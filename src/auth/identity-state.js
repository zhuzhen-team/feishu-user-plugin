// src/auth/identity-state.js — identity state machine for UAT-first/bot-fallback flows.
//
// The v1.3.7 pattern was `asUserOrApp` in src/auth/uat.js: try UAT, catch any
// failure, retry with bot, and attach a string `_fallbackWarning`. That works
// but is opaque: the caller can't tell whether UAT was revoked (need to
// re-oauth), expired (will refresh on next call), missing scope (need admin),
// or just experienced a network blip. The 2026-05 incident showed how this
// hides "UAT revoked for weeks" because every tool silently retried bot.
//
// This module adds a first-class IdentityState enum + a reactive cache. Each
// call to withIdentityFallback returns `{ data, via, viaReason, identity }`;
// LLMs and the get_login_status diagnostic can read the identity directly
// instead of grepping warning strings.
//
// Cache: keyed by appId (one entry per LarkOfficialClient instance is enough
// in practice — clients aren't shared across appIds in this codebase, but
// keying by appId is the safe contract). 30 second TTL. Refined writes from
// withIdentityFallback bypass TTL and write through immediately.
//
// What it owns:
//   - IdentityState enum
//   - resolveIdentity(client) — reads in-memory state into a state value
//   - withIdentityFallback({client, uatFn, botFn, label}) — composable wrapper
//   - invalidateIdentity(client) — cache eviction (CredentialsMonitor hook)

'use strict';

const IdentityState = Object.freeze({
  VALID_USER:        'VALID_USER',
  UAT_EXPIRED:       'UAT_EXPIRED',
  UAT_REVOKED:       'UAT_REVOKED',
  UAT_MISSING_SCOPE: 'UAT_MISSING_SCOPE',
  BOT_ONLY:          'BOT_ONLY',
  NO_CREDENTIALS:    'NO_CREDENTIALS',
});

const CACHE_TTL_MS = 30_000;
const _cache = new Map(); // key = client.appId — value = { state, expiresAt }

function _key(client) {
  // Fall back to a sentinel for clients without appId so NO_CREDENTIALS is still cacheable.
  return client?.appId || '__no_app__';
}

function _readInMemoryState(client) {
  if (!client) return IdentityState.NO_CREDENTIALS;
  const hasApp = !!client.appId;
  const hasUAT = !!client.hasUAT;
  if (!hasUAT && !hasApp) return IdentityState.NO_CREDENTIALS;
  if (!hasUAT) return IdentityState.BOT_ONLY;
  // hasUAT true — distinguish VALID_USER vs UAT_EXPIRED by expiry timestamp.
  // expires=0 means "we never decoded — treat as valid and let the refresh
  // path decide". Negative expiry never occurs but is treated as expired.
  const now = Math.floor(Date.now() / 1000);
  if (client._uatExpires && client._uatExpires > 0 && client._uatExpires <= now) {
    return IdentityState.UAT_EXPIRED;
  }
  return IdentityState.VALID_USER;
}

