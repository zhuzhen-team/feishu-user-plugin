#!/usr/bin/env node
// Unit tests for the cursor-chain fixes (2026-06-07 systemic audit, follow-up
// to PR #118): clients that return hasMore without a usable resume cursor,
// tool schemas/handlers that never expose page_token, and partial-failure
// arrays silently swallowed.
//
// Covers:
//   1. read_messages / read_p2p_messages — page_token passthrough (client ready)
//   2. list_wiki_nodes — client must return pageToken; handler must pass it
//   3. manage_bitable_record(search) — same chain as 2
//   4. listWikiSpaces — internal pagination to completion (was silent 50-cap)
//   5. manage_members(add) — surface not_existed_id_list / pending_approval_id_list
'use strict';

const assert = require('assert');
const wikiClient = require('./clients/official/wiki');
const bitableClient = require('./clients/official/bitable');
const groupsClient = require('./clients/official/groups');
const imReadHandlers = require('./tools/im-read').handlers;
const wikiHandlers = require('./tools/wiki').handlers;
const bitableHandlers = require('./tools/bitable').handlers;
const groupsHandlers = require('./tools/groups').handlers;

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  OK  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

async function run() {
  console.log('=== test-pagination-cursor-chain ===');

  // --- 1. read_messages / read_p2p_messages ---

  await ok('read_messages handler passes page_token through to readMessagesWithFallback', async () => {
    let got;
    const official = {
      hasUAT: true,
      readMessagesWithFallback: async (chatId, opts) => { got = { chatId, opts }; return { items: [] }; },
    };
    const ctx = { getOfficialClient: () => official, getUserClient: async () => { throw new Error('no cookie'); } };
    await imReadHandlers.read_messages({ chat_id: 'oc_test', page_token: 'PT1' }, ctx);
    assert.strictEqual(got.chatId, 'oc_test');
    assert.strictEqual(got.opts.pageToken, 'PT1', 'page_token must reach the client as pageToken');
  });

  await ok('read_p2p_messages handler passes page_token through to readMessagesAsUser', async () => {
    let got;
    const official = {
      readMessagesAsUser: async (chatId, opts) => { got = { chatId, opts }; return { items: [] }; },
    };
    const ctx = { getOfficialClient: () => official, getUserClient: async () => { throw new Error('no cookie'); } };
    await imReadHandlers.read_p2p_messages({ chat_id: '7123456', page_token: 'PT2' }, ctx);
    assert.strictEqual(got.opts.pageToken, 'PT2');
  });

  // --- 2. list_wiki_nodes ---

  await ok('listWikiNodes client returns the resume pageToken alongside hasMore', async () => {
    const self = {
      async _asUserOrApp() {
        return { data: { items: [{ node_token: 'n1' }], has_more: true, page_token: 'WNEXT' }, _viaUser: true };
      },
    };
    const r = await wikiClient.listWikiNodes.call(self, 'sp1', {});
    assert.strictEqual(r.hasMore, true);
    assert.strictEqual(r.pageToken, 'WNEXT', 'hasMore without a cursor is a dead end');
  });

  await ok('list_wiki_nodes handler passes page_token through', async () => {
    let got;
    const ctx = {
      getOfficialClient: () => ({
        listWikiNodes: async (spaceId, opts) => { got = { spaceId, opts }; return { items: [], hasMore: false }; },
      }),
    };
    await wikiHandlers.list_wiki_nodes({ space_id: 'sp1', page_token: 'PT3' }, ctx);
    assert.strictEqual(got.opts.pageToken, 'PT3');
  });

  // --- 3. manage_bitable_record(search) ---

  await ok('searchBitableRecords client returns the resume pageToken alongside hasMore', async () => {
    const self = {
      async _asUserOrApp() {
        return { data: { items: [{ record_id: 'r1' }], total: 2000, has_more: true, page_token: 'BNEXT' }, _viaUser: true };
      },
      // legacy path uses _safeSDKCall? keep both shims so the test follows the impl
      async _safeSDKCall(fn) { return fn(); },
    };
    const r = await bitableClient.searchBitableRecords.call(self, 'app1', 'tbl1', {});
    assert.strictEqual(r.hasMore, true);
    assert.strictEqual(r.pageToken, 'BNEXT', 'hasMore + total without a cursor strands the caller at page 1');
  });

  await ok('manage_bitable_record(search) handler passes page_token through', async () => {
    let got;
    const ctx = {
      resolveDocId: async (x) => x,
      getOfficialClient: () => ({
        searchBitableRecords: async (appToken, tableId, opts) => { got = { appToken, tableId, opts }; return { items: [], hasMore: false }; },
      }),
    };
    await bitableHandlers.manage_bitable_record({ action: 'search', app_token: 'app1', table_id: 'tbl1', page_token: 'PT4' }, ctx);
    assert.strictEqual(got.opts.pageToken, 'PT4');
  });

  // --- 4. listWikiSpaces full pagination ---

  await ok('listWikiSpaces follows page_token to fetch ALL spaces past the 50/page cap', async () => {
    const calls = [];
    const self = {
      async _asUserOrApp({ query }) {
        const key = (query && query.page_token) || '';
        calls.push(key);
        if (key === '') return { data: { items: Array.from({ length: 50 }, (_, i) => ({ space_id: 's' + i })), has_more: true, page_token: 'SP2' }, _viaUser: true };
        if (key === 'SP2') return { data: { items: [{ space_id: 's50' }], has_more: false }, _viaUser: true };
        throw new Error('unexpected page_token: ' + key);
      },
    };
    const r = await wikiClient.listWikiSpaces.call(self);
    assert.strictEqual(r.items.length, 51, 'all pages concatenated');
    assert.deepStrictEqual(calls, ['', 'SP2']);
    assert.ok(!r.hasMore, 'complete fetch must not flag hasMore');
  });

  await ok('listWikiSpaces continues past a permission-filtered empty page (empty + advancing token)', async () => {
    const calls = [];
    const self = {
      async _asUserOrApp({ query }) {
        const key = (query && query.page_token) || '';
        calls.push(key);
        if (key === '') return { data: { items: [{ space_id: 's1' }], has_more: true, page_token: 'SP2' }, _viaUser: true };
        if (key === 'SP2') return { data: { items: [], has_more: true, page_token: 'SP3' }, _viaUser: true }; // filtered-empty
        if (key === 'SP3') return { data: { items: [{ space_id: 's2' }], has_more: false }, _viaUser: true };
        throw new Error('unexpected page_token: ' + key);
      },
    };
    const r = await wikiClient.listWikiSpaces.call(self);
    assert.strictEqual(r.items.length, 2, 'must page through the filtered-empty page to reach s2');
    assert.deepStrictEqual(calls, ['', 'SP2', 'SP3']);
    assert.ok(!r.hasMore, 'complete fetch must not flag hasMore');
  });

  await ok('listWikiSpaces terminates on a stalled cursor and marks cursorUnavailable', async () => {
    let n = 0;
    const self = {
      async _asUserOrApp() {
        n++;
        return { data: { items: n === 1 ? [{ space_id: 's1' }] : [], has_more: true, page_token: 'LOOP' }, _viaUser: true };
      },
    };
    const r = await wikiClient.listWikiSpaces.call(self);
    assert.ok(n <= 3, `must terminate, made ${n} calls`);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.hasMore, false, 'hasMore:true must never be returned without a resumable cursor');
    assert.strictEqual(r.truncated, true, 'incompleteness must be visible');
    assert.strictEqual(r.cursorUnavailable, true, 'caller can distinguish upstream cursor failure from complete fetch');
  });

  // --- 5. manage_members(add) partial-failure arrays ---

  await ok('addChatMembers surfaces not_existed_id_list and pending_approval_id_list', async () => {
    const self = {
      async _safeSDKCall(fn) {
        return { data: { invalid_id_list: ['bad1'], not_existed_id_list: ['ghost1'], pending_approval_id_list: ['wait1', 'wait2'] } };
      },
    };
    const r = await groupsClient.addChatMembers.call(self, 'oc_g', ['bad1', 'ghost1', 'wait1', 'wait2', 'ok1']);
    assert.deepStrictEqual(r.invalidIds, ['bad1']);
    assert.deepStrictEqual(r.notExistedIds, ['ghost1'], 'not_existed ids must not be swallowed');
    assert.deepStrictEqual(r.pendingApprovalIds, ['wait1', 'wait2'], 'pending-approval ids must not be swallowed');
  });

  await ok('manage_members(add) response names the partial failures, not a silent success', async () => {
    const ctx = {
      getOfficialClient: () => ({
        addChatMembers: async () => ({ invalidIds: [], notExistedIds: ['ghost1'], pendingApprovalIds: ['wait1'] }),
      }),
    };
    const res = await groupsHandlers.manage_members({ chat_id: 'oc_g', member_ids: ['ghost1', 'wait1', 'ok1'], action: 'add' }, ctx);
    const txt = res.content[0].text;
    assert.ok(/ghost1/.test(txt), 'not-existed id visible in response');
    assert.ok(/wait1/.test(txt), 'pending id visible in response');
    assert.ok(txt.startsWith('⚠'), `partial failure must be lifted as a top warning, not buried in JSON: ${txt.slice(0, 120)}`);
  });

  console.log(`\n=== test-pagination-cursor-chain: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-pagination-cursor-chain harness error:', e); process.exit(1); });
}

module.exports = { run };
