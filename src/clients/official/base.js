const lark = require('@larksuiteoapi/node-sdk');
const { fetchWithTimeout } = require('../../utils');
const { stderrLogger } = require('../../logger');
const uatLifecycle = require('../../auth/uat');

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

  // UAT lifecycle methods are extracted to src/auth/uat.js (v1.3.8 D.1).
  // State (this._uat / this._uatRefresh / this._uatExpires) still lives here;
  // function bodies live in auth/uat.js. These methods are 1-line delegates.
  _decodeTokenExpiry(token)            { return uatLifecycle.decodeTokenExpiry(token); }
  async _getValidUAT()                 { return uatLifecycle.getValidUAT(this); }
  _adoptPersistedUATIfNewer()          { return uatLifecycle.adoptPersistedUATIfNewer(this); }
  async _refreshUAT()                  { return uatLifecycle.refreshUAT(this); }
  _persistUAT()                        { return uatLifecycle.persistUAT(this); }
  async _withUAT(fn)                   { return uatLifecycle.withUAT(this, fn); }
  async _uatREST(method, path, opts)   { return uatLifecycle.uatREST(this, method, path, opts); }
  async _asUserOrApp(opts)             { return uatLifecycle.asUserOrApp(this, opts); }

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

// base.js exports only the bare class. clients/official/index.js composes the
// domain mixins onto its prototype — callers should always import from there,
// never directly from base.js.
module.exports = { LarkOfficialClient };