async function resolveIdentity(client) {
  const k = _key(client);
  const cached = _cache.get(k);
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  const state = _readInMemoryState(client);
  _cache.set(k, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

function invalidateIdentity(client) {
  _cache.delete(_key(client));
}

// Write a refined state through to the cache (bypasses TTL). Called when
// withIdentityFallback observes a definitive UAT failure (revoked, missing
// scope) — the cache should reflect what we just learned, not what was
// inferred from in-memory state alone.
function _refineIdentity(client, state) {
  _cache.set(_key(client), { state, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Classify a UAT-side failure into a refined IdentityState + a human-readable
// via_reason string. Returns null if the failure isn't auth-related (caller
// should keep the original VALID_USER state and just record the via_reason).
function _classifyUatFailure(uatResp, uatError) {
  if (uatError) {
    // v1.3.14 — explicit short-circuit when refreshUAT set `err.uatRevoked`.
    // Lets refresh-side rejections (invalid_grant from /authen/v2/oauth/token)
    // flow into the same UAT_REVOKED state as tool-call-side 20064 responses,
    // and lets `withIdentityFallback` build a clear "请重跑 oauth" warning.
    if (uatError.uatRevoked) {
      return {
        state: IdentityState.UAT_REVOKED,
        viaReason: 'as user: refresh_token rejected by Feishu (invalid_grant)',
      };
    }
    // v1.3.14 — redact base64-ish tokens (40+ chars of [A-Za-z0-9._-]) in
    // case an upstream throw site leaked refresh_token or access_token bytes
    // into the error message. Defense-in-depth on top of uat.js::refreshUAT
    // which already avoids dumping the raw response body.
    const rawMsg = uatError.message || String(uatError);
    const msg = rawMsg.replace(/[A-Za-z0-9._-]{40,}/g, '<redacted>');
    // Network/JSON parse errors don't refine identity — UAT is still presumed
    // valid, we just couldn't reach Feishu this call.
    return { state: null, viaReason: `as user: ${msg}` };
  }
  if (!uatResp || typeof uatResp !== 'object') return null;
  const code = uatResp.code;
  const detail = `as user: code=${code} msg=${uatResp.msg}`;
  switch (code) {
    case 20064:    return { state: IdentityState.UAT_REVOKED,       viaReason: detail };
    case 99991663: return { state: IdentityState.UAT_EXPIRED,       viaReason: detail };
    case 99991668: return { state: IdentityState.UAT_MISSING_SCOPE, viaReason: detail };
    case 99991677: return { state: IdentityState.UAT_EXPIRED,       viaReason: detail };
    default:       return { state: null,                            viaReason: detail };
  }
}

function _buildFallbackWarning({ identity, viaReason, hadUAT }) {
  if (!hadUAT) {
    // BOT_ONLY — the caller never configured UAT. Strictly speaking this
    // isn't a "fallback" (no UAT attempt was made), but we keep the
    // informational warning because users frequently *think* they configured
    // UAT and are surprised to find resources owned by the shared bot. Same
    // wording as the legacy asUserOrApp path so existing get_login_status
    // expectations don't shift.
    return `⚠️  未配置 UAT,本次操作以 bot 身份执行。资源归属于共享 bot「Claude聊天助手」,不是你。想让资源归你所有,先跑 \`npx feishu-user-plugin oauth\` 然后重启 Claude Code / Codex。`;
  }
  let hint;
  switch (identity) {
    case IdentityState.UAT_REVOKED:
      hint = 'UAT 已被撤销 (invalid_grant)';
      break;
    case IdentityState.UAT_MISSING_SCOPE:
      hint = 'UAT 缺少所需 scope';
      break;
    case IdentityState.UAT_EXPIRED:
      hint = 'UAT 已过期';
      break;
    default:
      hint = 'UAT 不可用';
      break;
  }
  return `⚠️  ${hint} (${viaReason}),本次操作以 bot 身份执行。资源归属于共享 bot「Claude聊天助手」,不是你。恢复方法:运行 \`npx feishu-user-plugin oauth\` 后重启 Claude Code / Codex。`;
}

// withIdentityFallback({ client, uatFn, botFn, label })
//
// Tries uatFn first (when client has UAT), classifies any failure, then runs
// botFn. Returns `{ data, via, viaReason?, identity, fallbackWarning? }`.
// Throws an Error with `.uatSummary` and `.botError` when both sides fail.
async function withIdentityFallback({ client, uatFn, botFn, label }) {
  if (!label) throw new Error('withIdentityFallback: label is required (for error messages)');

  let identity = await resolveIdentity(client);
  const hadUAT = !!client?.hasUAT;
  let uatSummary = null;

  if (hadUAT) {
    let uatResp = null;
    let uatErr = null;
    try {
      uatResp = await uatFn();
    } catch (e) {
      uatErr = e;
    }
    if (uatResp && uatResp.code === 0) {
      // Preserve the legacy _viaUser marker that 15+ _asUserOrApp callers read
      // via `res._viaUser`. Without this flag, calendar/docs/bitable/wiki/okr/
      // tasks/drive write tools labelled UAT-owned resources as viaUser:false,
      // making users believe a bot created them. Caught by Codex review on
      // PR #103 (P1 — set _viaUser on successful UAT results).
      const data = { ...uatResp, _viaUser: true };
      return { data, via: 'uat', identity };
    }
    const cls = _classifyUatFailure(uatResp, uatErr);
    uatSummary = cls?.viaReason || `as user: unknown failure`;
    if (cls?.state) {
      identity = cls.state;
      _refineIdentity(client, cls.state);
    }
    // fall through to bot
  }

  // Bot path
  let botData;
  let botError;
  try {
    botData = await botFn();
  } catch (e) {
    botError = e;
  }

  if (botError) {
    if (uatSummary) {
      const err = new Error(`${label} failed on both identities. ${uatSummary}. as app: ${botError.message}`);
      err.uatSummary = uatSummary;
      err.botError = botError;
      err.identity = identity;
      throw err;
    }
    throw botError;
  }

  // Decorate the bot response with via metadata + (when UAT was attempted) a
  // fallback warning the caller can surface to the LLM.
  const data = { ...botData };
  data._viaUser = false;
  // _buildFallbackWarning always returns a non-empty string (BOT_ONLY included),
  // so assign unconditionally — the old `if (fallbackWarning)` guards were
  // always-true dead branches that implied a falsy case that cannot occur.
  const fallbackWarning = _buildFallbackWarning({ identity, viaReason: uatSummary, hadUAT });
  data._fallbackWarning = fallbackWarning;
  const out = { data, via: 'bot', identity, fallbackWarning };
  if (uatSummary) out.viaReason = uatSummary;
  return out;
}

module.exports = {
  IdentityState,
  resolveIdentity,
  withIdentityFallback,
  invalidateIdentity,
  _refineIdentity, // exported for D's CredentialsMonitor hook (private API)
  _readInMemoryState, // exported for testing edge cases (private API)
  _classifyUatFailure, // v1.3.14 — exported for testing redact + uatRevoked wiring
};
