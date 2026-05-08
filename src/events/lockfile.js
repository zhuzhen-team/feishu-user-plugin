// src/events/lockfile.js — generic O_CREAT|O_EXCL advisory lock.
//
// Two flavors:
//   - acquireLongLived(path, info) → { release(), heartbeat() } for owner-style
//     locks (one process holds for the duration of its lifetime, mtime = liveness).
//     Steal: rename old → .stale-<pid>, then EXCL create. Returns null if active.
//   - withMutex(path, fn, { staleMs }) → runs fn() while holding a per-operation
//     mutex. Stale lock files (mtime older than staleMs) are reaped.
//
// Both reuse the same `fs.openSync(p, 'wx')` pattern v1.3.5 UAT lock established.
// No new dep.

'use strict';

const fs = require('fs');
const path = require('path');

function _ensureDir(p) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); } catch (_) {}
}

function _writeLockBody(fd, info) {
  const body = JSON.stringify({ version: 1, pid: process.pid, start_time: Math.floor(Date.now() / 1000), ...info });
  fs.writeSync(fd, body);
}

// Long-lived (owner) acquisition.
//
// Returns { release(), heartbeat() } on success.
// Returns null if lock active (mtime within staleMs).
function acquireLongLived(lockPath, { info = {}, staleMs = 60_000 } = {}) {
  _ensureDir(lockPath);

  // If lock exists, check staleness.
  let stat;
  try { stat = fs.statSync(lockPath); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (stat) {
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < staleMs) return null;
    // Stale — try to steal. Rename out of the way to make room for EXCL create.
    const stolenPath = lockPath + '.stale-' + process.pid + '-' + Date.now();
    try { fs.renameSync(lockPath, stolenPath); } catch (e) {
      // Race: someone else got there first; try again from scratch.
      if (e.code === 'ENOENT') return acquireLongLived(lockPath, { info, staleMs });
      throw e;
    }
    // Schedule cleanup of the stolen file after a moment to avoid disk litter.
    setTimeout(() => { try { fs.unlinkSync(stolenPath); } catch (_) {} }, 5000).unref();
  }

  // Atomic EXCL create — only one process wins this race.
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') return null;  // someone else won
    throw e;
  }
  try {
    _writeLockBody(fd, info);
  } finally {
    fs.closeSync(fd);
  }

  return {
    release() {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    },
    heartbeat() {
      try {
        const now = new Date();
        fs.utimesSync(lockPath, now, now);
      } catch (e) {
        // If the lock file was stolen, our heartbeat will fail. Caller must
        // detect this via separate check (e.g., re-stat + compare pid in body).
        return false;
      }
      return true;
    },
  };
}

// Per-operation mutex. Synchronous wrapper for short critical sections.
function withMutex(lockPath, fn, { staleMs = 30_000, retries = 30, retryDelayMs = 100 } = {}) {
  _ensureDir(lockPath);

  const start = Date.now();
  while (true) {
    // Stale reap.
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > staleMs) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Wait + retry.
      if (Date.now() - start > staleMs) {
        throw new Error(`withMutex: lock ${lockPath} held longer than ${staleMs}ms`);
      }
      const sleepUntil = Date.now() + retryDelayMs;
      while (Date.now() < sleepUntil) { /* busy wait — short delay */ }
      continue;
    }

    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      fs.closeSync(fd);
      const result = fn();
      return result;
    } finally {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  }
}

module.exports = { acquireLongLived, withMutex };
