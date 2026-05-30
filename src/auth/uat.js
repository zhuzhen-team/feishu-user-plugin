// src/auth/uat.js — UAT lifecycle: refresh, cross-process file lock, persist.
//
// State lives on the LarkOfficialClient instance (this._uat, this._uatRefresh,
// this._uatExpires). These functions take `client` as first arg and mutate its
// fields. Lifted out of clients/official/base.js for clarity; called only from
// there.
//
// What this owns:
//   - decodeTokenExpiry(token) — JWT exp parsing
//   - getValidUAT(client) — returns current UAT, refreshes if expiring
//   - refreshUAT(client) — full refresh dance with file lock + persist
//   - withUAT(client, fn) — wrapper that retries fn once on auth codes + on
//     transient throws (classifyError action='retry'); v1.3.12 widening
//   - uatREST(client, method, path, opts) — generic UAT REST helper
//   - asUserOrApp(client, opts) — legacy UAT-first / bot-fallback signature.
//     v1.3.12: the body is now a thin shape adapter around
//     withIdentityFallback (src/auth/identity-state.js). The public contract
//     — return data with _viaUser ∈ {true,false} + optional _fallbackWarning,
//     throw Error with .uatSummary + .appError on dual failure — is
//     preserved so 15+ existing callsites in calendar/docs/bitable/wiki/okr/
//     tasks/drive/im keep compiling.
//   - persistUAT(client) — writes through auth/credentials
//   - adoptPersistedUATIfNewer(client) — peer-rotation adoption
//   - acquireRefreshLock / releaseRefreshLock — cross-process advisory lock

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fetchWithTimeout } = require('../utils');

// One-warning-per-malformed-token tracker. Without this, a persistently bad
// JWT would flood stderr every tool call (getValidUAT calls decode whenever
// _uatExpires falsy, which it stays at 0 if decode returns 0). 1024-entry cap
// is conservative — real tokens are rotated rarely; cap prevents OOM in the
// unlikely event of a malformed-token spray.
const _warnedMalformedTokens = new Set();
function _markWarnedMalformedToken(token) {
  if (typeof token !== 'string' || token.length === 0) return false;
  const key = require('crypto').createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
  if (_warnedMalformedTokens.has(key)) return false;
  if (_warnedMalformedTokens.size >= 1024) _warnedMalformedTokens.clear();
  _warnedMalformedTokens.add(key);
  return true;
}

function decodeTokenExpiry(token) {
  try {
    const payload = token?.split('.')?.[1];
    if (!payload) return 0;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' ? data.exp : 0;
  } catch (e) {
    // Log breadcrumb so silently-malformed UATs are observable, but only once
    // per distinct bad token (hashed). We still return 0 (caller treats 0 as
    // "never decoded — let refresh path decide") instead of throwing, because
    // a bad JWT shouldn't crash tool dispatch — the next 99991663/99991668
    // response will trigger refresh anyway.
    if (_markWarnedMalformedToken(token)) {
      console.error(`[feishu-user-plugin] decodeTokenExpiry: malformed JWT payload (${e.message}); will rely on Feishu rejection for refresh trigger`);
    }
    return 0;
  }
}

async function getValidUAT(client) {
  if (!client._uat) throw new Error('No user_access_token. Run: npx feishu-user-plugin oauth');
  const now = Math.floor(Date.now() / 1000);
  if (!client._uatExpires) client._uatExpires = decodeTokenExpiry(client._uat);
  if (client._uatExpires > 0 && client._uatExpires <= now + 300) {
    return refreshUAT(client);
  }
  return client._uat;
}

function adoptPersistedUATIfNewer(client) {
  try {
    const { readCredentials } = require('./credentials');
    const creds = readCredentials();
    const token = creds.LARK_USER_ACCESS_TOKEN;
    const refresh = creds.LARK_USER_REFRESH_TOKEN;
    if (!token && !refresh) return false;
    const expires = parseInt(creds.LARK_UAT_EXPIRES || '0') || decodeTokenExpiry(token);
    const changed = (token && token !== client._uat)
      || (refresh && refresh !== client._uatRefresh)
      || (expires && expires !== client._uatExpires);
    if (!changed) return false;
    if (token) client._uat = token;
    if (refresh) client._uatRefresh = refresh;
    client._uatExpires = expires || 0;
    console.error('[feishu-user-plugin] UAT adopted latest persisted token before refresh');
    return true;
  } catch (e) {
    console.error(`[feishu-user-plugin] UAT persisted-token check failed: ${e.message}`);
    return false;
  }
}

function uatLockPath() {
  // v1.3.14: moved from ~/.claude/feishu-uat-refresh.lock to canonical
  // ~/.feishu-user-plugin/ so Codex-only / non-Claude-Code users (whose
  // ~/.claude/ may not exist) still get cross-process mutual exclusion.
  // Mixed-version concern is N/A — running two different versions of this
  // plugin in parallel is not a supported configuration.
  return path.join(os.homedir(), '.feishu-user-plugin', 'uat-refresh.lock');
}

