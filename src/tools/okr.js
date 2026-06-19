// src/tools/okr.js — OKR read tools (v1.3.4) + progress record write (v1.3.7).

const { json, text } = require('./_registry');

// Helper: wrap plain text into the Feishu OKR progressRecord content block schema.
// Feishu's progressRecord.create expects a `content: { blocks: [...] }` payload
// where each block is a paragraph or gallery. Most callers just want a plain
// note, so this helper builds the trivial single-paragraph form.
function buildOkrContent(text) {
  return {
    blocks: [
      {
        type: 'paragraph',
        paragraph: {
          elements: [
            { type: 'textRun', textRun: { text: String(text || '') } },
          ],
        },
      },
    ],
  };
}

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
  {
    name: 'create_okr_progress_record',
    description: '[Official API + UAT, v1.3.7] Add a progress note to an OKR objective or key result. Feishu requires `source_title`, `source_url`, and a block-structured `content`; this tool exposes a simple `content_text` and auto-wraps it into the single-paragraph block format. Pass richer `content` directly if you need lists / mentions / docs links / images.',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: 'ID of the OKR objective or key result. Get from get_okrs response (`objective_list[].id` or `objective_list[].kr_list[].id`).' },
        target_type: { type: 'number', description: '1 = objective, 2 = key result. Pick based on which level target_id refers to.' },
        content_text: { type: 'string', description: 'Plain-text progress note. Auto-wrapped into the Feishu block format. Use `content` instead for rich text.' },
        content: { type: 'object', description: 'Optional: full Feishu block structure ({blocks:[...]}). If provided, overrides content_text.' },
        source_title: { type: 'string', description: 'Source label (default "Progress update"). Shown next to the note in the OKR UI.' },
        source_url: { type: 'string', description: 'Source URL (default https://feishu.cn/). Feishu requires a URL even for plain notes.' },
        source_url_pc: { type: 'string', description: 'Optional PC-specific source URL.' },
        source_url_mobile: { type: 'string', description: 'Optional mobile-specific source URL.' },
        progress_percent: { type: 'number', description: 'Optional progress percent (0-100) to bump alongside the note.' },
        progress_status: { type: 'number', description: 'Optional status code (Feishu enum: 1=on track, 2=at risk, 3=blocked, etc).' },
        user_id_type: { type: 'string', enum: ['user_id', 'union_id', 'open_id'], description: 'Type of user IDs in mentioned_user_list etc. (default open_id)' },
      },
      required: ['target_id', 'target_type'],
    },
  },
  {
    name: 'list_okr_progress_records',
    description: '[Official API + UAT, v1.3.7] List progress records for an OKR. Feishu has no native list endpoint — this tool calls get_okrs internally and walks the objective_list / kr_list to extract progress_record IDs (with their target_id and target_type). To read a record\'s full content, you currently need progressRecord.get (not yet wrapped).',
    inputSchema: {
      type: 'object',
      properties: {
        okr_id: { type: 'string', description: 'OKR ID (from list_user_okrs).' },
        user_id_type: { type: 'string', enum: ['user_id', 'union_id', 'open_id'], description: 'Pass-through to get_okrs (default open_id)' },
      },
      required: ['okr_id'],
    },
  },
  {
    name: 'delete_okr_progress_record',
    description: '[Official API + UAT, v1.3.7] Delete an OKR progress record by its progress_id (from list_okr_progress_records).',
    inputSchema: {
      type: 'object',
      properties: {
        progress_id: { type: 'string', description: 'Progress record ID' },
      },
      required: ['progress_id'],
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
  async create_okr_progress_record(args, ctx) {
    if (!args.content_text && !args.content) {
      return text('create_okr_progress_record: pass content_text (a plain string, auto-wrapped) or content (a full {blocks:[...]} structure).');
    }
    const content = args.content || buildOkrContent(args.content_text);
    let progressRate;
    if (args.progress_percent !== undefined || args.progress_status !== undefined) {
      progressRate = {};
      if (args.progress_percent !== undefined) progressRate.percent = args.progress_percent;
      if (args.progress_status !== undefined) progressRate.status = args.progress_status;
    }
    const r = await ctx.getOfficialClient().createOkrProgressRecord({
      targetId: args.target_id,
      targetType: args.target_type,
      content,
      sourceTitle: args.source_title,
      sourceUrl: args.source_url,
      sourceUrlPc: args.source_url_pc,
      sourceUrlMobile: args.source_url_mobile,
      progressRate,
      userIdType: args.user_id_type,
    });
    const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; record posted as bot)';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Progress record created${ownership}: ${r.progressId}\n${JSON.stringify(r, null, 2)}${warn}`);
  },
  async list_okr_progress_records(args, ctx) {
    return json(await ctx.getOfficialClient().listOkrProgressRecords(args.okr_id, { userIdType: args.user_id_type }));
  },
  async delete_okr_progress_record(args, ctx) {
    const r = await ctx.getOfficialClient().deleteOkrProgressRecord(args.progress_id);
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Progress record ${args.progress_id} deleted${r.viaUser ? '' : ' (as app)'}${warn}`);
  },
};

module.exports = { schemas, handlers };
