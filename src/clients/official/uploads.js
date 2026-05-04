// src/clients/official/uploads.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, etc. — all defined in base.js.

const { fetchWithTimeout } = require('../../utils');

module.exports = {
  // --- Upload ---

  async uploadImage(imagePath, imageType = 'message') {
    const fs = require('fs');
    const res = await this._safeSDKCall(
      () => this.client.im.image.create({
        data: { image_type: imageType, image: fs.createReadStream(imagePath) },
      }),
      'uploadImage'
    );
    // SDK multipart responses may have data at top level or nested under .data
    const imageKey = res.data?.image_key || res.image_key;
    if (!imageKey) throw new Error(`uploadImage: unexpected response structure: ${JSON.stringify(res).slice(0, 500)}`);
    return { imageKey };
  },

  async uploadFile(filePath, fileType = 'stream', fileName) {
    const fs = require('fs');
    const path = require('path');
    if (!fileName) fileName = path.basename(filePath);
    const res = await this._safeSDKCall(
      () => this.client.im.file.create({
        data: {
          file_type: fileType,
          file_name: fileName,
          file: fs.createReadStream(filePath),
        },
      }),
      'uploadFile'
    );
    // SDK multipart responses may have data at top level or nested under .data
    const fileKey = res.data?.file_key || res.file_key;
    if (!fileKey) throw new Error(`uploadFile: unexpected response structure: ${JSON.stringify(res).slice(0, 500)}`);
    return { fileKey };
  },

  // --- Docx Image Read (v1.3.4) ---

  // Download a media asset (image, file, etc.) referenced from inside a Feishu
  // docx block. The model actually gets the pixels via MCP image content in the
  // handler layer; here we just return base64 + metadata.
  //
  // Feishu's drive/v1/medias/{token}/download requires a query `extra` with
  // a JSON-encoded doc_token when the media lives inside a doc (to pass
  // tenant-scoped auth). Passing extra is harmless for generic drive files.
  async downloadDocImage(imageToken, docToken, docType = 'docx') {
    if (!imageToken) throw new Error('downloadDocImage: imageToken is required');
    // Feishu's drive media download uses `extra` as a JSON-string query param to
    // identify the enclosing doc context. Most observed forms carry both
    // `doc_type` and `doc_token`; omitting docType falls back to 'docx' which
    // is the by-far most common case. Omitting extra entirely is safe for
    // standalone drive-media tokens that don't live inside a doc.
    const extra = docToken
      ? `?extra=${encodeURIComponent(JSON.stringify({ doc_type: docType, doc_token: docToken }))}`
      : '';
    const path = `/open-apis/drive/v1/medias/${encodeURIComponent(imageToken)}/download${extra}`;
    const url = 'https://open.feishu.cn' + path;

    // Attempt 1 — user identity (most reliable for user-owned docs).
    if (this.hasUAT) {
      try {
        const uat = await this._getValidUAT();
        const res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${uat}` }, timeoutMs: 60000 });
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
        console.error(`[feishu-user-plugin] downloadDocImage as user failed: ${errJson?.code}: ${errJson?.msg || res.statusText}, retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] downloadDocImage as user threw (${e.message}), retrying as app`);
      }
    }

    // Attempt 2 — app identity. Requires the app to have drive access to the doc.
    const token = await this._getAppToken();
    const res = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` }, timeoutMs: 60000 });
    if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
      const errJson = await res.json().catch(() => null);
      throw new Error(`downloadDocImage failed: ${errJson?.code}: ${errJson?.msg || res.statusText}. Note: app identity requires drive access to the document; configure UAT for user-owned docs.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      base64: buf.toString('base64'),
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      bytes: buf.length,
      viaUser: false,
    };
  },

  // --- Docx Image Write (v1.3.4) ---

  // Upload binary media to Feishu's drive layer so it can be attached to a
  // docx block, sheet cell, bitable attachment field, etc. Returns the
  // media's file_token, which is what the host block's replace_*.token
  // (or bitable attachment field value) expects.
  //
  // parentType ∈ {
  //   docx_image, docx_file,
  //   sheet_image, sheet_file,
  //   bitable_image, bitable_file,
  //   doc_image, doc_file,        // legacy doc (pre-docx)
  //   ccm_import_open,            // import-task host
  //   vc_virtual_background       // VC bg, grayscale-only
  // }
  // parentNode = the block_id (docx) / spreadsheet_token (sheet) / app_token
  // (bitable) / doc_token (legacy) — depends on parentType.
  async uploadMedia(filePath, parentNode, parentType = 'docx_image') {
    const fs = require('fs');
    const path = require('path');
    if (!filePath) throw new Error('uploadMedia: filePath is required');
    if (!parentNode) throw new Error('uploadMedia: parentNode is required');
    const ALLOWED = new Set([
      'docx_image', 'docx_file',
      'sheet_image', 'sheet_file',
      'bitable_image', 'bitable_file',
      'doc_image', 'doc_file',
      'ccm_import_open', 'vc_virtual_background',
    ]);
    if (!ALLOWED.has(parentType)) {
      throw new Error(`uploadMedia: unsupported parent_type "${parentType}". Allowed: ${[...ALLOWED].join(', ')}`);
    }

    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const buf = fs.readFileSync(filePath);

    // Best-effort content-type from extension. Feishu doesn't require it but
    // some CDNs behind the API key off it; the Blob default is text/plain
    // which would look wrong for binary attachments.
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap = {
      // image
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.ico': 'image/x-icon',
      // doc / archive
      '.pdf': 'application/pdf', '.zip': 'application/zip',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const doUpload = async (bearer) => {
      const form = new FormData();
      form.append('file_name', fileName);
      form.append('parent_type', parentType);
      form.append('parent_node', parentNode);
      form.append('size', String(stat.size));
      form.append('file', new Blob([buf], { type: contentType }), fileName);
      const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${bearer}` },
        body: form,
        timeoutMs: 120000,
      });
      return res.json();
    };

    // User identity first — host resources are usually user-owned.
    if (this.hasUAT) {
      try {
        const data = await this._withUAT(doUpload);
        if (data.code === 0 && data.data?.file_token) {
          return { fileToken: data.data.file_token, viaUser: true };
        }
        console.error(`[feishu-user-plugin] uploadMedia (${parentType}) as user failed (${data.code}: ${data.msg}), retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] uploadMedia (${parentType}) as user threw (${e.message}), retrying as app`);
      }
    }
    const appToken = await this._getAppToken();
    const data = await doUpload(appToken);
    if (data.code !== 0 || !data.data?.file_token) {
      throw new Error(`uploadMedia (${parentType}) failed: ${data.code}: ${data.msg || 'no file_token returned'}`);
    }
    return { fileToken: data.data.file_token, viaUser: false };
  },

  // Backwards-compat alias — old name from v1.3.4.
  async uploadDocMedia(filePath, parentNode, parentType = 'docx_image') {
    return this.uploadMedia(filePath, parentNode, parentType);
  },

  // Upload a file to a drive folder (NOT for embedding in a doc — that's
  // uploadMedia). Uses drive/v1/files/upload_all with parent_type=explorer.
  // Returns { fileToken, viaUser } where fileToken is the cloud-doc file id.
  async uploadDriveFile(filePath, folderToken) {
    const fs = require('fs');
    const path = require('path');
    if (!filePath) throw new Error('uploadDriveFile: filePath is required');
    if (!folderToken) throw new Error('uploadDriveFile: folderToken is required (use the destination folder token; for "my space" root call list_files first to get it)');

    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf', '.zip': 'application/zip',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';

    const doUpload = async (bearer) => {
      const form = new FormData();
      form.append('file_name', fileName);
      form.append('parent_type', 'explorer');
      form.append('parent_node', folderToken);
      form.append('size', String(stat.size));
      form.append('file', new Blob([buf], { type: contentType }), fileName);
      const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${bearer}` },
        body: form,
        timeoutMs: 120000,
      });
      return res.json();
    };

    if (this.hasUAT) {
      try {
        const data = await this._withUAT(doUpload);
        if (data.code === 0 && data.data?.file_token) {
          return { fileToken: data.data.file_token, viaUser: true };
        }
        console.error(`[feishu-user-plugin] uploadDriveFile as user failed (${data.code}: ${data.msg}), retrying as app`);
      } catch (e) {
        console.error(`[feishu-user-plugin] uploadDriveFile as user threw (${e.message}), retrying as app`);
      }
    }
    const appToken = await this._getAppToken();
    const data = await doUpload(appToken);
    if (data.code !== 0 || !data.data?.file_token) {
      throw new Error(`uploadDriveFile failed: ${data.code}: ${data.msg || 'no file_token returned'}`);
    }
    return { fileToken: data.data.file_token, viaUser: false };
  },
};
