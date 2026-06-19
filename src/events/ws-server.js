// src/events/ws-server.js — rewritten for v1.3.9 owner-arbitrated mode.
//
// What this owns:
//   - createWSServer(opts) — factory for WS client + event dispatcher.
//   - v1.3.9: In owner mode (logPath provided), events go to events.jsonl
//     directly instead of the in-memory buffer.
//   - Tracks wsState / wsProfile so downstream can filter dropped events.
//
// What it does NOT own:
//   - Owner-lock acquisition (src/events/owner.js).
//   - Cursor protocol (src/events/cursor.js).

'use strict';

const lark = require('@larksuiteoapi/node-sdk');
const { EventBuffer, DEFAULT_CAP } = require('./event-buffer');
const { stderrLogger } = require('../logger');
const { appendEvent } = require('./event-log');

// Build the handler that writes a normalised event row.
// In v1.3.9 owner mode, we write to events.jsonl directly with a profile tag.
// In legacy mode (no logPath given) we fall back to the in-memory buffer.
function _eventRowHandler({ buffer, eventType, getProfile, getWsState, logPath }) {
  let _droppedSinceAppend = 0;  // events lost to a failed append (e.g. ENOSPC)
  return async (data) => {
    const wsState = getWsState();
    if (wsState !== 'connected') {
      // Drop events received during 'switching' / 'disconnected' — we don't
      // know which profile they belong to.
      return;
    }
    const event = {
      event_id: data?.event_id || data?.header?.event_id || 'evt_' + Math.random().toString(36).slice(2),
      ts: Date.now(),
      profile: getProfile(),
      event_type: eventType,
      header: data?.header || null,
      event: data?.event || data,
    };
    if (logPath) {
      try {
        appendEvent(logPath, event);
        // If a prior append failed (disk full), the owner-arbitrated
        // get_new_events never drains the in-memory buffer — so once the log is
        // writable again, emit a sticky marker so log consumers learn events
        // were dropped instead of silently missing them.
        if (_droppedSinceAppend > 0) {
          const n = _droppedSinceAppend;
          _droppedSinceAppend = 0;
          try {
            appendEvent(logPath, {
              event_id: '_events_dropped', ts: Date.now(), profile: '_system',
              event_type: '_system.events_dropped',
              event: { dropped_count: n, reason: 'a prior appendEvent failed (e.g. disk full); those events are NOT in this log and were not delivered' },
            });
          } catch (_) { _droppedSinceAppend = n; }  // still unwritable — keep the count
        }
      } catch (e) {
        // Disk-full or similar. NOTE: in owner mode get_new_events reads the log,
        // not this buffer, so this event is effectively LOST to consumers; we
        // count it and surface a marker on the next successful append.
        _droppedSinceAppend++;
        console.error(`[feishu-user-plugin] events.jsonl append failed: ${e.message}; event LOST to get_new_events consumers (they read the log, not the in-memory buffer)`);
        buffer.push(event);
      }
    } else {
      buffer.push(event);
    }
  };
}

function createWSServer({
  appId, appSecret,
  bufferCap = DEFAULT_CAP,
  registrations = ['im.message.receive_v1'],
  logPath = null,                 // NEW: when set, events go to events.jsonl
  initialProfile = 'default',     // NEW: profile name to tag events with
} = {}) {
  if (!appId || !appSecret) throw new Error('createWSServer: appId + appSecret required');

  const buffer = new EventBuffer({ cap: bufferCap });
  let wsClient = null;
  let started = false;
  let stopped = false;
  let wsProfile = initialProfile;
  let wsState = 'disconnected';   // disconnected | connected | switching
  let lastReconnectAt = null;
  let reconnectAttempts = 0;

  const dispatcher = new lark.EventDispatcher({
    logger: stderrLogger,
    loggerLevel: lark.LoggerLevel.warn,
  });

  const handlers = {};
  for (const t of registrations) {
    handlers[t] = _eventRowHandler({
      buffer, eventType: t,
      getProfile: () => wsProfile,
      getWsState: () => wsState,
      logPath,
    });
  }
  try {
    dispatcher.register(handlers);
  } catch (e) {
    console.error(`[feishu-user-plugin] WS event registration failed: ${e.message}; falling back to im.message.receive_v1 only`);
    dispatcher.register({
      'im.message.receive_v1': _eventRowHandler({
        buffer, eventType: 'im.message.receive_v1',
        getProfile: () => wsProfile, getWsState: () => wsState, logPath,
      }),
    });
  }

  async function start() {
    if (started) return;
    started = true;
    wsState = 'switching';
    wsClient = new lark.WSClient({
      appId, appSecret,
      logger: stderrLogger,
      loggerLevel: lark.LoggerLevel.warn,
    });
    try {
      await wsClient.start({ eventDispatcher: dispatcher });
      wsState = 'connected';
      lastReconnectAt = Date.now();
      console.error(`[feishu-user-plugin] WS connected (profile=${wsProfile}) — listening for: ${registrations.join(', ')}`);
    } catch (e) {
      wsState = 'disconnected';
      reconnectAttempts++;
      console.error(`[feishu-user-plugin] WS start failed: ${e.message}. Continuing without realtime events.`);
      started = false;
      wsClient = null;
    }
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    wsState = 'disconnected';
    if (wsClient) {
      try { wsClient.close(); } catch (_) {}
      wsClient = null;
    }
  }

  // NOTE: there is intentionally no reconfigureProfile() here. A previous helper
  // by that name restarted with the SAME (construction-fixed) registrations, so
  // it did not actually re-subscribe — an attractive-nuisance API. Profile
  // switching is done by server.js tearing this server down and constructing a
  // fresh one via _maybeReconfigure (which rebuilds registrations correctly).
  function getStatus() {
    return {
      state: wsState,
      wsProfile,
      subscribed_events: registrations.slice(),
      lastReconnectAt,
      reconnectAttempts,
    };
  }

  return { buffer, start, stop, getStatus, get isRunning() { return started && !stopped; } };
}

module.exports = { createWSServer };
