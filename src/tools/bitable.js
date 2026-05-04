// src/tools/bitable.js — Bitable (multi-dimensional table) operations.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'create_bitable',
    description: '[Official API] Create a new Bitable (multi-dimensional table) app. Can place directly under a Wiki space via wiki_space_id (and optional wiki_parent_node_token).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Bitable app name' },
        folder_id: { type: 'string', description: 'Parent folder token (optional, defaults to root; ignored when wiki_space_id is set)' },
        wiki_space_id: { type: 'string', description: 'Wiki space ID to place the bitable under (optional)' },
        wiki_parent_node_token: { type: 'string', description: 'Parent wiki node token within the space (optional)' },
      },
    },
  },
  {
    name: 'list_bitable_tables',
    description: '[Official API] List all tables in a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: { app_token: { type: 'string', description: 'Bitable app token' } },
      required: ['app_token'],
    },
  },
  {
    name: 'create_bitable_table',
    description: '[Official API] Create a new data table in a Bitable app. Optionally define initial fields.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        name: { type: 'string', description: 'Table name' },
        fields: {
          type: 'array',
          description: 'Initial field definitions (optional). Each item: {field_name, type} where type is 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=Link, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreateTime, 1002=ModifiedTime, 1003=Creator, 1004=Modifier',
          items: { type: 'object' },
        },
      },
      required: ['app_token', 'name'],
    },
  },
  {
    name: 'list_bitable_fields',
    description: '[Official API] List all fields (columns) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'create_bitable_field',
    description: '[Official API] Create a new field (column) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_name: { type: 'string', description: 'Field display name' },
        type: { type: 'number', description: 'Field type: 1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=URL, 17=Attachment, 18=Link, 20=Formula, 21=DuplexLink, 22=Location, 23=GroupChat, 1001=CreateTime, 1002=ModifiedTime, 1003=Creator, 1004=Modifier' },
        property: { type: 'object', description: 'Field-type-specific properties (optional). E.g. for SingleSelect: {options: [{name:"A"},{name:"B"}]}' },
      },
      required: ['app_token', 'table_id', 'field_name', 'type'],
    },
  },
  {
    name: 'update_bitable_field',
    description: '[Official API] Update an existing field (column) in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_id: { type: 'string', description: 'Field ID to update' },
        field_name: { type: 'string', description: 'New field name (optional)' },
        type: { type: 'number', description: 'Field type (REQUIRED by Feishu API, see create_bitable_field for values)' },
        property: { type: 'object', description: 'Field-type-specific properties (optional)' },
      },
      required: ['app_token', 'table_id', 'field_id', 'type'],
    },
  },
  {
    name: 'delete_bitable_field',
    description: '[Official API] Delete a field (column) from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        field_id: { type: 'string', description: 'Field ID to delete' },
      },
      required: ['app_token', 'table_id', 'field_id'],
    },
  },
  {
    name: 'list_bitable_views',
    description: '[Official API] List all views in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'search_bitable_records',
    description: '[Official API] Search/query records in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        filter: { type: 'object', description: 'Filter conditions (optional)' },
        sort: { type: 'array', description: 'Sort conditions (optional)' },
        page_size: { type: 'number', description: 'Results per page (default 20)' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'batch_create_bitable_records',
    description: '[Official API] Create one or more records (rows) in a Bitable table. Pass a single record or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        records: { type: 'array', description: 'Array of {fields: {field_name: value}} objects', items: { type: 'object' } },
      },
      required: ['app_token', 'table_id', 'records'],
    },
  },
  {
    name: 'batch_update_bitable_records',
    description: '[Official API] Update one or more records in a Bitable table. Pass a single record or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        records: { type: 'array', description: 'Array of {record_id, fields: {field_name: value}} objects', items: { type: 'object' } },
      },
      required: ['app_token', 'table_id', 'records'],
    },
  },
  {
    name: 'batch_delete_bitable_records',
    description: '[Official API] Delete one or more records from a Bitable table. Pass a single ID or up to 500.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        record_ids: { type: 'array', description: 'Array of record IDs to delete', items: { type: 'string' } },
      },
      required: ['app_token', 'table_id', 'record_ids'],
    },
  },
  {
    name: 'get_bitable_record',
    description: '[Official API] Get a single record by ID from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        record_id: { type: 'string', description: 'Record ID' },
      },
      required: ['app_token', 'table_id', 'record_id'],
    },
  },
  {
    name: 'delete_bitable_table',
    description: '[Official API] Delete a data table from a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID to delete' },
      },
      required: ['app_token', 'table_id'],
    },
  },
  {
    name: 'get_bitable_meta',
    description: '[Official API] Get metadata of a Bitable app (name, revision, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
      },
      required: ['app_token'],
    },
  },
  {
    name: 'update_bitable_table',
    description: '[Official API] Rename a data table in a Bitable app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        name: { type: 'string', description: 'New table name' },
      },
      required: ['app_token', 'table_id', 'name'],
    },
  },
  {
    name: 'create_bitable_view',
    description: '[Official API] Create a new view in a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        view_name: { type: 'string', description: 'View name' },
        view_type: { type: 'string', description: 'View type: grid (default), kanban, gallery, form, gantt, calendar', default: 'grid' },
      },
      required: ['app_token', 'table_id', 'view_name'],
    },
  },
  {
    name: 'delete_bitable_view',
    description: '[Official API] Delete a view from a Bitable table.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token' },
        table_id: { type: 'string', description: 'Table ID' },
        view_id: { type: 'string', description: 'View ID to delete' },
      },
      required: ['app_token', 'table_id', 'view_id'],
    },
  },
  {
    name: 'copy_bitable',
    description: '[Official API] Copy a Bitable app to create a new one.',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token to copy' },
        name: { type: 'string', description: 'New Bitable name' },
        folder_id: { type: 'string', description: 'Destination folder token (optional)' },
      },
      required: ['app_token', 'name'],
    },
  },
];