async function acquireRefreshLock(lockPath, { staleMs = 30000, pollMs = 200, timeoutMs = 20000 } = {}) {
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch (_) {}
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          try { fs.unlinkSync(lockPath); } catch (_) {}
          continue;
        }
      } catch (_) { /* lock vanished — retry */ }
      await new Promise(r => setTimeout(r, pollMs));
    }
  }
  return false;
}

function releaseRefreshLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

async function refreshUAT(client) {
  // v1.3.14 — Pre-lock cheap path: maybe a peer process already refreshed and
  // persisted a valid token. Adopt it before paying for the file lock. This
  // dramatically reduces lock contention in deployments with 10+ concurrent
  // MCP server processes (one per Claude Code session).
  let now = Math.floor(Date.now() / 1000);
  if (adoptPersistedUATIfNewer(client) && client._uatExpires > now + 300) {
    return client._uat;
  }

  const lockPath = uatLockPath();
  const acquired = await acquireRefreshLock(lockPath);
  if (!acquired) {
    // Lock timed out (>20s of contention). Before falling through to an
    // un-coordinated refresh — which can burn the refresh_token chain on the
    // Feishu side — give disk one more chance: a peer may have written a
    // fresh token between our pre-check and now.
    now = Math.floor(Date.now() / 1000);
    if (adoptPersistedUATIfNewer(client) && client._uatExpires > now + 300) {
      return client._uat;
    }
    console.error('[feishu-user-plugin] UAT refresh lock timed out; proceeding without mutual exclusion (this may burn refresh_token chain — investigate if it happens often)');
  }
  try {
    // Inside the lock: re-check disk one more time. Between acquireRefreshLock
    // returning and this point, another holder may have released after writing.
    now = Math.floor(Date.now() / 1000);
    if (adoptPersistedUATIfNewer(client) && client._uatExpires > now + 300) {
      return client._uat;
    }
    if (!client._uatRefresh) throw new Error('UAT expired and no refresh token. Run: npx feishu-user-plugin oauth');
    // Snapshot the refresh_token we are about to send BEFORE awaiting. A peer
    // in-process refresh or the credentials monitor can hot-reload
    // client._uatRefresh during the round-trip; the invalid_grant self-heal
    // below must compare against the token actually sent, not a field that may
    // have already rotated. (Codex review, PR #111.)
    const attemptedRefresh = client._uatRefresh;
    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: client.appId,
        client_secret: client.appSecret,
        refresh_token: attemptedRefresh,
      }),
    });
    const data = await res.json();
    const tokenData = data.access_token ? data : data.data;
    if (!tokenData?.access_token) {
      // v1.3.14 — never dump the raw response body. Some Feishu error paths
      // echo back portions of the request including refresh_token bytes, and
      // this message bubbles up to Error.message → MCP content[0].text →
      // LLM transcript. Surface only the structured error code/msg.
      const errCode = data?.error ?? data?.code ?? 'unknown';
      const errMsg = data?.error_description ?? data?.msg ?? '(no error message from Feishu)';
      // Distinguish refresh_token rejection (must re-oauth) from transient
      // server-side errors so the identity state machine can flip to
      // UAT_REVOKED, and withIdentityFallback can give the LLM clear guidance.
      const isInvalidGrant = errCode === 'invalid_grant' || errCode === 20064;
      if (isInvalidGrant) {
        // v1.3.15 — self-heal a benign refresh_token rotation race before
        // declaring the 7-day chain dead. When cross-process mutual exclusion
        // is defeated (lock-acquire timeout fallthrough above, or a transient
        // mixed-version upgrade window where old/new instances use different
        // lock paths), two processes can refresh with the same refresh_token;
        // Feishu rotates it for the winner and rejects the loser with
        // invalid_grant. By the time the loser lands here, the winner has very
        // likely already persisted a fresh, valid, DIFFERENT token to disk.
        // Re-read disk: if it now holds a different, still-valid token, our
        // invalid_grant just means "our copy was rotated away" — adopt it and
        // recover, instead of flipping to UAT_REVOKED and pushing the user
        // through a needless `oauth` re-consent (the "授权操作通知 没撑过一晚上"
        // symptom). Only when disk still holds the SAME (now-dead) refresh_token
        // is this a genuine revocation. Covered by test-uat-lifecycle
        // "invalid_grant + peer rotated fresh token to disk".
        now = Math.floor(Date.now() / 1000);
        // Best-effort re-sync from disk (a no-op if a peer/monitor already
        // updated this client in memory). Then recover iff we now hold a
        // DIFFERENT, still-valid token than the one we actually sent — this
        // covers both the cross-process race (disk holds the winner) and the
        // in-process / hot-reload race (client already holds the winner).
        // Gating on the resulting client state, rather than on
        // adoptPersistedUATIfNewer()'s return value, is what lets the
        // hot-reload case recover (adopt is a no-op there). (Codex review, PR #111.)
        adoptPersistedUATIfNewer(client);
        if (client._uat
            && client._uatRefresh !== attemptedRefresh
            && client._uatExpires > now + 300) {
          console.error('[feishu-user-plugin] UAT invalid_grant on the sent refresh_token; a different valid token is present (peer won the rotation) — adopted, no re-consent needed');
          return client._uat;
        }
        try {
          const { _refineIdentity, IdentityState } = require('./identity-state');
          _refineIdentity(client, IdentityState.UAT_REVOKED);
        } catch (_) { /* identity-state may not be loaded in CLI subcommands; non-fatal */ }
        const err = new Error('UAT refresh_token rejected by Feishu (invalid_grant). The 7-day refresh chain is broken. Run: npx feishu-user-plugin oauth to re-authorize.');
        err.uatRevoked = true;
        throw err;
      }
      throw new Error(`UAT refresh failed (code=${errCode}: ${errMsg}). If persistent, run: npx feishu-user-plugin oauth.`);
    }
    client._uat = tokenData.access_token;
    client._uatRefresh = tokenData.refresh_token || client._uatRefresh;
    const expiresIn = typeof tokenData.expires_in === 'number' && tokenData.expires_in > 0 ? tokenData.expires_in : 7200;
    client._uatExpires = Math.floor(Date.now() / 1000) + expiresIn;
    persistUAT(client);
    console.error('[feishu-user-plugin] UAT refreshed successfully');
    return client._uat;
  } finally {
    if (acquired) releaseRefreshLock(lockPath);
  }
}

