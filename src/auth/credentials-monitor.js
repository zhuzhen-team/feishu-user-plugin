// src/auth/credentials-monitor.js — single poller for credentials.json changes.
//
// The MCP server is long-lived; users routinely re-run `npx feishu-user-plugin
// oauth` from another shell to refresh UAT, expecting the running server to
// pick up the new token. Pre-v1.3.12 only the active-profile field was
// observed (server.js::_syncActiveProfileFromDisk); UAT changes, cookie
// rotations, and cache invalidation all required a Claude Code restart.
//
// CredentialsMonitor unifies the polling: per-tool-call `sync()` stats the
// file, hashes its contents, and fires per-field hooks on diff. Owners
// (officialClient, userClient, _userNameCache) register hooks at boot.
//
// Hash strategy: we don't trust mtime alone because `touch` would falsely
// trigger a UAT reload across every dispatcher call. Content hash + mtime
// means: skip the read entirely when mtime unchanged (cheap path), and
// when mtime advanced compute SHA-256 of the active profile's fields and
// compare per-field hashes to decide which hooks fire.
//
// Design choices:
//   - factory not singleton: `createCredentialsMonitor({ path? })` so tests
//     can use a tmpdir and server.js wires one against the real path.
//   - synchronous sync(): callers are the request dispatcher; we can't await
//     before handling a tool call. fs.statSync + fs.readFileSync are fine —
//     credentials.json is tiny (a few KiB max).
//   - hooks fire synchronously in registration order; exceptions are logged
//     to stderr and don't block other hooks.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PATH = path.join(os.homedir(), '.feishu-user-plugin', 'credentials.json');

function _hash(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

function _readSafely(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

function _statSafely(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

function _parseSafely(s) {
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object' && o.profiles && o.active) return o;
  } catch (_) {}
  return null;
}

function _activeProfileEnv(canonical) {
  if (!canonical) return null;
  const p = canonical.profiles[canonical.active];
  return p ? { ...p } : null;
}

function _fieldHash(env, key) {
  if (!env || env[key] === undefined || env[key] === null) return null;
  return _hash(String(env[key]));
}

function createCredentialsMonitor({ path: credPath = DEFAULT_PATH } = {}) {
  const hooks = {
    uat: [],
    cookie: [],
    profile: [],
    invalidate: [],
  };

  // Baseline state: null until first successful sync().
  let lastMtimeMs = null;
  let lastActive = null;
  let lastUatHash = null;
  let lastCookieHash = null;
  // refresh field is paired with UAT — refresh-only rotation also fires uat hook.
  let lastRefreshHash = null;
  // `_initialized` flips on first successful read. We DON'T reset on file
  // disappearance — that way a user who briefly removes credentials.json
  // (e.g. by hand-editing in vim with backup file shenanigans) doesn't see
  // the next reappear treated as a silent rebaseline.
  let _initialized = false;

  function _fire(list, arg, label) {
    for (const cb of list) {
      try { cb(arg); } catch (e) {
        console.error(`[feishu-user-plugin] credentials-monitor ${label} hook threw: ${e.message}`);
      }
    }
  }

  function sync() {
    const stat = _statSafely(credPath);
    if (!stat) {
      // File missing — early return. We don't reset state because the file
      // may reappear and we want to diff against what we last saw.
      lastMtimeMs = null; // force re-read on reappear (mtime will differ)
      return;
    }
    // Cheap exit when mtime hasn't advanced.
    if (lastMtimeMs !== null && stat.mtimeMs === lastMtimeMs) return;

    const raw = _readSafely(credPath);
    if (raw === null) { lastMtimeMs = stat.mtimeMs; return; }
    const canonical = _parseSafely(raw);
    if (!canonical) { lastMtimeMs = stat.mtimeMs; return; }

    const env = _activeProfileEnv(canonical);
    const active = canonical.active;
    const uatHash = _fieldHash(env, 'LARK_USER_ACCESS_TOKEN');
    const cookieHash = _fieldHash(env, 'LARK_COOKIE');
    const refreshHash = _fieldHash(env, 'LARK_USER_REFRESH_TOKEN');

    // First observation establishes baseline silently.
    const baselining = !_initialized;
    lastMtimeMs = stat.mtimeMs;
    _initialized = true;

    if (baselining) {
      lastActive = active;
      lastUatHash = uatHash;
      lastCookieHash = cookieHash;
      lastRefreshHash = refreshHash;
      return;
    }

    let anyChange = false;
    if (active !== lastActive) {
      anyChange = true;
      const prev = lastActive;
      lastActive = active;
      _fire(hooks.profile, { from: prev, to: active, env }, 'profile');
    }
    if (uatHash !== lastUatHash || refreshHash !== lastRefreshHash) {
      anyChange = true;
      lastUatHash = uatHash;
      lastRefreshHash = refreshHash;
      _fire(hooks.uat, env, 'uat');
    }
    if (cookieHash !== lastCookieHash) {
      anyChange = true;
      lastCookieHash = cookieHash;
      _fire(hooks.cookie, env, 'cookie');
    }
    if (anyChange) {
      _fire(hooks.invalidate, env, 'invalidate');
    }
  }

  // Force-fire all hooks as if everything changed. Used by switch_profile
  // when it wants to short-circuit the mtime debounce.
  function forceInvalidate() {
    const stat = _statSafely(credPath);
    const raw = stat ? _readSafely(credPath) : null;
    const canonical = raw ? _parseSafely(raw) : null;
    const env = _activeProfileEnv(canonical) || {};
    _fire(hooks.profile, { from: lastActive, to: canonical?.active, env }, 'profile');
    _fire(hooks.uat, env, 'uat');
    _fire(hooks.cookie, env, 'cookie');
    _fire(hooks.invalidate, env, 'invalidate');
    if (canonical) {
      lastActive = canonical.active;
      lastUatHash = _fieldHash(env, 'LARK_USER_ACCESS_TOKEN');
      lastCookieHash = _fieldHash(env, 'LARK_COOKIE');
      lastRefreshHash = _fieldHash(env, 'LARK_USER_REFRESH_TOKEN');
      lastMtimeMs = stat.mtimeMs;
    }
  }

  return {
    sync,
    forceInvalidate,
    onUatChange:    (cb) => { hooks.uat.push(cb); },
    onCookieChange: (cb) => { hooks.cookie.push(cb); },
    onProfileSwitch: (cb) => { hooks.profile.push(cb); },
    onCacheInvalidate: (cb) => { hooks.invalidate.push(cb); },
  };
}

module.exports = { createCredentialsMonitor };
