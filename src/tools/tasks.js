// src/tools/tasks.js — Feishu Tasks v2 tools (v1.3.7 new domain).
//
// 7 tools backed by clients/official/tasks.js. All UAT-first.
// Requires `task:task` scope on the OAuth — re-run `npx feishu-user-plugin oauth`
// after enabling the scope on the Feishu app console.

const { json, text } = require('./_registry');

const schemas = [
  {
    name: 'list_tasks',
    description: '[Official API + UAT, v1.3.7] List the current user\'s tasks. Filter by completion or type.',
    inputSchema: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'true → only completed; false → only pending; omit → all' },
        type: { type: 'string', description: 'Filter by task type (optional). E.g. "all" / "personal".' },
        page_size: { type: 'number', description: 'Items per page (default Feishu default)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
  {
    name: 'get_task',
    description: '[Official API + UAT, v1.3.7] Get full details of a single task by GUID.',
    inputSchema: {
      type: 'object',
      properties: {
        task_guid: { type: 'string', description: 'Task GUID (from list_tasks / create_task / Feishu URL)' },
      },
      required: ['task_guid'],
    },
  },
  {
    name: 'create_task',
    description: '[Official API + UAT, v1.3.7] Create a new task. summary is required; due / members / etc. are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description (optional)' },
        due: { type: 'object', description: 'Due time (optional). {timestamp:"<unix-millis>", is_all_day?:true|false}' },
        members: {
          type: 'array',
          description: 'Initial members (optional). Each: {id:"<open_id>", role:"assignee"|"follower", type?:"user", name?:"..."}',
          items: { type: 'object' },
        },
        repeat_rule: { type: 'string', description: 'Recurrence (optional, RFC5545 RRULE)' },
        extra: { type: 'string', description: 'Free-form extra metadata (optional)' },
      },
      required: ['summary'],
    },
  },
  {
    name: 'update_task',
    description: '[Official API + UAT, v1.3.7] Patch a task. **update_fields** is required by Feishu — list which fields to update (e.g. ["summary","due","completed_at"]).',
    inputSchema: {
      type: 'object',
      properties: {
        task_guid: { type: 'string', description: 'Task GUID' },
        update_fields: {
          type: 'array',
          description: 'Required. Names of fields to update. E.g. ["summary","description","due","completed_at","start","extra","repeat_rule"]. Feishu only patches fields listed here, ignoring other keys in `task`.',
          items: { type: 'string' },
        },
        task: {
          type: 'object',
          description: 'Field values. E.g. {summary:"new title", due:{timestamp:"1717939200000"}}.',
        },
      },
      required: ['task_guid', 'update_fields', 'task'],
    },
  },
  {
    name: 'complete_task',
    description: '[Official API + UAT, v1.3.7] Mark a task complete (or uncomplete it). Convenience wrapper around update_task with completed_at.',
    inputSchema: {
      type: 'object',
      properties: {
        task_guid: { type: 'string', description: 'Task GUID' },
        completed: { type: 'boolean', description: 'true → mark complete (uses Date.now()); false → uncomplete (sets completed_at to "0"). Default true.' },
      },
      required: ['task_guid'],
    },
  },
  {
    name: 'delete_task',
    description: '[Official API + UAT, v1.3.7] Permanently delete a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_guid: { type: 'string', description: 'Task GUID' },
      },
      required: ['task_guid'],
    },
  },
  {
    name: 'manage_task_members',
    description: '[Official API + UAT, v1.3.7] Add or remove members on a task. Members are objects {id:"<open_id>", role:"assignee"|"follower", type?:"user", name?:""}.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove'], description: 'add or remove' },
        task_guid: { type: 'string', description: 'Task GUID' },
        members: {
          type: 'array',
          description: 'Members to add/remove. Each: {id, role, type?, name?}.',
          items: { type: 'object' },
        },
      },
      required: ['action', 'task_guid', 'members'],
    },
  },
];

const handlers = {
  async list_tasks(args, ctx) {
    return json(await ctx.getOfficialClient().listTasks({
      completed: args.completed,
      type: args.type,
      pageSize: args.page_size,
      pageToken: args.page_token,
    }));
  },
  async get_task(args, ctx) {
    return json(await ctx.getOfficialClient().getTask(args.task_guid));
  },
  async create_task(args, ctx) {
    const data = { summary: args.summary };
    if (args.description !== undefined) data.description = args.description;
    if (args.due !== undefined) data.due = args.due;
    if (args.members !== undefined) data.members = args.members;
    if (args.repeat_rule !== undefined) data.repeat_rule = args.repeat_rule;
    if (args.extra !== undefined) data.extra = args.extra;
    const r = await ctx.getOfficialClient().createTask(data);
    const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; task created by the app, not you)';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Task created${ownership}: ${r.task?.guid || '(no guid returned)'}\n${JSON.stringify(r.task, null, 2)}${warn}`);
  },
  async update_task(args, ctx) {
    const r = await ctx.getOfficialClient().updateTask(args.task_guid, args.task, args.update_fields);
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Task updated: ${args.task_guid}\n${JSON.stringify(r.task, null, 2)}${warn}`);
  },
  async complete_task(args, ctx) {
    const completed = args.completed === undefined ? true : !!args.completed;
    const r = await ctx.getOfficialClient().completeTask(args.task_guid, completed);
    return text(`Task ${completed ? 'completed' : 'uncompleted'}: ${args.task_guid}`);
  },
  async delete_task(args, ctx) {
    await ctx.getOfficialClient().deleteTask(args.task_guid);
    return text(`Task deleted: ${args.task_guid}`);
  },
  async manage_task_members(args, ctx) {
    const c = ctx.getOfficialClient();
    if (args.action === 'add') {
      const r = await c.addTaskMembers(args.task_guid, args.members);
      return text(`Members added to ${args.task_guid}: ${args.members.length}\n${JSON.stringify(r.task?.members, null, 2)}`);
    }
    if (args.action === 'remove') {
      const r = await c.removeTaskMembers(args.task_guid, args.members);
      return text(`Members removed from ${args.task_guid}: ${args.members.length}\n${JSON.stringify(r.task?.members, null, 2)}`);
    }
    throw new Error('manage_task_members: action must be add or remove');
  },
};

module.exports = { schemas, handlers };
