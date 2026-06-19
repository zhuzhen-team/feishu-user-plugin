// src/events/cursor.js — events.cursor.json + drain protocol.
//
// cursor.json schema: { version: 1, file: "events.jsonl", offset: <int> }
// Atomic write: tmp + rename.
// Drain: take per-operation mutex, read cursor, read events.jsonl[offset:], advance.

'use strict';

const fs = require('fs');
const path = require('path');
const { withMutex } = require('./lockfile');
const { readFrom } = require('./event-log');

const CURSOR_FILENAME = 'events.cursor.json';
const CURSOR_LOCK_FILENAME = 'events.cursor.lock';

function _cursorPath(dir) { return path.join(dir, CURSOR_FILENAME); }
function _lockPath(dir) { return path.join(dir, CURSOR_LOCK_FILENAME); }

function _readCursor(cursorPath, defaultFileSize) {
  try {
    const raw = fs.readFileSync(cursorPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) throw new Error('bad version');
    if (typeof parsed.file !== 'string' || typeof parsed.offset !== 'number') throw new Error('bad shape');
    return parsed;
  } catch (e) {
    // Conservative reset: skip history (offset = current size), don't replay.
    if (e.code !== 'ENOENT') {
      console.error(`[feishu-user-plugin] cursor.json read failed: ${e.message}; resetting to current EOF.`);
    }
    return { version: 1, file: 'events.jsonl', offset: defaultFileSize };
  }
}

function _writeCursorAtomic(cursorPath, cursor) {
  const tmpPath = cursorPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(cursor) + '\n', { mode: 0o600 });
  fs.renameSync(tmpPath, cursorPath);
}

// Sanity check: offset in [0, fileSize]. Returns clamped cursor.
function _sanitize(cursor, fileSize) {
  if (cursor.offset < 0 || cursor.offset > fileSize) {
    console.error(`[feishu-user-plugin] cursor offset ${cursor.offset} out of range [0, ${fileSize}]; resetting to EOF.`);
    return { ...cursor, offset: fileSize };
  }
  return cursor;
}

// Drain: read events from current offset; advance cursor (unless peek).
//
// Returns { events, nextOffset, advanced }.
// `events` is the raw event objects from events.jsonl (filter applied by caller).
function drain(dir, { peek = false, maxEvents = Infinity } = {}) {
  const logPath = path.join(dir, 'events.jsonl');
  const curPath = _cursorPath(dir);
  const lockPath = _lockPath(dir);

  return withMutex(lockPath, () => {
    let stat;
    try { stat = fs.statSync(logPath); } catch (e) {
      if (e.code === 'ENOENT') return { events: [], nextOffset: 0, advanced: false, capped: false };
      throw e;
    }
    let cursor = _readCursor(curPath, stat.size);
    cursor = _sanitize(cursor, stat.size);

    // Consume at most maxEvents; the cursor advances only past the events we
    // actually return, so a capped tail stays pending instead of being skipped.
    const { events, nextOffset, capped } = readFrom(logPath, cursor.offset, { maxEvents });
    if (!peek && nextOffset !== cursor.offset) {
      _writeCursorAtomic(curPath, { version: 1, file: 'events.jsonl', offset: nextOffset });
      return { events, nextOffset, advanced: true, capped };
    }
    // Always persist cursor.json on first drain (ENOENT) so subsequent calls
    // don't trigger the conservative-reset-to-EOF path.
    if (!peek) {
      const exists = (() => { try { fs.statSync(curPath); return true; } catch (_) { return false; } })();
      if (!exists) _writeCursorAtomic(curPath, { version: 1, file: 'events.jsonl', offset: nextOffset });
    }
    return { events, nextOffset, advanced: false, capped };
  }, { staleMs: 30_000 });
}

// Read cursor without advancing or locking — for diagnostics.
function readSnapshot(dir) {
  const logPath = path.join(dir, 'events.jsonl');
  const curPath = _cursorPath(dir);
  let fileSize = 0;
  try { fileSize = fs.statSync(logPath).size; } catch (_) {}
  const cursor = _readCursor(curPath, fileSize);
  return { cursor, fileSize, pending: Math.max(0, fileSize - cursor.offset) };
}

// Manual reset (used by force-rotate path).
function resetCursorTo(dir, offset) {
  const curPath = _cursorPath(dir);
  const lockPath = _lockPath(dir);
  withMutex(lockPath, () => {
    _writeCursorAtomic(curPath, { version: 1, file: 'events.jsonl', offset });
  }, { staleMs: 30_000 });
}

// Run a rotate-and-reset under the SAME mutex that drain() takes, so the
// events.jsonl rename and the cursor reset are atomic with respect to a
// concurrent drain on another process (previously the rotate renamed the log
// and reset the cursor in two unsynchronised steps, racing in-flight drains).
// `doRotate({ cursorOffset, fileSize })` performs the rename(s) and returns
// `{ resetCursor: bool }`; when true the cursor is reset to 0 in the same lock.
function rotateUnderLock(dir, doRotate) {
  const curPath = _cursorPath(dir);
  const lockPath = _lockPath(dir);
  const logPath = path.join(dir, 'events.jsonl');
  return withMutex(lockPath, () => {
    let fileSize = 0;
    try { fileSize = fs.statSync(logPath).size; } catch (_) {}
    const cursor = _readCursor(curPath, fileSize);
    const result = doRotate({ cursorOffset: cursor.offset, fileSize }) || {};
    if (result.resetCursor) {
      _writeCursorAtomic(curPath, { version: 1, file: 'events.jsonl', offset: 0 });
    }
    return result;
  }, { staleMs: 30_000 });
}

module.exports = { drain, readSnapshot, resetCursorTo, rotateUnderLock, CURSOR_FILENAME };
