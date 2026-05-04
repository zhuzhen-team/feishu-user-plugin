const lark = require('@larksuiteoapi/node-sdk');
const { fetchWithTimeout } = require('../../utils');
const { classifyError } = require('../../error-codes');
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

  async listChatsAsUser({ pageSize = 20, pageToken } = {}) {
    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) params.set('page_token', pageToken);
    const data = await this._withUAT(async (uat) => {
      const res = await fetchWithTimeout(`https://open.feishu.cn/open-apis/im/v1/chats?${params}`, {
        headers: { 'Authorization': `Bearer ${uat}` },
      });
      return res.json();
    });
    if (data.code !== 0) throw new Error(`listChatsAsUser failed (${data.code}): ${data.msg}`);
    return { items: data.data.items || [], pageToken: data.data.page_token, hasMore: data.data.has_more };
  }

  async readMessagesAsUser(chatId, { pageSize = 20, startTime, endTime, pageToken, sortType = 'ByCreateTimeDesc', expandMergeForward = true } = {}, userClient) {
    // Feishu API requires end_time >= start_time; auto-set end_time to now if missing
    if (startTime && !endTime) {
      endTime = String(Math.floor(Date.now() / 1000));
    }
    const params = new URLSearchParams({
      container_id_type: 'chat', container_id: chatId, page_size: String(pageSize),
      sort_type: sortType,
    });
    if (startTime) params.set('start_time', startTime);
    if (endTime) params.set('end_time', endTime);
    if (pageToken) params.set('page_token', pageToken);
    const data = await this._withUAT(async (uat) => {
      const res = await fetchWithTimeout(`https://open.feishu.cn/open-apis/im/v1/messages?${params}`, {
        headers: { 'Authorization': `Bearer ${uat}` },
      });
      return res.json();
    });
    if (data.code !== 0) throw new Error(`readMessagesAsUser failed (${data.code}): ${data.msg}`);
    const items = (data.data.items || []).map(m => this._formatMessage(m));
    await this._populateSenderNames(items, userClient);
    if (expandMergeForward) await this._expandMergeForwardItems(items, userClient, { preferUAT: true });
    return { items, hasMore: data.data.has_more, pageToken: data.data.page_token };
  }

  // --- IM ---

  async listChats({ pageSize = 20, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.list({ params: { page_size: pageSize, page_token: pageToken } }),
      'listChats'
    );
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  }

  async readMessages(chatId, { pageSize = 20, startTime, endTime, pageToken, sortType = 'ByCreateTimeDesc', expandMergeForward = true } = {}, userClient) {
    const params = { container_id_type: 'chat', container_id: chatId, page_size: pageSize, sort_type: sortType };
    if (startTime) params.start_time = startTime;
    if (endTime) params.end_time = endTime;
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(() => this.client.im.message.list({ params }), 'readMessages');
    const items = (res.data.items || []).map(m => this._formatMessage(m));
    await this._populateSenderNames(items, userClient);
    if (expandMergeForward) await this._expandMergeForwardItems(items, userClient, { preferUAT: false });
    return { items, hasMore: res.data.has_more, pageToken: res.data.page_token };
  }

  async getMessage(messageId) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.get({ path: { message_id: messageId } }),
      'getMessage'
    );
    return this._formatMessage(res.data);
  }

  // Download a resource (image/file) attached to a message.
  // Tries UAT first (works for any chat the user is in), falls back to app token
  // (requires the bot to be in the same chat — Feishu restriction).
  // resourceType: 'image' | 'file'. Returns { base64, mimeType, viaUser }.
  async downloadMessageResource(messageId, fileKey, resourceType = 'image') {
    const path = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${encodeURIComponent(resourceType)}`;
    const url = 'https://open.feishu.cn' + path;

    // Attempt 1: user identity
    if (this.hasUAT) {
      try {
        const uat = await this._getValidUAT();
        const res = await fetchWithTimeout(url, {
          headers: { 'Authorization': `Bearer ${uat}` },
          timeoutMs: 60000,
        });
        if (res.ok && !res.headers.get('content-type')?.includes('application/json')) {
          const buf = Buffer.from(await res.arrayBuffer());
          return {
            base64: buf.toString('base64'),
            mimeType: res.headers.get('content-type') || 'application/octet-stream',
            bytes: buf.length,
            viaUser: true,
          };
        }
        const errJson = await res.json().catch(() => null);
        console.error(`[feishu-user-plugin] downloadMessageResource as user failed: ${errJson?.code}: ${errJson?.msg || res.statusText}, retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] downloadMessageResource as user threw (${e.message}), retrying as app`);
      }
    }

    // Attempt 2: app identity
    const token = await this._getAppToken();
    const res = await fetchWithTimeout(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeoutMs: 60000,
    });
    if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
      const errJson = await res.json().catch(() => null);
      throw new Error(`downloadMessageResource failed: ${errJson?.code}: ${errJson?.msg || res.statusText}. Note: app identity requires the bot to be in the same chat.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      bytes: buf.length,
      viaUser: false,
    };
  }

  async replyMessage(messageId, text, msgType = 'text') {
    const content = msgType === 'text' ? JSON.stringify({ text }) : text;
    const res = await this._safeSDKCall(
      () => this.client.im.message.reply({ path: { message_id: messageId }, data: { content, msg_type: msgType } }),
      'replyMessage'
    );
    return { messageId: res.data.message_id };
  }

  async forwardMessage(messageId, receiverId, receiveIdType = 'chat_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.message.forward({
        path: { message_id: messageId },
        data: { receive_id: receiverId },
        params: { receive_id_type: receiveIdType },
      }),
      'forwardMessage'
    );
    return { messageId: res.data.message_id };
  }

  // --- IM: Send (Bot Identity) ---

  async sendMessageAsBot(chatId, msgType, content, receiveIdType = 'chat_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: { receive_id: chatId, msg_type: msgType, content: typeof content === 'string' ? content : JSON.stringify(content) },
      }),
      'sendMessage'
    );
    return { messageId: res.data.message_id };
  }

  async deleteMessage(messageId) {
    await this._safeSDKCall(
      () => this.client.im.message.delete({ path: { message_id: messageId } }),
      'deleteMessage'
    );
    return { deleted: true };
  }

  async updateMessage(messageId, msgType, content) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.patch({
        path: { message_id: messageId },
        data: { msg_type: msgType, content: typeof content === 'string' ? content : JSON.stringify(content) },
      }),
      'updateMessage'
    );
    return { messageId: res.data?.message_id || messageId };
  }

  // --- IM: Reactions ---

  async addReaction(messageId, emojiType) {
    const res = await this._safeSDKCall(
      () => this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      }),
      'addReaction'
    );
    return { reactionId: res.data.reaction_id };
  }

  async deleteReaction(messageId, reactionId) {
    await this._safeSDKCall(
      () => this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      }),
      'deleteReaction'
    );
    return { deleted: true };
  }

  // --- IM: Pins ---

  async pinMessage(messageId, pinned = true) {
    if (pinned) {
      const res = await this._safeSDKCall(
        () => this.client.im.pin.create({ data: { message_id: messageId } }),
        'pinMessage'
      );
      return { pin: res.data.pin };
    }
    await this._safeSDKCall(
      () => this.client.im.pin.delete({ data: { message_id: messageId } }),
      'unpinMessage'
    );
    return { unpinned: true };
  }

  // --- Chat Info (Official API) ---

  async getChatInfo(chatId) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.get({ path: { chat_id: chatId } }),
      'getChatInfo'
    );
    return res.data;
  }

  // --- Bitable ---

  async createBitable(name, folderId, { wikiSpaceId, wikiParentNodeToken } = {}) {
    const data = {};
    if (name) data.name = name;
    if (folderId) data.folder_token = folderId;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.app.create({ data }),
      label: 'createBitable',
    });
    const appToken = res.data.app?.app_token;
    const out = { appToken, name: res.data.app?.name, url: res.data.app?.url, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
    if (appToken && wikiSpaceId) {
      try {
        const node = await this.attachToWiki(wikiSpaceId, 'bitable', appToken, wikiParentNodeToken);
        if (node?.node_token) out.wikiNodeToken = node.node_token;
        else if (node?.task_id) out.wikiAttachTaskId = node.task_id;
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return out;
  }

  async listBitableTables(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      sdkFn: () => this.client.bitable.appTable.list({ path: { app_token: appToken } }),
      label: 'listTables',
    });
    return { items: res.data.items || [] };
  }

  async createBitableTable(appToken, name, fields) {
    const data = { table: { name } };
    if (fields && fields.length > 0) data.table.default_view_name = name;
    if (fields && fields.length > 0) data.table.fields = fields;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.appTable.create({ path: { app_token: appToken }, data }),
      label: 'createTable',
    });
    return { tableId: res.data.table_id, fallbackWarning: res._fallbackWarning || null };
  }

  async listBitableFields(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      sdkFn: () => this.client.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } }),
      label: 'listFields',
    });
    return { items: res.data.items || [] };
  }

  async createBitableField(appToken, tableId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      method: 'POST',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.create({ path: { app_token: appToken, table_id: tableId }, data: fieldConfig }),
      label: 'createField',
    });
    return { field: res.data.field, fallbackWarning: res._fallbackWarning || null };
  }

  async updateBitableField(appToken, tableId, fieldId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'PUT',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.update({ path: { app_token: appToken, table_id: tableId, field_id: fieldId }, data: fieldConfig }),
      label: 'updateField',
    });
    return { field: res.data.field };
  }

  async deleteBitableField(appToken, tableId, fieldId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableField.delete({ path: { app_token: appToken, table_id: tableId, field_id: fieldId } }),
      label: 'deleteField',
    });
    return { fieldId: res.data.field_id, deleted: res.data.deleted };
  }

  async searchBitableRecords(appToken, tableId, { filter, sort, pageSize = 20, pageToken } = {}) {
    const data = {};
    if (filter) data.filter = filter;
    if (sort) data.sort = sort;
    const query = {};
    if (pageSize) query.page_size = String(pageSize);
    if (pageToken) query.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
      method: 'POST',
      body: data,
      query,
      sdkFn: () => this.client.bitable.appTableRecord.search({
        path: { app_token: appToken, table_id: tableId },
        params: { page_size: pageSize, ...(pageToken ? { page_token: pageToken } : {}) },
        data,
      }),
      label: 'searchRecords',
    });
    return { items: res.data.items || [], total: res.data.total, hasMore: res.data.has_more };
  }

  async createBitableRecord(appToken, tableId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      method: 'POST',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.create({ path: { app_token: appToken, table_id: tableId }, data: { fields } }),
      label: 'createRecord',
    });
    return { recordId: res.data.record?.record_id, fallbackWarning: res._fallbackWarning || null };
  }

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'PUT',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.update({ path: { app_token: appToken, table_id: tableId, record_id: recordId }, data: { fields } }),
      label: 'updateRecord',
    });
    return { recordId: res.data.record?.record_id };
  }

  async deleteBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableRecord.delete({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'deleteRecord',
    });
    return { deleted: res.data.deleted };
  }

  async batchCreateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchCreate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchCreateRecords',
    });
    return { records: res.data.records || [], fallbackWarning: res._fallbackWarning || null };
  }

  async batchUpdateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchUpdate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchUpdateRecords',
    });
    return { records: res.data.records || [] };
  }

  async batchDeleteBitableRecords(appToken, tableId, recordIds) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
      method: 'POST',
      body: { records: recordIds },
      sdkFn: () => this.client.bitable.appTableRecord.batchDelete({ path: { app_token: appToken, table_id: tableId }, data: { records: recordIds } }),
      label: 'batchDeleteRecords',
    });
    return { records: res.data.records || [] };
  }

  async listBitableViews(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      query: { page_size: '50' },
      sdkFn: () => this.client.bitable.appTableView.list({ path: { app_token: appToken, table_id: tableId }, params: { page_size: 50 } }),
      label: 'listViews',
    });
    return { items: res.data.items || [] };
  }

  async getBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      sdkFn: () => this.client.bitable.appTableRecord.get({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'getRecord',
    });
    return { record: res.data.record };
  }

  async deleteBitableTable(appToken, tableId) {
    await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTable.delete({ path: { app_token: appToken, table_id: tableId } }),
      label: 'deleteTable',
    });
    return { deleted: true };
  }

  async getBitableMeta(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}`,
      sdkFn: () => this.client.bitable.app.get({ path: { app_token: appToken } }),
      label: 'getBitableMeta',
    });
    return { app: res.data.app };
  }

  async updateBitableTable(appToken, tableId, name) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'PATCH',
      body: { name },
      sdkFn: () => this.client.bitable.appTable.patch({ path: { app_token: appToken, table_id: tableId }, data: { name } }),
      label: 'updateTable',
    });
    return { name: res.data.name };
  }

  async createBitableView(appToken, tableId, viewName, viewType = 'grid') {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      method: 'POST',
      body: { view_name: viewName, view_type: viewType },
      sdkFn: () => this.client.bitable.appTableView.create({ path: { app_token: appToken, table_id: tableId }, data: { view_name: viewName, view_type: viewType } }),
      label: 'createView',
    });
    return { view: res.data.view, fallbackWarning: res._fallbackWarning || null };
  }

  async deleteBitableView(appToken, tableId, viewId) {
    await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableView.delete({ path: { app_token: appToken, table_id: tableId, view_id: viewId } }),
      label: 'deleteView',
    });
    return { deleted: true };
  }

  async copyBitable(appToken, name, folderId) {
    const data = { name };
    if (folderId) data.folder_token = folderId;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/copy`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.bitable.app.copy({ path: { app_token: appToken }, data }),
      label: 'copyBitable',
    });
    return { app: res.data.app, fallbackWarning: res._fallbackWarning || null };
  }

  // --- Chat ID Resolution ---

  async listAllChats() {
    const allChats = [];
    let pageToken;
    let hasMore = true;
    while (hasMore) {
      const res = await this._safeSDKCall(
        () => this.client.im.chat.list({ params: { page_size: 100, page_token: pageToken } }),
        'listAllChats'
      );
      allChats.push(...(res.data.items || []));
      pageToken = res.data.page_token;
      hasMore = res.data.has_more && !!pageToken;
    }
    return allChats;
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

  // --- Chat Search (keyword-based, works even if bot isn't in the group's list) ---

  async chatSearch(query) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.search({ params: { query, page_size: 20 } }),
      'chatSearch'
    );
    return res.data.items || [];
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

  // Fetch the child messages inside a merge_forward parent. Feishu exposes them
  // via `/im/v1/messages/{parent_id}` (single-message GET). The response is
  // actually a list: items[0] is the parent merge_forward placeholder,
  // items[1..N] are the children carrying `upper_message_id` pointing back to
  // the parent and `chat_id` pointing to their ORIGIN chat (the one being
  // forwarded from, not where the merge_forward was posted).
  //
  // Media resources (image_key / file_key) on children must be downloaded
  // using the PARENT message id — a Feishu quirk: downloading with the child
  // id returns "File not in msg".
  async readMergeForwardChildren(parentMessageId, userClient, { preferUAT = true } = {}) {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(parentMessageId)}`;

    const tryPath = async (bearer) => {
      const res = await fetchWithTimeout(url, {
        headers: { 'Authorization': `Bearer ${bearer}` },
        timeoutMs: 30000,
      });
      return res.json();
    };

    let data = null;
    const order = preferUAT ? ['uat', 'bot'] : ['bot', 'uat'];
    const errors = [];
    for (const identity of order) {
      try {
        if (identity === 'uat') {
          if (!this.hasUAT) { errors.push('uat: not configured'); continue; }
          const uat = await this._getValidUAT();
          const resp = await tryPath(uat);
          if (resp.code === 0) { data = resp; break; }
          errors.push(`uat: code=${resp.code} msg=${resp.msg}`);
        } else {
          const tat = await this._getAppToken();
          const resp = await tryPath(tat);
          if (resp.code === 0) { data = resp; break; }
          errors.push(`bot: code=${resp.code} msg=${resp.msg}`);
        }
      } catch (e) {
        errors.push(`${identity}: ${e.message}`);
      }
    }
    if (!data) {
      throw new Error(`readMergeForwardChildren failed: ${errors.join(' | ')}`);
    }

    // items[0] is the parent itself — filter it out. The rest are children.
    const rawChildren = (data.data?.items || []).filter(m =>
      m.message_id !== parentMessageId && m.upper_message_id);

    const children = rawChildren.map(raw => {
      const f = this._formatMessage(raw);
      // Surface the parent id on the child so downstream tools (download_image /
      // download_file) know which id to pass to Feishu's resource endpoint.
      f.parentMessageId = parentMessageId;
      // Mark the origin chat explicitly — child.chatId is the ORIGINAL chat the
      // message came from, not the chat where the merge_forward was posted.
      f.originChatId = raw.chat_id;
      return f;
    });
    await this._populateSenderNames(children, userClient);
    return children;
  }

  // Expand merge_forward placeholders in-place. Adds `children: [...]` or
  // `expandError` on each merge_forward item. `depth` guards against nesting
  // (Feishu does allow nested merge_forward, but we cap at 1 level to avoid
  // exponential fan-out in agent contexts).
  async _expandMergeForwardItems(items, userClient, { preferUAT = true, depth = 0, maxDepth = 1 } = {}) {
    if (!items || depth >= maxDepth) return;
    for (const m of items) {
      if (m.msgType !== 'merge_forward') continue;
      try {
        const children = await this.readMergeForwardChildren(m.messageId, userClient, { preferUAT });
        m.children = children;
        // One extra level deep if user really wants, via recursive call.
        if (depth + 1 < maxDepth) {
          await this._expandMergeForwardItems(children, userClient, { preferUAT, depth: depth + 1, maxDepth });
        }
      } catch (e) {
        m.expandError = e.message;
      }
    }
  }

  _normalizeTimestamp(ts) {
    if (!ts) return null;
    const n = parseInt(ts);
    // Feishu returns millisecond strings; normalize to seconds
    return String(n > 1e12 ? Math.floor(n / 1000) : n);
  }

  // --- Hardened Message Read (v1.3.4) ---

  // Reads messages with explicit fallback routing: tries the bot path first,
  // classifies any failure via error-codes.js, and escalates to UAT when
  // appropriate. Returns the same shape as readMessages/readMessagesAsUser
  // plus `via` ('bot' | 'user' | 'contacts') and, if fallback fired,
  // `via_reason` (a short enum from classifyError).
  //
  // If `skipBot` is true, the bot path is never attempted (callers use this
  // when the chat_id came from search_contacts — i.e. definitely external).
  //
  // Throws a single, wrapped error if BOTH paths fail or if UAT is absent and
  // the bot failed; the message points the user at `npx feishu-user-plugin oauth`.
  async readMessagesWithFallback(chatId, options, userClient, { skipBot = false, via = 'bot' } = {}) {
    const tryUAT = async (viaLabel, reason) => {
      if (!this.hasUAT) {
        const hint = 'To read external / private groups, configure UAT via: npx feishu-user-plugin oauth';
        const err = new Error(`Cannot read chat ${chatId} as bot (${reason || 'bot failed and no UAT configured'}). ${hint}`);
        err.viaReason = reason;
        throw err;
      }
      const data = await this.readMessagesAsUser(chatId, options, userClient);
      data.via = viaLabel;
      if (reason) data.via_reason = reason;
      return data;
    };

    if (skipBot) {
      return tryUAT(via || 'contacts', 'contacts_resolved_external');
    }

    // Attempt 1 — bot identity.
    try {
      const data = await this.readMessages(chatId, options, userClient);
      data.via = 'bot';
      return data;
    } catch (botErr) {
      const klass = classifyError(botErr);
      console.error(`[feishu-user-plugin] read_messages bot failed for ${chatId}: ${botErr.message} [class=${klass.action}, reason=${klass.reason}, code=${klass.code}]`);

      if (klass.action === 'retry') {
        // One retry after short backoff before hopping to UAT.
        await new Promise(r => setTimeout(r, 2000));
        try {
          const data = await this.readMessages(chatId, options, userClient);
          data.via = 'bot';
          data.via_reason = klass.reason + '_recovered';
          return data;
        } catch (retryErr) {
          console.error(`[feishu-user-plugin] read_messages bot retry failed for ${chatId}: ${retryErr.message}`);
        }
      }

      // Fall through to UAT — if UAT is missing, tryUAT throws the user-friendly
      // "run npx feishu-user-plugin oauth" error instead of the raw Feishu payload.
      return tryUAT('user', klass.reason);
    }
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

module.exports = { LarkOfficialClient };
