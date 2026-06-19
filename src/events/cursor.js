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

// Per-profile cursor files give each profile's consumer an independent position,
// so one profile draining can't advance a shared cursor past another profile's
// unread events. The "all" view (profile '*'/'any' or none) keeps using the
// legacy events.cursor.json. A single shared lock (CURSOR_LOCK_FILENAME)
// serialises every drain + rotate so they stay mutually atomic.
function _cursorFileForProfile(profile) {
  if (!profile || profile === '*' || profile === 'any') return CURSOR_FILENAME;
  return `events.cursor.${String(profile).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}
function _cursorPathForProfile(dir, profile) { return path.join(dir, _cursorFileForProfile(profile)); }

// Predicate selecting events a given profile's drain should consume. _system
// events (drop markers, rotation notices) are delivered to every profile.
function _matchForProfile(profile) {
  if (!profile || profile === '*' || profile === 'any') return null;  // all
  return (e) => e && (e.profile === profile || e.profile === '_system');
}

function _listCursorFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) {}
  return entries.filter((n) => n.startsWith('events.cursor') && n.endsWith('.json'));
}
// Reset every per-profile cursor to 0 (the log was rotated → all positions stale).
function _resetAllCursors(dir) {
  const files = _listCursorFiles(dir);
  if (!files.includes(CURSOR_FILENAME)) files.push(CURSOR_FILENAME);  // ensure the "all" cursor exists at 0
  for (const name of files) {
    try { _writeCursorAtomic(path.join(dir, name), { version: 1, file: 'events.jsonl', offset: 0 }); } catch (_) {}
  }
}
// Slowest (min) cursor offset across all profiles — the rotate "consumer caught
// up?" check must use this so rotation never drops a lagging profile's events.
function _minCursorOffset(dir, fileSize) {
  const files = _listCursorFiles(dir);
  if (files.length === 0) return fileSize;
  let min = fileSize;
  for (const name of files) {
    const c = _readCursor(path.join(dir, name), fileSize);
    if (typeof c.offset === 'number' && c.offset < min) min = c.offset;
  }
  return min;
}

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
function drain(dir, { peek = false, maxEvents = Infinity, profile = null } = {}) {
  const logPath = path.join(dir, 'events.jsonl');
  const curPath = _cursorPathForProfile(dir, profile);
  const lockPath = _lockPath(dir);
  const match = _matchForProfile(profile);

  return withMutex(lockPath, () => {
    let stat;
    try { stat = fs.statSync(logPath); } catch (e) {
      if (e.code === 'ENOENT') return { events: [], nextOffset: 0, advanced: false, capped: false };
      throw e;
    }
    let cursor = _readCursor(curPath, stat.size);
    cursor = _sanitize(cursor, stat.size);

    // Consume at most maxEvents matching THIS profile; the cursor advances past
    // the events examined (matching returned + other-profile skipped), so a
    // capped tail stays pending and other profiles keep their own positions.
    const { events, nextOffset, capped } = readFrom(logPath, cursor.offset, { maxEvents, match });
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

// Read cursor without advancing or locking — for diagnostics. Defaults to the
// "all" cursor; pass a profile to inspect that profile's position.
function readSnapshot(dir, profile = null) {
  const logPath = path.join(dir, 'events.jsonl');
  const curPath = _cursorPathForProfile(dir, profile);
  let fileSize = 0;
  try { fileSize = fs.statSync(logPath).size; } catch (_) {}
  const cursor = _readCursor(curPath, fileSize);
  return { cursor, fileSize, pending: Math.max(0, fileSize - cursor.offset) };
}

// Manual reset. With no profile it resets EVERY per-profile cursor (used by the
// manual force-rotate path, where the whole log was dropped); pass a profile to
// reset just that one.
function resetCursorTo(dir, offset, profile) {
  const lockPath = _lockPath(dir);
  withMutex(lockPath, () => {
    if (profile === undefined && offset === 0) {
      _resetAllCursors(dir);
      return;
    }
    _writeCursorAtomic(_cursorPathForProfile(dir, profile || null), { version: 1, file: 'events.jsonl', offset });
  }, { staleMs: 30_000 });
}

// Run a rotate-and-reset under the SAME mutex that drain() takes, so the
// events.jsonl rename and the cursor resets are atomic with respect to a
// concurrent drain on another process. `doRotate({ cursorOffset, fileSize })`
// receives the SLOWEST profile cursor offset (so it won't rotate away a lagging
// profile's unread events), performs the rename(s), and returns
// `{ resetCursor: bool }`; when true ALL per-profile cursors reset to 0.
function rotateUnderLock(dir, doRotate) {
  const lockPath = _lockPath(dir);
  const logPath = path.join(dir, 'events.jsonl');
  return withMutex(lockPath, () => {
    let fileSize = 0;
    try { fileSize = fs.statSync(logPath).size; } catch (_) {}
    const result = doRotate({ cursorOffset: _minCursorOffset(dir, fileSize), fileSize }) || {};
    if (result.resetCursor) _resetAllCursors(dir);
    return result;
  }, { staleMs: 30_000 });
}

module.exports = { drain, readSnapshot, resetCursorTo, rotateUnderLock, CURSOR_FILENAME };
