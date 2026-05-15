// src/test-negative-cache.js — verify _populateSenderNames writes a null
// sentinel for un-resolvable open_ids so repeated read_messages calls
// don't re-fire the same contact API request.
//
// Pre-fix bug: contacts.js::getUserById returned null on failure without
// writing to _userNameCache, so every subsequent _populateSenderNames
// invocation re-added the same id to unknownUserIds and dispatched another
// API call. In a hot chat with N un-resolvable senders that's N redundant
// API calls per read_messages — observed in the 2026-05 incident's stderr.
//
// Fix lives in _populateSenderNames itself (not in contacts.js): after each
// Promise.allSettled batch, ids still absent from _userNameCache get a null
// sentinel written. has(id)==true / get(id)==null on next call → the loop
// skips the id entirely, _computeDisplayLabel falls back to "(open_id)"
// the same way it would have without a cache.

'use strict';

const assert = require('node:assert/strict');
const { LarkOfficialClient } = require('./clients/official');

async function run() {
  const c = new LarkOfficialClient('cli_test', 'fake_secret');
  // Stub self tenant probe so the real one doesn't hit Feishu.
  c._resolveSelfTenantKey = async () => 'tenant_self';
  c._selfTenantKey = 'tenant_self';

  // Mock getUserById to simulate a un-resolvable user: cache nothing,
  // return null. The fix in _populateSenderNames is what should write the
  // null sentinel afterwards.
  let userCallCount = 0;
  c.getUserById = async (userId) => {
    if (c._userNameCache.has(userId)) return c._userNameCache.get(userId);
    userCallCount++;
    return null;
  };

  // Same for getAppName.
  let appCallCount = 0;
  c.getAppName = async (appId) => {
    if (c._appNameCache.has(appId)) return c._appNameCache.get(appId);
    appCallCount++;
    return null;
  };

  // --- 1. User negative-cache: un-resolvable ou_bad ---
  const items1 = [{ senderId: 'ou_bad', senderType: 'user' }];
  await c._populateSenderNames(items1, null);
  assert.equal(userCallCount, 1, 'first populate dispatches one API call');
  assert.equal(items1[0].senderName, null);
  assert.equal(items1[0].displayLabel, '(ou_bad)');

  // Cache must now hold a null sentinel.
  assert.equal(c._userNameCache.has('ou_bad'), true, 'null sentinel written for un-resolvable id');
  assert.equal(c._userNameCache.get('ou_bad'), null);

  // --- 2. Same id, second populate → cache hit, no new API call ---
  const items2 = [{ senderId: 'ou_bad', senderType: 'user' }];
  await c._populateSenderNames(items2, null);
  assert.equal(userCallCount, 1, 'cached null skips dispatch');
  assert.equal(items2[0].displayLabel, '(ou_bad)');

  // --- 3. Mixed batch: new id triggers exactly one new call ---
  const items3 = [
    { senderId: 'ou_bad', senderType: 'user' },
    { senderId: 'ou_new', senderType: 'user' },
  ];
  await c._populateSenderNames(items3, null);
  assert.equal(userCallCount, 2, 'new id alone dispatches one new call');

  // --- 4. App negative-cache: un-resolvable cli_bad ---
  const items4 = [{ senderId: 'cli_bad', senderType: 'app' }];
  await c._populateSenderNames(items4, null);
  assert.equal(appCallCount, 1);
  assert.equal(items4[0].displayLabel, '[Bot] (cli_bad)');

  const items5 = [{ senderId: 'cli_bad', senderType: 'app' }];
  await c._populateSenderNames(items5, null);
  assert.equal(appCallCount, 1, 'cached null app skips dispatch');

  console.log('negative-cache.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
