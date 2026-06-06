// src/tools/docs.js — Feishu document operations.
//
// 6 tools (was 7 in v1.3.6): search_docs, read_doc, get_doc_blocks, create_doc,
// manage_doc_block (action=create|update|delete, replaces the v1.3.6 trio
// create_doc_block / update_doc_block / delete_doc_blocks), and read_doc_markdown.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'search_docs',
    description: '[Official API] Search Feishu documents by keyword. UAT-first with app fallback: with user identity (UAT) the search covers docs visible to YOU, including your personal space; via bot it only covers docs shared with the bot. Response carries viaUser; when hasMore is true, pass the returned nextOffset back as offset to page forward.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword' },
        page_size: { type: 'number', description: 'Max results per page (default 10)' },
        offset: { type: 'number', description: 'Pagination offset from a previous nextOffset' },
      },
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
    description: '[Official API] Manage content blocks in a document. Single tool replaces v1.3.6 create_doc_block / update_doc_block / delete_doc_blocks.\n  action=create — six modes (pass exactly ONE):\n    (A) Generic — pass `children` array (e.g. [{block_type:2, text:{...}}]).\n    (B) Image from local file — pass `image_path`; plugin uploads and patches.\n    (C) Image from token — pass `image_token` (already uploaded).\n    (D) File attachment from local file — pass `file_path`; plugin handles VIEW-wrap + replace_file.\n    (E) File from token — pass `file_token`.\n    (F) Table — pass `table={rows,columns,cells?}`; plugin creates a block_type=31 table (Feishu auto-makes the block_type=32 cells) and fills each provided cell. USE THIS for tables — do NOT hand-build table blocks via `children` (the table block_type is 31, NOT 40; getting it wrong returns invalid_param).\n  action=update — generic (pass `update_body`), image-replace (pass `image_token`), or file-replace (pass `file_token`).\n  action=delete — pass `parent_block_id` + `start_index` + `end_index` (range delete).\n`document_id` accepts native ID, wiki node token, or Feishu URL.',
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
        table: { type: 'object', description: 'Create a table — create mode F (mutually exclusive with other create modes). Shape: {rows:int>=1, columns:int>=1, cells?:string[][] (row-major plain text; omit/empty-string to leave a cell blank), column_width?:int[] (px, length=columns), header_row?:bool, header_column?:bool}. The plugin creates a block_type=31 table, lets Feishu auto-create the cells, and fills each provided cell by updating its text — you never specify block types. Returns {tableBlockId, cells:[[cellId,...]] (row-major grid), filled}. Example: {"rows":2,"columns":2,"cells":[["Name","Role"],["Ann","PM"]]}.' },
      },
      required: ['action', 'document_id'],
    },
  },
  {
    name: 'read_doc_markdown',
    description: '[Plugin v1.3.9] Read a Feishu doc as Markdown (vs get_doc_blocks JSON). Saves ~60% tokens for RAG / digest / summarisation use cases. Accepts native docx token, wiki node token, or full Feishu URL. Embedded images / files appear as feishu://image_token/<TOKEN> placeholders — call download_doc_image for the binary if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'docx token / wiki node / full URL' },
      },
      required: ['document_id'],
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
    const opts = {};
    if (args.page_size) opts.pageSize = args.page_size;
    if (args.offset !== undefined) opts.pageToken = String(args.offset);
    return json(await ctx.getOfficialClient().searchDocs(args.query, opts));
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
        const modes = [args.children, args.image_path, args.image_token, args.file_path, args.file_token, args.table].filter(Boolean);
        if (modes.length > 1) return text('manage_doc_block(create): pass exactly ONE of children / image_path / image_token / file_path / file_token / table.');
        if (args.table) {
          const t = args.table;
          return json(await official.createDocTable(docId, args.parent_block_id, {
            rows: t.rows, columns: t.columns, cells: t.cells,
            columnWidth: t.column_width, headerRow: t.header_row, headerColumn: t.header_column,
            index: args.index,
          }));
        }
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
        if (!args.children) return text('manage_doc_block(create): children, image_path, image_token, file_path, file_token, or table is required.');
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
  async read_doc_markdown(args, ctx) {
    const docId = await ctx.resolveDocId(args.document_id);
    const result = await ctx.getOfficialClient().getDocBlocks(docId);

    // Lazy-load feishu-docx (so environments without the dep don't crash on startup)
    let MarkdownRenderer;
    try {
      ({ MarkdownRenderer } = require('feishu-docx'));
    } catch (e) {
      return text('read_doc_markdown: feishu-docx package not installed. Run: npm install feishu-docx@^0.7.0');
    }

    const blocks = result.items || result;
    if (!blocks || !blocks.length) {
      return text('read_doc_markdown: document has no blocks (empty or unpublished draft). Try read_doc for plain text.');
    }
    const pageBlock = blocks.find(b => b.block_type === 1);
    const documentId = pageBlock ? pageBlock.block_id : blocks[0].block_id;

    let md;
    try {
      const renderer = new MarkdownRenderer({ document: { document_id: documentId }, blocks });
      md = renderer.parse();
    } catch (e) {
      return text(`read_doc_markdown: feishu-docx render failed — ${e.message}. Try get_doc_blocks for raw JSON fallback. (feishu-docx version may need upgrading)`);
    }

    return text(_normaliseEmbeds(md));
  },
};

