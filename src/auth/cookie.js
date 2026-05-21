// src/auth/cookie.js — cookie heartbeat scheduler.
//
// State lives on the LarkUserClient instance. Lifted from clients/user.js.
//
// v1.3.14 — owner-gated single runner: only the process holding
// ws-owner.lock does the real heartbeat; non-owners tick into no-op. Non-owner
// clients pick up the refreshed cookie via CredentialsMonitor's
// onCookieChange hook on the next tool call. Fallback: no ws-owner.lock
// (e.g., APP_ID/SECRET missing → no WS server) → every process runs heartbeat
// (pre-v1.3.14 behaviour), keeping cookie-only deployments working.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours — sl_session has 12h max
const WS_OWNER_LOCK = path.join(os.homedir(), '.feishu-user-plugin', 'ws-owner.lock');

/**
 * Returns true iff this process should run the cookie heartbeat right now.
 * Logic: this process is the ws-owner, OR no ws-owner exists (fallback).
 * Re-checked on every tick so the gate adapts to live ws-owner takeovers.
 *
 * Exported for testing — callers should not depend on its presence.
 */
function _isHeartbeatRunner(_lockPath = WS_OWNER_LOCK, _pid = process.pid) {
  let body;
  try {
    body = JSON.parse(fs.readFileSync(_lockPath, 'utf8'));
  } catch (_) {
    // Lock file missing or unreadable → no owner is claimed → fall back to
    // pre-v1.3.14 behavior (every process runs heartbeat).
    return true;
  }
  if (typeof body.pid !== 'number') return true; // malformed body → fallback
  return body.pid === _pid;
}

/**
 * One heartbeat tick. Extracted so unit tests can call it directly without
 * waiting 4 hours. Returns the action taken: 'skip' (non-owner), 'refreshed'
 * (owner did the API call + persist), or 'error' (owner tried but failed).
 *
 * Exported for testing.
 */
async function _heartbeatTick(client, deps = {}) {
  const isOwner = deps.isHeartbeatRunner || _isHeartbeatRunner;
  if (!isOwner()) {
    return 'skip';
  }
  try {
    await client._getCsrfToken();
    const persist = deps.persistToConfig || require('./credentials').persistToConfig;
    persist({ LARK_COOKIE: client.cookieStr });
    console.error('[feishu-user-plugin] Cookie heartbeat: session refreshed and persisted (ws-owner)');
    return 'refreshed';
  } catch (e) {
    console.error('[feishu-user-plugin] Cookie heartbeat failed:', e.message);
    return 'error';
  }
}

function startHeartbeat(client) {
  client._heartbeatTimer = setInterval(() => _heartbeatTick(client), HEARTBEAT_INTERVAL_MS);
  if (client._heartbeatTimer.unref) client._heartbeatTimer.unref();
}

function stopHeartbeat(client) {
  if (client._heartbeatTimer) {
    clearInterval(client._heartbeatTimer);
    client._heartbeatTimer = null;
  }
}

module.exports = {
  startHeartbeat,
  stopHeartbeat,
  HEARTBEAT_INTERVAL_MS,
  _isHeartbeatRunner, // exported for testing
  _heartbeatTick,     // exported for testing
};
