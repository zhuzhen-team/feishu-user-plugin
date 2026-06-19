// src/test-events-concurrency.js
//
// Regression tests for the v1.3.17 events single-owner concurrency fixes:
//   - acquireLongLived heartbeat() must detect a force-steal (rename + recreate
//     under a new owner), not just a vanished file — else the old owner keeps
//     writing as a phantom second writer.
//   - release() must only unlink OUR lock, never a successor's.
//   - cursor.rotateUnderLock runs the rotate + cursor reset atomically under the
//     same mutex drains take.
//
// Pure unit test — temp files, no network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireLongLived } = require('./events/lockfile');
const cursor = require('./events/cursor');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = (n, fn) => {
    try { fn(); pass++; console.log('  PASS', n); }
    catch (e) { fail++; console.error('  FAIL', n, '—', e.message); }
  };

  const dir = path.join(os.tmpdir(), `fup-conc-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const lockPath = path.join(dir, 'ws-owner.lock');

    check('heartbeat() true while we still own the lock', () => {
      const h = acquireLongLived(lockPath, { staleMs: 60_000 });
      assert.ok(h, 'should acquire');
      assert.equal(h.heartbeat(), true);
      h.release();
    });

    check('heartbeat() detects a force-steal (recreated under a different token)', () => {
      const h = acquireLongLived(lockPath, { staleMs: 60_000 });
      assert.ok(h);
      assert.equal(h.heartbeat(), true);
      // Simulate a peer force-steal: rename our lock away, recreate with a
      // different owner token (what tryClaim force + acquireLongLived would do).
      fs.renameSync(lockPath, lockPath + '.forced');
      fs.writeFileSync(lockPath, JSON.stringify({ version: 1, pid: 999999, ownerToken: 'a-different-owner' }));
      assert.equal(h.heartbeat(), false, 'old owner must detect it lost the lock');
      // And releasing the OLD handle must NOT delete the successor's lock.
      h.release();
      assert.ok(fs.existsSync(lockPath), 'release() must not delete the successor lock');
      fs.unlinkSync(lockPath);
    });

    check('heartbeat() false when the lock file vanishes', () => {
      const h = acquireLongLived(lockPath, { staleMs: 60_000 });
      assert.ok(h);
      fs.unlinkSync(lockPath);
      assert.equal(h.heartbeat(), false);
    });

    // rotateUnderLock atomic rotate + reset
    const logPath = path.join(dir, 'events.jsonl');
    fs.writeFileSync(logPath, '{"event_id":"a"}\n{"event_id":"b"}\n');
    cursor.resetCursorTo(dir, 5);
    check('rotateUnderLock resets cursor to 0 when doRotate returns resetCursor:true', () => {
      let saw = null;
      const r = cursor.rotateUnderLock(dir, ({ cursorOffset, fileSize }) => {
        saw = { cursorOffset, fileSize };
        return { resetCursor: true };
      });
      assert.ok(saw && typeof saw.cursorOffset === 'number', 'doRotate receives cursorOffset/fileSize');
      assert.equal(r.resetCursor, true);
      assert.equal(cursor.readSnapshot(dir).cursor.offset, 0, 'cursor reset to 0 under the lock');
    });
    check('rotateUnderLock leaves cursor untouched when resetCursor:false', () => {
      cursor.resetCursorTo(dir, 7);
      cursor.rotateUnderLock(dir, () => ({ resetCursor: false }));
      assert.equal(cursor.readSnapshot(dir).cursor.offset, 7);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\nevents-concurrency: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`events-concurrency: ${fail} check(s) failed`);
  console.log('events-concurrency.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
