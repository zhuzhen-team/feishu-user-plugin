// src/clients/official/drive.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Drive ---

  async listFiles(folderToken, { pageSize = 50, pageToken } = {}) {
    // UAT-first (v1.3.16): the bot identity 403s on personal-space ("我的空间")
    // folders it was never invited to, which made user-uploaded files (UAT
    // upload path) undiscoverable — and therefore undeletable, because
    // manage_drive_file needs a file_token only list_files can provide.
    // Bot fallback keeps bot-shared folders working. (2026-06-06 user report.)
    const size = Math.max(1, parseInt(pageSize, 10) || 50);
    const params = { page_size: size, folder_token: folderToken || '' };
    if (pageToken) params.page_token = pageToken;
    const query = { page_size: String(size), folder_token: folderToken || '' };
    if (pageToken) query.page_token = pageToken;
    const res = await this._asUserOrApp({
      uatPath: '/open-apis/drive/v1/files',
      query,
      sdkFn: () => this.client.drive.file.list({ params }),
      label: 'listFiles',
    });
    const out = { items: res.data.files || [], hasMore: res.data.has_more, viaUser: !!res._viaUser };
    if (res.data.next_page_token) out.nextPageToken = res.data.next_page_token;
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    // Empty + bot path + ROOT listing only: with an empty folder_token the
    // bot lists its OWN root space (usually empty), not the user's 我的空间 —
    // that mismatch is the blind spot worth explaining. A specific
    // folder_token the bot cannot access throws (403) and never reaches here,
    // and a bot-visible folder that is genuinely empty should stay a bare []
    // (Copilot review, PR #115).
    if (out.items.length === 0 && !res._viaUser && !folderToken) {
      out.scopeHint = 'Empty result via app identity: with an empty folder_token the bot lists its OWN root space, not your 我的空间 — your personal files are invisible to it. Run `npx feishu-user-plugin oauth` so list_files can read your own space via UAT.';
    }
    return out;
  },

  async createFolder(name, parentToken) {
    const body = { name, folder_token: parentToken || '' };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/drive/v1/files/create_folder`,
      method: 'POST',
      body,
      sdkFn: () => this.client.drive.file.createFolder({ data: body }),
      label: 'createFolder',
    });
    return { token: res.data.token, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  // --- Drive: File Operations ---

  async copyFile(fileToken, name, folderToken, type) {
    const data = { name, folder_token: folderToken || '' };
    if (type) data.type = type;
    // _asUserOrApp so UAT-owned files (created by the user) can be copied
    // without the bot needing edit permission. Bot-only path returned 1062501.
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/drive/v1/files/${fileToken}/copy`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.drive.file.copy({ path: { file_token: fileToken }, data }),
      label: 'copyFile',
    });
    return { file: res.data.file, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  async moveFile(fileToken, folderToken, type) {
    // Feishu drive move requires `type` in the request body — without it Feishu
    // returns 1061002 ("invalid params"). type values: file, folder, doc,
    // sheet, bitable, docx, mindnote, slides. _asUserOrApp so user-owned
    // resources can be moved without bot edit permission.
    const data = { folder_token: folderToken || '' };
    if (type) data.type = type;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/drive/v1/files/${fileToken}/move`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.drive.file.move({ path: { file_token: fileToken }, data }),
      label: 'moveFile',
    });
    return { taskId: res.data.task_id, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },

  async deleteFile(fileToken, type) {
    // _asUserOrApp so UAT-owned files can be deleted by the user. Bot-only
    // path returned 1062501 because the bot lacks edit permission on
    // user-created resources. Feishu also requires `type` as a query param.
    const params = { type: type || 'file' };
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/drive/v1/files/${fileToken}`,
      method: 'DELETE',
      query: params,
      sdkFn: () => this.client.drive.file.delete({ path: { file_token: fileToken }, params }),
      label: 'deleteFile',
    });
    return { taskId: res.data.task_id, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
  },
};
