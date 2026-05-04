// src/tools/okr.js — OKR read tools (v1.3.4).

const { json } = require('./_registry');

const schemas = [
  {
    name: 'list_user_okrs',
    description: '[Official API + UAT] List a user\'s OKRs. Requires the user\'s open_id (get yours via get_login_status or search_contacts). Filter by period_ids to narrow to a specific quarter.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Target user\'s open_id (or the matching user_id_type)' },
        user_id_type: { type: 'string', enum: ['user_id', 'union_id', 'open_id', 'people_admin_id'], description: 'Type of user_id (default: open_id)' },
        period_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by OKR period IDs (optional). Get period IDs via list_okr_periods.' },
        offset: { type: 'number', description: 'Pagination offset (default 0)' },
        limit: { type: 'number', description: 'Items per page (default 10, max 10)' },
        lang: { type: 'string', description: 'Response language (optional, e.g. "zh_cn", "en_us")' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_okrs',
    description: '[Official API + UAT] Batch-fetch full OKR details (objectives, key results, progress, alignments) by OKR IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        okr_ids: { type: 'array', items: { type: 'string' }, description: 'OKR IDs (max 10 per call). From list_user_okrs.' },
        user_id_type: { type: 'string', enum: ['user_id', 'union_id', 'open_id', 'people_admin_id'], description: 'Type of user_ids in response (default: open_id)' },
        lang: { type: 'string', description: 'Response language (optional)' },
      },
      required: ['okr_ids'],
    },
  },
  {
    name: 'list_okr_periods',
    description: '[Official API + UAT] List OKR periods (quarters / years) defined in the tenant. Use period_ids from this to filter list_user_okrs.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 10)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
];

const handlers = {
  async list_user_okrs(args, ctx) {
    return json(await ctx.getOfficialClient().listUserOkrs(args.user_id, {
      periodIds: args.period_ids, offset: args.offset, limit: args.limit, lang: args.lang,
      userIdType: args.user_id_type,
    }));
  },
  async get_okrs(args, ctx) {
    return json(await ctx.getOfficialClient().getOkrs(args.okr_ids, { lang: args.lang, userIdType: args.user_id_type }));
  },
  async list_okr_periods(args, ctx) {
    return json(await ctx.getOfficialClient().listOkrPeriods({ pageSize: args.page_size, pageToken: args.page_token }));
  },
};

module.exports = { schemas, handlers };
