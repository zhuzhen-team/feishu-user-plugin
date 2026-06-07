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
    description: '[Official API] Add or remove members from a group chat. The Feishu API rejects with code 9499 when the IDs in `member_ids` do not match `member_id_type` — pass `member_id_type` explicitly when using union_id or user_id (default: open_id).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Group chat ID (oc_xxx)' },
        member_ids: { type: 'array', items: { type: 'string' }, description: 'Array of member identifiers — IDs must match member_id_type.' },
        action: { type: 'string', enum: ['add', 'remove'], description: 'Action to perform' },
        member_id_type: { type: 'string', enum: ['open_id', 'union_id', 'user_id'], description: 'Format of member_ids (default: open_id).', default: 'open_id' },
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
    const memberIdType = args.member_id_type || 'open_id';
    if (args.action === 'remove') {
      return json(await official.removeChatMembers(args.chat_id, args.member_ids, memberIdType));
    }
    const r = await official.addChatMembers(args.chat_id, args.member_ids, memberIdType);
    // Lift a top warning when any id did NOT actually join — invalid format,
    // nonexistent user, or stuck behind join-approval. Without it an empty
    // invalidIds read as "everyone is in" while some never joined.
    const problems = [];
    if (r.invalidIds?.length) problems.push(`${r.invalidIds.length} invalid id(s): ${r.invalidIds.join(', ')}`);
    if (r.notExistedIds?.length) problems.push(`${r.notExistedIds.length} nonexistent user(s): ${r.notExistedIds.join(', ')}`);
    if (r.pendingApprovalIds?.length) problems.push(`${r.pendingApprovalIds.length} pending group-owner approval (NOT yet in the group): ${r.pendingApprovalIds.join(', ')}`);
    if (problems.length) {
      r.fallbackWarning = `⚠ Partial add — ${problems.join('; ')}. The rest joined successfully.`;
    }
    return json(r);
  },
};

module.exports = { schemas, handlers };
