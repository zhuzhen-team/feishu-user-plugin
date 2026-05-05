// src/tools/events.js — real-time event consumption (v1.3.8).
//
// Single tool: get_new_events. Drains the EventBuffer that ws-server.js fills
// from Feishu's realtime WS push. Default: pulls all events accumulated since
// the last call (drain semantics — consumers must accept that events vanish
// after read).

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'get_new_events',
    description: '[Plugin v1.3.8] Drain real-time events received since the last call. Currently surfaces "im.message.receive_v1" events (replies, group messages). Returns empty when WS isn\'t connected or no events have arrived. Use filter to scope by event_type or chat_id; max_events caps response size.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type:    { type: 'string',  description: 'Optional: only events of this type (e.g. "im.message.receive_v1").' },
        event_types:   { type: 'array', items: { type: 'string' }, description: 'Optional: any-of list of event types.' },
        chat_id:       { type: 'string',  description: 'Optional: only events from this chat (oc_xxx for groups, message events expose chat_id).' },
        since_seconds: { type: 'integer', description: 'Optional: only events received in the last N seconds.' },
        max_events:    { type: 'integer', description: 'Cap on returned events (default 50). Drained events beyond the cap are returned in subsequent calls.' },
        peek:          { type: 'boolean', description: 'When true, leave events in the buffer (default false = drain).' },
      },
    },
  },
];

const handlers = {
  async get_new_events(args, ctx) {
    const buffer = ctx.getEventBuffer && ctx.getEventBuffer();
    if (!buffer) {
      return text('Realtime events are not available. Reasons: APP_ID/SECRET not configured, OR Lark international tenant (Feishu WS only supports feishu.cn), OR the WS handshake failed at startup. Check server stderr for "WS connected" / "WS start failed".');
    }

    const filter = {};
    if (args.event_type)    filter.event_type = args.event_type;
    if (args.event_types)   filter.event_types = args.event_types;
    if (args.chat_id)       filter.chat_id = args.chat_id;
    if (args.since_seconds) filter.since_seconds = args.since_seconds;

    const cap = Math.max(1, parseInt(args.max_events, 10) || 50);

    let events = args.peek ? buffer.peek(filter) : buffer.drain(filter);
    let truncated = false;
    if (events.length > cap) {
      const kept = events.slice(0, cap);
      const overflow = events.slice(cap);
      if (!args.peek) {
        for (const e of overflow) buffer.push(e);
      }
      events = kept;
      truncated = true;
    }

    return json({
      events,
      stats: buffer.stats(),
      truncated,
      hint: events.length === 0 ? 'No new events. Call again later, or check stats.totalSeen / .totalDropped to confirm WS is alive.' : undefined,
    });
  },
};

module.exports = { schemas, handlers };
