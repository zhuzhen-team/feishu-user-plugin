// src/test-with-uat-retry.js — unit test for the v1.3.12 widening of
// `withUAT` in src/auth/uat.js.
//
// Background: pre-v1.3.12 `withUAT` only retried fn() when the response
// carried code in {99991668, 99991663, 99991677} (it refreshed the UAT and
// re-ran). Anything else — network blip, truncated JSON body, ECONNRESET —
// bubbled straight out, even though one retry would have cleared the failure.
//
// New behaviour:
//   1. If fn() throws AND classifyError says action='retry', call fn() one
//      more time with the *same* uat (it's an upstream flake, not an auth
//      issue — refreshing wouldn't help).
//   2. Existing 99991668 / 99991663 / 99991677 path is unchanged: refresh
//      then re-run.
//   3. Otherwise (success, or non-retriable code) return data as-is.
//
// Real Feishu API is NOT touched — we mock fn() directly.

'use strict';

const assert = require('node:assert/strict');
const { withUAT } = require('./auth/uat');

function fakeClient() {
  const farFuture = Math.floor(Date.now() / 1000) + 3600;
  return {
    appId: 'cli_test',
    appSecret: 'secret',
    _uat: 'fake_token',
    _uatRefresh: 'fake_refresh',
    _uatExpires: farFuture,
    get hasUAT() { return !!this._uat; },
  };
}

async function run() {
  // --- 1. Success on first try → no retry ---
  {
    let calls = 0;
    const data = await withUAT(fakeClient(), async () => {
      calls++;
      return { code: 0, data: { ok: true } };
    });
    assert.equal(calls, 1);
    assert.equal(data.code, 0);
  }

  // --- 2. Throws network error → retries once, succeeds ---
  {
    let calls = 0;
    const data = await withUAT(fakeClient(), async () => {
      calls++;
      if (calls === 1) throw new Error('fetch timeout after 10000ms');
      return { code: 0, data: { ok: true } };
    });
    assert.equal(calls, 2, 'should retry transient throw once');
    assert.equal(data.code, 0);
  }

  // --- 3. Throws JSON parse error → retries once ---
  {
    let calls = 0;
    const data = await withUAT(fakeClient(), async () => {
      calls++;
      if (calls === 1) {
        const err = new SyntaxError('Unexpected end of JSON input');
        throw err;
      }
      return { code: 0, data: { ok: 'parsed' } };
    });
    assert.equal(calls, 2);
    assert.equal(data.data.ok, 'parsed');
  }

  // --- 4. Throws non-retriable error → re-throws (no retry) ---
  {
    let calls = 0;
    let caught;
    try {
      await withUAT(fakeClient(), async () => {
        calls++;
        throw new Error('something completely unexpected');
      });
    } catch (e) { caught = e; }
    assert.equal(calls, 1, 'unknown error should not retry');
    assert.ok(caught);
    assert.ok(caught.message.includes('something completely unexpected'));
  }

  // --- 5. Throws transient on BOTH attempts → re-throws ---
  {
    let calls = 0;
    let caught;
    try {
      await withUAT(fakeClient(), async () => {
        calls++;
        throw new Error('fetch timeout after 10000ms');
      });
    } catch (e) { caught = e; }
    assert.equal(calls, 2, 'should give up after one retry');
    assert.ok(caught);
  }

  // --- 6. ECONNRESET pattern → retry ---
  {
    let calls = 0;
    const data = await withUAT(fakeClient(), async () => {
      calls++;
      if (calls === 1) throw new Error('socket hang up ECONNRESET');
      return { code: 0 };
    });
    assert.equal(calls, 2);
  }

  // --- 7. Existing auth-code path still works: 99991663 triggers refresh ---
  // We can't easily mock refreshUAT without rewiring; verify the data path
  // for the simple non-refresh "no auth code" case here (refresh path is
  // exercised by integration tests / real API).
  {
    let calls = 0;
    const data = await withUAT(fakeClient(), async () => {
      calls++;
      return { code: 42101, msg: 'rate limited' };
    });
    // 42101 is not an auth code so withUAT returns it without refresh-retry.
    // (Caller may decide to retry via classifyError separately.)
    assert.equal(calls, 1);
    assert.equal(data.code, 42101);
  }

  console.log('with-uat-retry.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
