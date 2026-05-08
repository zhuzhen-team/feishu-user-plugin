// src/test-events-cursor.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { ensureLog, appendEvent } = require('./events/event-log');
const { drain, readSnapshot, resetCursorTo } = require('./events/cursor');

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-cur-'));
  const logPath = path.join(dir, 'events.jsonl');
  ensureLog(logPath);

  // No events → empty drain.
  let r = drain(dir);
  assert.equal(r.events.length, 0);

  // Append 3 events, drain reads them.
  appendEvent(logPath, { event_id: 'a', ts: 1, profile: 'default', payload: {} });
  appendEvent(logPath, { event_id: 'b', ts: 2, profile: 'default', payload: {} });
  appendEvent(logPath, { event_id: 'c', ts: 3, profile: 'default', payload: {} });

  r = drain(dir);
  assert.equal(r.events.length, 3);
  assert.equal(r.advanced, true);

  // Second drain returns nothing (cursor advanced).
  r = drain(dir);
  assert.equal(r.events.length, 0);

  // Peek doesn't advance.
  appendEvent(logPath, { event_id: 'd', ts: 4, profile: 'default', payload: {} });
  r = drain(dir, { peek: true });
  assert.equal(r.events.length, 1);
  assert.equal(r.advanced, false);
  // Real drain afterward still returns the same event.
  r = drain(dir);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].event_id, 'd');

  // Snapshot.
  const snap = readSnapshot(dir);
  assert.equal(snap.pending, 0);
  assert.ok(snap.cursor.offset > 0);

  // Reset cursor to 0 → next drain returns all 4.
  resetCursorTo(dir, 0);
  r = drain(dir);
  assert.equal(r.events.length, 4);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('cursor.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
