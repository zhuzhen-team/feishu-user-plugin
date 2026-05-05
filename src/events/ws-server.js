// src/events/ws-server.js — Feishu WebSocket subscription wrapper.
//
// Owns the WSClient + EventDispatcher pair. The MCP main() in server.js calls
// startWS() at boot if APP_ID + APP_SECRET are configured; failures are
// logged-and-tolerated (MCP keeps serving tool calls without realtime).
//
// What this owns:
//   - createWSServer(opts) → { buffer, start(), stop() } factory
//   - Default event registrations (im.message.receive_v1)
//   - Reconnect via SDK's built-in handling (WSClient does this internally)
//
// What it does NOT own:
//   - The buffer's persistence — it's in-memory only.
//   - Multi-profile fan-out — single WS per process, per active profile.

const lark = require('@larksuiteoapi/node-sdk');
const { EventBuffer, DEFAULT_CAP } = require('./event-buffer');
const { stderrLogger } = require('../logger');

// Wrap an SDK event handler so the payload always lands in the buffer with
// a stable shape. The SDK passes the raw event payload — we add metadata
// for downstream filtering / display.
function _bufferEventHandler(buffer, eventType) {
  return async (data) => {
    const event = {
      event_type: eventType,
      event_id: data?.event_id || data?.header?.event_id || null,
      _received_at: Math.floor(Date.now() / 1000),
      header: data?.header || null,
      event: data?.event || data,
    };
    buffer.push(event);
  };
}

function createWSServer({ appId, appSecret, bufferCap = DEFAULT_CAP, registrations = ['im.message.receive_v1'] } = {}) {
  if (!appId || !appSecret) throw new Error('createWSServer: appId + appSecret required');

  const buffer = new EventBuffer({ cap: bufferCap });
  let wsClient = null;
  let started = false;
  let stopped = false;

  const dispatcher = new lark.EventDispatcher({
    logger: stderrLogger,
    loggerLevel: lark.LoggerLevel.warn,
  });

  // Register handlers for each requested event type.
  const handlers = {};
  for (const t of registrations) {
    handlers[t] = _bufferEventHandler(buffer, t);
  }
  dispatcher.register(handlers);

  async function start() {
    if (started) return;
    started = true;
    wsClient = new lark.WSClient({
      appId, appSecret,
      logger: stderrLogger,
      loggerLevel: lark.LoggerLevel.warn,
    });
    try {
      await wsClient.start({ eventDispatcher: dispatcher });
      console.error(`[feishu-user-plugin] WS connected — listening for: ${registrations.join(', ')}`);
    } catch (e) {
      console.error(`[feishu-user-plugin] WS start failed: ${e.message}. Continuing without realtime events.`);
      started = false;
      wsClient = null;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (wsClient) {
      try { wsClient.close(); } catch (e) { console.error(`[feishu-user-plugin] WS close error: ${e.message}`); }
      wsClient = null;
    }
  }

  return { buffer, start, stop, get isRunning() { return started && !stopped; } };
}

module.exports = { createWSServer };
