// src/clients/official/okr.js
// Mixed into LarkOfficialClient.prototype by ./index.js. UAT-first throughout
// — OKR resources belong to the calling user.

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
  // --- OKR read (v1.3.4) ---

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
    return _applyPageTokenInvariant({ items: res.data.items || [], hasMore: !!res.data.has_more }, res.data.page_token);
  },

  // --- OKR progress record write (v1.3.7) ---
  // Requires `okr:okr.content:writeonly` (or wider okr:okr) on the OAuth.
  // Note: Feishu uses `:writeonly` (one word), not `:write`.

  async createOkrProgressRecord({ targetId, targetType, content, sourceTitle, sourceUrl, sourceUrlPc, sourceUrlMobile, progressRate, userIdType = 'open_id' }) {
    if (!targetId) throw new Error('createOkrProgressRecord: target_id is required (the key_result_id or objective_id)');
    if (!targetType) throw new Error('createOkrProgressRecord: target_type is required (1=objective, 2=key_result)');
    if (!content || typeof content !== 'object') {
      throw new Error('createOkrProgressRecord: content (block-structured object) is required. Use buildOkrContent(text) helper for a simple paragraph.');
    }
    const data = {
      source_title: sourceTitle || 'Progress update',
      source_url: sourceUrl || 'https://feishu.cn/',
      target_id: targetId,
      target_type: targetType,
      content,
    };
    if (sourceUrlPc) data.source_url_pc = sourceUrlPc;
    if (sourceUrlMobile) data.source_url_mobile = sourceUrlMobile;
    if (progressRate) data.progress_rate = progressRate;
    const params = { user_id_type: userIdType };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/progress_records`,
      method: 'POST',
      body: data,
      query: params,
      sdkFn: () => this.client.okr.progressRecord.create({ data, params }),
      label: 'createOkrProgressRecord',
    });
    const out = { progressId: res.data.progress_id, modifyTime: res.data.modify_time, content: res.data.content, progressRate: res.data.progress_rate, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },

  // Feishu OKR API has no native "list progress records" — the records live
  // under each key_result in the OKR object. This helper extracts the IDs by
  // walking getOkrs(okrId) and unwinding the progress_record_list per
  // objective + key_result.
  async listOkrProgressRecords(okrId, { lang, userIdType = 'open_id' } = {}) {
    if (!okrId) throw new Error('listOkrProgressRecords: okr_id is required');
    const { items } = await this.getOkrs([okrId], { lang, userIdType });
    if (!items || items.length === 0) {
      return { okrId, records: [] };
    }
    const okr = items[0];
    const records = [];
    for (const obj of okr.objective_list || []) {
      for (const r of obj.progress_record_list || []) {
        records.push({ progress_id: r.id, target_type: 1, target_id: obj.id });
      }
      for (const kr of obj.kr_list || []) {
        for (const r of kr.progress_record_list || []) {
          records.push({ progress_id: r.id, target_type: 2, target_id: kr.id });
        }
      }
    }
    return { okrId, records };
  },

  async deleteOkrProgressRecord(progressId) {
    if (!progressId) throw new Error('deleteOkrProgressRecord: progress_id is required');
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/okr/v1/progress_records/${encodeURIComponent(progressId)}`,
      method: 'DELETE',
      sdkFn: () => this.client.okr.progressRecord.delete({ path: { progress_id: progressId } }),
      label: 'deleteOkrProgressRecord',
    });
    const out = { deleted: true, viaUser: !!res._viaUser };
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
  },
};
