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

// Read from `offset` to EOF; return { events: [...], nextOffset }.
// Tolerates a trailing partial line (no \n) — partial line not consumed,
// nextOffset stops at the last full \n.
function readFrom(logPath, offset) {
  let stat;
  try { stat = fs.statSync(logPath); } catch (e) {
    if (e.code === 'ENOENT') return { events: [], nextOffset: 0, fileSize: 0 };
    throw e;
  }
  const fileSize = stat.size;
  if (offset >= fileSize) return { events: [], nextOffset: offset, fileSize };
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
      return { events: [], nextOffset: offset, fileSize };
    }
    const fullText = text.slice(0, lastNl + 1);  // include the \n
    const events = [];
    for (const line of fullText.split('\n')) {
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch (_) { /* skip malformed */ }
    }
    return { events, nextOffset: offset + Buffer.byteLength(fullText, 'utf8'), fileSize };
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
    const readLen = Math.min(scanBytes, stat.size);
    const buf = Buffer.allocUnsafe(readLen);
    fs.readSync(fd, buf, 0, readLen, stat.size - readLen);
    // If the file already ends in \n, no repair needed.
    if (buf[buf.length - 1] === 0x0A) return { repaired: false, sizeBefore: stat.size, sizeAfter: stat.size };
    // Find last \n in the scanned tail.
    let i = buf.length - 1;
    while (i >= 0 && buf[i] !== 0x0A) i--;
    if (i < 0) {
      // No \n in last 8 KB — pathological. Don't truncate (might lose data); leave as is.
      return { repaired: false, sizeBefore: stat.size, sizeAfter: stat.size, warning: 'no \\n in scan window' };
    }
    const truncateAt = stat.size - readLen + i + 1;  // +1 to keep the \n
    fs.ftruncateSync(fd, truncateAt);
    return { repaired: true, sizeBefore: stat.size, sizeAfter: truncateAt };
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
