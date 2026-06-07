// src/test-error-codes.js — unit test for src/error-codes.js classifyError.
//
// Covers the v1.3.12 widening:
//   - 20064 (invalid_grant — UAT revoked, permanent)
//   - 91403 (cross-tenant bot — bot can never access, route to UAT)
//   - 1254xxx upload errors (transient — retry once)
//   - res.json() parse failure messages → 'retry' (transient)
//
// Each case maps an error code (or Error object) to { action, reason } the
// classifier should output. Run via `node src/test-error-codes.js` or as part
// of `npm test` (imported from src/test-all.js).

'use strict';

const assert = require('node:assert/strict');
const { classifyError, FAILURE_MAP, TRANSIENT_PATTERNS } = require('./error-codes');

function run() {
  // --- Existing classifications (regression guard) ---
  assert.deepEqual(
    classifyError(240001),
    { action: 'uat', reason: 'bot_external_tenant', code: 240001 },
    '240001 → bot_external_tenant',
  );
  assert.deepEqual(
    classifyError(70009),
    { action: 'uat', reason: 'bot_no_permission', code: 70009 },
  );
  assert.deepEqual(
    classifyError(42101),
    { action: 'retry', reason: 'bot_rate_limited', code: 42101 },
  );

  // --- New v1.3.12 entries ---
  const m20064 = classifyError(20064);
  assert.equal(m20064.action, 'uat', '20064 should escalate to UAT path (revoked permanent)');
  assert.equal(m20064.reason, 'uat_revoked', '20064 reason should be uat_revoked');

  const m91403 = classifyError(91403);
  assert.equal(m91403.action, 'uat', '91403 cross-tenant bot');
  assert.equal(m91403.reason, 'bot_cross_tenant');

  // 1254xxx — a sample of upload failures observed in production
  for (const code of [1254000, 1254001, 1254301, 1254400]) {
    const c = classifyError(code);
    assert.equal(c.action, 'retry', `${code} should be transient (retry)`);
    assert.equal(c.reason, 'upload_transient', `${code} reason`);
  }

  // --- 2200 docx scope-check flake (v1.3.17) ---
  // Field report 2026-06-07: a mode-F table fill saw 15 identical updateDocBlock
  // calls succeed, then "code=2200 check incr user_access_token scope fail" —
  // same token, so the scope was fine; the check itself is intermittently flaky
  // under rapid-fire docx writes. Classified transient so cell-fill retries it.
  const c2200 = classifyError(2200);
  assert.equal(c2200.action, 'retry', '2200 should be transient (retry)');
  const bothIdentities = new Error('updateDocBlock failed on both identities. as user: code=2200 msg=check incr user_access_token scope fail. as app: updateDocBlock failed (HTTP 403, code=1770032): forBidden');
  assert.equal(classifyError(bothIdentities).action, 'retry', 'combined both-identities message extracts the UAT-side 2200');

  // --- res.json() parse failures should retry once ---
  // Real-world: feishu's gateway occasionally returns truncated bodies that
  // make response.json() throw SyntaxError; one retry usually clears it.
  const parseErr = new Error('Unexpected end of JSON input');
  parseErr.name = 'SyntaxError';
  const parseClass = classifyError(parseErr);
  assert.equal(parseClass.action, 'retry', 'JSON parse error → retry');
  assert.equal(parseClass.reason, 'response_parse_error');

  // --- Existing transient patterns still work ---
  const networkErr = new Error('fetch timeout after 10000ms');
  assert.equal(classifyError(networkErr).action, 'retry');

  const httpFive = new Error('readMessages failed (HTTP 503, code=99991400): rate limited');
  // Note: code=99991400 hits FAILURE_MAP before the pattern. Either way action=retry.
  assert.equal(classifyError(httpFive).action, 'retry');

  // --- Unknown codes preserve fallback behavior ---
  assert.deepEqual(
    classifyError(99999),
    { action: 'unknown', reason: 'bot_unknown_error', code: 99999 },
  );

  // --- TRANSIENT_PATTERNS still exported ---
  assert.ok(Array.isArray(TRANSIENT_PATTERNS) && TRANSIENT_PATTERNS.length >= 5);

  // --- FAILURE_MAP coverage: all new codes are registered ---
  assert.ok(FAILURE_MAP[20064], 'FAILURE_MAP must register 20064');
  assert.ok(FAILURE_MAP[91403], 'FAILURE_MAP must register 91403');
  assert.ok(FAILURE_MAP[1254000], 'FAILURE_MAP must register 1254000');

  console.log('error-codes.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
