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

// Probe whether `pid` is a live process. Returns true when alive (or when we
// can't tell for certain; we prefer "alive" on EPERM because falsely
// declaring an EPERM'd process dead would race-steal a lock from another
// user's MCP server). Returns false only when ESRCH says "no such process".
function _isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return true; // unknown → safe default
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    // EPERM — process exists but we can't signal it. Treat as alive.
    return true;
  }
}

function _readPidFromLock(lockPath) {
  try {
    const body = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (body && typeof body.pid === 'number' && body.pid > 0) return body.pid;
  } catch (_) { /* malformed or unreadable — caller falls back to mtime */ }
  return null;
}

// Long-lived (owner) acquisition.
//
// Returns { release(), heartbeat() } on success.
// Returns null if lock active (mtime within staleMs AND pid still alive).
// v1.3.12: pid liveness check shortcircuits the 60s stale window when the
// holder process is definitively gone (SIGKILL'd, crashed, host reboot).
function acquireLongLived(lockPath, { info = {}, staleMs = 60_000 } = {}) {
  _ensureDir(lockPath);

  // If lock exists, check staleness.
  let stat;
  try { stat = fs.statSync(lockPath); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (stat) {
    const ageMs = Date.now() - stat.mtimeMs;
    const fresh = ageMs < staleMs;
    let canSteal = !fresh;
    if (fresh) {
      // mtime suggests alive — verify by pid liveness. If the body has a pid
      // and that pid is gone, the holder crashed and we can steal now.
      const pid = _readPidFromLock(lockPath);
      if (pid !== null && !_isProcessAlive(pid)) {
        canSteal = true;
      }
    }
    if (!canSteal) return null;
    // Stealable — rename out of the way to make room for EXCL create.
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

// Blocking sleep that parks the thread instead of burning a CPU core.
// The previous busy-spin (`while (Date.now() < until) {}`) pegged 100% of a
// core for the full retry delay and froze the single-threaded event loop while
// a peer process held the cursor lock — a self-inflicted stall under exactly
// the concurrency the lock exists to handle (v1.3.17 health-check finding).
function _sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* SharedArrayBuffer unavailable — last-resort bounded spin */ }
  }
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
      _sleepSync(retryDelayMs);
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

module.exports = { acquireLongLived, withMutex, _isProcessAlive };
