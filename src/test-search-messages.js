// src/test-search-messages.js — fixture test for v1.3.12 search_messages.
//
// search_messages wraps POST /open-apis/search/v2/message (UAT-only).
// Live calls require the `search:message` scope; this test mocks
// _uatREST directly to verify request shape + response handling +
// error classification without a real Feishu round-trip.

'use strict';

const assert = require('node:assert/strict');
const { LarkOfficialClient } = require('./clients/official');

async function run() {
  const c = new LarkOfficialClient('cli_test', 'fake_secret');
  // Make hasUAT truthy so the early-throw doesn't fire.
  c._uat = 'fake_uat';
  c._uatRefresh = 'fake_refresh';
  c._uatExpires = Math.floor(Date.now() / 1000) + 3600;

  // --- 1. happy path: returns items + pageToken + hasMore ---
  c._uatREST = async (method, path, opts) => {
    assert.equal(method, 'POST');
    assert.equal(path, '/open-apis/search/v2/message');
    assert.equal(opts.body.query, 'hello');
    return {
      code: 0,
      data: {
        items: [
          { message_id: 'om_a', chat_id: 'oc_x' },
          { message_id: 'om_b', chat_id: 'oc_y' },
        ],
        page_token: 'next_xyz',
        has_more: true,
      },
    };
  };
  let result = await c.searchMessages({ query: 'hello', pageSize: 10 });
  assert.equal(result.items.length, 2);
  assert.equal(result.pageToken, 'next_xyz');
  assert.equal(result.hasMore, true);

  // --- 2. filter knobs propagate into body ---
  let captured;
  c._uatREST = async (method, path, opts) => {
    captured = opts.body;
    return { code: 0, data: { items: [], page_token: null, has_more: false } };
  };
  await c.searchMessages({
    query: 'q',
    chatIds: ['oc_a', 'oc_b'],
    fromIds: ['ou_x'],
    atUserIds: ['ou_at'],
    messageTypes: ['text', 'post'],
    fromTypes: ['user'],
  });
  assert.deepEqual(captured.chat_ids, ['oc_a', 'oc_b']);
  assert.deepEqual(captured.from_ids, ['ou_x']);
  assert.deepEqual(captured.at_chatter_ids, ['ou_at']);
  assert.deepEqual(captured.message_type_list, ['text', 'post']);
  assert.deepEqual(captured.from_types, ['user']);

  // --- 3. 99991679 → throws with scope guidance ---
  c._uatREST = async () => ({ code: 99991679, msg: 'Unauthorized. required: search:message' });
  let threw;
  try { await c.searchMessages({ query: 'x' }); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.ok(threw.message.includes('search:message'));
  assert.ok(threw.message.includes('npx feishu-user-plugin oauth'));

  // --- 4. other non-zero code → wrapped throw ---
  c._uatREST = async () => ({ code: 42101, msg: 'rate limited' });
  threw = undefined;
  try { await c.searchMessages({ query: 'x' }); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.ok(threw.message.includes('42101'));

  // --- 5. missing query → input error before any API call ---
  c._uatREST = async () => { throw new Error('should not be called'); };
  threw = undefined;
  try { await c.searchMessages({}); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.ok(threw.message.includes('query'));

  // --- 6. no UAT → throws with oauth pointer ---
  const c2 = new LarkOfficialClient('cli_test', 'fake_secret');
  // hasUAT will be false (no _uat).
  threw = undefined;
  try { await c2.searchMessages({ query: 'x' }); }
  catch (e) { threw = e; }
  assert.ok(threw);
  assert.ok(threw.message.includes('UAT'));
  assert.ok(threw.message.includes('npx feishu-user-plugin oauth'));

  console.log('search-messages.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
