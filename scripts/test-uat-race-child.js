// Child worker for test-uat-race.js. Acquires the UAT refresh lock, holds
// for a brief window (simulating the refresh + persist), then releases.
// Writes a single line to stdout: "<id> acquired <ts_ms>; released <ts_ms>"
//
// v1.3.14 — rewritten to use module-level uat.js API. Pre-v1.3.14 this called
// `client._uatLockPath()` etc, which no longer existed after v1.3.7 extracted
// lifecycle into src/auth/uat.js — the test was silently broken for months.

const { uatLockPath, acquireRefreshLock, releaseRefreshLock } = require('../src/auth/uat');

const id = process.argv[2] || '?';
const holdMs = parseInt(process.argv[3] || '250');

const lockPath = uatLockPath();

(async () => {
  const got = await acquireRefreshLock(lockPath, { timeoutMs: 15000 });
  if (!got) {
    console.log(`${id} FAILED_TO_ACQUIRE`);
    process.exit(1);
  }
  const acquired = Date.now();
  await new Promise(r => setTimeout(r, holdMs));
  const released = Date.now();
  releaseRefreshLock(lockPath);
  console.log(`${id} acquired ${acquired}; released ${released}`);
})().catch(e => { console.log(`${id} ERROR ${e.message}`); process.exit(1); });
