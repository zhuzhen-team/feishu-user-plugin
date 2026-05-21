#!/usr/bin/env node
// Unit tests for the UAT lifecycle building blocks in src/auth/uat.js.
// Covers v1.3.14 hardening:
//   - decodeTokenExpiry: malformed JWT → 0 with stderr breadcrumb (no throw)
//   - acquireRefreshLock: basic acquire / contention timeout / stale recovery
//   - releaseRefreshLock: tolerant of already-released
//   - adoptPersistedUATIfNewer: peer-rotation adoption logic
//   - refreshUAT: invalid_grant → err.uatRevoked = true (via mocked fetch)
//   - refreshUAT: success path persists + adopts new token
//
// These are pure-unit; no live Feishu calls.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let pass = 0;
let fail = 0;

function ok(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  OK  ${name}`); pass++; },
                    (e) => { console.log(`  FAIL ${name}: ${e.message}`); fail++; });
    }
    console.log(`  OK  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
    fail++;
  }
}

async function run() {
  console.log('=== test-uat-lifecycle ===');

  const uat = require('./auth/uat');

  // --- decodeTokenExpiry ---
  await ok('decodeTokenExpiry: well-formed JWT returns exp', () => {
    // Hand-craft a JWT with exp=123456 (no signature; we only read payload).
    const payload = Buffer.from(JSON.stringify({ exp: 123456 }), 'utf8').toString('base64url');
    const token = `header.${payload}.sig`;
    assert.strictEqual(uat.decodeTokenExpiry(token), 123456);
  });

  await ok('decodeTokenExpiry: missing payload returns 0', () => {
    assert.strictEqual(uat.decodeTokenExpiry('only-header'), 0);
  });

  await ok('decodeTokenExpiry: malformed base64 returns 0 (with stderr breadcrumb)', () => {
    // Capture stderr so the breadcrumb doesn't pollute test output. We don't
    // assert on the message — just that the function doesn't throw and returns 0.
    const origErr = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    try {
      const v = uat.decodeTokenExpiry('header.not-base64-payload!!.sig');
      assert.strictEqual(v, 0);
      // We don't strictly require a breadcrumb (silent return 0 was the v1.3.13
      // behavior; v1.3.14 added stderr log). Test passes either way.
    } finally {
      console.error = origErr;
    }
  });

  await ok('decodeTokenExpiry: payload without exp returns 0', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'u_xxx' }), 'utf8').toString('base64url');
    assert.strictEqual(uat.decodeTokenExpiry(`h.${payload}.s`), 0);
  });

  // v1.3.14 — flood-gate test: a persistently-malformed JWT should only log
  // once per distinct token, not on every call. Without the gate, every
  // getValidUAT call (= every UAT-backed tool dispatch) flooded stderr.
  await ok('decodeTokenExpiry: same malformed token logs only once across repeated calls', () => {
    const origErr = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    try {
      const badToken = 'header.malformed-payload-XX-not-base64.sig-1';
      for (let i = 0; i < 5; i++) uat.decodeTokenExpiry(badToken);
      const decodeWarnings = captured.filter(l => /decodeTokenExpiry: malformed/.test(l));
      assert.strictEqual(decodeWarnings.length, 1,
        `expected exactly 1 decode warning for the same bad token across 5 calls; got ${decodeWarnings.length}: ${JSON.stringify(decodeWarnings)}`);
    } finally {
      console.error = origErr;
    }
  });

  await ok('decodeTokenExpiry: different malformed tokens each log once', () => {
    const origErr = console.error;
    const captured = [];
    console.error = (...args) => captured.push(args.join(' '));
    try {
      uat.decodeTokenExpiry('header.bad-A!!!XX.sig');
      uat.decodeTokenExpiry('header.bad-B@@@YY.sig');
      uat.decodeTokenExpiry('header.bad-C###ZZ.sig');
      const decodeWarnings = captured.filter(l => /decodeTokenExpiry: malformed/.test(l));
      assert.strictEqual(decodeWarnings.length, 3,
        `expected one warning per distinct bad token; got ${decodeWarnings.length}`);
    } finally {
      console.error = origErr;
    }
  });

  // --- acquireRefreshLock / releaseRefreshLock ---

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-uat-lifecycle-'));
  const lockPath = path.join(tmpDir, 'test.lock');

  await ok('acquireRefreshLock: fresh dir, lock acquires', async () => {
    const got = await uat.acquireRefreshLock(lockPath, { timeoutMs: 1000 });
    assert.strictEqual(got, true);
    assert.strictEqual(fs.existsSync(lockPath), true);
    uat.releaseRefreshLock(lockPath);
    assert.strictEqual(fs.existsSync(lockPath), false);
  });

  await ok('acquireRefreshLock: contention times out', async () => {
    const got1 = await uat.acquireRefreshLock(lockPath, { timeoutMs: 1000 });
    assert.strictEqual(got1, true);
    try {
      const got2 = await uat.acquireRefreshLock(lockPath, { timeoutMs: 500, pollMs: 100, staleMs: 60_000 });
      assert.strictEqual(got2, false, 'second acquire should fail while first holds');
    } finally {
      uat.releaseRefreshLock(lockPath);
    }
  });

  await ok('acquireRefreshLock: stale lock recovers', async () => {
    // Write a "stale" lock by setting mtime in the past.
    fs.writeFileSync(lockPath, `${process.pid}\n${Date.now() - 60_000}\n`);
    const oldTime = Date.now() - 60_000;
    fs.utimesSync(lockPath, oldTime / 1000, oldTime / 1000);
    // staleMs=5s — our lock is 60s old, should be detected and stolen.
    const got = await uat.acquireRefreshLock(lockPath, { timeoutMs: 2000, staleMs: 5_000, pollMs: 100 });
    assert.strictEqual(got, true, 'should steal stale lock');
    uat.releaseRefreshLock(lockPath);
  });

  await ok('releaseRefreshLock: tolerant of already-released', () => {
    // Should not throw.
    uat.releaseRefreshLock(lockPath);
    uat.releaseRefreshLock(path.join(tmpDir, 'never-existed.lock'));
  });

  // --- adoptPersistedUATIfNewer ---
  //
  // Uses a tmp HOME so we don't touch the real canonical store. We monkey-patch
  // os.homedir to point at our tmp.

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-home-'));
  fs.mkdirSync(path.join(fakeHome, '.feishu-user-plugin'), { recursive: true, mode: 0o700 });
  const fakeCanonical = path.join(fakeHome, '.feishu-user-plugin', 'credentials.json');
  const origHomedir = os.homedir;
  os.homedir = () => fakeHome;

  // Snapshot + clear LARK_* env vars so legacy fallback inside readCredentials
  // can't pick them up from the host process. Pre-v1.3.14 these tests passed
  // standalone but failed in `npm test` because test-all.js v1.3.14 backfill
  // populates process.env from the real canonical store.
  const SNAP_KEYS = ['LARK_COOKIE', 'LARK_APP_ID', 'LARK_APP_SECRET',
                     'LARK_USER_ACCESS_TOKEN', 'LARK_USER_REFRESH_TOKEN',
                     'LARK_UAT_EXPIRES', 'LARK_UAT_SCOPE', 'LARK_PROFILES_JSON'];
  const envSnapshot = {};
  for (const k of SNAP_KEYS) { envSnapshot[k] = process.env[k]; delete process.env[k]; }

  function writeCanonical(env) {
    fs.writeFileSync(fakeCanonical, JSON.stringify({
      version: 1,
      active: 'default',
      profiles: { default: env },
      profileHints: {},
    }, null, 2));
    fs.chmodSync(fakeCanonical, 0o600);
  }

  try {
    await ok('adoptPersistedUATIfNewer: no canonical → false', () => {
      // ensure no file
      try { fs.unlinkSync(fakeCanonical); } catch (_) {}
      const client = { _uat: null, _uatRefresh: null, _uatExpires: 0 };
      const r = uat.adoptPersistedUATIfNewer(client);
      assert.strictEqual(r, false);
    });

    await ok('adoptPersistedUATIfNewer: same token → false', () => {
      writeCanonical({
        LARK_USER_ACCESS_TOKEN: 'same.token.value',
        LARK_USER_REFRESH_TOKEN: 'same.refresh.value',
        LARK_UAT_EXPIRES: 5000,
      });
      const client = { _uat: 'same.token.value', _uatRefresh: 'same.refresh.value', _uatExpires: 5000 };
      const r = uat.adoptPersistedUATIfNewer(client);
      assert.strictEqual(r, false);
    });

    await ok('adoptPersistedUATIfNewer: newer access token → adopts', () => {
      writeCanonical({
        LARK_USER_ACCESS_TOKEN: 'new.access.token',
        LARK_USER_REFRESH_TOKEN: 'old.refresh',
        LARK_UAT_EXPIRES: 9999,
      });
      const client = { _uat: 'old.access', _uatRefresh: 'old.refresh', _uatExpires: 5000 };
      const r = uat.adoptPersistedUATIfNewer(client);
      assert.strictEqual(r, true);
      assert.strictEqual(client._uat, 'new.access.token');
      assert.strictEqual(client._uatExpires, 9999);
    });

    await ok('adoptPersistedUATIfNewer: rotated refresh_token → adopts', () => {
      writeCanonical({
        LARK_USER_ACCESS_TOKEN: 'same.access',
        LARK_USER_REFRESH_TOKEN: 'rotated.refresh',
        LARK_UAT_EXPIRES: 5000,
      });
      const client = { _uat: 'same.access', _uatRefresh: 'old.refresh', _uatExpires: 5000 };
      const r = uat.adoptPersistedUATIfNewer(client);
      assert.strictEqual(r, true);
      assert.strictEqual(client._uatRefresh, 'rotated.refresh');
    });
  } finally {
    os.homedir = origHomedir;
    // Restore the LARK_* env vars we cleared for this test.
    for (const k of SNAP_KEYS) {
      if (envSnapshot[k] === undefined) delete process.env[k];
      else process.env[k] = envSnapshot[k];
    }
  }

  // --- refreshUAT: invalid_grant → err.uatRevoked = true ---
  //
  // Monkey-patch global.fetch to simulate Feishu refresh responses without
  // touching the network. fetchWithTimeout in utils.js delegates to global.fetch.

  await ok('refreshUAT: invalid_grant throws err.uatRevoked=true', async () => {
    os.homedir = () => fakeHome;
    writeCanonical({
      LARK_USER_ACCESS_TOKEN: 'expired.token',
      LARK_USER_REFRESH_TOKEN: 'dead.refresh',
      LARK_UAT_EXPIRES: Math.floor(Date.now() / 1000) - 3600, // 1h ago
    });

    const origFetch = global.fetch;
    global.fetch = async () => ({
      json: async () => ({ error: 'invalid_grant', error_description: 'refresh_token expired' }),
    });

    try {
      const client = {
        appId: 'test', appSecret: 'test',
        _uat: 'expired.token',
        _uatRefresh: 'dead.refresh',
        _uatExpires: Math.floor(Date.now() / 1000) - 3600,
      };
      let thrown = null;
      try {
        await uat.refreshUAT(client);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'refreshUAT should throw');
      assert.strictEqual(thrown.uatRevoked, true, 'err.uatRevoked must be true');
      assert.ok(thrown.message.includes('invalid_grant') || thrown.message.includes('refresh_token'),
                `error message should reference invalid_grant: ${thrown.message}`);
      // Critically: error message must NOT contain the raw response body /
      // refresh_token bytes. v1.3.14 redact regression guard.
      assert.ok(!thrown.message.includes('dead.refresh'), 'error message must not echo refresh_token');
    } finally {
      global.fetch = origFetch;
      os.homedir = origHomedir;
    }
  });

  // identity-state.js redact-regex regression guard. Exercises the actual
  // regex on `_classifyUatFailure` path that the previous "no dead.refresh"
  // assertion in test #14 did NOT cover (the invalid_grant message is
  // hard-coded with no interpolation, so it's trivially redacted).
  await ok('identity-state _classifyUatFailure: redact regex strips long token-like strings from uatError.message', () => {
    const { _classifyUatFailure } = require('./auth/identity-state');
    // A realistic-looking JWT-like base64-ish string > 40 chars.
    const longToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3Nzk0MDAwMDB9.abc123def456ghi789jklmnoXYZabcdefgXXXX';
    assert.ok(longToken.length >= 40, 'fixture token should be >= 40 chars to trigger redact');
    const fakeErr = new Error(`UAT request failed: server returned: ${longToken}`);
    const cls = _classifyUatFailure(null, fakeErr);
    assert.ok(cls, 'should classify a uatError');
    assert.ok(!cls.viaReason.includes(longToken), `viaReason must not contain raw long token; got: ${cls.viaReason}`);
    assert.ok(cls.viaReason.includes('<redacted>'), `viaReason must contain '<redacted>' marker; got: ${cls.viaReason}`);
    assert.strictEqual(cls.state, null, 'non-uatRevoked errors should not refine identity from this path');
  });

  await ok('identity-state _classifyUatFailure: uatRevoked flag short-circuits to UAT_REVOKED state', () => {
    const { _classifyUatFailure, IdentityState } = require('./auth/identity-state');
    const err = new Error('UAT refresh_token rejected by Feishu (invalid_grant). The 7-day refresh chain is broken. Run: npx feishu-user-plugin oauth to re-authorize.');
    err.uatRevoked = true;
    const cls = _classifyUatFailure(null, err);
    assert.strictEqual(cls.state, IdentityState.UAT_REVOKED, 'uatRevoked flag must refine state to UAT_REVOKED');
    assert.ok(cls.viaReason.includes('invalid_grant') || cls.viaReason.includes('rejected'),
              `viaReason must mention rejection: ${cls.viaReason}`);
  });

  await ok('refreshUAT: non-invalid_grant error does NOT set uatRevoked', async () => {
    os.homedir = () => fakeHome;
    writeCanonical({
      LARK_USER_ACCESS_TOKEN: 'expired.token',
      LARK_USER_REFRESH_TOKEN: 'live.refresh',
      LARK_UAT_EXPIRES: Math.floor(Date.now() / 1000) - 3600,
    });

    const origFetch = global.fetch;
    global.fetch = async () => ({
      json: async () => ({ code: 99991663, msg: 'token transient error' }),
    });

    try {
      const client = {
        appId: 'test', appSecret: 'test',
        _uat: 'expired.token',
        _uatRefresh: 'live.refresh',
        _uatExpires: Math.floor(Date.now() / 1000) - 3600,
      };
      let thrown = null;
      try {
        await uat.refreshUAT(client);
      } catch (e) {
        thrown = e;
      }
      assert.ok(thrown, 'should throw on non-success');
      assert.ok(!thrown.uatRevoked, 'transient error should not set uatRevoked');
      assert.ok(thrown.message.includes('99991663') || thrown.message.includes('transient'),
                `should mention specific error: ${thrown.message}`);
    } finally {
      global.fetch = origFetch;
      os.homedir = origHomedir;
    }
  });

  // --- Cleanup ---
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n=== test-uat-lifecycle: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-uat-lifecycle harness error:', e); process.exit(1); });
}

module.exports = { run };
