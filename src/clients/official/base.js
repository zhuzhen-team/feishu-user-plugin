const lark = require('@larksuiteoapi/node-sdk');
const { fetchWithTimeout } = require('../../utils');
const { buildEmptyImageBlock, buildReplaceImagePayload, buildEmptyFileBlock, buildReplaceFilePayload } = require('../../doc-blocks');
const { stderrLogger } = require('../../logger');

class LarkOfficialClient {
  constructor(appId, appSecret) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.client = new lark.Client({ appId, appSecret, disableTokenCache: false, logger: stderrLogger, loggerLevel: lark.LoggerLevel.warn });
    this._uat = null;
    this._uatRefresh = null;
    this._uatExpires = 0;
    this._userNameCache = new Map(); // open_id → display name
  }

  // --- UAT (User Access Token) Management ---

  loadUAT() {
    const token = process.env.LARK_USER_ACCESS_TOKEN;
    const refresh = process.env.LARK_USER_REFRESH_TOKEN;
    const expires = parseInt(process.env.LARK_UAT_EXPIRES || '0');
    if (token) {
      this._uat = token;
      this._uatRefresh = refresh || null;
      this._uatExpires = expires || this._decodeTokenExpiry(token);
    }
  }

  get hasUAT() {
    return !!this._uat;
  }

  // Fetches (and caches) an app_access_token directly via the internal endpoint.
  // Avoids relying on SDK-internal token-manager APIs that may change across versions.
  async _getAppToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this._appToken && this._appTokenExpires > now + 60) return this._appToken;
    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
      timeoutMs: 10000,
    });
    const data = await res.json();
    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`app_access_token failed: ${data.code}: ${data.msg || 'unknown'}`);
    }
    this._appToken = data.app_access_token;
    this._appTokenExpires = now + (typeof data.expire === 'number' ? data.expire : 7200);
    return this._appToken;
  }

  // Probe APP_ID/SECRET validity by requesting a tenant access token.
  // Catches the common "user's Claude filled in a wrong/stale APP_ID" failure mode
  // (observed in production: 周宇's machine ran with an APP_ID nobody recognized,
  // causing all Official API calls to 401 with cryptic messages that looked like
  // MCP "掉线" to the user). Returns { valid, appId, appName?, error? }.
  async verifyApp() {
    try {
      const token = await this._getAppToken();
      // Try to fetch app display name (best-effort; requires application scope)
      let appName = null;
      try {
        const infoRes = await fetchWithTimeout(`https://open.feishu.cn/open-apis/application/v6/applications/${this.appId}?lang=zh_cn`, {
          headers: { 'Authorization': `Bearer ${token}` },
          timeoutMs: 10000,
        });
        const info = await infoRes.json();
        if (info.code === 0) appName = info.data?.app?.app_name || null;
      } catch (_) { /* name is best-effort; valid creds still matter most */ }
      return { valid: true, appId: this.appId, appName };
    } catch (e) {
      return { valid: false, appId: this.appId, error: e.message };
    }
  }

  async _getValidUAT() {
    if (!this._uat) throw new Error('No user_access_token. Run: npx feishu-user-plugin oauth');

    const now = Math.floor(Date.now() / 1000);
    if (!this._uatExpires) this._uatExpires = this._decodeTokenExpiry(this._uat);
    // Proactively refresh if we know it's expiring within 5 min
    if (this._uatExpires > 0 && this._uatExpires <= now + 300) {
      return this._refreshUAT();
    }
    return this._uat;
  }

  _decodeTokenExpiry(token) {
    try {
      const payload = token?.split('.')?.[1];
      if (!payload) return 0;
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return typeof data.exp === 'number' ? data.exp : 0;
    } catch (_) {
      return 0;
    }
  }

  _adoptPersistedUATIfNewer() {
    try {
      const { readCredentials } = require('../../config');
      const creds = readCredentials();
      const token = creds.LARK_USER_ACCESS_TOKEN;
      const refresh = creds.LARK_USER_REFRESH_TOKEN;
      if (!token && !refresh) return false;

      const expires = parseInt(creds.LARK_UAT_EXPIRES || '0') || this._decodeTokenExpiry(token);
      const changed = (token && token !== this._uat)
        || (refresh && refresh !== this._uatRefresh)
        || (expires && expires !== this._uatExpires);
      if (!changed) return false;

      if (token) this._uat = token;
      if (refresh) this._uatRefresh = refresh;
      this._uatExpires = expires || 0;
      console.error('[feishu-user-plugin] UAT adopted latest persisted token before refresh');
      return true;
    } catch (e) {
      console.error(`[feishu-user-plugin] UAT persisted-token check failed: ${e.message}`);
      return false;
    }
  }

  // Cross-process advisory lock for UAT refresh. Feishu rotates the refresh_token
  // on every refresh (old one invalidated instantly). When multiple MCP server
  // processes share the same persisted refresh_token and all wake up near expiry,
  // they race: the first wins, the rest see `invalid_grant` and can't recover.
  // This lock serialises refreshes across processes; inside the critical section
  // we also re-read the persisted config so late arrivals adopt the winner's
  // token instead of attempting a doomed refresh with the already-rotated one.
  _uatLockPath() {
    const path = require('path');
    const os = require('os');
    return path.join(os.homedir(), '.claude', 'feishu-uat-refresh.lock');
  }

  async _acquireRefreshLock(lockPath, { staleMs = 30000, pollMs = 200, timeoutMs = 20000 } = {}) {
    const fs = require('fs');
    const path = require('path');
    try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch (_) {}
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const fd = fs.openSync(lockPath, 'wx'); // O_CREAT | O_EXCL
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
        } catch (_) { /* lock vanished under us — retry */ }
        await new Promise(r => setTimeout(r, pollMs));
      }
    }
    return false;
  }

  _releaseRefreshLock(lockPath) {
    try { require('fs').unlinkSync(lockPath); } catch (_) {}
  }

  async _refreshUAT() {
    const lockPath = this._uatLockPath();
    const acquired = await this._acquireRefreshLock(lockPath);
    if (!acquired) {
      console.error('[feishu-user-plugin] UAT refresh lock timed out; proceeding without mutual exclusion');
    }
    try {
      // Re-check under lock: another process may have already refreshed and
      // persisted a new token while we waited. If so, adopt and skip the refresh.
      const now = Math.floor(Date.now() / 1000);
      if (this._adoptPersistedUATIfNewer() && this._uatExpires > now + 300) {
        return this._uat;
      }

      if (!this._uatRefresh) throw new Error('UAT expired and no refresh token. Run: npx feishu-user-plugin oauth');

      const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          refresh_token: this._uatRefresh,
        }),
      });
      const data = await res.json();
      const tokenData = data.access_token ? data : data.data;
      if (!tokenData?.access_token) throw new Error(`UAT refresh failed: ${JSON.stringify(data)}. Run: npx feishu-user-plugin oauth`);

      this._uat = tokenData.access_token;
      this._uatRefresh = tokenData.refresh_token || this._uatRefresh;
      const expiresIn = typeof tokenData.expires_in === 'number' && tokenData.expires_in > 0 ? tokenData.expires_in : 7200;
      this._uatExpires = Math.floor(Date.now() / 1000) + expiresIn;
      this._persistUAT();
      console.error('[feishu-user-plugin] UAT refreshed successfully');
      return this._uat;
    } finally {
      if (acquired) this._releaseRefreshLock(lockPath);
    }
  }

  _persistUAT() {
    // Lazy require to avoid circular dependency at module load time
    const { persistToConfig } = require('../../config');
    persistToConfig({
      LARK_USER_ACCESS_TOKEN: this._uat,
      LARK_USER_REFRESH_TOKEN: this._uatRefresh,
      LARK_UAT_EXPIRES: String(this._uatExpires),
    });
  }

  // --- UAT-based IM operations (for P2P chats) ---

  // Wrapper: call fn with UAT, retry once after refresh if auth fails
  async _withUAT(fn) {
    let uat = await this._getValidUAT();
    const data = await fn(uat);
    // Known auth error codes: 99991668 (invalid), 99991663 (expired), 99991677 (auth_expired)
    if (data.code === 99991668 || data.code === 99991663 || data.code === 99991677) {
      // 99991668 is overloaded: "invalid token" (→ refresh helps) vs
      // "endpoint doesn't support UAT at all" (→ refresh is pointless, and
      // worse, it consumes a one-shot refresh_token rotation). The second
      // case is identifiable by the msg "user access token not support" or
      // "not support". If so, surface the code to the caller without refresh.
      if (data.code === 99991668 && typeof data.msg === 'string' && /not support/i.test(data.msg)) {
        return data;
      }
      // Token invalid/expired — try refresh once
      uat = await this._refreshUAT();
      return fn(uat);
    }
    return data;
  }

  // Generic UAT REST helper. Returns parsed JSON ({code, msg, data}).
  // Array query values are expanded to repeated keys (period_ids=a&period_ids=b)
  // because several Feishu endpoints (OKR, calendar) rely on that convention.
  async _uatREST(method, path, { body, query } = {}) {
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
    const url = 'https://open.feishu.cn' + path + qs;
    return this._withUAT(async (uat) => {
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

  // Try UAT first (for resources likely owned by the user), fall back to app SDK on failure.
  // Returns SDK-shaped {code, msg, data, _viaUser}. _viaUser is true iff the UAT call succeeded;
  // callers can surface this to distinguish "created by user" vs "created by app" for resources
  // whose ownership matters (docs, bitables, folders).
  //
  // When BOTH paths fail (common for OKR/Calendar if neither UAT nor app has the scope),
  // the final error includes the UAT-side reason too, so the user can tell whether they
  // need a new OAuth (UAT missing scope) or a different app (app missing scope).
  async _asUserOrApp({ uatPath, method = 'GET', body, query, sdkFn, label }) {
    let uatSummary = null;
    if (this.hasUAT) {
      try {
        const data = await this._uatREST(method, uatPath, { body, query });
        if (data.code === 0) {
          data._viaUser = true;
          return data;
        }
        uatSummary = `as user: code=${data.code} msg=${data.msg}`;
        console.error(`[feishu-user-plugin] ${label} ${uatSummary}, retrying as app`);
      } catch (err) {
        uatSummary = `as user: ${err.message}`;
        console.error(`[feishu-user-plugin] ${label} as user threw (${err.message}), retrying as app`);
      }
    }
    try {
      const appData = await this._safeSDKCall(sdkFn, label);
      if (appData && typeof appData === 'object') {
        appData._viaUser = false;
        // Attach a warning when we silently fell back to bot identity. This lets
        // write handlers surface "⚠️ created as BOT, not you" so the user doesn't
        // discover it days later when a teammate can read the "private" resource.
        if (uatSummary) {
          appData._fallbackWarning = `⚠️  UAT 不可用 (${uatSummary}),本次操作以 bot 身份执行。资源归属于共享 bot「Claude聊天助手」,不是你。恢复方法:运行 \`npx feishu-user-plugin oauth\` 后重启 Claude Code / Codex。`;
        } else if (!this.hasUAT) {
          appData._fallbackWarning = `⚠️  未配置 UAT,本次操作以 bot 身份执行。资源归属于共享 bot「Claude聊天助手」,不是你。想让资源归你所有,先跑 \`npx feishu-user-plugin oauth\` 然后重启 Claude Code / Codex。`;
        }
      }
      return appData;
    } catch (appErr) {
      if (uatSummary) {
        const err = new Error(`${label} failed on both identities. ${uatSummary}. as app: ${appErr.message}`);
        err.uatSummary = uatSummary;
        err.appError = appErr;
        throw err;
      }
      throw appErr;
    }
  }

  // --- Safe SDK Call (extracts real Feishu error from AxiosError) ---

  async _safeSDKCall(fn, label = 'API') {
    try {
      const res = await fn();
      // SDK returns abbreviated responses for multipart uploads (code/msg undefined)
      // Only treat as error if code is explicitly non-zero
      if (res.code !== undefined && res.code !== 0) throw new Error(`${label} failed (${res.code}): ${res.msg}`);
      return res;
    } catch (err) {
      // Lark SDK uses axios; extract actual Feishu error from response body
      if (err.response?.data) {
        const d = err.response.data;
        const code = d.code ?? d.error ?? 'unknown';
        const msg = d.msg ?? d.error_description ?? d.message ?? JSON.stringify(d);
        throw new Error(`${label} failed (HTTP ${err.response.status}, code=${code}): ${msg}`);
      }
      throw err;
    }
  }

  async _populateSenderNames(items, userClient) {
    // Collect unique sender IDs that aren't cached
    const unknownIds = new Set();
    for (const item of items) {
      if (item.senderId && !this._userNameCache.has(item.senderId)) {
        unknownIds.add(item.senderId);
      }
    }
    // Parallel resolve via official contact API (instead of sequential N calls)
    if (unknownIds.size > 0) {
      await Promise.allSettled([...unknownIds].map(id => this.getUserById(id)));
    }
    // Fallback: resolve remaining unknowns via cookie-based user identity client
    if (userClient) {
      for (const id of unknownIds) {
        if (!this._userNameCache.has(id)) {
          try {
            const name = await userClient.getUserName(id);
            if (name) this._userNameCache.set(id, name);
          } catch {}
        }
      }
    }
    // Populate senderName field
    for (const item of items) {
      if (item.senderId) {
        item.senderName = this._userNameCache.get(item.senderId) || null;
      }
    }
  }

  // --- Helpers ---

  _formatMessage(m) {
    if (!m) return null;
    let body = m.body?.content || '';
    try { body = JSON.parse(body); } catch {}
    const out = {
      messageId: m.message_id,
      chatId: m.chat_id,
      senderId: m.sender?.id,
      senderType: m.sender?.sender_type,
      msgType: m.msg_type,
      content: body,
      createTime: this._normalizeTimestamp(m.create_time),
      updateTime: this._normalizeTimestamp(m.update_time),
    };
    if (Array.isArray(m.mentions) && m.mentions.length > 0) out.mentions = m.mentions;
    if (m.upper_message_id) out.upperMessageId = m.upper_message_id;
    if (m.root_id) out.rootId = m.root_id;
    if (m.parent_id) out.parentId = m.parent_id;
    // Extract URL-like strings from text bodies so agents can call WebFetch /
    // read_doc / get_doc_blocks without having to regex the body themselves.
    if (out.msgType === 'text' && typeof body?.text === 'string') {
      const urls = body.text.match(/https?:\/\/[^\s一-鿿]+/g);
      if (urls && urls.length > 0) {
        out.urls = Array.from(new Set(urls));
        const feishuDocs = out.urls.filter(u =>
          /feishu\.cn\/(?:docx|wiki|base|sheets|docs|mindnotes)\//i.test(u));
        if (feishuDocs.length > 0) out.feishuDocs = feishuDocs;
      }
    }
    return out;
  }

  _normalizeTimestamp(ts) {
    if (!ts) return null;
    const n = parseInt(ts);
    // Feishu returns millisecond strings; normalize to seconds
    return String(n > 1e12 ? Math.floor(n / 1000) : n);
  }

}

// Temporary mixin during phase A.4–A.11 — Task 12 will move these into
// clients/official/index.js as a single composed export.
Object.assign(LarkOfficialClient.prototype, require('./contacts'));
Object.assign(LarkOfficialClient.prototype, require('./calendar'));
Object.assign(LarkOfficialClient.prototype, require('./groups'));
Object.assign(LarkOfficialClient.prototype, require('./okr'));
Object.assign(LarkOfficialClient.prototype, require('./wiki'));
Object.assign(LarkOfficialClient.prototype, require('./drive'));
Object.assign(LarkOfficialClient.prototype, require('./uploads'));
Object.assign(LarkOfficialClient.prototype, require('./docs'));
Object.assign(LarkOfficialClient.prototype, require('./bitable'));
Object.assign(LarkOfficialClient.prototype, require('./im'));

module.exports = { LarkOfficialClient };
