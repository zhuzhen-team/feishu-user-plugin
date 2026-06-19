// src/clients/official/bitable.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this.attachToWiki (mixed in via wiki.js), etc. — all
// defined in base.js or mixed in via other domain modules.

function _withIdentityMeta(res, out) {
  out.viaUser = !!res._viaUser;
  if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
  return out;
}

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

function _mergeWarning(existing, next) {
  if (!next) return existing;
  return existing ? `${existing}\n\n${next}` : next;
}

module.exports = {
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
        out.fallbackWarning = _mergeWarning(out.fallbackWarning, node?.fallbackWarning);
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return out;
  },

  async listBitableTables(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables`,
      sdkFn: () => this.client.bitable.appTable.list({ path: { app_token: appToken } }),
      label: 'listTables',
    });
    return _withIdentityMeta(res, { items: res.data.items || [] });
  },

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
    return _withIdentityMeta(res, { tableId: res.data.table_id });
  },

  async listBitableFields(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      sdkFn: () => this.client.bitable.appTableField.list({ path: { app_token: appToken, table_id: tableId } }),
      label: 'listFields',
    });
    return _withIdentityMeta(res, { items: res.data.items || [] });
  },

  async createBitableField(appToken, tableId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      method: 'POST',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.create({ path: { app_token: appToken, table_id: tableId }, data: fieldConfig }),
      label: 'createField',
    });
    return _withIdentityMeta(res, { field: res.data.field });
  },

  async updateBitableField(appToken, tableId, fieldId, fieldConfig) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'PUT',
      body: fieldConfig,
      sdkFn: () => this.client.bitable.appTableField.update({ path: { app_token: appToken, table_id: tableId, field_id: fieldId }, data: fieldConfig }),
      label: 'updateField',
    });
    return _withIdentityMeta(res, { field: res.data.field });
  },

  async deleteBitableField(appToken, tableId, fieldId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableField.delete({ path: { app_token: appToken, table_id: tableId, field_id: fieldId } }),
      label: 'deleteField',
    });
    return _withIdentityMeta(res, { fieldId: res.data.field_id, deleted: res.data.deleted });
  },

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
    // pageToken accompanies hasMore (2026-06-07 audit) — hasMore + total
    // without the resume cursor stranded callers at the first page of a
    // potentially thousands-row table.
    const out = _withIdentityMeta(res, { items: res.data.items || [], total: res.data.total, hasMore: !!res.data.has_more });
    return _applyPageTokenInvariant(out, res.data.page_token);
  },

  async createBitableRecord(appToken, tableId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      method: 'POST',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.create({ path: { app_token: appToken, table_id: tableId }, data: { fields } }),
      label: 'createRecord',
    });
    return _withIdentityMeta(res, { recordId: res.data.record?.record_id });
  },

  async updateBitableRecord(appToken, tableId, recordId, fields) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'PUT',
      body: { fields },
      sdkFn: () => this.client.bitable.appTableRecord.update({ path: { app_token: appToken, table_id: tableId, record_id: recordId }, data: { fields } }),
      label: 'updateRecord',
    });
    return _withIdentityMeta(res, { recordId: res.data.record?.record_id });
  },

  async deleteBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableRecord.delete({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'deleteRecord',
    });
    return _withIdentityMeta(res, { deleted: res.data.deleted });
  },

  async batchCreateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchCreate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchCreateRecords',
    });
    return _withIdentityMeta(res, { records: res.data.records || [] });
  },

  async batchUpdateBitableRecords(appToken, tableId, records) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      method: 'POST',
      body: { records },
      sdkFn: () => this.client.bitable.appTableRecord.batchUpdate({ path: { app_token: appToken, table_id: tableId }, data: { records } }),
      label: 'batchUpdateRecords',
    });
    return _withIdentityMeta(res, { records: res.data.records || [] });
  },

  async batchDeleteBitableRecords(appToken, tableId, recordIds) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
      method: 'POST',
      body: { records: recordIds },
      sdkFn: () => this.client.bitable.appTableRecord.batchDelete({ path: { app_token: appToken, table_id: tableId }, data: { records: recordIds } }),
      label: 'batchDeleteRecords',
    });
    return _withIdentityMeta(res, { records: res.data.records || [] });
  },

  async listBitableViews(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      query: { page_size: '50' },
      sdkFn: () => this.client.bitable.appTableView.list({ path: { app_token: appToken, table_id: tableId }, params: { page_size: 50 } }),
      label: 'listViews',
    });
    return _withIdentityMeta(res, { items: res.data.items || [] });
  },

  async getBitableRecord(appToken, tableId, recordId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      sdkFn: () => this.client.bitable.appTableRecord.get({ path: { app_token: appToken, table_id: tableId, record_id: recordId } }),
      label: 'getRecord',
    });
    return _withIdentityMeta(res, { record: res.data.record });
  },

  async deleteBitableTable(appToken, tableId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTable.delete({ path: { app_token: appToken, table_id: tableId } }),
      label: 'deleteTable',
    });
    return _withIdentityMeta(res, { deleted: true });
  },

  async getBitableMeta(appToken) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}`,
      sdkFn: () => this.client.bitable.app.get({ path: { app_token: appToken } }),
      label: 'getBitableMeta',
    });
    return _withIdentityMeta(res, { app: res.data.app });
  },

  async updateBitableTable(appToken, tableId, name) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}`,
      method: 'PATCH',
      body: { name },
      sdkFn: () => this.client.bitable.appTable.patch({ path: { app_token: appToken, table_id: tableId }, data: { name } }),
      label: 'updateTable',
    });
    return _withIdentityMeta(res, { name: res.data.name });
  },

  async createBitableView(appToken, tableId, viewName, viewType = 'grid') {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
      method: 'POST',
      body: { view_name: viewName, view_type: viewType },
      sdkFn: () => this.client.bitable.appTableView.create({ path: { app_token: appToken, table_id: tableId }, data: { view_name: viewName, view_type: viewType } }),
      label: 'createView',
    });
    return _withIdentityMeta(res, { view: res.data.view });
  },

  async deleteBitableView(appToken, tableId, viewId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
      method: 'DELETE',
      sdkFn: () => this.client.bitable.appTableView.delete({ path: { app_token: appToken, table_id: tableId, view_id: viewId } }),
      label: 'deleteView',
    });
    return _withIdentityMeta(res, { deleted: true });
  },

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
    return _withIdentityMeta(res, { app: res.data.app });
  },
};
