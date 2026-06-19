// Feishu error-code classification for read_messages fallback routing.
//
// The v1.3.2 read_messages handler catches any bot failure and unconditionally
// retries with UAT. That's cheap when the bot fails fast, but it has two flaws
// in v1.3.3:
//   • Transient errors (rate-limit, network stalls) are treated the same as
//     permanent permission errors — the UAT path runs when a 2-second retry
//     would have worked.
//   • When UAT is absent, the raw Feishu payload leaks to the user verbatim,
//     with no hint that OAuth is the fix.
//
// This table classifies known codes into three buckets:
//   'uat'     — permanent bot failure; hop straight to UAT.
//   'retry'   — likely transient; caller should retry once (after short delay)
//               and fall through to UAT if still failing.
//   'unknown' — not seen before; preserve v1.3.3 behaviour (try UAT silently).

const FAILURE_MAP = {
  // External tenant — bot lives in a different tenant, will never be granted.
  240001: { action: 'uat', reason: 'bot_external_tenant' },
  // No permission for the resource (scope missing, or chat restricts bot reads).
  70009:  { action: 'uat', reason: 'bot_no_permission' },
  // Bot is not a member of the chat.
  70003:  { action: 'uat', reason: 'bot_not_in_chat' },
  99991668: { action: 'uat', reason: 'bot_not_in_chat' },
  // Chat does not exist (from the bot's POV — may still be accessible to user).
  19001:  { action: 'uat', reason: 'bot_chat_not_found' },

  // UAT revoked — refresh_token explicitly invalid_grant (user revoked OAuth
  // or the 7-day refresh_token window elapsed without any successful refresh
  // to roll it forward). The live trigger for this code lives in
  // identity-state.js::_classifyUatFailure (UAT REST throws / returns 20064);
  // this entry exists for *symmetry* — should a bot-side surface ever return
  // 20064 (it shouldn't, bot uses app_access_token not refresh_token), the
  // fallback caller would route to UAT once and surface revocation.
  20064: { action: 'uat', reason: 'uat_revoked' },
  // Cross-tenant bot block — bot lives in tenant A, target resource is in
  // tenant B. Will never be granted. Distinct from 240001 (which is the
  // older code form for the same shape); both surface in production.
  91403: { action: 'uat', reason: 'bot_cross_tenant' },
  // OAuth scope not granted on the bot/app surface — one of the documented
  // multi-profile auto-switch read-path codes. classifyError previously fell
  // through to 'unknown' (which also routes to UAT), so this entry preserves
  // behaviour while disambiguating logs/monitoring for the scope-missing case.
  99991672: { action: 'uat', reason: 'oauth_scope_not_granted' },

  // Upload pipeline transient errors — the Feishu upload gateway is
  // intermittently flaky; one retry after a moment usually clears.
  // 1254000 / 1254001 are generic upload failures, 1254301 is multipart
  // size mismatch (rare race when the body is being computed concurrently),
  // 1254400 is "upload service busy" the gateway returns under load.
  //
  // NOTE: Feishu reuses 1254000/1254301 across APIs — in the BITABLE context
  // they mean "access denied", which profile-router's SWITCH_CODES treats as a
  // cross-profile auto-switch trigger. That is not a contradiction: this map
  // drives classifyError → withUAT retry on the UPLOAD path (a write, so
  // profile-router never auto-switches it), while SWITCH_CODES drives bitable
  // READ routing (never an upload). The two never fire on the same call-site;
  // each interprets the reused code correctly for its own context.
  1254000: { action: 'retry', reason: 'upload_transient' },
  1254001: { action: 'retry', reason: 'upload_transient' },
  1254301: { action: 'retry', reason: 'upload_transient' },
  1254400: { action: 'retry', reason: 'upload_transient' },

  // docx scope-check flake — "check incr user_access_token scope fail".
  // Field report 2026-06-07: a mode-F table fill saw 15 identical
  // updateDocBlock calls succeed, then 2200 — same UAT, so the scope was
  // granted; Feishu's incremental-scope check is intermittently flaky under
  // rapid-fire docx writes. A short-backoff retry usually clears it.
  2200: { action: 'retry', reason: 'docx_scope_check_transient' },

  // Rate limited — Feishu throttles, try once more after a brief pause.
  42101:  { action: 'retry', reason: 'bot_rate_limited' },
  // Frequency control variants occasionally observed.
  99991400: { action: 'retry', reason: 'bot_rate_limited' },
};

// HTTP-status / network-error patterns that warrant one retry.
// Axios-wrapped messages from @larksuiteoapi/node-sdk embed the http status
// into _safeSDKCall's rethrown message. We match those substrings.
const TRANSIENT_PATTERNS = [
  /HTTP 5\d\d/i,         // Any 5xx from upstream
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /fetch timeout after/i, // from utils.fetchWithTimeout
  /socket hang up/i,
  /Unexpected end of JSON input/i,
  /Unexpected token .* in JSON/i,
];

// Recognise res.json() parse failures so withUAT widens retry to them too.
// The Feishu gateway occasionally returns a truncated body that crashes
// JSON.parse — classifying the SyntaxError as transient lets the wrapper
// recover with a single retry instead of bubbling a cryptic parse error.
function _isJsonParseError(err) {
  if (!err) return false;
  if (err.name === 'SyntaxError') return true;
  const msg = err.message || '';
  return /Unexpected end of JSON input/i.test(msg) || /Unexpected token .* in JSON/i.test(msg);
}

/**
 * Classify an error thrown by a bot-API path.
 * Input is either the Feishu code number (preferred) or the Error object —
 * the code is extracted from the message if present.
 *
 * Output: { action: 'uat' | 'retry' | 'unknown', reason: string, code: number|null }
 */
function classifyError(errOrCode) {
  let code = null;
  let msg = '';
  if (typeof errOrCode === 'number') {
    code = errOrCode;
  } else if (errOrCode && typeof errOrCode === 'object') {
    msg = errOrCode.message || String(errOrCode);
    // _safeSDKCall formats as "label failed (HTTP N, code=XXX): ..." or "label failed (CODE): ..."
    const m = msg.match(/code[=(]\s*(\d+)/i) || msg.match(/failed\s*\((\d+)\)/i);
    if (m) code = parseInt(m[1], 10);
  }

  if (code != null && FAILURE_MAP[code]) {
    return { ...FAILURE_MAP[code], code };
  }
  // res.json() parse failures get a dedicated reason so logs disambiguate
  // them from generic network flakes (different remediation in monitoring).
  if (errOrCode && typeof errOrCode === 'object' && _isJsonParseError(errOrCode)) {
    return { action: 'retry', reason: 'response_parse_error', code };
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(msg)) return { action: 'retry', reason: 'bot_network_error', code };
  }
  return { action: 'unknown', reason: 'bot_unknown_error', code };
}

module.exports = {
  classifyError,
  FAILURE_MAP,
  TRANSIENT_PATTERNS,
};
