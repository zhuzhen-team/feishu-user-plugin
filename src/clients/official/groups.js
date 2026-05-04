// src/clients/official/groups.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

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
    return { items: res.data.items || [], hasMore: res.data.has_more, pageToken: res.data.page_token };
  },

  async addChatMembers(chatId, userIds) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.create({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id' },
        data: { id_list: userIds },
      }),
      'addChatMembers'
    );
    return { invalidIds: res.data.invalid_id_list || [] };
  },

  async removeChatMembers(chatId, userIds) {
    const res = await this._safeSDKCall(
      () => this.client.im.chatMembers.delete({
        path: { chat_id: chatId },
        params: { member_id_type: 'open_id' },
        data: { id_list: userIds },
      }),
      'removeChatMembers'
    );
    return { invalidIds: res.data.invalid_id_list || [] };
  },
};
