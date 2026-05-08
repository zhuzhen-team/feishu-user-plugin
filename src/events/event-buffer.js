// src/events/event-buffer.js — in-memory FIFO buffer.
//
// v1.3.9: This is now the **disk-full fallback** only. Normal flow writes
// to events.jsonl via src/events/event-log.js. The owner falls back to this
// buffer when fs.appendFileSync fails (ENOSPC etc); get_new_events does NOT
// read from this buffer in the owner-arbitrated path. Pre-v1.3.8 behaviour
// is preserved when no logPath is configured.
//
// (rest of file unchanged)
//
// What this owns:
//   - _events: ordered list of events (oldest first)
//   - cap: max retained; oldest dropped when full
//   - push(event): append + trim
//   - drain(filter?): remove and return matching events
//   - peek(filter?): return matching events without removing
//   - size, cap accessors

const DEFAULT_CAP = 1000;

class EventBuffer {
  constructor({ cap = DEFAULT_CAP } = {}) {
    this._events = [];
    this._cap = Math.max(1, cap | 0);
    this._totalSeen = 0;
    this._totalDropped = 0;
  }

  push(event) {
    if (!event || typeof event !== 'object') return;
    if (!event._received_at) event._received_at = Math.floor(Date.now() / 1000);
    this._events.push(event);
    this._totalSeen++;
    while (this._events.length > this._cap) {
      this._events.shift();
      this._totalDropped++;
    }
  }

  drain(filter) {
    if (!filter) {
      const out = this._events;
      this._events = [];
      return out;
    }
    const fn = this._compileFilter(filter);
    const kept = [];
    const drained = [];
    for (const e of this._events) {
      if (fn(e)) drained.push(e);
      else kept.push(e);
    }
    this._events = kept;
    return drained;
  }

  peek(filter) {
    if (!filter) return [...this._events];
    const fn = this._compileFilter(filter);
    return this._events.filter(fn);
  }

  size() { return this._events.length; }
  cap() { return this._cap; }
  stats() {
    return {
      size: this._events.length,
      cap: this._cap,
      totalSeen: this._totalSeen,
      totalDropped: this._totalDropped,
    };
  }

  // Filter language (intentionally narrow — extend on demand):
  //   { event_type: "im.message.receive_v1" }       — exact match on type
  //   { chat_id: "oc_zzz" }                         — extract from event payload
  //   { since_seconds: 60 }                         — only events received in last N sec
  //   { event_types: ["a", "b"] }                   — any of these types
  // Multiple keys = AND.
  _compileFilter(filter) {
    return (e) => {
      if (filter.event_type && e.event_type !== filter.event_type) return false;
      if (filter.event_types && !filter.event_types.includes(e.event_type)) return false;
      if (filter.chat_id) {
        const chatId = this._extractChatId(e);
        if (chatId !== filter.chat_id) return false;
      }
      if (filter.since_seconds) {
        const cutoff = Math.floor(Date.now() / 1000) - filter.since_seconds;
        if ((e._received_at || 0) < cutoff) return false;
      }
      return true;
    };
  }

  _extractChatId(e) {
    return e?.event?.message?.chat_id
        || e?.event?.chat_id
        || null;
  }
}

module.exports = { EventBuffer, DEFAULT_CAP };
