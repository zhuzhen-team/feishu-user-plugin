// src/clients/official/drive.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

module.exports = {
  // --- Drive ---

  async listFiles(folderToken, { pageSize = 50, pageToken } = {}) {
    const params = { page_size: pageSize, folder_token: folderToken || '' };
    if (pageToken) params.page_token = pageToken;
    const res = await this._safeSDKCall(() => this.client.drive.file.list({ params }), 'listFiles');
    return { items: res.data.files || [], hasMore: res.data.has_more };
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
    const res = await this._safeSDKCall(
      () => this.client.drive.file.copy({ path: { file_token: fileToken }, data }),
      'copyFile'
    );
    return { file: res.data.file };
  },

  async moveFile(fileToken, folderToken) {
    const res = await this._safeSDKCall(
      () => this.client.drive.file.move({ path: { file_token: fileToken }, data: { folder_token: folderToken || '' } }),
      'moveFile'
    );
    return { taskId: res.data.task_id };
  },

  async deleteFile(fileToken, type) {
    const res = await this._safeSDKCall(
      () => this.client.drive.file.delete({ path: { file_token: fileToken }, params: { type: type || 'file' } }),
      'deleteFile'
    );
    return { taskId: res.data.task_id };
  },
};
