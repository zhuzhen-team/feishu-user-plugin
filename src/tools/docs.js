// src/tools/docs.js — Feishu document operations.
//
// 5 tools (was 7 in v1.3.6): search_docs, read_doc, get_doc_blocks, create_doc,
// and the consolidated manage_doc_block (action=create|update|delete) which
// replaces the v1.3.6 trio create_doc_block / update_doc_block / delete_doc_blocks.

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
    name: 'manage_doc_block',
    description: '[Official API] Manage content blocks in a document. Single tool replaces v1.3.6 create_doc_block / update_doc_block / delete_doc_blocks.\n  action=create — five modes:\n    (A) Generic — pass `children` array (e.g. [{block_type:2, text:{...}}]).\n    (B) Image from local file — pass `image_path`; plugin uploads and patches.\n    (C) Image from token — pass `image_token` (already uploaded).\n    (D) File attachment from local file — pass `file_path`; plugin handles VIEW-wrap + replace_file.\n    (E) File from token — pass `file_token`.\n  action=update — generic (pass `update_body`), image-replace (pass `image_token`), or file-replace (pass `file_token`).\n  action=delete — pass `parent_block_id` + `start_index` + `end_index` (range delete).\n`document_id` accepts native ID, wiki node token, or Feishu URL.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Operation to perform' },
        document_id: { type: 'string', description: 'Document ID, wiki node token, or Feishu URL (required for all actions)' },
        block_id: { type: 'string', description: 'Block ID — required for action=update.' },
        parent_block_id: { type: 'string', description: 'Parent block ID — required for create/delete (use document_id for the doc root).' },
        index: { type: 'number', description: 'Insert position for create (optional, appends to end if omitted).' },
        start_index: { type: 'number', description: 'Range start (inclusive) — required for delete.' },
        end_index: { type: 'number', description: 'Range end (exclusive) — required for delete.' },
        children: { type: 'array', description: 'Generic blocks for create mode A. E.g. [{block_type:2, text:{elements:[{text_run:{content:"Hello"}}]}}]', items: { type: 'object' } },
        image_path: { type: 'string', description: 'Local image path — create mode B (mutually exclusive with other create modes).' },
        image_token: { type: 'string', description: 'Pre-uploaded docx image token — create mode C, or update image-replace.' },
        file_path: { type: 'string', description: 'Local file path — create mode D (mutually exclusive with other create modes).' },
        file_token: { type: 'string', description: 'Pre-uploaded docx file token — create mode E, or update file-replace.' },
        update_body: { type: 'object', description: 'Generic update payload for action=update. E.g. {update_text_elements:{elements:[{text_run:{content:"new text"}}]}}.' },
      },
      required: ['action', 'document_id'],
    },
  },
];

function need(arg, name, action) {
  if (arg === undefined || arg === null || arg === '') {
    throw new Error(`manage_doc_block: ${name} required for action=${action}`);
  }
}

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
  async manage_doc_block(args, ctx) {
    const official = ctx.getOfficialClient();
    const docId = await ctx.resolveDocId(args.document_id);
    switch (args.action) {
      case 'create': {
        need(args.parent_block_id, 'parent_block_id', 'create');
        const modes = [args.children, args.image_path, args.image_token, args.file_path, args.file_token].filter(Boolean);
        if (modes.length > 1) return text('manage_doc_block(create): pass exactly ONE of children / image_path / image_token / file_path / file_token.');
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
        if (!args.children) return text('manage_doc_block(create): children, image_path, image_token, file_path, or file_token is required.');
        return json(await official.createDocBlock(docId, args.parent_block_id, args.children, args.index));
      }
      case 'update': {
        need(args.block_id, 'block_id', 'update');
        const modes = [args.update_body, args.image_token, args.file_token].filter(Boolean);
        if (modes.length > 1) return text('manage_doc_block(update): pass exactly ONE of update_body / image_token / file_token.');
        if (args.image_token) {
          return json(await official.updateDocBlockImage(docId, args.block_id, args.image_token));
        }
        if (args.file_token) {
          return json(await official.updateDocBlockFile(docId, args.block_id, args.file_token));
        }
        if (!args.update_body) return text('manage_doc_block(update): update_body, image_token, or file_token is required.');
        return json(await official.updateDocBlock(docId, args.block_id, args.update_body));
      }
      case 'delete': {
        need(args.parent_block_id, 'parent_block_id', 'delete');
        if (typeof args.start_index !== 'number' || typeof args.end_index !== 'number') {
          throw new Error('manage_doc_block(delete): start_index and end_index (numbers) required.');
        }
        return text(`Blocks deleted: ${(await official.deleteDocBlocks(docId, args.parent_block_id, args.start_index, args.end_index)).deleted}`);
      }
    }
  },
};

module.exports = { schemas, handlers };
