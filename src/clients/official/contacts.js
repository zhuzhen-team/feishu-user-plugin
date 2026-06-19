// src/clients/official/contacts.js
// Mixed into LarkOfficialClient.prototype by ./index.js. Methods receive `this`
// bound to the LarkOfficialClient instance, so they can use this.client,
// this._safeSDKCall, this._asUserOrApp, this._uatREST, etc.

module.exports = {
  // --- User Name Resolution ---
  //
  // UAT-first (v1.3.7 C1.15 fix) so that calling get_user_info with the
  // current user's own open_id resolves correctly. The bot path goes via the
  // app-level contact API which can read tenant employees but does not have a
  // notion of "the calling user" — so when the bot couldn't see a user (because
  // contact scope wasn't granted, or the user happened to be the bot's owner)
  // the previous code fell into a `null` and we surfaced "may be from external
  // tenant", which was misleading. UAT can always see the current user.
  async getUserById(userId, userIdType = 'open_id') {
    // Key by id-type too: the same string under open_id vs union_id vs user_id
    // is a different lookup, so a type-blind cache could return the wrong name.
    const _k = `${userIdType}:${userId}`;
    if (this._userNameCache.has(_k)) return this._userNameCache.get(_k);

    // 1. UAT path — works for the current user (self) and any colleague the
    //    UAT owner has access to.
    if (this.hasUAT) {
      try {
        const data = await this._uatREST(
          'GET',
          `/open-apis/contact/v3/users/${encodeURIComponent(userId)}`,
          { query: { user_id_type: userIdType } },
        );
        if (data && data.code === 0 && data.data?.user?.name) {
          this._userNameCache.set(_k, data.data.user.name);
          return data.data.user.name;
        }
      } catch (e) {
        console.error(`[feishu-user-plugin] getUserById(${userId}) as user failed: ${e.message}`);
      }
    }

    // 2. Bot fallback — needs `contact:user.base:readonly` scope on the app.
    try {
      const res = await this.client.contact.user.get({
        path: { user_id: userId },
        params: { user_id_type: userIdType },
      });
      if (res.code === 0 && res.data?.user?.name) {
        this._userNameCache.set(_k, res.data.user.name);
        return res.data.user.name;
      }
    } catch (e) {
      // Surface to the diagnostics log so users can see whether the failure
      // was a missing contact scope vs an actual external user.
      console.error(`[feishu-user-plugin] getUserById(${userId}) as bot failed: ${e.message}`);
    }
    return null;
  },
};
