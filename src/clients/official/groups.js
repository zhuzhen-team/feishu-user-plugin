// src/clients/official/groups.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

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
  // --- IM: Chat Management ---

  async createChat({ name, description, userIds, botIds } = {}) {
    const data = {};
    if (name) data.name = name;
    if (description) data.description = description;
    if (userIds) data.user_id_list = userIds;
    if (botIds) data.bot_id_list = botIds;
    const res = await this._safeSDKCall(
      () => this.client.im.chat.create({ params: { user_id_type: 'open_id' }, data }),
      'createChat'
    );
    return { chatId: res.data.chat_id };
  },

  async updateChat(chatId, { name, description } = {}) {
    const data = {};
    if (name) data.name = name;
    if (description) data.description = description;
    const res = await this._safeSDKCall(
      () => this.client.im.chat.update({ path: { chat_id: chatId }, data }),
      'updateChat'
    );
    return { updated: true };
  },

  async listChatMembers(chatId, { pageSize = 50, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.get({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id', page_size: pageSize, page_token: pageToken },
      }),
      'listChatMembers'
    );
    return _applyPageTokenInvariant({ items: res.data.items || [], hasMore: !!res.data.has_more }, res.data.page_token);
  },

  async addChatMembers(chatId, userIds, memberIdType = 'open_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.create({
        path: { chat_id: chatId },
        params: { member_id_type: memberIdType },
        data: { id_list: userIds },
      }),
      'addChatMembers'
    );
    // Feishu reports three partial-failure buckets on batch add (2026-06-07
    // audit) — swallowing not_existed/pending_approval made a half-failed add
    // read as full success (members "in the group" who never joined).
    return {
      invalidIds: res.data.invalid_id_list || [],
      notExistedIds: res.data.not_existed_id_list || [],
      pendingApprovalIds: res.data.pending_approval_id_list || [],
    };
  },

  async removeChatMembers(chatId, userIds, memberIdType = 'open_id') {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.delete({
        path: { chat_id: chatId },
        params: { member_id_type: memberIdType },
        data: { id_list: userIds },
      }),
      'removeChatMembers'
    );
    return { invalidIds: res.data.invalid_id_list || [] };
  },
};
