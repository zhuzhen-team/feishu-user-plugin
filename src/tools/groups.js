// src/tools/groups.js — bot-side group chat management.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'create_group',
    description: '[Official API] Create a new group chat (as bot). Can add initial members.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name' },
        description: { type: 'string', description: 'Group description (optional)' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'Initial member open_ids (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_group',
    description: '[Official API] Update group chat name or description.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx)' },
        name: { type: 'string', description: 'New group name (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'list_members',
    description: '[Official API] List all members in a group chat.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx)' },
        page_size: { type: 'number', description: 'Items per page (default 50)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'manage_members',
    description: '[Official API] Add or remove members from a group chat.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Group chat ID (oc_xxx)' },
        member_ids: { type: 'array', items: { type: 'string' }, description: 'Array of user open_ids' },
        action: { type: 'string', enum: ['add', 'remove'], description: 'Action to perform' },
      },
      required: ['chat_id', 'member_ids', 'action'],
    },
  },
];

const handlers = {
  async create_group(args, ctx) {
    return text(`Group created: ${(await ctx.getOfficialClient().createChat({ name: args.name, description: args.description, userIds: args.user_ids })).chatId}`);
  },
  async update_group(args, ctx) {
    return text(`Group updated: ${(await ctx.getOfficialClient().updateChat(args.chat_id, { name: args.name, description: args.description })).updated}`);
  },
  async list_members(args, ctx) {
    return json(await ctx.getOfficialClient().listChatMembers(args.chat_id, { pageSize: args.page_size, pageToken: args.page_token }));
  },
  async manage_members(args, ctx) {
    const official = ctx.getOfficialClient();
    if (args.action === 'remove') {
      return json(await official.removeChatMembers(args.chat_id, args.member_ids));
    }
    return json(await official.addChatMembers(args.chat_id, args.member_ids));
  },
};

module.exports = { schemas, handlers };
