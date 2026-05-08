// src/test-events-lockfile.js (new file; require it from src/test-all.js)
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { acquireLongLived, withMutex } = require('./events/lockfile');

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-lock-'));
  const lockPath = path.join(dir, 'test.lock');

  // Long-lived: first acquire works, second returns null.
  const handle1 = acquireLongLived(lockPath, { info: { test: 1 } });
  assert.ok(handle1, 'first acquire should succeed');
  const handle2 = acquireLongLived(lockPath, { info: { test: 2 } });
  assert.equal(handle2, null, 'second acquire should fail (lock held)');
  handle1.release();

  // After release, can acquire again.
  const handle3 = acquireLongLived(lockPath, { info: { test: 3 } });
  assert.ok(handle3, 'third acquire after release should succeed');
  handle3.release();

  // withMutex serializes.
  const mutexPath = path.join(dir, 'mutex.lock');
  let counter = 0;
  withMutex(mutexPath, () => { counter += 1; });
  withMutex(mutexPath, () => { counter += 1; });
  assert.equal(counter, 2);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('lockfile.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
