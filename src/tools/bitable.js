// src/tools/bitable.js — Bitable (multi-dimensional table) operations.
//
// 5 consolidated tools (replaces 19 in v1.3.6):
//   manage_bitable_app    — actions: create, copy, get_meta
//   manage_bitable_table  — actions: list, create, update, delete
//   manage_bitable_field  — actions: list, create, update, delete
//   manage_bitable_view   — actions: list, create, delete
//   manage_bitable_record — actions: search, get, create, update, delete (records arg is array; max 500)
//
// The action= discriminator routes to the existing client methods unchanged;
// this file is just a tool-surface compaction.

const { text, json } = require('./_registry');

const FIELD_TYPE_NOTE = '1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=Link, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreateTime, 1002=ModifiedTime, 1003=Creator, 1004=Modifier';

const schemas = [
  {
    name: 'manage_bitable_app',
    description: '[Official API] Manage a Bitable app. action=create (new app, optional wiki_space_id to attach), copy (duplicate an existing app), get_meta (read app metadata).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'copy', 'get_meta'], description: 'Operation to perform' },
        app_token: { type: 'string', description: 'Required for copy/get_meta. Native token, wiki node, or Feishu URL.' },
        name: { type: 'string', description: 'New app name. Required for create/copy.' },
        folder_id: { type: 'string', description: 'Destination folder token (optional for create/copy; ignored when wiki_space_id is set).' },
        wiki_space_id: { type: 'string', description: 'Wiki space ID — create the app directly under this space (create only).' },
        wiki_parent_node_token: { type: 'string', description: 'Parent wiki node within the space (optional for create).' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_bitable_table',
    description: '[Official API] Manage a table inside a Bitable app. action=list, create (with optional initial fields), update (rename), delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'delete'], description: 'Operation to perform' },
        app_token: { type: 'string', description: 'Bitable app token (required for all actions). Accepts native token, wiki node, or Feishu URL.' },
        table_id: { type: 'string', description: 'Table ID — required for update/delete.' },
        name: { type: 'string', description: 'Table name — required for create, optional for update (rename).' },
        fields: {
          type: 'array',
          description: `Initial field definitions (create only, optional). Each item: {field_name, type, property?} where type is ${FIELD_TYPE_NOTE}.`,
          items: { type: 'object' },
        },
      },
      required: ['action', 'app_token'],
    },
  },
  {
    name: 'manage_bitable_field',
    description: '[Official API] Manage fields (columns) inside a Bitable table. action=list, create, update (Feishu requires `type` even when only renaming), delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'update', 'delete'], description: 'Operation to perform' },
        app_token: { type: 'string', description: 'Bitable app token. Accepts native token, wiki node, or Feishu URL.' },
        table_id: { type: 'string', description: 'Table ID' },
        field_id: { type: 'string', description: 'Field ID — required for update/delete.' },
        field_name: { type: 'string', description: 'Field display name — required for create, optional for update.' },
        type: { type: 'number', description: `Field type (${FIELD_TYPE_NOTE}). Required for create AND update — Feishu API rejects update without it.` },
        property: { type: 'object', description: 'Field-type-specific properties (optional). E.g. SingleSelect: {options:[{name:"A"},{name:"B"}]}.' },
      },
      required: ['action', 'app_token', 'table_id'],
    },
  },
  {
    name: 'manage_bitable_view',
    description: '[Official API] Manage views inside a Bitable table. action=list, create, delete. (Feishu open API does not expose view update — recreate with a new name to change.)',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'delete'], description: 'Operation to perform' },
        app_token: { type: 'string', description: 'Bitable app token. Accepts native token, wiki node, or Feishu URL.' },
        table_id: { type: 'string', description: 'Table ID' },
        view_id: { type: 'string', description: 'View ID — required for delete.' },
        view_name: { type: 'string', description: 'View name — required for create.' },
        view_type: { type: 'string', description: 'View type for create: grid (default), kanban, gallery, form, gantt, calendar.', default: 'grid' },
      },
      required: ['action', 'app_token', 'table_id'],
    },
  },
  {
    name: 'manage_bitable_record',
    description: '[Official API] Manage records (rows) inside a Bitable table. action=search, get, create, update, delete. create/update/delete accept arrays — single record or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'get', 'create', 'update', 'delete'], description: 'Operation to perform' },
        app_token: { type: 'string', description: 'Bitable app token. Accepts native token, wiki node, or Feishu URL.' },
        table_id: { type: 'string', description: 'Table ID' },
        record_id: { type: 'string', description: 'Record ID — required for action=get.' },
        records: {
          type: 'array',
          description: 'Records to write. For create: [{fields:{field_name:value}}]. For update: [{record_id, fields:{...}}]. Single record or up to 500.',
          items: { type: 'object' },
        },
        record_ids: {
          type: 'array',
          description: 'Record IDs to delete. Single ID or up to 500.',
          items: { type: 'string' },
        },
        filter: { type: 'object', description: 'Filter conditions (search only, optional)' },
        sort: { type: 'array', description: 'Sort conditions (search only, optional)' },
        page_size: { type: 'number', description: 'Results per page (search only, default 20)' },
        page_token: { type: 'string', description: 'Pagination cursor (search only) — pass the pageToken from a previous response to fetch the next page when hasMore is true.' },
      },
      required: ['action', 'app_token', 'table_id'],
    },
  },
];

function need(arg, name, action) {
  if (arg === undefined || arg === null || arg === '') {
    throw new Error(`manage_bitable: ${name} required for action=${action}`);
  }
}

