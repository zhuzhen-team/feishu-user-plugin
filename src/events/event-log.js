// src/events/event-log.js — events.jsonl management.
//
// Single-writer (owner) appends with `\n`-terminated lines.
// Multi-reader (any process) seeks from cursor offset to EOF, parses lines,
// tolerates a trailing partial line.
//
// On owner takeover, callers should run repairTail() once before appending
// to ensure append-only invariant is intact.

'use strict';

const fs = require('fs');
const path = require('path');

function ensureLog(logPath) {
  try { fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 }); } catch (_) {}
  try { fs.openSync(logPath, 'a'); } catch (_) {}
}

function appendEvent(logPath, eventObj) {
  const line = JSON.stringify(eventObj) + '\n';
  fs.appendFileSync(logPath, line, { encoding: 'utf8' });
}

// Read from `offset` to EOF; return { events, nextOffset, fileSize, capped }.
// Tolerates a trailing partial line (no \n) — partial line not consumed,
// nextOffset stops at the last full \n.
//
// `maxEvents` bounds how many events are consumed: nextOffset advances only past
// the lines actually returned, so the unread tail stays pending for the next
// call. Without this bound a caller that caps its own result silently strands —
// and permanently loses — every event past the cap, because the cursor had
// already jumped to EOF (the v1.3.17 health-check HIGH finding on get_new_events).
function readFrom(logPath, offset, { maxEvents = Infinity } = {}) {
  let stat;
  try { stat = fs.statSync(logPath); } catch (e) {
    if (e.code === 'ENOENT') return { events: [], nextOffset: 0, fileSize: 0, capped: false };
    throw e;
  }
  const fileSize = stat.size;
  if (offset >= fileSize) return { events: [], nextOffset: offset, fileSize, capped: false };
  if (offset < 0) offset = 0;

  const fd = fs.openSync(logPath, 'r');
  try {
    const length = fileSize - offset;
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(fd, buf, 0, length, offset);
    const text = buf.toString('utf8');
    // Find last \n; everything after it is partial.
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) {
      // Entire chunk is partial; no events consumed.
      return { events: [], nextOffset: offset, fileSize, capped: false };
    }
    const fullText = text.slice(0, lastNl + 1);  // include the \n
    const events = [];
    let consumedLen = 0;  // byte length of the lines we actually consume (incl their \n)
    let capped = false;
    let pos = 0;
    while (pos < fullText.length) {
      const nl = fullText.indexOf('\n', pos);
      if (nl < 0) break;  // no more complete lines (fullText ends in \n, so unreachable)
      const line = fullText.slice(pos, nl);
      const lineBytes = Buffer.byteLength(fullText.slice(pos, nl + 1), 'utf8');
      if (line) {
        if (events.length >= maxEvents) { capped = true; break; }  // stop BEFORE consuming the next event
        try { events.push(JSON.parse(line)); } catch (_) { /* skip malformed, but still consume */ }
      }
      consumedLen += lineBytes;
      pos = nl + 1;
    }
    return { events, nextOffset: offset + consumedLen, fileSize, capped };
  } finally {
    fs.closeSync(fd);
  }
}

// Repair: scan the tail for last \n; truncate file there if file ends with
// non-\n bytes (partial line from a crash).
function repairTail(logPath, scanBytes = 8192) {
  let stat;
  try { stat = fs.statSync(logPath); } catch (e) {
    if (e.code === 'ENOENT') return { repaired: false, sizeBefore: 0, sizeAfter: 0 };
    throw e;
  }
  if (stat.size === 0) return { repaired: false, sizeBefore: 0, sizeAfter: 0 };

  const fd = fs.openSync(logPath, 'r+');
  try {
    // Grow the scan window until we find a newline or reach the file start, so a
    // crash that left a partial trailing record LARGER than the initial window
    // is still repaired (the old code gave up at 8 KB and left the unterminated
    // tail, which the next append then concatenated into one corrupt line).
    let win = Math.min(scanBytes, stat.size);
    for (;;) {
      const buf = Buffer.allocUnsafe(win);
      fs.readSync(fd, buf, 0, win, stat.size - win);
      // If the file already ends in \n, no repair needed.
      if (buf[buf.length - 1] === 0x0A) return { repaired: false, sizeBefore: stat.size, sizeAfter: stat.size };
      // Find the last \n in the scanned window.
      let i = buf.length - 1;
      while (i >= 0 && buf[i] !== 0x0A) i--;
      if (i >= 0) {
        const truncateAt = stat.size - win + i + 1;  // +1 to keep the \n
        fs.ftruncateSync(fd, truncateAt);
        return { repaired: true, sizeBefore: stat.size, sizeAfter: truncateAt };
      }
      if (win >= stat.size) {
        // No \n in the ENTIRE file and it doesn't end in \n: the whole file is a
        // single never-terminated (corrupt) record from a crash mid-first-write.
        // Truncate to empty so appendEvent starts clean rather than concatenating
        // onto a partial line forever.
        fs.ftruncateSync(fd, 0);
        return { repaired: true, sizeBefore: stat.size, sizeAfter: 0, warning: 'no \\n in entire file; truncated corrupt single-record log to empty' };
      }
      win = Math.min(win * 4, stat.size);  // grow and retry
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Defer-rotate. Returns true if rotation happened.
//
// Conditions: size > sizeThresholdBytes AND (cursorOffset >= size - 4096) — i.e.,
// consumer is within 4 KB of EOF.
function maybeRotate(logPath, cursorOffset, sizeThresholdBytes) {
  let stat;
  try { stat = fs.statSync(logPath); } catch (e) {
    if (e.code === 'ENOENT') return { rotated: false };
    throw e;
  }
  if (stat.size <= sizeThresholdBytes) return { rotated: false, sizeBytes: stat.size };
  if (cursorOffset < stat.size - 4096) {
    return { rotated: false, deferred: true, sizeBytes: stat.size, cursorOffset };
  }
  const ts = Math.floor(Date.now() / 1000);
  const droppedPath = logPath + '.dropped-' + ts;
  fs.renameSync(logPath, droppedPath);
  // Recreate empty events.jsonl.
  fs.openSync(logPath, 'a');
  return { rotated: true, droppedPath, sizeBytes: stat.size };
}

// Force rotate (called when log > hardCap and consumer is too far behind).
// Drops the current log to .dropped-<ts>, writes a synthetic _rotated event
// to the new log so consumers see the warning.
function forceRotate(logPath, prevSize) {
  const ts = Math.floor(Date.now() / 1000);
  const droppedPath = logPath + '.dropped-' + ts;
  try { fs.renameSync(logPath, droppedPath); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  appendEvent(logPath, {
    event_id: '_rotated',
    ts: ts * 1000,
    profile: '_system',
    payload: { warning: 'force_rotated_log', prev_size: prevSize, dropped_file: path.basename(droppedPath) },
  });
  return { droppedPath };
}

// Cleanup of old .dropped-<ts> files. Keep last `keepDays` worth.
function cleanupDropped(logPath, keepDays = 7) {
  const dir = path.dirname(logPath);
  const base = path.basename(logPath);
  const cutoffMs = Date.now() - keepDays * 86400_000;
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of entries) {
    if (!name.startsWith(base + '.dropped-')) continue;
    const fp = path.join(dir, name);
    try {
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoffMs) fs.unlinkSync(fp);
    } catch (_) {}
  }
}

module.exports = { ensureLog, appendEvent, readFrom, repairTail, maybeRotate, forceRotate, cleanupDropped };