// Post-processor applied to feishu-docx output before returning to the caller.
// Converts inline HTML tags emitted by feishu-docx to Markdown equivalents,
// converts callout <div> wrappers to > blockquotes, decodes HTML entities, and
// normalises embedded image/file URLs to feishu:// scheme placeholders.
function _normaliseEmbeds(md) {
  // 1. Inline bold: <b>...</b> → **...**
  md = md.replace(/<b>([\s\S]*?)<\/b>/g, '**$1**');
  // 2. Inline italic: <em>...</em> → *...*
  md = md.replace(/<em>([\s\S]*?)<\/em>/g, '*$1*');
  // 3. Inline strikethrough: <del>...</del> → ~~...~~
  md = md.replace(/<del>([\s\S]*?)<\/del>/g, '~~$1~~');
  // 4. Inline underline: <u>...</u> → strip tags, keep inner text (no native Markdown underline)
  md = md.replace(/<u>([\s\S]*?)<\/u>/g, '$1');
  // 5. Callout divs → > blockquote. feishu-docx emits:
  //      <div class="callout callout-bg-N callout-border-N">
  //      <div class='callout-emoji'>EMOJI</div>
  //      <p>content...</p>
  //      </div>
  //    Strip the outer div + emoji div; prefix each non-empty inner line with "> ".
  //    Note: nested callouts will partially leak as raw HTML — feishu-docx encloses
  //    the inner block in its own div, and our non-greedy match may close on the
  //    first </div>. Acceptable for v1.3.9; revisit if real docs exhibit this.
  md = md.replace(
    /<div class="callout[^"]*">\s*<div class=['"]callout-emoji['"][^<]*<\/div>\s*([\s\S]*?)\s*<\/div>/g,
    (match, inner) => {
      const stripped = inner.replace(/<\/?[^>]+>/g, '');
      return stripped.split('\n').map(l => l.trim() ? '> ' + l : '').join('\n');
    },
  );
  // 6. Decode common HTML entities (&lt; &gt; &amp; appear in doc body text).
  //    &amp; must be decoded first so that double-encoded sequences like &amp;lt;
  //    are fully resolved (otherwise &amp; → & yields &lt; which stays escaped).
  md = md.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // 7. Image URL normalization.
  //    feishu-docx parseImage (verified from dist/markdown_renderer.js) emits an HTML <img> tag
  //    with the image token as src, e.g. <img src="img_v3_02k0XXX"/> or
  //    <img src="img_v3_02k0XXX" src-width="800" src-height="600" align="center"/>
  //    Convert to: ![](feishu://image_token/TOKEN)
  md = md.replace(/<img\s+src="([^"]+)"[^>]*\/?>/g, '![](feishu://image_token/$1)');
  // 8. File embed normalization.
  //    feishu-docx parseFile (verified from dist/markdown_renderer.js) emits the
  //    file token directly as the markdown link URL: [document.pdf](boxcnAbCdEfGhIj)
  //    Feishu Drive file tokens always start with "box" — anchoring on that
  //    prefix excludes wiki/docx/bitable/sheet mention links that share the
  //    [name](token) syntax (wikcn/wikm/wikn/docx/doccn/bascn/sheet prefixes).
  //    Convert to: [name](feishu://file_token/TOKEN)
  md = md.replace(/\[([^\]]+)\]\((box[a-zA-Z0-9_-]{8,})\)/g, '[$1](feishu://file_token/$2)');
  return md;
}

module.exports = { schemas, handlers };
