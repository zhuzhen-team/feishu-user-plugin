// src/tools/wiki.js — Wiki space + node read tools.

const { json } = require('./_registry');

const schemas = [
  {
    name: 'list_wiki_spaces',
    description: '[Official API] List all accessible Wiki spaces.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_wiki',
    description: '[Official API] Search Wiki nodes by keyword.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'list_wiki_nodes',
    description: '[Official API] List nodes in a Wiki space.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Wiki space ID' },
        parent_node_token: { type: 'string', description: 'Parent node token (optional)' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'get_wiki_node',
    description: '[Official API] Resolve a Wiki node token to its underlying object (docx / bitable / sheet / mindnote / file). Returns obj_type + obj_token + space_id so you can read/write the real resource via the usual docx / bitable tools. Accepts bare wiki node token (wikcnXXX), an underlying obj_token (docxXXX / bascnXXX from search_wiki), or a full Feishu /wiki/ URL — the handler tries the wiki endpoint first and falls back to a synthesized node-shape for non-wiki tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        node_token: { type: 'string', description: 'Wiki node token (wikcnXXX / wikmXXX / wiknXXX), underlying obj_token (docxXXX / bascnXXX), or full Feishu /wiki/<token> URL' },
      },
      required: ['node_token'],
    },
  },
];

const { parseFeishuInput } = require('../resolver');

const handlers = {
  async list_wiki_spaces(_args, ctx) {
    return json(await ctx.getOfficialClient().listWikiSpaces());
  },
  async search_wiki(args, ctx) {
    return json(await ctx.getOfficialClient().searchWiki(args.query));
  },
  async list_wiki_nodes(args, ctx) {
    return json(await ctx.getOfficialClient().listWikiNodes(args.space_id, { parentNodeToken: args.parent_node_token }));
  },
  async get_wiki_node(args, ctx) {
    const parsed = parseFeishuInput(args.node_token);
    const token = (parsed.kind === 'wiki' || parsed.kind === 'raw') ? parsed.token : args.node_token;
    try {
      return json(await ctx.getOfficialClient().getWikiNode(token));
    } catch (e) {
      // search_wiki returns underlying obj_tokens (docxXXX / bascnXXX), which
      // wiki.v2.getNode rejects. Detect the wiki-only error codes and return
      // a synthesized node-shape so callers can pass either token kind.
      const msg = String(e.message || '');
      if (/95300\d|invalid.*token|node.*not.*found/i.test(msg)) {
        const objType = inferObjTypeFromToken(token);
        if (objType) {
          return json({
            obj_type: objType,
            obj_token: token,
            note: `Token does not look like a wiki node token; treating as a direct ${objType} obj_token. Pass it to ${objType === 'bitable' ? 'list_bitable_tables / search_bitable_records' : objType === 'docx' ? 'read_doc / get_doc_blocks' : 'the matching read tool'} directly.`,
          });
        }
      }
      throw e;
    }
  },
};

function inferObjTypeFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  if (token.startsWith('docx')) return 'docx';
  if (token.startsWith('doccn') || token.startsWith('doc')) return 'doc';
  if (token.startsWith('bascn') || token.startsWith('bas')) return 'bitable';
  if (token.startsWith('shtcn') || token.startsWith('sht')) return 'sheet';
  if (token.startsWith('mind') || token.startsWith('mn')) return 'mindnote';
  if (token.startsWith('boxcn') || token.startsWith('boxbn')) return 'file';
  return null;
}

module.exports = { schemas, handlers };
