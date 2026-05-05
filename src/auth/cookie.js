// src/auth/cookie.js — cookie heartbeat scheduler.
//
// State lives on the LarkUserClient instance (this.cookieStr, this._heartbeatTimer).
// We expose start/stop functions that take `client` and mutate the timer field.
// Lifted out of clients/user.js for clarity; called only from there.

const HEARTBEAT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours — sl_session has 12h max

function startHeartbeat(client) {
  client._heartbeatTimer = setInterval(async () => {
    try {
      await client._getCsrfToken();
      const { persistToConfig } = require('./credentials');
      persistToConfig({ LARK_COOKIE: client.cookieStr });
      console.error('[feishu-user-plugin] Cookie heartbeat: session refreshed and persisted');
    } catch (e) {
      console.error('[feishu-user-plugin] Cookie heartbeat failed:', e.message);
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (client._heartbeatTimer.unref) client._heartbeatTimer.unref();
}

function stopHeartbeat(client) {
  if (client._heartbeatTimer) {
    clearInterval(client._heartbeatTimer);
    client._heartbeatTimer = null;
  }
}

module.exports = { startHeartbeat, stopHeartbeat, HEARTBEAT_INTERVAL_MS };
