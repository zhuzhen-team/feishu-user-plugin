// src/test-identity-state.js — unit test for src/auth/identity-state.js.
//
// resolveIdentity + withIdentityFallback are the v1.3.12 replacement for
// asUserOrApp's silent fallback. Behaviour we test:
//
//   1. resolveIdentity reads in-memory client state (no API call by default)
//      and returns one of: VALID_USER / UAT_EXPIRED / BOT_ONLY / NO_CREDENTIALS.
//   2. withIdentityFallback wraps a UAT-first / bot-fallback flow, attaches
//      via / via_reason / identity to the response, refines the cached
//      identity on UAT failure (e.g. 20064 → UAT_REVOKED), and returns a
//      well-formed combined error when both sides fail.
//   3. invalidateIdentity clears the 30s cache so a new probe is taken next
//      time (CredentialsMonitor will call this on UAT change).

'use strict';

const assert = require('node:assert/strict');
const {
  IdentityState,
  resolveIdentity,
  withIdentityFallback,
  invalidateIdentity,
} = require('./auth/identity-state');

// Minimal fake client. Real LarkOfficialClient exposes hasUAT (getter), appId,
// _uat, _uatExpires; tests only need those.
function fakeClient({ hasUAT = false, appId = 'cli_test', expires = 0 } = {}) {
  return {
    appId,
    appSecret: 'secret',
    _uat: hasUAT ? 'token' : null,
    _uatRefresh: hasUAT ? 'refresh' : null,
    _uatExpires: expires,
    get hasUAT() { return !!this._uat; },
  };
}

