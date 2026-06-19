// src/clients/official/im.js
// Mixed into LarkOfficialClient.prototype by ./base.js (temporarily during
// phase A.4–A.11; will move to ./index.js in Task 12). Methods receive `this`
// bound to the LarkOfficialClient instance, so they can use this.client,
// this._safeSDKCall, this._asUserOrApp, this._uatREST, this._withUAT,
// this._getValidUAT, this._getAppToken, this._populateSenderNames,
// this._formatMessage, this._normalizeTimestamp, this.getUserById, this.hasUAT
// — all defined in base.js.

const { fetchWithTimeout } = require('../../utils');
const { classifyError } = require('../../error-codes');

function _applyPageTokenInvariant(out, token) {
  if (!out.hasMore) return out;
  if (token) {
    out.pageToken = token;
    return out;
  }
  out.hasMore = false;
  out.truncated = true;
  out.cursorUnavailable = true;
  return out;
}

module.exports = {
  // --- UAT-based IM operations (for P2P chats) ---

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
    return _applyPageTokenInvariant({ items: data.data.items || [], hasMore: !!data.data.has_more }, data.data.page_token);
  },

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
    return _applyPageTokenInvariant({ items, hasMore: !!data.data.has_more }, data.data.page_token);
  },

  // --- IM ---

  async listChats({ pageSize = 20, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.list({ params: { page_size: pageSize, page_token: pageToken } }),
      'listChats'
    );
    return _applyPageTokenInvariant({ items: res.data.items || [], hasMore: !!res.data.has_more }, res.data.page_token);
  },

  async readMessages(chatId, { pageSize = 20, startTime, endTime, pageToken, sortType = 'ByCreateTimeDesc', expandMergeForward = true } = {}, userClient) {
    const params = { container_id_type: 'chat', container_id: chatId, page_size: pageSize, sort_type: sortType };
    if (startTime) params.start_time = startTime;
    if (endTime) params.end_time = endTime;
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(() => this.client.im.message.list({ params }), 'readMessages');
    const items = (res.data.items || []).map(m => this._formatMessage(m));
    await this._populateSenderNames(items, userClient);
    if (expandMergeForward) await this._expandMergeForwardItems(items, userClient, { preferUAT: false });
    return _applyPageTokenInvariant({ items, hasMore: !!res.data.has_more }, res.data.page_token);
  },

  async getMessage(messageId) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.get({ path: { message_id: messageId } }),
      'getMessage'
    );
    return this._formatMessage(res.data);
  },

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
  },

  async replyMessage(messageId, text, msgType = 'text') {
    const content = msgType === 'text' ? JSON.stringify({ text }) : text;
    const res = await this._safeSDKCall(
      () => this.client.im.message.reply({ path: { message_id: messageId }, data: { content, msg_type: msgType } }),
      'replyMessage'
    );
    return { messageId: res.data.message_id };
  },

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
  },

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
  },

  async deleteMessage(messageId) {
    await this._safeSDKCall(
      () => this.client.im.message.delete({ path: { message_id: messageId } }),
      'deleteMessage'
    );
    return { deleted: true };
  },

  async updateMessage(messageId, msgType, content) {
    const res = await this._safeSDKCall(
      () => this.client.im.message.patch({
        path: { message_id: messageId },
        data: { msg_type: msgType, content: typeof content === 'string' ? content : JSON.stringify(content) },
      }),
      'updateMessage'
    );
    return { messageId: res.data?.message_id || messageId };
  },

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
  },

  async deleteReaction(messageId, reactionId) {
    await this._safeSDKCall(
      () => this.client.im.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      }),
      'deleteReaction'
    );
    return { deleted: true };
  },

  // --- IM: Pins ---

  async pinMessage(messageId, pinned = true) {
    if (pinned) {
      const res = await this._safeSDKCall(
        () => this.client.im.pin.create({ data: { message_id: messageId } }),
        'pinMessage'
      );
      return { pin: res.data.pin };
    }
    // Feishu unpin is DELETE /pins/{message_id} — path param only, no body.
    // SDK's pin.delete expects `path: {message_id}`. Sending `data: {message_id}`
    // (the previous shape) yielded a 400 with "message_id is required" because
    // the message_id never made it onto the URL.
    await this._safeSDKCall(
      () => this.client.im.pin.delete({ path: { message_id: messageId } }),
      'unpinMessage'
    );
    return { unpinned: true };
  },

  // --- Chat Info (Official API) ---

  async getChatInfo(chatId) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.get({ path: { chat_id: chatId } }),
      'getChatInfo'
    );
    return res.data;
  },


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
  },

  // --- Chat Search (keyword-based, works even if bot isn't in the group's list) ---

  async chatSearch(query) {
    const res = await this._safeSDKCall(
      () => this.client.im.chat.search({ params: { query, page_size: 20 } }),
      'chatSearch'
    );
    return res.data.items || [];
  },

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
    // Best-effort: surface the origin chat NAME for each child so the LLM doesn't
    // misread the children as native messages of the current chat. A single
    // merge_forward usually has 1 origin chat → 1 API call. Failures are silent
    // (bot may not be in the origin chat) and the field is simply absent.
    const originChatIds = [...new Set(children.map(c => c.originChatId).filter(Boolean))];
    const chatNameMap = new Map();
    await Promise.allSettled(originChatIds.map(async (cid) => {
      try {
        const info = await this.getChatInfo(cid);
        if (info?.name) chatNameMap.set(cid, info.name);
      } catch {}
    }));
    for (const c of children) {
      const name = c.originChatId && chatNameMap.get(c.originChatId);
      if (name) c.forwardedFromChatName = name;
    }
    return children;
  },

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
  },

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
  async readMessagesWithFallback(chatId, options, userClient, { skipBot = false, skipUat = false, via = 'bot' } = {}) {
    if (skipBot && skipUat) {
      throw new Error('readMessagesWithFallback: cannot set both skipBot and skipUat — at least one identity path must be allowed');
    }
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
      // Two reasons we skipBot:
      //   Path B (im-read.js): via='contacts' — chat was found only via
      //   cookie search_contacts, bot definitely can't see it. Reason
      //   field surfaces this to the LLM as "contacts_resolved_external".
      //   v1.3.12 via_user=true: caller explicitly opted for UAT. No
      //   failure happened; no reason needed.
      if (via === 'contacts') {
        return tryUAT('contacts', 'contacts_resolved_external');
      }
      return tryUAT(via && via !== 'bot' ? via : 'user');
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

      // v1.3.12: when caller passes via_user=false (skipUat=true), surface
      // the bot error instead of silently falling through to UAT. The user
      // explicitly opted out of cross-identity fallback.
      if (skipUat) {
        throw new Error(`Bot path failed and via_user=false specified: ${botErr.message}`);
      }
      // Fall through to UAT — if UAT is missing, tryUAT throws the user-friendly
      // "run npx feishu-user-plugin oauth" error instead of the raw Feishu payload.
      return tryUAT('user', klass.reason);
    }
  },

  // --- Message search (v1.3.12, B.5) ---
  //
  // Wraps POST /open-apis/search/v2/message. UAT-only (Feishu doesn't expose
  // bot path; probed 2026-05-15 — bot returns 99991668 "user access token not
  // support"). Requires the `search:message` OAuth scope; without it the API
  // returns 99991679 (permission_violations.subject="search:message"). Caller
  // should re-run `npx feishu-user-plugin oauth` after adding the scope.
  //
  // Returns the raw shape from Feishu: { items: [{ message_id, ... }], page_token, has_more }.
  // Items are message-id pointers — call read_messages / read_p2p_messages
  // with the parent chat_id to fetch full bodies if needed.
  async searchMessages({ query, fromIds, chatIds, messageTypes, atUserIds, fromTypes, pageSize = 20, pageToken } = {}) {
    if (!query || typeof query !== 'string') {
      throw new Error('searchMessages: query (search keyword string) is required');
    }
    if (!this.hasUAT) {
      throw new Error('search_messages requires UAT (Feishu does not expose a bot-path search). Run: npx feishu-user-plugin oauth');
    }
    const body = { query };
    if (pageSize) body.page_size = pageSize;
    if (pageToken) body.page_token = pageToken;
    if (Array.isArray(fromIds) && fromIds.length) body.from_ids = fromIds;
    if (Array.isArray(chatIds) && chatIds.length) body.chat_ids = chatIds;
    if (Array.isArray(messageTypes) && messageTypes.length) body.message_type_list = messageTypes;
    if (Array.isArray(atUserIds) && atUserIds.length) body.at_chatter_ids = atUserIds;
    if (Array.isArray(fromTypes) && fromTypes.length) body.from_types = fromTypes;
    const data = await this._uatREST('POST', '/open-apis/search/v2/message', { body });
    if (data.code === 99991679) {
      throw new Error(`search_messages: UAT lacks the search:message scope. Re-run \`npx feishu-user-plugin oauth\` after the v1.3.12 SCOPES update.`);
    }
    if (data.code !== 0) {
      throw new Error(`search_messages failed (code=${data.code}): ${data.msg}`);
    }
    return _applyPageTokenInvariant({
      items: data.data?.items || [],
      hasMore: !!data.data?.has_more,
    }, data.data?.page_token || null);
  },
};