const handlers = {
  async create_bitable(args, ctx) {
    const r = await ctx.getOfficialClient().createBitable(args.name, args.folder_id, {
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
  },
  async list_bitable_tables(args, ctx) {
    return json(await ctx.getOfficialClient().listBitableTables(await ctx.resolveDocId(args.app_token)));
  },
  async create_bitable_table(args, ctx) {
    const r = await ctx.getOfficialClient().createBitableTable(await ctx.resolveDocId(args.app_token), args.name, args.fields);
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Table created: ${r.tableId}${warn}`);
  },
  async list_bitable_fields(args, ctx) {
    return json(await ctx.getOfficialClient().listBitableFields(await ctx.resolveDocId(args.app_token), args.table_id));
  },
  async create_bitable_field(args, ctx) {
    const config = { field_name: args.field_name, type: args.type };
    if (args.property) config.property = args.property;
    return json(await ctx.getOfficialClient().createBitableField(await ctx.resolveDocId(args.app_token), args.table_id, config));
  },
  async update_bitable_field(args, ctx) {
    const config = {};
    if (args.field_name) config.field_name = args.field_name;
    if (args.type) config.type = args.type;
    if (args.property) config.property = args.property;
    return json(await ctx.getOfficialClient().updateBitableField(await ctx.resolveDocId(args.app_token), args.table_id, args.field_id, config));
  },
  async delete_bitable_field(args, ctx) {
    const r = await ctx.getOfficialClient().deleteBitableField(await ctx.resolveDocId(args.app_token), args.table_id, args.field_id);
    return text(r.deleted ? `Field ${r.fieldId} deleted` : `Field deletion returned deleted=${r.deleted}`);
  },
  async list_bitable_views(args, ctx) {
    return json(await ctx.getOfficialClient().listBitableViews(await ctx.resolveDocId(args.app_token), args.table_id));
  },
  async search_bitable_records(args, ctx) {
    return json(await ctx.getOfficialClient().searchBitableRecords(await ctx.resolveDocId(args.app_token), args.table_id, {
      filter: args.filter, sort: args.sort, pageSize: args.page_size,
    }));
  },
  async batch_create_bitable_records(args, ctx) {
    return json(await ctx.getOfficialClient().batchCreateBitableRecords(await ctx.resolveDocId(args.app_token), args.table_id, args.records));
  },
  async batch_update_bitable_records(args, ctx) {
    return json(await ctx.getOfficialClient().batchUpdateBitableRecords(await ctx.resolveDocId(args.app_token), args.table_id, args.records));
  },
  async batch_delete_bitable_records(args, ctx) {
    return json(await ctx.getOfficialClient().batchDeleteBitableRecords(await ctx.resolveDocId(args.app_token), args.table_id, args.record_ids));
  },
  async get_bitable_record(args, ctx) {
    return json(await ctx.getOfficialClient().getBitableRecord(await ctx.resolveDocId(args.app_token), args.table_id, args.record_id));
  },
  async delete_bitable_table(args, ctx) {
    return text(`Table deleted: ${(await ctx.getOfficialClient().deleteBitableTable(await ctx.resolveDocId(args.app_token), args.table_id)).deleted}`);
  },
  async get_bitable_meta(args, ctx) {
    return json(await ctx.getOfficialClient().getBitableMeta(await ctx.resolveDocId(args.app_token)));
  },
  async update_bitable_table(args, ctx) {
    return text(`Table renamed: ${(await ctx.getOfficialClient().updateBitableTable(await ctx.resolveDocId(args.app_token), args.table_id, args.name)).name}`);
  },
  async create_bitable_view(args, ctx) {
    return json(await ctx.getOfficialClient().createBitableView(await ctx.resolveDocId(args.app_token), args.table_id, args.view_name, args.view_type));
  },
  async delete_bitable_view(args, ctx) {
    return text(`View deleted: ${(await ctx.getOfficialClient().deleteBitableView(await ctx.resolveDocId(args.app_token), args.table_id, args.view_id)).deleted}`);
  },
  async copy_bitable(args, ctx) {
    return json(await ctx.getOfficialClient().copyBitable(await ctx.resolveDocId(args.app_token), args.name, args.folder_id));
  },
};

module.exports = { schemas, handlers };
