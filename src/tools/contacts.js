// src/tools/contacts.js — contact lookup + P2P chat creation.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'search_contacts',
    description: '[User Identity] Search Feishu users, bots, or group chats by name. Returns IDs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keyword' } },
      required: ['query'],
    },
  },
  {
    name: 'create_p2p_chat',
    description: '[User Identity] Create or get a P2P (direct message) chat. Returns numeric chat_id.',
    inputSchema: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Target user ID from search_contacts' } },
      required: ['user_id'],
    },
  },
  {
    name: 'get_user_info',
    description: '[User Identity] Look up a user\'s display name by user ID.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'User ID' },
        chat_id: { type: 'string', description: 'Chat context (optional)' },
      },
      required: ['user_id'],
    },
  },
];

const handlers = {
  async search_contacts(args, ctx) {
    const c = await ctx.getUserClient();
    return json(await c.search(args.query));
  },
  async create_p2p_chat(args, ctx) {
    const c = await ctx.getUserClient();
    const chatId = await c.createChat(args.user_id);
    return text(chatId ? `P2P chat: ${chatId}` : 'Failed to create P2P chat');
  },
  async get_user_info(args, ctx) {
    let n = null;
    try {
      const official = ctx.getOfficialClient();
      n = await official.getUserById(args.user_id, 'open_id');
    } catch {}
    if (!n) {
      try {
        const c = await ctx.getUserClient();
        n = await c.getUserName(args.user_id);
      } catch {}
    }
    return text(n
      ? `User ${args.user_id}: ${n}`
      : `Could not resolve user ${args.user_id}. Tried (1) UAT contact API, (2) bot contact API, (3) cookie protobuf cache. Possible causes:\n  • External tenant user — contact API can't see them. Use search_contacts with display name + the inferred numeric ID for messaging.\n  • App is missing contact:user.base:readonly scope (only blocks bot path; UAT path should still work).\n  • UAT not configured — run \`npx feishu-user-plugin oauth\`.`);
  },
};

module.exports = { schemas, handlers };
