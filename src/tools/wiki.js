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
    description: '[Official API] Search Wiki nodes by keyword. UAT-first with app fallback: with user identity (UAT) the search covers wiki spaces visible to YOU; via bot it only covers spaces the bot was invited to. Response carries viaUser.',
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
  {
    name: 'create_wiki_node',
    description: '[Official API] Create a new Wiki node inside a space. obj_type picks the underlying resource (doc/sheet/bitable/mindnote/file/docx/slides). UAT-first so the resource is owned by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Wiki space ID (from list_wiki_spaces)' },
        obj_type: { type: 'string', enum: ['doc', 'sheet', 'bitable', 'mindnote', 'file', 'docx', 'slides'], description: 'Underlying resource type' },
        title: { type: 'string', description: 'Node title (optional; Feishu generates a default if absent)' },
        parent_node_token: { type: 'string', description: 'Parent wiki node under which to create (optional; root if omitted)' },
        node_type: { type: 'string', enum: ['origin', 'shortcut'], description: 'origin = real resource, shortcut = pointer to existing node (default: origin)', default: 'origin' },
        origin_node_token: { type: 'string', description: 'Required when node_type=shortcut — the wiki node this shortcut points at' },
      },
      required: ['space_id', 'obj_type'],
    },
  },
  {
    name: 'update_wiki_node',
    description: '[Official API] Rename a Wiki node (only `title` is updatable via the wiki API; the underlying resource content is edited via docx/bitable/sheet tools).',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Wiki space ID' },
        node_token: { type: 'string', description: 'Wiki node token (wikcnXXX)' },
        title: { type: 'string', description: 'New title' },
      },
      required: ['space_id', 'node_token', 'title'],
    },
  },
  {
    name: 'move_wiki_node',
    description: '[Official API] Move a Wiki node to a different parent (within the same space) or to a different space. Pass at least one of target_parent_token / target_space_id.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Source space ID' },
        node_token: { type: 'string', description: 'Wiki node token to move' },
        target_parent_token: { type: 'string', description: 'New parent wiki node token (optional)' },
        target_space_id: { type: 'string', description: 'New target space ID (optional; same-space move if omitted)' },
      },
      required: ['space_id', 'node_token'],
    },
  },
  {
    name: 'copy_wiki_node',
    description: '[Official API] Deep-copy a Wiki node into a different location (and optionally a different space). Underlying resource is duplicated.',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Source space ID' },
        node_token: { type: 'string', description: 'Wiki node token to copy' },
        target_parent_token: { type: 'string', description: 'Destination parent wiki node token (optional)' },
        target_space_id: { type: 'string', description: 'Destination space ID (optional; same-space copy if omitted)' },
        title: { type: 'string', description: 'Title for the copy (optional; defaults to source title)' },
      },
      required: ['space_id', 'node_token'],
    },
  },
  {
    name: 'delete_wiki_node',
    description: '[Official API, v1.3.7] Delete a Wiki node. Calls `DELETE /open-apis/wiki/v2/spaces/{space_id}/nodes/{node_token}`. The Feishu SDK does not type this endpoint, so the call goes through raw REST (UAT-first; bot fallback uses `client.request`). **The underlying drive resource (docx / sheet / bitable / file) is NOT deleted** — Feishu treats wiki nodes as pointers. To delete the actual resource as well, follow up with `manage_drive_file(action=delete, type=<obj_type>, file_token=<obj_token>)` (use `get_wiki_node` first to get obj_type / obj_token).',
    inputSchema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Wiki space ID' },
        node_token: { type: 'string', description: 'Wiki node token to delete' },
      },
      required: ['space_id', 'node_token'],
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
  async create_wiki_node(args, ctx) {
    return json(await ctx.getOfficialClient().createWikiNode(args.space_id, {
      obj_type: args.obj_type,
      node_type: args.node_type || 'origin',
      parent_node_token: args.parent_node_token,
      origin_node_token: args.origin_node_token,
      title: args.title,
    }));
  },
  async update_wiki_node(args, ctx) {
    return json(await ctx.getOfficialClient().updateWikiNodeTitle(args.space_id, args.node_token, args.title));
  },
  async move_wiki_node(args, ctx) {
    return json(await ctx.getOfficialClient().moveWikiNode(args.space_id, args.node_token, {
      target_parent_token: args.target_parent_token,
      target_space_id: args.target_space_id,
    }));
  },
  async copy_wiki_node(args, ctx) {
    return json(await ctx.getOfficialClient().copyWikiNode(args.space_id, args.node_token, {
      target_parent_token: args.target_parent_token,
      target_space_id: args.target_space_id,
      title: args.title,
    }));
  },
  async delete_wiki_node(args, ctx) {
    return json(await ctx.getOfficialClient().deleteWikiNode(args.space_id, args.node_token));
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
