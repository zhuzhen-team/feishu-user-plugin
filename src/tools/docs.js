// src/tools/docs.js — Feishu document operations (search, read, create, edit blocks).

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'search_docs',
    description: '[Official API] Search Feishu documents by keyword.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'read_doc',
    description: '[Official API] Read the raw text content of a Feishu document.',
    inputSchema: {
      type: 'object',
      properties: { document_id: { type: 'string', description: 'Document ID or token' } },
      required: ['document_id'],
    },
  },
  {
    name: 'get_doc_blocks',
    description: '[Official API] Get structured block tree of a document. Returns block types, content, and hierarchy for precise document analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID (from search_docs or create_doc)' },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'create_doc',
    description: '[Official API] Create a new Feishu document. Can place directly under a Wiki space by passing wiki_space_id (optionally wiki_parent_node_token for nested placement) — the plugin creates the doc in drive then attaches it as a Wiki node.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        folder_id: { type: 'string', description: 'Parent folder token (optional; ignored when wiki_space_id is set)' },
        wiki_space_id: { type: 'string', description: 'Wiki space ID to place the doc under (optional)' },
        wiki_parent_node_token: { type: 'string', description: 'Parent wiki node token within the space (optional; defaults to space root)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_doc_block',
    description: '[Official API] Insert content blocks into a document. Five modes:\n  (A) Generic — pass `children` array (e.g. [{block_type:2, text:{...}}]) for text/heading/list/etc.\n  (B) Image from local file — pass `image_path` (absolute path); the plugin creates an image block, uploads the file to drive, and patches the block with the token. Returns block_id + image_token.\n  (C) Image from uploaded token — pass `image_token` to reuse an already-uploaded image.\n  (D) File attachment from local file — pass `file_path`; the plugin creates a file block (block_type=23), uploads via parent_type=docx_file, and patches with replace_file.\n  (E) File from uploaded token — pass `file_token` to reuse an already-uploaded file.\n`document_id` accepts native document_id, wiki node token, or Feishu URL.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID, wiki node token, or Feishu URL' },
        parent_block_id: { type: 'string', description: 'Parent block ID (use document_id for root)' },
        children: { type: 'array', description: 'Generic block objects — mode A. E.g. [{block_type:2, text:{elements:[{text_run:{content:"Hello"}}]}}]', items: { type: 'object' } },
        image_path: { type: 'string', description: 'Local image path — mode B (mutually exclusive with other modes)' },
        image_token: { type: 'string', description: 'Pre-uploaded docx image token — mode C (mutually exclusive with other modes)' },
        file_path: { type: 'string', description: 'Local file path for an attachment block — mode D (mutually exclusive with other modes)' },
        file_token: { type: 'string', description: 'Pre-uploaded docx file token — mode E (mutually exclusive with other modes)' },
        index: { type: 'number', description: 'Insert position (optional, appends to end if omitted)' },
      },
      required: ['document_id', 'parent_block_id'],
    },
  },
  {
    name: 'update_doc_block',
    description: '[Official API] Update a specific block in a document. Generic mode: pass update_body. Image-replace mode: pass image_token to swap the picture in an existing image block. File-replace mode: pass file_token to swap an existing file block. document_id accepts native ID, wiki node token, or Feishu URL.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID, wiki node token, or Feishu URL' },
        block_id: { type: 'string', description: 'Block ID to update' },
        update_body: { type: 'object', description: 'Generic update payload. E.g. {update_text_elements:{elements:[{text_run:{content:"new text"}}]}}' },
        image_token: { type: 'string', description: 'Pre-uploaded image token — if provided, update_body is ignored and the block is patched with {replace_image:{token}}' },
        file_token: { type: 'string', description: 'Pre-uploaded file token — patches the block with {replace_file:{token}}' },
      },
      required: ['document_id', 'block_id'],
    },
  },
  {
    name: 'delete_doc_blocks',
    description: '[Official API] Delete a range of blocks from a document.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Document ID' },
        parent_block_id: { type: 'string', description: 'Parent block ID containing the blocks to delete' },
        start_index: { type: 'number', description: 'Start index (inclusive)' },
        end_index: { type: 'number', description: 'End index (exclusive)' },
      },
      required: ['document_id', 'parent_block_id', 'start_index', 'end_index'],
    },
  },
];

const handlers = {
  async search_docs(args, ctx) {
    return json(await ctx.getOfficialClient().searchDocs(args.query));
  },
  async read_doc(args, ctx) {
    return json(await ctx.getOfficialClient().readDoc(await ctx.resolveDocId(args.document_id)));
  },
  async get_doc_blocks(args, ctx) {
    return json(await ctx.getOfficialClient().getDocBlocks(await ctx.resolveDocId(args.document_id)));
  },
  async create_doc(args, ctx) {
    const r = await ctx.getOfficialClient().createDoc(args.title, args.folder_id, {
      wikiSpaceId: args.wiki_space_id,
      wikiParentNodeToken: args.wiki_parent_node_token,
    });
    const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; document owned by the app, not you)';
    const wikiNote = r.wikiNodeToken ? ` [wiki node: ${r.wikiNodeToken}]`
      : r.wikiAttachTaskId ? ` [wiki attach queued — task_id: ${r.wikiAttachTaskId}]`
      : r.wikiAttachError ? ` [WARNING: wiki attach failed — ${r.wikiAttachError}. Doc exists in drive root/folder.]`
      : '';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Document created${ownership}: ${r.documentId}${wikiNote}${warn}`);
  },
  async create_doc_block(args, ctx) {
    const official = ctx.getOfficialClient();
    const docId = await ctx.resolveDocId(args.document_id);
    const modes = [args.children, args.image_path, args.image_token, args.file_path, args.file_token].filter(Boolean);
    if (modes.length > 1) return text('create_doc_block: pass exactly ONE of children / image_path / image_token / file_path / file_token.');
    if (args.image_path || args.image_token) {
      const r = await official.createDocBlockWithImage(docId, args.parent_block_id, {
        imagePath: args.image_path,
        imageToken: args.image_token,
        index: args.index,
      });
      return json(r);
    }
    if (args.file_path || args.file_token) {
      const r = await official.createDocBlockWithFile(docId, args.parent_block_id, {
        filePath: args.file_path,
        fileToken: args.file_token,
        index: args.index,
      });
      return json(r);
    }
    if (!args.children) return text('create_doc_block: children, image_path, image_token, file_path, or file_token is required.');
    return json(await official.createDocBlock(docId, args.parent_block_id, args.children, args.index));
  },
  async update_doc_block(args, ctx) {
    const official = ctx.getOfficialClient();
    const docId = await ctx.resolveDocId(args.document_id);
    const modes = [args.update_body, args.image_token, args.file_token].filter(Boolean);
    if (modes.length > 1) return text('update_doc_block: pass exactly ONE of update_body / image_token / file_token.');
    if (args.image_token) {
      return json(await official.updateDocBlockImage(docId, args.block_id, args.image_token));
    }
    if (args.file_token) {
      return json(await official.updateDocBlockFile(docId, args.block_id, args.file_token));
    }
    if (!args.update_body) return text('update_doc_block: update_body, image_token, or file_token is required.');
    return json(await official.updateDocBlock(docId, args.block_id, args.update_body));
  },
  async delete_doc_blocks(args, ctx) {
    return text(`Blocks deleted: ${(await ctx.getOfficialClient().deleteDocBlocks(await ctx.resolveDocId(args.document_id), args.parent_block_id, args.start_index, args.end_index)).deleted}`);
  },
};

module.exports = { schemas, handlers };
