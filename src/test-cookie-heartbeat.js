#!/usr/bin/env node
// Tests for src/auth/cookie.js owner-gated heartbeat (v1.3.14).
//
// Covers:
//   - _isHeartbeatRunner: returns true when this process IS the ws-owner
//   - _isHeartbeatRunner: returns false when another pid owns ws-owner.lock
//   - _isHeartbeatRunner: returns true when ws-owner.lock is missing (fallback)
//   - _isHeartbeatRunner: returns true when lock body is malformed (fallback)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let pass = 0;
let fail = 0;

function ok(name, fn) {
  try {
    fn();
    console.log(`  OK  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
    fail++;
  }
}

function run() {
  console.log('=== test-cookie-heartbeat ===');

  const { _isHeartbeatRunner } = require('./auth/cookie');

  // Use a tmpdir + override lockPath/pid for hermetic testing
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cookie-hb-'));
  const fakeLock = path.join(tmpDir, 'ws-owner.lock');

  ok('returns true when this pid IS the lock owner', () => {
    fs.writeFileSync(fakeLock, JSON.stringify({
      version: 1, pid: 12345, start_time: Date.now() / 1000, role: 'ws_owner',
    }));
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, true);
  });

  ok('returns false when another pid owns the lock', () => {
    fs.writeFileSync(fakeLock, JSON.stringify({
      version: 1, pid: 99999, start_time: Date.now() / 1000, role: 'ws_owner',
    }));
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, false);
  });

  ok('returns true (fallback) when lock file missing', () => {
    try { fs.unlinkSync(fakeLock); } catch (_) {}
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, true, 'no owner claimed → every process runs heartbeat');
  });

  ok('returns true (fallback) when lock body malformed', () => {
    fs.writeFileSync(fakeLock, 'not-valid-json');
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, true);
  });

  ok('returns true (fallback) when lock body has no pid field', () => {
    fs.writeFileSync(fakeLock, JSON.stringify({ version: 1, start_time: 1, role: 'ws_owner' }));
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, true);
  });

  ok('returns true (fallback) when lock body pid is a string', () => {
    fs.writeFileSync(fakeLock, JSON.stringify({ version: 1, pid: '12345', start_time: 1 }));
    const r = _isHeartbeatRunner(fakeLock, 12345);
    assert.strictEqual(r, true, 'malformed pid type → fall back to running');
  });

  // --- _heartbeatTick: the tick path itself ---

  const { _heartbeatTick } = require('./auth/cookie');

  // Helper to assert tick behavior with injectable deps.
  async function tickWith({ isOwner, expectGetCsrf, expectPersist, expectReturn, throwCsrf = false }) {
    let getCsrfCalled = false;
    let persistCalled = false;
    let persistArg = null;
    const client = {
      cookieStr: 'session=abc; sl_session=def',
      _getCsrfToken: async () => {
        getCsrfCalled = true;
        if (throwCsrf) throw new Error('network down');
      },
    };
    const result = await _heartbeatTick(client, {
      isHeartbeatRunner: () => isOwner,
      persistToConfig: (updates) => { persistCalled = true; persistArg = updates; },
    });
    assert.strictEqual(result, expectReturn, `expected return value ${expectReturn}, got ${result}`);
    assert.strictEqual(getCsrfCalled, expectGetCsrf, `_getCsrfToken called=${getCsrfCalled} expected ${expectGetCsrf}`);
    assert.strictEqual(persistCalled, expectPersist, `persistToConfig called=${persistCalled} expected ${expectPersist}`);
    if (expectPersist) {
      assert.deepStrictEqual(persistArg, { LARK_COOKIE: 'session=abc; sl_session=def' },
        `persist called with wrong payload: ${JSON.stringify(persistArg)}`);
    }
  }

  ok('_heartbeatTick: non-owner skips network call AND persist', async () => {
    await tickWith({ isOwner: false, expectGetCsrf: false, expectPersist: false, expectReturn: 'skip' });
  });

  ok('_heartbeatTick: owner calls _getCsrfToken + persists refreshed cookie', async () => {
    await tickWith({ isOwner: true, expectGetCsrf: true, expectPersist: true, expectReturn: 'refreshed' });
  });

  ok('_heartbeatTick: owner with _getCsrfToken throw → returns error WITHOUT persist', async () => {
    await tickWith({ isOwner: true, expectGetCsrf: true, expectPersist: false, expectReturn: 'error', throwCsrf: true });
  });

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n=== test-cookie-heartbeat: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error('test-cookie-heartbeat harness error:', e); process.exit(1); }
}

module.exports = { run };
