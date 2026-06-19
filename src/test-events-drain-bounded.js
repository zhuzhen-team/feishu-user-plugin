// src/test-events-drain-bounded.js
//
// Regression test for the get_new_events data-loss HIGH finding (v1.3.17 health
// check): drain() used to advance the global cursor to EOF, so any caller that
// capped its result permanently lost every event past the cap. drain() now
// consumes at most maxEvents and the cursor advances only past what it returned,
// so a capped tail stays pending and is delivered on the next call — exactly
// once, in order, with zero loss.
//
// Pure unit test against a temp events.jsonl — no network, no live API.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendEvent, readFrom } = require('./events/event-log');
const { drain, readSnapshot, resetCursorTo } = require('./events/cursor');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = (name, fn) => {
    try { fn(); pass++; console.log('  PASS', name); }
    catch (e) { fail++; console.error('  FAIL', name, '—', e.message); }
  };

  const dir = path.join(os.tmpdir(), `fup-drain-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'events.jsonl');
  try {
    for (let i = 1; i <= 5; i++) {
      appendEvent(logPath, { event_id: `e${i}`, ts: i, profile: 'default', payload: { n: i } });
    }
    // A fresh cursor defaults to EOF (intentional: don't replay backlog on first
    // attach). Point it at the start so the test exercises draining real events.
    resetCursorTo(dir, 0);

    // readFrom honours maxEvents and stops at the line boundary.
    check('readFrom(maxEvents:2) returns 2 events + capped + bounded nextOffset', () => {
      const r = readFrom(logPath, 0, { maxEvents: 2 });
      assert.equal(r.events.length, 2, 'expected 2 events');
      assert.equal(r.events[0].event_id, 'e1');
      assert.equal(r.events[1].event_id, 'e2');
      assert.equal(r.capped, true, 'expected capped=true (more pending)');
      assert.ok(r.nextOffset > 0 && r.nextOffset < r.fileSize, 'nextOffset must stop before EOF');
    });

    // Drain in batches of 2 — collect everything, assert exactly-once + order.
    const collected = [];
    const batchCaps = [];
    for (let i = 0; i < 5; i++) {
      const r = drain(dir, { maxEvents: 2 });
      collected.push(...r.events.map((e) => e.event_id));
      batchCaps.push(r.capped);
      if (r.events.length === 0) break;
    }

    check('every event delivered exactly once, in order, none lost', () => {
      assert.deepEqual(collected, ['e1', 'e2', 'e3', 'e4', 'e5'], 'got: ' + JSON.stringify(collected));
    });
    check('first two batches report capped=true, last reports capped=false', () => {
      assert.equal(batchCaps[0], true, 'batch1 capped');
      assert.equal(batchCaps[1], true, 'batch2 capped');
      assert.equal(batchCaps[2], false, 'batch3 not capped (drains the remainder)');
    });
    check('cursor is fully drained at EOF after consuming all events', () => {
      const snap = readSnapshot(dir);
      assert.equal(snap.pending, 0, 'no pending bytes left');
    });
    check('a further drain returns nothing and is not capped', () => {
      const r = drain(dir, { maxEvents: 2 });
      assert.equal(r.events.length, 0);
      assert.equal(r.capped, false);
    });

    // Counter-check: a single bounded drain must NOT jump the cursor to EOF
    // (that was the bug — it left pending=0 after one capped read).
    const dir2 = path.join(os.tmpdir(), `fup-drain-test2-${process.pid}-${Date.now()}`);
    fs.mkdirSync(dir2, { recursive: true });
    const logPath2 = path.join(dir2, 'events.jsonl');
    for (let i = 1; i <= 5; i++) appendEvent(logPath2, { event_id: `x${i}`, ts: i, profile: 'default' });
    resetCursorTo(dir2, 0);
    check('one capped drain leaves the tail pending (no jump-to-EOF data loss)', () => {
      const r = drain(dir2, { maxEvents: 2 });
      assert.equal(r.events.length, 2);
      const snap = readSnapshot(dir2);
      assert.ok(snap.pending > 0, 'tail must remain pending after a capped drain, got pending=' + snap.pending);
    });
    fs.rmSync(dir2, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nevents-drain-bounded: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`events-drain-bounded: ${fail} check(s) failed`);
  console.log('events-drain-bounded.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
