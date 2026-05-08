// src/tools/events.js — v1.3.9 reads from events.jsonl via cursor.
//
// Backwards compat: when ctx.getEventBuffer() is the legacy in-memory buffer
// (no events.jsonl exists), fall back to the old behaviour.

const path = require('path');
const os = require('os');
const { text, json } = require('./_registry');
const { drain, readSnapshot } = require('../events/cursor');
const { readOwnerInfo } = require('../events/owner');
const fs = require('fs');

const FEISHU_HOME = path.join(os.homedir(), '.feishu-user-plugin');
const EVENTS_LOG_PATH = path.join(FEISHU_HOME, 'events.jsonl');

function _hasJsonlMode() {
  try { fs.statSync(EVENTS_LOG_PATH); return true; } catch (_) { return false; }
}

function _filter(event, args, currentProfile) {
  // Profile filter (v1.3.9 default = current active; "*"/"any" = all)
  const profFilter = args.profile;
  if (!profFilter || profFilter === 'auto') {
    if (event.profile && event.profile !== currentProfile && event.profile !== '_system') return false;
  } else if (profFilter !== '*' && profFilter !== 'any') {
    if (event.profile !== profFilter) return false;
  }

  if (args.event_type && event.event_type !== args.event_type) return false;
  if (args.event_types && !args.event_types.includes(event.event_type)) return false;
  if (args.chat_id) {
    const chatId = event?.event?.message?.chat_id || event?.event?.chat_id;
    if (chatId !== args.chat_id) return false;
  }
  if (args.since_seconds) {
    const cutoff = Date.now() - args.since_seconds * 1000;
    if ((event.ts || 0) < cutoff) return false;
  }
  return true;
}

const schemas = [
  {
    name: 'get_new_events',
    description: '[Plugin v1.3.9] Drain real-time events from the machine-level shared event log. v1.3.8 used per-process in-memory buffers (with duplicate-event problem); v1.3.9 uses ~/.feishu-user-plugin/events.jsonl with a single global cursor — every event delivered exactly once across all MCP processes on this machine. Default returns events from the current active profile only; pass profile="*" to see all.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: { type: 'string' },
        event_types: { type: 'array', items: { type: 'string' } },
        chat_id: { type: 'string' },
        since_seconds: { type: 'integer' },
        profile: { type: 'string', description: 'Profile filter. Default = current active. Pass "*" or "any" for all profiles.' },
        max_events: { type: 'integer' },
        peek: { type: 'boolean' },
      },
    },
  },
  {
    name: 'manage_ws_status',
    description: '[Plugin v1.3.9] Inspect or control the machine-level WS owner. Actions: info (status dump), reconnect (owner-only; restart WS), claim (try become owner; force=true to steal active lock), rotate (owner-only; force events.jsonl rotation), reconfig (owner-only; re-read credentials.json + apply event subscriptions).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['info', 'reconnect', 'claim', 'rotate', 'reconfig'] },
        force: { type: 'boolean', description: 'For claim only: steal an active owner lock' },
      },
      required: ['action'],
    },
  },
];

const handlers = {
  async get_new_events(args, ctx) {
    if (_hasJsonlMode()) {
      const cap = Math.max(1, parseInt(args.max_events, 10) || 50);
      const peek = !!args.peek;
      const r = drain(FEISHU_HOME, { peek });
      const currentProfile = ctx.getActiveProfile();
      let filtered = r.events.filter((e) => _filter(e, args, currentProfile));
      let truncated = false;
      if (filtered.length > cap) {
        filtered = filtered.slice(0, cap);
        truncated = true;
      }
      const snap = readSnapshot(FEISHU_HOME);
      return json({
        events: filtered,
        cursor: { offset: snap.cursor.offset, file: snap.cursor.file },
        log: { size_bytes: snap.fileSize, pending_bytes: snap.pending },
        truncated,
      });
    }
    // Legacy in-memory fallback
    const buffer = ctx.getEventBuffer && ctx.getEventBuffer();
    if (!buffer) {
      return text('Realtime events are not available. Reasons: APP_ID/SECRET not configured, OR Lark international tenant (Feishu WS only supports feishu.cn), OR the WS handshake failed at startup.');
    }
    const filter = {};
    if (args.event_type) filter.event_type = args.event_type;
    if (args.event_types) filter.event_types = args.event_types;
    if (args.chat_id) filter.chat_id = args.chat_id;
    if (args.since_seconds) filter.since_seconds = args.since_seconds;
    const cap = Math.max(1, parseInt(args.max_events, 10) || 50);
    let evts = args.peek ? buffer.peek(filter) : buffer.drain(filter);
    let truncated = false;
    if (evts.length > cap) {
      evts = evts.slice(0, cap);
      truncated = true;
    }
    return json({ events: evts, stats: buffer.stats(), truncated });
  },

  async manage_ws_status(args, ctx) {
    const ws = ctx.getWsServer && ctx.getWsServer();
    const ownerInfo = readOwnerInfo(FEISHU_HOME);
    const isOwner = ws !== null && ws !== undefined;

    if (args.action === 'info') {
      const snap = readSnapshot(FEISHU_HOME);
      const cred = require('../auth/credentials').readCanonical();
      const activeProfile = ctx.getActiveProfile();
      const configuredEvents = cred?.profiles?.[activeProfile]?.events || ['im.message.receive_v1'];
      return json({
        this_process: { is_owner: isOwner, pid: process.pid },
        owner: ownerInfo.exists
          ? { pid: ownerInfo.pid, start_time: ownerInfo.start_time, last_heartbeat_age_seconds: ownerInfo.last_heartbeat_age_seconds, alive: ownerInfo.alive }
          : { exists: false },
        ws: isOwner && ws ? ws.getStatus() : undefined,
        log: { size_bytes: snap.fileSize, cursor_offset: snap.cursor.offset, pending_bytes: snap.pending },
        config: { active_profile: activeProfile, configured_events: configuredEvents },
      });
    }

    if (args.action === 'reconnect') {
      if (!isOwner) return json({ error: 'not_owner', owner_pid: ownerInfo.pid });
      ws.stop().then(() => ws.start()).catch(() => {});
      return json({ ok: true, ws_state: 'switching' });
    }

    if (args.action === 'claim') {
      if (isOwner) return json({ ok: true, became_owner: false, reason: 'already_owner' });
      // Trigger _claimAndStart-like flow via ctx.
      if (ctx.requestClaim) {
        const r = await ctx.requestClaim({ force: !!args.force });
        return json(r);
      }
      return json({ error: 'claim_not_supported_in_this_ctx' });
    }

    if (args.action === 'rotate') {
      if (!isOwner) return json({ error: 'not_owner', owner_pid: ownerInfo.pid });
      const snap = readSnapshot(FEISHU_HOME);
      const { forceRotate } = require('../events/event-log');
      const r = forceRotate(EVENTS_LOG_PATH, snap.fileSize);
      const { resetCursorTo } = require('../events/cursor');
      resetCursorTo(FEISHU_HOME, 0);
      return json({ ok: true, prev_size: snap.fileSize, dropped_file: r.droppedPath });
    }

    if (args.action === 'reconfig') {
      if (!isOwner) return json({ error: 'not_owner', owner_pid: ownerInfo.pid });
      if (ctx.requestReconfigure) {
        const r = await ctx.requestReconfigure();
        return json({ ok: true, ...r });
      }
      return json({ error: 'reconfig_not_supported_in_this_ctx' });
    }

    return text(`unknown action: ${args.action}`);
  },
};

module.exports = { schemas, handlers };
