// src/events/owner.js — ws-owner.lock acquire / heartbeat / takeover.
//
// Wraps lockfile.acquireLongLived for the WS-ownership use case.
// Exposes an EventEmitter-style interface: 'become_owner', 'lose_owner', 'state_change'.

'use strict';

const path = require('path');
const fs = require('fs');
const { acquireLongLived } = require('./lockfile');

const OWNER_LOCK_FILENAME = 'ws-owner.lock';
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_MS = 60_000;
const TAKEOVER_POLL_INTERVAL_MS = 30_000;

function _ownerLockPath(dir) { return path.join(dir, OWNER_LOCK_FILENAME); }

// Try to claim ownership (or steal if stale + force, or just steal if stale).
// Returns:
//   { isOwner: true, release(), heartbeat() } if successful
//   { isOwner: false, ownerInfo } otherwise
function tryClaim(dir, { info = {}, force = false } = {}) {
  const lockPath = _ownerLockPath(dir);

  if (force) {
    // Force takeover: rename existing out of the way.
    try { fs.renameSync(lockPath, lockPath + '.forced-' + Date.now()); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  const handle = acquireLongLived(lockPath, { info, staleMs: STALE_MS });
  if (!handle) {
    // Read existing lock body for diagnostics.
    let body = null;
    try { body = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) {}
    let mtimeMs = null;
    try { mtimeMs = fs.statSync(lockPath).mtimeMs; } catch (_) {}
    return { isOwner: false, ownerInfo: { ...body, mtimeMs, last_heartbeat_age_seconds: mtimeMs ? Math.floor((Date.now() - mtimeMs) / 1000) : null } };
  }
  return { isOwner: true, ...handle };
}

// Read current owner info without modifying anything.
function readOwnerInfo(dir) {
  const lockPath = _ownerLockPath(dir);
  let body = null;
  let mtimeMs = null;
  try {
    body = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    mtimeMs = fs.statSync(lockPath).mtimeMs;
  } catch (_) {}
  if (!body) return { exists: false };
  const ageSec = mtimeMs ? Math.floor((Date.now() - mtimeMs) / 1000) : null;
  return {
    exists: true,
    pid: body.pid,
    start_time: body.start_time,
    mtimeMs,
    last_heartbeat_age_seconds: ageSec,
    alive: ageSec !== null && ageSec * 1000 < STALE_MS,
  };
}

module.exports = {
  tryClaim,
  readOwnerInfo,
  OWNER_LOCK_FILENAME,
  HEARTBEAT_INTERVAL_MS,
  STALE_MS,
  TAKEOVER_POLL_INTERVAL_MS,
};
