// src/tools/calendar.js — Calendar read tools (v1.3.4).

const { json } = require('./_registry');

const schemas = [
  {
    name: 'list_calendars',
    description: '[Official API + UAT] List the current user\'s calendars (primary + shared + subscribed). Requires UAT — app identity only sees calendars it was explicitly invited to. Requires `calendar:calendar:readonly` scope on the OAuth.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (min 50, default 50). Feishu\'s calendar endpoint rejects page_size < 50.' },
        page_token: { type: 'string', description: 'Pagination token' },
        sync_token: { type: 'string', description: 'Incremental sync token (optional)' },
      },
    },
  },
  {
    name: 'list_calendar_events',
    description: '[Official API + UAT] List events in a calendar within an optional time range. Typical usage: first list_calendars to find calendar_id (primary calendar has type="primary"), then list events in e.g. [now, now+7d] (Unix seconds).',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID from list_calendars' },
        start_time: { type: 'string', description: 'Range start (Unix seconds, optional)' },
        end_time: { type: 'string', description: 'Range end (Unix seconds, optional)' },
        page_size: { type: 'number', description: 'Items per page (default 50)' },
        page_token: { type: 'string', description: 'Pagination token' },
        sync_token: { type: 'string', description: 'Incremental sync token (optional)' },
      },
      required: ['calendar_id'],
    },
  },
  {
    name: 'get_calendar_event',
    description: '[Official API + UAT] Get full details of a single calendar event (summary, description, start/end, attendees, location, attachments, meeting link).',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID' },
        event_id: { type: 'string', description: 'Event ID from list_calendar_events' },
      },
      required: ['calendar_id', 'event_id'],
    },
  },
];

const handlers = {
  async list_calendars(args, ctx) {
    return json(await ctx.getOfficialClient().listCalendars({ pageSize: args.page_size, pageToken: args.page_token, syncToken: args.sync_token }));
  },
  async list_calendar_events(args, ctx) {
    return json(await ctx.getOfficialClient().listCalendarEvents(args.calendar_id, {
      startTime: args.start_time, endTime: args.end_time,
      pageSize: args.page_size, pageToken: args.page_token, syncToken: args.sync_token,
    }));
  },
  async get_calendar_event(args, ctx) {
    return json(await ctx.getOfficialClient().getCalendarEvent(args.calendar_id, args.event_id));
  },
};

module.exports = { schemas, handlers };
