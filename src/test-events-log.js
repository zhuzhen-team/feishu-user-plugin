// src/test-events-log.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { ensureLog, appendEvent, readFrom, repairTail, maybeRotate, forceRotate } = require('./events/event-log');

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-log-'));
  const logPath = path.join(dir, 'events.jsonl');

  // Append + read
  ensureLog(logPath);
  appendEvent(logPath, { event_id: 'a', ts: 1, profile: 'default', payload: {} });
  appendEvent(logPath, { event_id: 'b', ts: 2, profile: 'default', payload: {} });

  let r = readFrom(logPath, 0);
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].event_id, 'a');
  assert.equal(r.events[1].event_id, 'b');

  // Read with offset
  r = readFrom(logPath, r.events.length === 2 ? r.nextOffset : 0);
  assert.equal(r.events.length, 0);

  // Partial-line tolerance: append broken line
  fs.appendFileSync(logPath, '{"event_id":"c","ts":3,"profile":"default","payload":{}}');
  r = readFrom(logPath, 0);
  assert.equal(r.events.length, 2, 'partial last line should not be consumed');

  // Repair tail
  const beforeSize = fs.statSync(logPath).size;
  const repair = repairTail(logPath);
  assert.equal(repair.repaired, true, 'repair should run');
  assert.ok(repair.sizeAfter < beforeSize, 'truncation occurred');

  // After repair, can append normally
  appendEvent(logPath, { event_id: 'd', ts: 4, profile: 'default', payload: {} });
  r = readFrom(logPath, 0);
  assert.equal(r.events.length, 3, 'after repair + append, 3 full events');
  assert.equal(r.events[2].event_id, 'd');

  // Defer-rotate: size below threshold → no rotation
  let rot = maybeRotate(logPath, r.nextOffset, 1024 * 1024);
  assert.equal(rot.rotated, false);

  // Defer-rotate: size above threshold + cursor caught up → rotation
  // (we'll use a tiny threshold)
  rot = maybeRotate(logPath, r.nextOffset, 1);
  assert.equal(rot.rotated, true);
  assert.ok(fs.existsSync(rot.droppedPath));
  assert.equal(fs.statSync(logPath).size, 0, 'new log empty after rotate');

  // Force rotate: even with cursor 0 (behind), drops + writes _rotated event
  appendEvent(logPath, { event_id: 'e', ts: 5, profile: 'default', payload: {} });
  forceRotate(logPath, fs.statSync(logPath).size);
  r = readFrom(logPath, 0);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].event_id, '_rotated');
  assert.equal(r.events[0].profile, '_system');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('event-log.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
