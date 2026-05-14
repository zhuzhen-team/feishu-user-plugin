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
//   - withUAT(client, fn) — wrapper that retries fn once on auth-error codes
//   - uatREST(client, method, path, opts) — generic UAT REST helper
//   - asUserOrApp(client, opts) — UAT-first, bot-fallback wrapper
//   - persistUAT(client) — writes through auth/credentials
//   - adoptPersistedUATIfNewer(client) — peer-rotation adoption
//   - acquireRefreshLock / releaseRefreshLock — cross-process advisory lock

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fetchWithTimeout } = require('../utils');

function decodeTokenExpiry(token) {
  try {
    const payload = token?.split('.')?.[1];
    if (!payload) return 0;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' ? data.exp : 0;
  } catch (_) {
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
  return path.join(os.homedir(), '.claude', 'feishu-uat-refresh.lock');
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
  const lockPath = uatLockPath();
  const acquired = await acquireRefreshLock(lockPath);
  if (!acquired) {
    console.error('[feishu-user-plugin] UAT refresh lock timed out; proceeding without mutual exclusion');
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    if (adoptPersistedUATIfNewer(client) && client._uatExpires > now + 300) {
      return client._uat;
    }
    if (!client._uatRefresh) throw new Error('UAT expired and no refresh token. Run: npx feishu-user-plugin oauth');
    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: client.appId,
        client_secret: client.appSecret,
        refresh_token: client._uatRefresh,
      }),
    });
    const data = await res.json();
    const tokenData = data.access_token ? data : data.data;
    if (!tokenData?.access_token) throw new Error(`UAT refresh failed: ${JSON.stringify(data)}. Run: npx feishu-user-plugin oauth`);
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
      return fn(uat);
    }
    throw err;
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
};