async function run() {
  // --- 1. enum values are exported ---
  for (const k of ['VALID_USER', 'UAT_EXPIRED', 'UAT_REVOKED', 'UAT_MISSING_SCOPE', 'BOT_ONLY', 'NO_CREDENTIALS']) {
    assert.ok(IdentityState[k], `IdentityState.${k} should be defined`);
  }

  // --- 2. resolveIdentity, no UAT, has app ---
  const c1 = fakeClient({ hasUAT: false, appId: 'cli_x' });
  invalidateIdentity(c1);
  assert.equal(await resolveIdentity(c1), IdentityState.BOT_ONLY);

  // --- 3. resolveIdentity, no UAT, no app ---
  const c2 = fakeClient({ hasUAT: false, appId: null });
  invalidateIdentity(c2);
  assert.equal(await resolveIdentity(c2), IdentityState.NO_CREDENTIALS);

  // --- 4. resolveIdentity, valid UAT (future expiry) ---
  const c3 = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(c3);
  assert.equal(await resolveIdentity(c3), IdentityState.VALID_USER);

  // --- 5. resolveIdentity, expired UAT (past expiry) ---
  const c4 = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) - 100 });
  invalidateIdentity(c4);
  assert.equal(await resolveIdentity(c4), IdentityState.UAT_EXPIRED);

  // --- 6. resolveIdentity cache: change underlying state, get cached value ---
  invalidateIdentity(c1);
  assert.equal(await resolveIdentity(c1), IdentityState.BOT_ONLY);
  c1._uat = 'token'; // simulate adopt-persisted-uat happened mid-flight
  c1._uatExpires = Math.floor(Date.now() / 1000) + 3600;
  // Still cached — 30s window not elapsed.
  assert.equal(await resolveIdentity(c1), IdentityState.BOT_ONLY, 'cache should hold within 30s');
  invalidateIdentity(c1);
  assert.equal(await resolveIdentity(c1), IdentityState.VALID_USER, 'invalidate reads fresh state');

  // --- 7. withIdentityFallback: UAT path succeeds ---
  const cOk = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(cOk);
  const r1 = await withIdentityFallback({
    client: cOk,
    uatFn: async () => ({ code: 0, data: { ok: true } }),
    botFn: async () => { throw new Error('should not run'); },
    label: 'test_op',
  });
  assert.equal(r1.via, 'uat');
  assert.equal(r1.identity, IdentityState.VALID_USER);
  assert.equal(r1.data.code, 0);
  assert.equal(r1.data.ok, undefined, 'should pass through fields, not double-wrap');
  assert.equal(r1.data.data.ok, true);
  assert.equal(r1.viaReason, undefined, 'no fallback → no via_reason');
  // PR #103 Codex P1 followup: UAT success must set the legacy _viaUser=true
  // marker so 15+ _asUserOrApp callsites (calendar/docs/bitable/wiki/okr/tasks
  // /drive) report viaUser:true. Without this flag downstream code thinks the
  // resource was created by the bot.
  assert.equal(r1.data._viaUser, true, 'UAT success path must mark _viaUser=true on response');

  // --- 8. withIdentityFallback: UAT returns 20064 → bot fallback, identity refined ---
  let botRan = false;
  const cRevoked = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(cRevoked);
  const r2 = await withIdentityFallback({
    client: cRevoked,
    uatFn: async () => ({ code: 20064, msg: 'invalid_grant' }),
    botFn: async () => { botRan = true; return { code: 0, data: { from: 'bot' } }; },
    label: 'test_revoked',
  });
  assert.equal(botRan, true);
  assert.equal(r2.via, 'bot');
  assert.equal(r2.identity, IdentityState.UAT_REVOKED, 'identity refined on 20064');
  assert.ok(typeof r2.viaReason === 'string' && r2.viaReason.includes('20064'));
  assert.ok(r2.fallbackWarning && r2.fallbackWarning.includes('UAT'));

  // Subsequent resolveIdentity sees the refined cached state without re-probe.
  assert.equal(await resolveIdentity(cRevoked), IdentityState.UAT_REVOKED);

  // --- 9. withIdentityFallback: UAT 99991668 → UAT_MISSING_SCOPE ---
  const cScope = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(cScope);
  const r3 = await withIdentityFallback({
    client: cScope,
    uatFn: async () => ({ code: 99991668, msg: 'scope not granted' }),
    botFn: async () => ({ code: 0, data: { ok: true } }),
    label: 'test_scope',
  });
  assert.equal(r3.identity, IdentityState.UAT_MISSING_SCOPE);
  assert.equal(r3.via, 'bot');

  // --- 10. withIdentityFallback: UAT throws → bot fallback ---
  const cThrow = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(cThrow);
  const r4 = await withIdentityFallback({
    client: cThrow,
    uatFn: async () => { throw new Error('network blew up'); },
    botFn: async () => ({ code: 0, data: { ok: 'bot' } }),
    label: 'test_throw',
  });
  assert.equal(r4.via, 'bot');
  assert.ok(r4.viaReason.includes('network blew up'));

  // --- 11. withIdentityFallback: BOT_ONLY → no uat attempted, informational warning ---
  const cBotOnly = fakeClient({ hasUAT: false, appId: 'cli_x' });
  invalidateIdentity(cBotOnly);
  let uatRan = false;
  const r5 = await withIdentityFallback({
    client: cBotOnly,
    uatFn: async () => { uatRan = true; return { code: 0 }; },
    botFn: async () => ({ code: 0, data: { ok: 'bot' } }),
    label: 'test_botonly',
  });
  assert.equal(uatRan, false, 'BOT_ONLY must not invoke uatFn');
  assert.equal(r5.via, 'bot');
  assert.equal(r5.identity, IdentityState.BOT_ONLY);
  // BOT_ONLY still attaches the legacy "未配置 UAT" informational warning so
  // users notice that resources will be owned by the shared bot.
  assert.ok(r5.fallbackWarning && r5.fallbackWarning.includes('未配置 UAT'));

  // --- 12. withIdentityFallback: both sides fail → throws combined error ---
  const cBoth = fakeClient({ hasUAT: true, expires: Math.floor(Date.now() / 1000) + 3600 });
  invalidateIdentity(cBoth);
  let caught;
  try {
    await withIdentityFallback({
      client: cBoth,
      uatFn: async () => ({ code: 99991668, msg: 'no scope' }),
      botFn: async () => { throw new Error('bot not in chat'); },
      label: 'test_both_fail',
    });
  } catch (e) { caught = e; }
  assert.ok(caught, 'both-fail should throw');
  assert.ok(caught.message.includes('test_both_fail'));
  assert.ok(caught.message.includes('bot not in chat'));
  assert.ok(caught.uatSummary, 'combined error carries uatSummary');
  assert.ok(caught.botError, 'combined error carries botError');

  console.log('identity-state.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
