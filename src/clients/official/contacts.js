// src/clients/official/contacts.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Contact ---

  async findUserByIdentity({ emails, mobiles } = {}) {
    const data = {};
    if (emails) data.emails = Array.isArray(emails) ? emails : [emails];
    if (mobiles) data.mobiles = Array.isArray(mobiles) ? mobiles : [mobiles];
    const res = await this._safeSDKCall(
      () => this.client.contact.user.batchGetId({ data, params: { user_id_type: 'open_id' } }),
      'findUser'
    );
    return { userList: res.data.user_list || [] };
  },

  // --- User Name Resolution ---

  async getUserById(userId, userIdType = 'open_id') {
    if (this._userNameCache.has(userId)) return this._userNameCache.get(userId);
    try {
      const res = await this.client.contact.user.get({
        path: { user_id: userId },
        params: { user_id_type: userIdType },
      });
      if (res.code === 0 && res.data?.user?.name) {
        this._userNameCache.set(userId, res.data.user.name);
        return res.data.user.name;
      }
    } catch {}
    return null;
  },
};