function persistUAT(client) {
  const { persistToConfig } = require('./credentials');
  persistToConfig({
    LARK_USER_ACCESS_TOKEN: client._uat,
    LARK_USER_REFRESH_TOKEN: client._uatRefresh,
    LARK_UAT_EXPIRES: String(client._uatExpires),
  });
}

async function withUAT(client, fn) {
  const { classifyError } = require('../error-codes');
  let uat = await getValidUAT(client);

  // First attempt. If fn() throws an upstream flake (network reset, response
  // body truncated mid-JSON, gateway 5xx), classifyError says action='retry'
  // and we re-run once with the same UAT — the token is still valid, the
  // call just lost. Auth-related codes are the existing refresh path below.
  let data;
  try {
    data = await fn(uat);
  } catch (err) {
    const cls = classifyError(err);
    if (cls.action === 'retry') {
      // v1.3.14 — fall through into the auth-code check below instead of
      // returning the retry result raw. A token rotated between our first
      // attempt and the retry (peer process refreshed) can manifest as a
      // 99991663/99991668 in the retry response, and we want refreshUAT to
      // run before bubbling that up as a hard failure.
      data = await fn(uat);
    } else {
      throw err;
    }
  }

  if (data.code === 99991668 || data.code === 99991663 || data.code === 99991677) {
    if (data.code === 99991668 && typeof data.msg === 'string' && /not support/i.test(data.msg)) {
      return data;
    }
    uat = await refreshUAT(client);
    return fn(uat);
  }
  return data;
}

async function uatREST(client, method, urlPath, { body, query } = {}) {
  let qs = '';
  if (query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) { for (const item of v) sp.append(k, String(item)); }
      else sp.append(k, String(v));
    }
    const str = sp.toString();
    if (str) qs = '?' + str;
  }
  const url = 'https://open.feishu.cn' + urlPath + qs;
  return withUAT(client, async (uat) => {
    const headers = { 'Authorization': `Bearer ${uat}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetchWithTimeout(url, init);
    return res.json();
  });
}

async function asUserOrApp(client, { uatPath, method = 'GET', body, query, sdkFn, label }) {
  // v1.3.12: internal implementation routes through withIdentityFallback in
  // src/auth/identity-state.js. The public shape — return data with _viaUser
  // and optional _fallbackWarning, throw Error with .uatSummary + .appError
  // when both sides fail — is preserved for 15+ existing callsites.
  const { withIdentityFallback } = require('./identity-state');
  try {
    const result = await withIdentityFallback({
      client,
      uatFn: () => uatREST(client, method, uatPath, { body, query }),
      botFn: () => client._safeSDKCall(sdkFn, label),
      label,
    });
    // Surface state machine breadcrumbs in stderr so long-running servers can
    // be diagnosed without grepping the LLM transcript. (Pre-v1.3.12 already
    // logged on fallback; we keep parity but only when fallback actually
    // happened, not on every BOT_ONLY call.)
    if (result.via === 'bot' && result.viaReason) {
      console.error(`[feishu-user-plugin] ${label} fell back to bot (${result.identity}): ${result.viaReason}`);
    }
    return result.data;
  } catch (e) {
    // Legacy callers expect err.appError — keep the alias alongside the new
    // err.botError that withIdentityFallback sets.
    if (e && e.botError && !e.appError) e.appError = e.botError;
    throw e;
  }
}

module.exports = {
  decodeTokenExpiry,
  getValidUAT,
  refreshUAT,
  withUAT,
  uatREST,
  asUserOrApp,
  persistUAT,
  adoptPersistedUATIfNewer,
  // v1.3.14 — exposed for testing (lifecycle + race tests). Not part of the
  // stable API; do not use outside src/test-* or scripts/test-* harnesses.
  uatLockPath,
  acquireRefreshLock,
  releaseRefreshLock,
};
