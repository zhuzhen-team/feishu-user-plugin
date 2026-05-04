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
  {
    name: 'find_user',
    description: '[Official API] Find a Feishu user by email or mobile number.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email (optional)' },
        mobile: { type: 'string', description: 'User mobile with country code like +86xxx (optional)' },
      },
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
    return text(n ? `User ${args.user_id}: ${n}` : `Could not resolve user ${args.user_id}. This user may be from an external tenant. Try search_contacts with the user's display name instead.`);
  },
  async find_user(args, ctx) {
    return json(await ctx.getOfficialClient().findUserByIdentity({ emails: args.email, mobiles: args.mobile }));
  },
};

module.exports = { schemas, handlers };
