// src/clients/official/okr.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- OKR (v1.3.4) ---

  async listUserOkrs(userId, { periodIds, offset = 0, limit = 10, lang, userIdType = 'open_id' } = {}) {
    if (!userId) throw new Error('listUserOkrs: userId is required (the user whose OKRs to read). For your own, get your open_id from get_login_status or search_contacts.');
    const params = { user_id_type: userIdType, offset: String(offset), limit: String(limit) };
    if (lang) params.lang = lang;
    if (periodIds && periodIds.length) params.period_ids = periodIds;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/users/${encodeURIComponent(userId)}/okrs`,
      query: params,
      sdkFn: () => this.client.okr.userOkr.list({
        path: { user_id: userId },
        params: {
          user_id_type: userIdType,
          offset: String(offset),
          limit: String(limit),
          ...(lang ? { lang } : {}),
          ...(periodIds && periodIds.length ? { period_ids: periodIds } : {}),
        },
      }),
      label: 'listUserOkrs',
    });
    return { total: res.data.total, items: res.data.okr_list || [] };
  },

  async getOkrs(okrIds, { lang, userIdType = 'open_id' } = {}) {
    if (!Array.isArray(okrIds) || okrIds.length === 0) {
      throw new Error('getOkrs: okrIds must be a non-empty array');
    }
    const params = { user_id_type: userIdType, okr_ids: okrIds };
    if (lang) params.lang = lang;
    // UAT REST path takes repeated okr_ids= params; URLSearchParams will serialize an array properly
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/okrs/batch_get`,
      query: params,
      sdkFn: () => this.client.okr.okr.batchGet({ params }),
      label: 'getOkrs',
    });
    return { items: res.data.okr_list || [] };
  },

  async listOkrPeriods({ pageSize = 10, pageToken } = {}) {
    const params = { page_size: String(pageSize) };
    if (pageToken) params.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/periods`,
      query: params,
      sdkFn: () => this.client.okr.period.list({ params: { page_size: pageSize, ...(pageToken ? { page_token: pageToken } : {}) } }),
      label: 'listOkrPeriods',
    });
    return { items: res.data.items || [], pageToken: res.data.page_token, hasMore: res.data.has_more };
  },
};
