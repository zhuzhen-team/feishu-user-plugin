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
    // UAT-first (v1.3.16): the suite search API only indexes docs the calling
    // identity can see. App identity misses everything in the user's personal
    // space — the 2026-06-06 "search_docs 搜不到个人空间 PDF" report.
    // Tool args arrive unvalidated — clamp to sane non-negative integers so a
    // bad offset can't reach Feishu as NaN/negative or corrupt nextOffset
    // math (Copilot review, PR #115).
    const offset = Math.max(0, parseInt(pageToken, 10) || 0);
    const size = Math.max(1, parseInt(pageSize, 10) || 10);
    const body = { search_key: query, count: size, offset, owner_ids: [], chat_ids: [], docs_types: [] };
    const res = await this._asUserOrApp({
      uatPath: '/open-apis/suite/docs-api/search/object',
      method: 'POST',
      body,
      sdkFn: () => this.client.request({ method: 'POST', url: '/open-apis/suite/docs-api/search/object', data: body }),
      label: 'searchDocs',
    });
    const out = { items: res.data.docs_entities || [], hasMore: res.data.has_more, viaUser: !!res._viaUser };
    // Offset-based cursor — hasMore alone gave callers no way to actually
    // page forward, and UAT-wide search makes truncation likelier (the hidden
    // tail may hold the very personal-space doc the user is hunting).
    // Guard on items.length: an abnormal has_more:true + empty page would
    // otherwise emit nextOffset === offset and stall a paging loop.
    if (res.data.has_more && out.items.length > 0) out.nextOffset = offset + out.items.length;
    if (res._fallbackWarning) out.fallbackWarning = res._fallbackWarning;
    return out;
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

  // Direct children of a single block — scoped, so it does not inherit the
  // whole-document 500-block cap of getDocBlocks. Used by createDocTable to map
  // a table's cells (and each cell's text block) reliably in large documents.
  async getBlockChildren(documentId, blockId) {
    const res = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}/children`,
      query: { page_size: '500' },
      sdkFn: () => this.client.docx.documentBlockChildren.get({
        path: { document_id: documentId, block_id: blockId },
        params: { page_size: 500 },
      }),
      label: 'getBlockChildren',
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

  // Create a Feishu docx table (block_type=31) and optionally fill its cells —
  // so callers never have to know docx block types. Added after field reports
  // of agents guessing the table block_type (40 is wrong; 31 table / 32 cell).
  // Flow:
  //   1) create the table block with row_size/column_size — Feishu auto-creates
  //      the table_cell (32) children (row-major) and gives each cell an empty
  //      text block.
  //   2) read the table back to map cell_id -> its auto-created text block.
  //   3) fill: UPDATE each cell's existing text block (clean — no stray empty
  //      block) when present, else CREATE a text block in the cell.
  // `cells` is an optional row-major 2D array of plain strings.
  // Returns { tableBlockId, cells:[[cellId,...],...], rows, columns, filled, viaUser, fallbackWarning }.
  async createDocTable(documentId, parentBlockId, { rows, columns, cells, columnWidth, headerRow, headerColumn, index } = {}) {
    rows = Number(rows); columns = Number(columns);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1) {
      throw new Error('createDocTable: rows and columns must be integers >= 1');
    }
    const property = { row_size: rows, column_size: columns };
    if (Array.isArray(columnWidth) && columnWidth.length === columns) property.column_width = columnWidth;
    if (headerRow) property.header_row = true;
    if (headerColumn) property.header_column = true;
    const createBody = { children: [{ block_type: 31, table: { property } }] };
    if (index !== undefined) createBody.index = index;
    const created = await this._asUserOrApp({
      uatPath: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children`,
      method: 'POST',
      body: createBody,
      sdkFn: () => this.client.docx.documentBlockChildren.create({
        path: { document_id: documentId, block_id: parentBlockId },
        data: createBody,
      }),
      label: 'createDocTable',
    });
    const tableCreated = (created.data.children || [])[0];
    const tableBlockId = tableCreated?.block_id;
    if (!tableBlockId) throw new Error(`createDocTable: no table block_id returned: ${JSON.stringify(created.data).slice(0, 400)}`);
    const viaUser = !!created._viaUser;
    const fallbackWarning = created._fallbackWarning || null;

    // Resolve the cell IDs. Prefer the create response; else fetch the table
    // block's children directly (scoped — NOT the whole-doc getDocBlocks, which
    // caps at 500 blocks and would silently lose an appended table's cells in a
    // large document). Fail loud rather than silently dropping requested content.
    let flatCellIds = tableCreated.table?.cells || tableCreated.children || [];
    if (flatCellIds.length < rows * columns) {
      flatCellIds = ((await this.getBlockChildren(documentId, tableBlockId)).items || []).map(b => b.block_id);
    }
    if (flatCellIds.length < rows * columns) {
      throw new Error(`createDocTable: created table ${tableBlockId} but resolved only ${flatCellIds.length}/${rows * columns} cells — aborting fill to avoid silently dropping content.`);
    }
    const grid = [];
    for (let r = 0; r < rows; r++) grid.push(flatCellIds.slice(r * columns, (r + 1) * columns));

    let filled = 0;
    if (Array.isArray(cells)) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns; c++) {
          const content = cells[r] ? cells[r][c] : undefined;
          if (content === undefined || content === null || content === '') continue;
          const cellId = grid[r][c];
          if (!cellId) throw new Error(`createDocTable: missing cell id at row ${r}, col ${c}`);
          // Each fresh cell auto-creates exactly one empty text block — UPDATE it
          // (clean) rather than CREATE a second. Scoped per-cell fetch stays
          // correct regardless of overall document size.
          const cellChildren = (await this.getBlockChildren(documentId, cellId)).items || [];
          const textChild = cellChildren.find(b => b.block_type === 2);
          const elements = { elements: [{ text_run: { content: String(content) } }] };
          if (textChild) {
            await this.updateDocBlock(documentId, textChild.block_id, { update_text_elements: elements });
          } else {
            await this.createDocBlock(documentId, cellId, [{ block_type: 2, text: elements }]);
          }
          filled++;
        }
      }
    }
    return { tableBlockId, cells: grid, rows, columns, filled, viaUser, fallbackWarning };
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
