// src/test-lockfile-pid.js — verify acquireLongLived's v1.3.12 PID
// liveness check.
//
// Pre-v1.3.12 the lock was judged "alive" purely by mtime: heartbeat every
// 15s, stale after 60s. If the owner process got SIGKILL'd (or crashed
// mid-heartbeat), the lock looked alive for up to 60s. With the WS event
// subscription tied to the lock, a hung owner blocked event ingestion for
// the entire window.
//
// New behaviour: when stat says mtime is fresh, ALSO read the lock body and
// `process.kill(pid, 0)`. If ESRCH → process is gone, lock is steal-eligible
// immediately regardless of mtime.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { acquireLongLived } = require('./events/lockfile');

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-pid-lock-'));
  const lockPath = path.join(dir, 'test.lock');

  // --- 1. Write a lock body for a pid that definitely doesn't exist.
  //        PID 1 is init/launchd — always exists; we need a pid that's
  //        certainly gone. Use a huge integer well outside the kernel's
  //        normal range; the most portable check is process.kill(pid, 0).
  const fakePid = 999_999_999;
  const body = JSON.stringify({ version: 1, pid: fakePid, start_time: Math.floor(Date.now() / 1000), role: 'test_dead_owner' });
  fs.writeFileSync(lockPath, body, { mode: 0o600 });
  // Fresh mtime — pre-v1.3.12 this would block acquisition for 60s.
  fs.utimesSync(lockPath, new Date(), new Date());

  const handle = acquireLongLived(lockPath, { info: { role: 'new_owner' }, staleMs: 60_000 });
  assert.ok(handle, 'should be able to steal lock when holder pid is dead, even when mtime is fresh');

  // Read body — should now contain THIS process's pid.
  const newBody = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(newBody.pid, process.pid);

  handle.release();

  // --- 2. Live pid (this process) prevents acquisition even past staleMs
  //        when content shows we're still alive — but for safety we treat
  //        EPERM (different user, can't probe) as alive too. Skip EPERM
  //        case since it requires multi-user setup.
  const livePid = process.pid;
  const liveBody = JSON.stringify({ version: 1, pid: livePid, start_time: Math.floor(Date.now() / 1000), role: 'live_owner' });
  fs.writeFileSync(lockPath, liveBody, { mode: 0o600 });
  fs.utimesSync(lockPath, new Date(), new Date());
  const blocked = acquireLongLived(lockPath, { info: {}, staleMs: 60_000 });
  assert.equal(blocked, null, 'live pid + fresh mtime → cannot steal');
  fs.unlinkSync(lockPath); // cleanup

  // --- 3. Stale mtime + live pid: previously would have stolen; new behaviour
  //        keeps the steal because mtime says heartbeat is dead.
  //        (We don't try to second-guess a stuck process — mtime is the
  //        primary signal; PID check only adds the ability to reclaim
  //        FASTER when process is definitively dead.)
  fs.writeFileSync(lockPath, JSON.stringify({ version: 1, pid: livePid, start_time: Math.floor(Date.now() / 1000) - 999 }), { mode: 0o600 });
  // Backdate mtime well past staleMs.
  const backdate = new Date(Date.now() - 120_000);
  fs.utimesSync(lockPath, backdate, backdate);
  const stolenLive = acquireLongLived(lockPath, { info: {}, staleMs: 60_000 });
  assert.ok(stolenLive, 'stale mtime should still allow takeover (back-compat)');
  stolenLive.release();

  // --- 4. Body missing pid field (legacy locks from older versions) — fall
  //        back to mtime-only check (existing behaviour, no regression).
  fs.writeFileSync(lockPath, JSON.stringify({ version: 1 }), { mode: 0o600 });
  fs.utimesSync(lockPath, new Date(), new Date());
  const noPidBlocked = acquireLongLived(lockPath, { info: {}, staleMs: 60_000 });
  assert.equal(noPidBlocked, null, 'no pid in body → fall back to mtime, fresh mtime blocks');
  fs.unlinkSync(lockPath);

  // --- 5. Malformed lock body (not JSON) — mtime-only fallback.
  fs.writeFileSync(lockPath, 'not json at all', { mode: 0o600 });
  fs.utimesSync(lockPath, new Date(), new Date());
  const malformedBlocked = acquireLongLived(lockPath, { info: {}, staleMs: 60_000 });
  assert.equal(malformedBlocked, null, 'malformed body → fall back to mtime, fresh mtime blocks');
  fs.unlinkSync(lockPath);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('lockfile-pid.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
