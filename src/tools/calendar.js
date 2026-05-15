// src/tools/calendar.js — Calendar read + write tools.
//
// 8 tools (was 3 in v1.3.6): list_calendars, list_calendar_events,
// get_calendar_event, plus the v1.3.7 write tools:
//   create_calendar_event / update_calendar_event / delete_calendar_event
//   respond_calendar_event / get_freebusy
// All UAT-first. Write tools require `calendar:calendar.event:{create,update,delete,reply}` scope.

const { json, text } = require('./_registry');

const TIME_NOTE = 'A time object: {timestamp:"<unix-seconds>", timezone?:"Asia/Shanghai"} OR {date:"YYYY-MM-DD"} for all-day events.';

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
  {
    name: 'create_calendar_event',
    description: `[Official API + UAT, v1.3.7] Create a new calendar event. Requires \`calendar:calendar.event:create\` scope (re-run \`npx feishu-user-plugin oauth\` after enabling). The current identity (UAT-first) must have writer or owner permission on the calendar.\n\nTime fields: ${TIME_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID (use list_calendars; primary calendar has type="primary").' },
        summary: { type: 'string', description: 'Event title' },
        description: { type: 'string', description: 'Description / notes (optional)' },
        start_time: { type: 'object', description: TIME_NOTE },
        end_time: { type: 'object', description: TIME_NOTE },
        location: { type: 'object', description: 'Optional. {name, address?, latitude?, longitude?}.' },
        visibility: { type: 'string', enum: ['default', 'public', 'private'], description: 'Event visibility (optional)' },
        attendee_ability: { type: 'string', enum: ['none', 'can_see_others', 'can_invite_others', 'can_modify_event'], description: 'What attendees may do (optional)' },
        free_busy_status: { type: 'string', enum: ['busy', 'free'], description: 'Whether this event blocks the calendar (optional)' },
        reminders: { type: 'array', description: 'Reminders before event start (optional). E.g. [{minutes:15}].', items: { type: 'object' } },
        recurrence: { type: 'string', description: 'iCal RRULE recurrence string (optional)' },
        need_notification: { type: 'boolean', description: 'Whether to notify attendees on create (default true)' },
      },
      required: ['calendar_id', 'summary', 'start_time', 'end_time'],
    },
  },
  {
    name: 'update_calendar_event',
    description: '[Official API + UAT, v1.3.7] Patch fields on an existing calendar event. Pass only the fields you want to change. Requires `calendar:calendar.event:update` scope.',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID' },
        event_id: { type: 'string', description: 'Event ID' },
        summary: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        start_time: { type: 'object', description: TIME_NOTE },
        end_time: { type: 'object', description: TIME_NOTE },
        location: { type: 'object', description: 'New location object (optional)' },
        visibility: { type: 'string', enum: ['default', 'public', 'private'] },
        attendee_ability: { type: 'string', enum: ['none', 'can_see_others', 'can_invite_others', 'can_modify_event'] },
        free_busy_status: { type: 'string', enum: ['busy', 'free'] },
        reminders: { type: 'array', items: { type: 'object' } },
        recurrence: { type: 'string', description: 'RRULE string' },
        need_notification: { type: 'boolean', description: 'Whether to notify attendees of the update' },
      },
      required: ['calendar_id', 'event_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: '[Official API + UAT, v1.3.7] Delete a calendar event. Requires `calendar:calendar.event:delete` scope.',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID' },
        event_id: { type: 'string', description: 'Event ID' },
        need_notification: { type: 'boolean', description: 'Whether to notify attendees of the deletion (default true)' },
        meeting_chat_id: { type: 'string', description: 'Optional. If the event has a linked meeting chat, pass its chat_id to also dissolve it.' },
      },
      required: ['calendar_id', 'event_id'],
    },
  },
  {
    name: 'respond_calendar_event',
    description: '[Official API + UAT, v1.3.7] Respond to an event invitation. The current identity must be in the event\'s attendee list. Requires `calendar:calendar.event:reply` scope.',
    inputSchema: {
      type: 'object',
      properties: {
        calendar_id: { type: 'string', description: 'Calendar ID' },
        event_id: { type: 'string', description: 'Event ID' },
        rsvp_status: { type: 'string', enum: ['accept', 'decline', 'tentative'], description: 'Your response' },
      },
      required: ['calendar_id', 'event_id', 'rsvp_status'],
    },
  },
  {
    name: 'get_freebusy',
    description: '[Official API + UAT, v1.3.7] Query freebusy windows for one or more users in a time range. Use to find a meeting slot. Requires `calendar:calendar:readonly` (already in default scope set).',
    inputSchema: {
      type: 'object',
      properties: {
        time_min: { type: 'string', description: 'RFC3339 start, e.g. 2026-05-04T09:00:00+08:00' },
        time_max: { type: 'string', description: 'RFC3339 end' },
        user_ids: { type: 'array', description: 'Open IDs to query (use get_login_status / search_contacts to look up).', items: { type: 'string' } },
        room_ids: { type: 'array', description: 'Optional meeting-room IDs.', items: { type: 'string' } },
        include_external_calendar: { type: 'boolean', description: 'Include the user\'s synced external calendars (optional)' },
        only_busy: { type: 'boolean', description: 'Only return busy windows (optional)' },
      },
      required: ['time_min', 'time_max', 'user_ids'],
    },
  },
];

function eventDataFromArgs(args, isUpdate = false) {
  const data = {};
  if (args.summary !== undefined) data.summary = args.summary;
  if (args.description !== undefined) data.description = args.description;
  if (args.start_time !== undefined) data.start_time = args.start_time;
  if (args.end_time !== undefined) data.end_time = args.end_time;
  if (args.location !== undefined) data.location = args.location;
  if (args.visibility !== undefined) data.visibility = args.visibility;
  if (args.attendee_ability !== undefined) data.attendee_ability = args.attendee_ability;
  if (args.free_busy_status !== undefined) data.free_busy_status = args.free_busy_status;
  if (args.reminders !== undefined) data.reminders = args.reminders;
  if (args.recurrence !== undefined) data.recurrence = args.recurrence;
  if (args.need_notification !== undefined) data.need_notification = args.need_notification;
  if (!isUpdate && data.need_notification === undefined) data.need_notification = true;
  return data;
}

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
  async create_calendar_event(args, ctx) {
    const r = await ctx.getOfficialClient().createCalendarEvent(args.calendar_id, eventDataFromArgs(args, false));
    const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; event organized by the app, not you)';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Event created${ownership}: ${r.event?.event_id || '(no id returned)'}\n${JSON.stringify(r.event, null, 2)}${warn}`);
  },
  async update_calendar_event(args, ctx) {
    const r = await ctx.getOfficialClient().updateCalendarEvent(args.calendar_id, args.event_id, eventDataFromArgs(args, true));
    const ownership = r.viaUser ? ' (as user)' : ' (as app)';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Event updated${ownership}: ${args.event_id}\n${JSON.stringify(r.event, null, 2)}${warn}`);
  },
  async delete_calendar_event(args, ctx) {
    const r = await ctx.getOfficialClient().deleteCalendarEvent(args.calendar_id, args.event_id, {
      needNotification: args.need_notification, meetingChatId: args.meeting_chat_id,
    });
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Event deleted: ${args.event_id}${warn}`);
  },
  async respond_calendar_event(args, ctx) {
    const r = await ctx.getOfficialClient().respondCalendarEvent(args.calendar_id, args.event_id, args.rsvp_status);
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Responded to event ${args.event_id} as ${args.rsvp_status}${warn}`);
  },
  async get_freebusy(args, ctx) {
    return json(await ctx.getOfficialClient().getFreebusy({
      timeMin: args.time_min, timeMax: args.time_max,
      userIds: args.user_ids, roomIds: args.room_ids,
      includeExternalCalendar: args.include_external_calendar, onlyBusy: args.only_busy,
    }));
  },
};

module.exports = { schemas, handlers };
