// src/test-events-per-profile-cursor.js
//
// Regression test for the get_new_events cross-profile data-loss residual:
// each profile must drain its OWN cursor, so one profile polling can't advance
// a shared cursor past another profile's unread events. _system events are
// delivered to every profile.
//
// Pure unit test — temp events.jsonl, no network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendEvent } = require('./events/event-log');
const { drain, resetCursorTo } = require('./events/cursor');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = (n, fn) => {
    try { fn(); pass++; console.log('  PASS', n); }
    catch (e) { fail++; console.error('  FAIL', n, '—', e.message); }
  };

  const dir = path.join(os.tmpdir(), `fup-ppc-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, 'events.jsonl');
  try {
    // Interleaved profiles + one system event.
    for (const e of [
      { profile: 'pA', event_id: 'a1' },
      { profile: 'pB', event_id: 'b1' },
      { profile: 'pA', event_id: 'a2' },
      { profile: '_system', event_id: 's1' },
      { profile: 'pB', event_id: 'b2' },
    ]) appendEvent(logPath, e);

    // Init both profile cursors at 0 (fresh cursors default to EOF).
    resetCursorTo(dir, 0, 'pA');
    resetCursorTo(dir, 0, 'pB');

    const ids = (r) => r.events.map((e) => e.event_id);

    check('pA drains its own events + _system (skips pB)', () => {
      const r = drain(dir, { profile: 'pA' });
      assert.deepEqual(ids(r), ['a1', 'a2', 's1'], JSON.stringify(ids(r)));
    });
    check('pB still sees ALL its events + _system (not stranded by pA draining first)', () => {
      const r = drain(dir, { profile: 'pB' });
      assert.deepEqual(ids(r), ['b1', 's1', 'b2'], JSON.stringify(ids(r)));
    });
    check('pA re-drain returns nothing new (its cursor is at EOF)', () => {
      const r = drain(dir, { profile: 'pA' });
      assert.deepEqual(ids(r), []);
    });
    check('pB re-drain returns nothing new', () => {
      const r = drain(dir, { profile: 'pB' });
      assert.deepEqual(ids(r), []);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nevents-per-profile-cursor: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`events-per-profile-cursor: ${fail} check(s) failed`);
  console.log('events-per-profile-cursor.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