// Feishu's batch record endpoints cap at 500 per call. Enforce it locally with a
// clear error instead of letting an oversized array hit the API as an opaque
// failure (or, worse, a partial write with no per-record reporting). Callers
// should chunk into <=500-record batches.
function capBatch(arr, name, action) {
  if (Array.isArray(arr) && arr.length > 500) {
    throw new Error(`manage_bitable: ${name} has ${arr.length} items for action=${action}, exceeding Feishu's 500-per-call cap. Split into batches of <=500.`);
  }
}

const handlers = {
  async manage_bitable_app(args, ctx) {
    const c = ctx.getOfficialClient();
    switch (args.action) {
      case 'create': {
        need(args.name, 'name', 'create');
        const r = await c.createBitable(args.name, args.folder_id, {
          wikiSpaceId: args.wiki_space_id,
          wikiParentNodeToken: args.wiki_parent_node_token,
        });
        const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; bitable owned by the app, not you)';
        const wikiNote = r.wikiNodeToken ? `\nWiki node: ${r.wikiNodeToken}`
          : r.wikiAttachTaskId ? `\nWiki attach queued — task_id: ${r.wikiAttachTaskId}`
          : r.wikiAttachError ? `\nWARNING: wiki attach failed — ${r.wikiAttachError}. Bitable exists in drive root/folder.`
          : '';
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text(`Bitable created${ownership}: ${r.appToken}\nURL: ${r.url || ''}${wikiNote}${warn}`);
      }
      case 'copy': {
        need(args.app_token, 'app_token', 'copy');
        need(args.name, 'name', 'copy');
        return json(await c.copyBitable(await ctx.resolveDocId(args.app_token), args.name, args.folder_id));
      }
      case 'get_meta': {
        need(args.app_token, 'app_token', 'get_meta');
        return json(await c.getBitableMeta(await ctx.resolveDocId(args.app_token)));
      }
    }
  },
  async manage_bitable_table(args, ctx) {
    const c = ctx.getOfficialClient();
    const appToken = await ctx.resolveDocId(args.app_token);
    switch (args.action) {
      case 'list':
        return json(await c.listBitableTables(appToken));
      case 'create': {
        need(args.name, 'name', 'create');
        const r = await c.createBitableTable(appToken, args.name, args.fields);
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text(`Table created: ${r.tableId}${warn}`);
      }
      case 'update': {
        need(args.table_id, 'table_id', 'update');
        need(args.name, 'name', 'update');
        const r = await c.updateBitableTable(appToken, args.table_id, args.name);
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text(`Table renamed: ${r.name}${warn}`);
      }
      case 'delete': {
        need(args.table_id, 'table_id', 'delete');
        const r = await c.deleteBitableTable(appToken, args.table_id);
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text(`Table deleted: ${r.deleted}${warn}`);
      }
    }
  },
  async manage_bitable_field(args, ctx) {
    const c = ctx.getOfficialClient();
    const appToken = await ctx.resolveDocId(args.app_token);
    switch (args.action) {
      case 'list':
        return json(await c.listBitableFields(appToken, args.table_id));
      case 'create': {
        need(args.field_name, 'field_name', 'create');
        need(args.type, 'type', 'create');
        const config = { field_name: args.field_name, type: args.type };
        if (args.property) config.property = args.property;
        return json(await c.createBitableField(appToken, args.table_id, config));
      }
      case 'update': {
        need(args.field_id, 'field_id', 'update');
        need(args.type, 'type', 'update');
        const config = {};
        if (args.field_name) config.field_name = args.field_name;
        if (args.type) config.type = args.type;
        if (args.property) config.property = args.property;
        return json(await c.updateBitableField(appToken, args.table_id, args.field_id, config));
      }
      case 'delete': {
        need(args.field_id, 'field_id', 'delete');
        const r = await c.deleteBitableField(appToken, args.table_id, args.field_id);
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text((r.deleted ? `Field ${r.fieldId} deleted` : `Field deletion returned deleted=${r.deleted}`) + warn);
      }
    }
  },
  async manage_bitable_view(args, ctx) {
    const c = ctx.getOfficialClient();
    const appToken = await ctx.resolveDocId(args.app_token);
    switch (args.action) {
      case 'list':
        return json(await c.listBitableViews(appToken, args.table_id));
      case 'create': {
        need(args.view_name, 'view_name', 'create');
        return json(await c.createBitableView(appToken, args.table_id, args.view_name, args.view_type));
      }
      case 'delete': {
        need(args.view_id, 'view_id', 'delete');
        const r = await c.deleteBitableView(appToken, args.table_id, args.view_id);
        const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
        return text(`View deleted: ${r.deleted}${warn}`);
      }
    }
  },
  async manage_bitable_record(args, ctx) {
    const c = ctx.getOfficialClient();
    const appToken = await ctx.resolveDocId(args.app_token);
    switch (args.action) {
      case 'search':
        return json(await c.searchBitableRecords(appToken, args.table_id, {
          filter: args.filter, sort: args.sort, pageSize: args.page_size, pageToken: args.page_token,
        }));
      case 'get': {
        need(args.record_id, 'record_id', 'get');
        return json(await c.getBitableRecord(appToken, args.table_id, args.record_id));
      }
      case 'create': {
        need(args.records, 'records', 'create');
        capBatch(args.records, 'records', 'create');
        return json(await c.batchCreateBitableRecords(appToken, args.table_id, args.records));
      }
      case 'update': {
        need(args.records, 'records', 'update');
        capBatch(args.records, 'records', 'update');
        return json(await c.batchUpdateBitableRecords(appToken, args.table_id, args.records));
      }
      case 'delete': {
        need(args.record_ids, 'record_ids', 'delete');
        capBatch(args.record_ids, 'record_ids', 'delete');
        return json(await c.batchDeleteBitableRecords(appToken, args.table_id, args.record_ids));
      }
    }
  },
};

module.exports = { schemas, handlers };
