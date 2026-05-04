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
    description: '[Official API] Resolve a Wiki node token to its underlying object (docx / bitable / sheet / mindnote / file). Returns obj_type + obj_token + space_id so you can read/write the real resource via the usual docx / bitable tools. Accepts bare wiki node token (wikcnXXX) or a full Feishu /wiki/ URL.',
    inputSchema: {
      type: 'object',
      properties: {
        node_token: { type: 'string', description: 'Wiki node token (wikcnXXX / wikmXXX / wiknXXX) or full Feishu /wiki/<token> URL' },
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
    return json(await ctx.getOfficialClient().getWikiNode(token));
  },
};

module.exports = { schemas, handlers };
