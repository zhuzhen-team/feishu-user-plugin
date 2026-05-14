// src/test-populate-sender-names.js — verify _populateSenderNames now reads
// Promise.allSettled results instead of discarding them.
//
// Pre-v1.3.12 bug: base.js used `await Promise.allSettled([...]map(getUserById))`
// without reading result.status — every failed contact lookup vanished into
// the void. We track failedIds and log a single stderr line per call so
// long-running diagnosis can grep for "[populate_sender_names]".

'use strict';

const assert = require('node:assert/strict');
const { LarkOfficialClient } = require('./clients/official');

function captureStderr(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  return Promise.resolve(fn()).finally(() => { console.error = original; });
}

async function run() {
  const c = new LarkOfficialClient('cli_test', 'fake_secret');

  // Stub network probes — _resolveSelfTenantKey hits Feishu via fetchWithTimeout,
  // we don't want that in a unit test.
  c._resolveSelfTenantKey = async () => 'tenant_self';
  c._selfTenantKey = 'tenant_self';

  // --- Case 1: all lookups succeed → no stderr complaint ---
  c.getUserById = async (id) => {
    c._userNameCache.set(id, `user_${id.slice(-2)}`);
  };
  c.getAppName = async () => null;

  let stderrLines;
  stderrLines = [];
  await captureStderr(async () => {
    const items = [
      { senderId: 'ou_aa', senderType: 'user' },
      { senderId: 'ou_bb', senderType: 'user' },
    ];
    await c._populateSenderNames(items, null);
    assert.equal(items[0].senderName, 'user_aa');
    assert.equal(items[1].senderName, 'user_bb');
  }).then(() => null).catch(e => stderrLines.push(`THREW ${e.message}`));

  // --- Case 2: one lookup throws → failedIds logged once ---
  c._userNameCache.clear();
  c.getUserById = async (id) => {
    if (id === 'ou_bad') throw new Error('contact api 70009');
    c._userNameCache.set(id, `user_${id.slice(-2)}`);
  };
  const captured = [];
  const originalErr = console.error;
  console.error = (...args) => captured.push(args.join(' '));
  try {
    const items = [
      { senderId: 'ou_aa', senderType: 'user' },
      { senderId: 'ou_bad', senderType: 'user' },
    ];
    await c._populateSenderNames(items, null);
    assert.equal(items[0].senderName, 'user_aa');
    assert.equal(items[1].senderName, null, 'failed lookup leaves senderName null');
    assert.equal(items[1].displayLabel, '(ou_bad)', 'displayLabel uses raw id fallback');
  } finally {
    console.error = originalErr;
  }
  const failedLog = captured.find(l => l.includes('[feishu-user-plugin]') && l.includes('sender name lookup'));
  assert.ok(failedLog, 'should log a failed-lookup line to stderr');
  assert.ok(failedLog.includes('ou_bad'), 'failed log should name the failing open_id');

  // --- Case 3: app name lookup fails → logged with kind=app ---
  c._appNameCache.clear();
  c.getUserById = async (id) => { c._userNameCache.set(id, `u_${id.slice(-2)}`); };
  c.getAppName = async (id) => {
    if (id === 'cli_bad') throw new Error('99991672');
    return null;
  };
  const appCaptured = [];
  console.error = (...args) => appCaptured.push(args.join(' '));
  try {
    const items = [
      { senderId: 'cli_bad', senderType: 'app' },
    ];
    await c._populateSenderNames(items, null);
    assert.equal(items[0].displayLabel, '[Bot] (cli_bad)');
  } finally {
    console.error = originalErr;
  }
  const appLog = appCaptured.find(l => l.includes('app name lookup') || (l.includes('sender name lookup') && l.includes('cli_bad')));
  assert.ok(appLog, 'should log a failed app name lookup');
  assert.ok(appLog.includes('cli_bad'));

  console.log('populate-sender-names.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
