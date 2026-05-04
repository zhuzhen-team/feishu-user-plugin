// src/clients/official/docs.js
// Mixed into LarkOfficialClient.prototype by ./index.js (or temporarily by
// ./base.js during phase A.4–A.11). Methods receive `this` bound to the
// LarkOfficialClient instance, so they can use this.client, this._safeSDKCall,
// this._asUserOrApp, this._uatREST, this.uploadMedia, etc. — all defined in
// base.js or mixed in via other domain modules.

const { buildEmptyImageBlock, buildReplaceImagePayload, buildEmptyFileBlock, buildReplaceFilePayload } = require('../../doc-blocks');

module.exports = {
  // --- Docs ---

  async searchDocs(query, { pageSize = 10, pageToken } = {}) {
    const res = await this._safeSDKCall(
      () => this.client.request({
        method: 'POST', url: '/open-apis/suite/docs-api/search/object',
        data: { search_key: query, count: pageSize, offset: pageToken ? parseInt(pageToken) : 0, owner_ids: [], chat_ids: [], docs_types: [] },
      }),
      'searchDocs'
    );
    return { items: res.data.docs_entities || [], hasMore: res.data.has_more };
  },

  async readDoc(documentId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/raw_content`,
      query: { lang: '0' },
      sdkFn: () => this.client.docx.document.rawContent({ path: { document_id: documentId }, params: { lang: 0 } }),
      label: 'readDoc',
    });
    return { content: res.data.content };
  },

  async createDoc(title, folderId, { wikiSpaceId, wikiParentNodeToken } = {}) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents`,
      method: 'POST',
      body: { title, folder_token: folderId || '' },
      sdkFn: () => this.client.docx.document.create({ data: { title, folder_token: folderId || '' } }),
      label: 'createDoc',
    });
    const documentId = res.data.document?.document_id;
    const out = { documentId, viaUser: !!res._viaUser, fallbackWarning: res._fallbackWarning || null };
    if (documentId && wikiSpaceId) {
      try {
        const node = await this.attachToWiki(wikiSpaceId, 'docx', documentId, wikiParentNodeToken);
        if (node?.node_token) out.wikiNodeToken = node.node_token;
        else if (node?.task_id) out.wikiAttachTaskId = node.task_id;
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return out;
  },

  async getDocBlocks(documentId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks`,
      query: { page_size: '500' },
      sdkFn: () => this.client.docx.documentBlock.list({ path: { document_id: documentId }, params: { page_size: 500 } }),
      label: 'getDocBlocks',
    });
    return { items: res.data.items || [] };
  },

  async createDocBlock(documentId, parentBlockId, children, index) {
    const data = { children };
    if (index !== undefined) data.index = index;
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: data,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data,
      }),
      label: 'createDocBlock',
    });
    return { blocks: res.data.children || [], fallbackWarning: res._fallbackWarning || null };
  },

  async updateDocBlock(documentId, blockId, updateBody) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: updateBody,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: updateBody,
      }),
      label: 'updateDocBlock',
    });
    return { block: res.data.block };
  },

  async deleteDocBlocks(documentId, parentBlockId, startIndex, endIndex) {
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children/batch_delete`,
      method: 'DELETE',
      body: { start_index: startIndex, end_index: endIndex },
      sdkFn: () => this.client.docx.documentBlockChildren.batchDelete({
        path: { document_id: documentId, block_id: parentBlockId },
        data: { start_index: startIndex, end_index: endIndex },
      }),
      label: 'deleteDocBlocks',
    });
    return { deleted: true };
  },

  // Create a new image block and populate it from either a local file path or
  // an already-uploaded media token. Orchestrates the three-step Feishu flow:
  //   1) create empty image placeholder block
  //   2) upload pixels (skipped if caller passes a ready-made imageToken)
  //   3) patch the placeholder with the uploaded token
  // Returns { blockId, imageToken, viaUser }.
  async createDocBlockWithImage(documentId, parentBlockId, { imagePath, imageToken, index } = {}) {
    if (!imagePath && !imageToken) {
      throw new Error('createDocBlockWithImage: either imagePath or imageToken is required');
    }

    // Step 1 — empty placeholder.
    const placeholder = buildEmptyImageBlock();
    const createBody = { children: [placeholder] };
    if (index !== undefined) createBody.index = index;
    const created = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: createBody,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data: createBody,
      }),
      label: 'createDocBlockWithImage.placeholder',
    });
    const newBlock = (created.data.children || [])[0];
    const blockId = newBlock?.block_id;
    if (!blockId) throw new Error(`createDocBlockWithImage: placeholder creation returned no block_id: ${JSON.stringify(created.data).slice(0, 400)}`);

    // Step 2 — upload (if needed).
    let finalToken = imageToken;
    let viaUser = !!created._viaUser;
    let fallbackWarning = created._fallbackWarning || null;
    if (!finalToken) {
      const uploaded = await this.uploadMedia(imagePath, blockId, 'docx_image');
      finalToken = uploaded.fileToken;
      viaUser = viaUser && uploaded.viaUser; // true iff both steps went via user
    }

    // Step 3 — attach token to the placeholder via PATCH replace_image.
    const patch = buildReplaceImagePayload(finalToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'createDocBlockWithImage.replaceImage',
    });

    return { blockId, imageToken: finalToken, viaUser, fallbackWarning };
  },

  // Replace an existing image block's media token (e.g. swap the picture in an
  // already-created image block). Expects an uploaded media token — use
  // uploadMedia or create_doc_block's image_path shortcut to obtain one.
  async updateDocBlockImage(documentId, blockId, imageToken) {
    const patch = buildReplaceImagePayload(imageToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'updateDocBlockImage',
    });
    return { blockId, imageToken };
  },

  // Create a file-attachment block in a docx, mirroring createDocBlockWithImage:
  //   1) create empty file placeholder block
  //   2) upload the binary via uploadMedia(parent_type=docx_file)
  //   3) PATCH with replace_file.token to attach
  // Returns { blockId, fileToken, viaUser, fallbackWarning }.
  async createDocBlockWithFile(documentId, parentBlockId, { filePath, fileToken, index } = {}) {
    if (!filePath && !fileToken) {
      throw new Error('createDocBlockWithFile: either filePath or fileToken is required');
    }
    const placeholder = buildEmptyFileBlock();
    const createBody = { children: [placeholder] };
    if (index !== undefined) createBody.index = index;
    const created = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: createBody,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data: createBody,
      }),
      label: 'createDocBlockWithFile.placeholder',
    });
    // Feishu auto-wraps a FILE block (block_type=23) in a VIEW block
    // (block_type=33) — the create response returns the OUTER view block.
    // We need the inner file block's id for both the media upload (parent_node)
    // and the replace_file PATCH. Walk children to find it; fall back to a
    // get_doc_blocks lookup if the response didn't materialize the descendant.
    const newBlock = (created.data.children || [])[0];
    const outerBlockId = newBlock?.block_id;
    if (!outerBlockId) throw new Error(`createDocBlockWithFile: placeholder creation returned no block_id: ${JSON.stringify(created.data).slice(0, 400)}`);
    // Feishu auto-wraps a FILE block (23) in a VIEW block (33). The create
    // response's outer block is the view; we need to find the inner file
    // block for both the media upload (parent_node) and the replace_file PATCH.
    let blockId = outerBlockId;
    if (newBlock.block_type !== 23) {
      const inner = await this._findFileChildOf(documentId, outerBlockId, newBlock.children);
      if (!inner) throw new Error(`createDocBlockWithFile: could not locate inner FILE block under view ${outerBlockId}`);
      blockId = inner;
    }

    let finalToken = fileToken;
    let viaUser = !!created._viaUser;
    let fallbackWarning = created._fallbackWarning || null;
    if (!finalToken) {
      const uploaded = await this.uploadMedia(filePath, blockId, 'docx_file');
      finalToken = uploaded.fileToken;
      viaUser = viaUser && uploaded.viaUser;
    }

    const patch = buildReplaceFilePayload(finalToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'createDocBlockWithFile.replaceFile',
    });

    return { blockId, viewBlockId: outerBlockId !== blockId ? outerBlockId : undefined, fileToken: finalToken, viaUser, fallbackWarning };
  },

  // Helper for createDocBlockWithFile — given a view block id and the children
  // array surfaced by the create response (just IDs in docx v1), find the
  // FILE child (block_type=23). If no children list was returned, fall back
  // to listing the doc and walking by parent_id.
  async _findFileChildOf(documentId, viewBlockId, childIds) {
    if (Array.isArray(childIds) && childIds.length > 0) {
      // childIds[0] is most likely the file block — verify with a get
      for (const childId of childIds) {
        try {
          const res = await this._asUserOrApp({
            uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${childId}`,
            method: 'GET',
            sdkFn: () => this.client.docx.documentBlock.get({ path: { document_id: documentId, block_id: childId } }),
            label: '_findFileChildOf.get',
          });
          if (res?.data?.block?.block_type === 23) return childId;
        } catch (_) { /* fall through */ }
      }
      // None matched directly; return the first as best-effort
      return childIds[0];
    }
    // Fallback: list all blocks and find a 23 whose parent_id is the view block
    try {
      const res = await this._asUserOrApp({
        uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks`,
        method: 'GET',
        sdkFn: () => this.client.docx.documentBlock.list({ path: { document_id: documentId } }),
        label: '_findFileChildOf.list',
      });
      const items = res?.data?.items || [];
      const match = items.find(b => b.block_type === 23 && b.parent_id === viewBlockId);
      return match?.block_id || null;
    } catch (_) {
      return null;
    }
  },

  // Replace an existing file block's media token. Expects an already-uploaded
  // file token (use uploadMedia with parent_type=docx_file, or
  // create_doc_block's file_path shortcut).
  async updateDocBlockFile(documentId, blockId, fileToken) {
    const patch = buildReplaceFilePayload(fileToken);
    await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}`,
      method: 'PATCH',
      body: patch,
      sdkFn: () => this.client.docx.documentBlock.patch({
        path: { document_id: documentId, block_id: blockId },
        data: patch,
      }),
      label: 'updateDocBlockFile',
    });
    return { blockId, fileToken };
  },
};
