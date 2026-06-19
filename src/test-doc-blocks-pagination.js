#!/usr/bin/env node
// Unit tests for getDocBlocks pagination (v1.3.17) + the tool-layer plumbing
// in src/tools/docs.js (get_doc_blocks page_token/max_blocks passthrough,
// manage_doc_block failedCells warning lift, read_doc_markdown truncation note).
//
// Field report (2026-06-07): a ~300KB doc synced via manage_doc_block exceeded
// 500 blocks; get_doc_blocks and read_doc_markdown both silently stopped at the
// same mid-document position — the client fetched ONE page of 500 and ignored
// has_more/page_token, with no truncation flag for the caller.
'use strict';

const assert = require('assert');
const docs = require('./clients/official/docs');
const { handlers } = require('./tools/docs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  OK  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

// pageMap: requested page_token ('' for first call) → { items, has_more, next }
function pagedStub(pageMap) {
  const calls = [];
  const self = {
    async _asUserOrApp({ query }) {
      const key = (query && query.page_token) || '';
      calls.push(key);
      const p = pageMap[key];
      if (!p) throw new Error(`unexpected page_token: "${key}"`);
      const data = { items: p.items, has_more: !!p.has_more };
      if (p.next !== undefined) data.page_token = p.next;
      return { data, _viaUser: true };
    },
  };
  return { self, calls };
}

const blk = (id) => ({ block_id: id, block_type: 2 });

async function run() {
  console.log('=== test-doc-blocks-pagination ===');

  await ok('follows page_token to fetch ALL blocks past the 500/page cap', async () => {
    const { self, calls } = pagedStub({
      '':   { items: [blk('b1'), blk('b2')], has_more: true, next: 'p2' },
      'p2': { items: [blk('b3')], has_more: false },
    });
    const r = await docs.getDocBlocks.call(self, 'docX');
    assert.strictEqual(r.items.length, 3, 'all pages concatenated');
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.hasMore, false);
    assert.strictEqual(r.nextPageToken, undefined);
    assert.deepStrictEqual(calls, ['', 'p2'], 'second request carries the page_token');
    assert.strictEqual(r.viaUser, true);
  });

  await ok('max_blocks stops early and reports hasMore + nextPageToken + truncated', async () => {
    const { self, calls } = pagedStub({
      '':   { items: [blk('b1'), blk('b2')], has_more: true, next: 'p2' },
      'p2': { items: [blk('b3')], has_more: false },
    });
    const r = await docs.getDocBlocks.call(self, 'docX', { maxBlocks: 2 });
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.hasMore, true);
    assert.strictEqual(r.truncated, true);
    assert.strictEqual(r.nextPageToken, 'p2');
    assert.strictEqual(calls.length, 1, 'no extra page fetched past max_blocks');
  });

  await ok('treats malformed max_blocks (0 / negative / string) as "no cap" — full fetch, no truncation', async () => {
    for (const bad of [0, -5, 'abc', NaN]) {
      const { self } = pagedStub({
        '':   { items: [blk('b1'), blk('b2')], has_more: true, next: 'p2' },
        'p2': { items: [blk('b3')], has_more: false },
      });
      const r = await docs.getDocBlocks.call(self, 'docX', { maxBlocks: bad });
      assert.strictEqual(r.items.length, 3, `maxBlocks=${bad} must not cap the fetch`);
      assert.strictEqual(r.hasMore, false, `maxBlocks=${bad} must not flag truncation`);
    }
  });

  await ok('resumes from a caller-provided pageToken', async () => {
    const { self, calls } = pagedStub({
      'p2': { items: [blk('b3')], has_more: false },
    });
    const r = await docs.getDocBlocks.call(self, 'docX', { pageToken: 'p2' });
    assert.deepStrictEqual(calls, ['p2']);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.hasMore, false);
  });

  await ok('continues past a permission-filtered empty page (empty + ADVANCING token is not a stall)', async () => {
    // Feishu documents that paginated endpoints may return an empty page with
    // has_more:true (permission filtering) and the caller should keep paging.
    // An empty page must NOT end the loop when the cursor is still advancing.
    const { self, calls } = pagedStub({
      '':   { items: [blk('b1')], has_more: true, next: 'p2' },
      'p2': { items: [], has_more: true, next: 'p3' }, // filtered-empty, real data behind it
      'p3': { items: [blk('b2')], has_more: false },
    });
    const r = await docs.getDocBlocks.call(self, 'docX');
    assert.strictEqual(r.items.length, 2, 'must fetch the data behind the empty page');
    assert.strictEqual(r.hasMore, false);
    assert.deepStrictEqual(calls, ['', 'p2', 'p3']);
  });

  await ok('terminates on a stalled cursor (empty page, has_more, same token) and marks cursorUnavailable', async () => {
    const { self, calls } = pagedStub({
      '':   { items: [blk('b1')], has_more: true, next: 'p1' },
      'p1': { items: [], has_more: true, next: 'p1' }, // server stall — would loop forever
    });
    const r = await docs.getDocBlocks.call(self, 'docX');
    assert.ok(calls.length <= 3, `must terminate, made ${calls.length} calls`);
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.hasMore, false, 'hasMore:true must never be returned without a resumable cursor');
    assert.strictEqual(r.truncated, true, 'incompleteness is still reported');
    assert.strictEqual(r.cursorUnavailable, true, 'caller can distinguish upstream cursor failure from complete fetch');
    assert.strictEqual(r.nextPageToken, undefined, 'stalled cursor is withheld (PR #116 parity)');
  });

  await ok('get_doc_blocks handler passes page_token/max_blocks through to the client', async () => {
    let got;
    const ctx = {
      resolveDocId: async (x) => x,
      getOfficialClient: () => ({
        getDocBlocks: async (id, opts) => { got = { id, opts }; return { items: [], total: 0, hasMore: false }; },
      }),
    };
    await handlers.get_doc_blocks({ document_id: 'd', page_token: 'pX', max_blocks: 100 }, ctx);
    assert.strictEqual(got.id, 'd');
    assert.strictEqual(got.opts.pageToken, 'pX');
    assert.strictEqual(got.opts.maxBlocks, 100);
  });

  await ok('manage_doc_block lifts a top warning when the table fill partially failed', async () => {
    const ctx = {
      resolveDocId: async (x) => x,
      getOfficialClient: () => ({
        createDocTable: async () => ({
          tableBlockId: 'tbl1', cells: [['c0', 'c1']], rows: 1, columns: 2, filled: 1,
          failedCells: [{ row: 0, col: 1, cellId: 'c1', textBlockId: 't-c1', reason: 'code=2200 …' }],
          viaUser: true, fallbackWarning: null,
        }),
      }),
    };
    const res = await handlers.manage_doc_block({
      action: 'create', document_id: 'd', parent_block_id: 'd',
      table: { rows: 1, columns: 2, cells: [['A', 'B']] },
    }, ctx);
    const txt = res.content[0].text;
    assert.ok(txt.startsWith('⚠'), `warning lifted to top: ${txt.slice(0, 80)}`);
    assert.ok(/1\/2/.test(txt), 'warning names the failed/attempted ratio');
    assert.ok(/failedCells/.test(txt), 'warning points at failedCells[]');
    assert.ok(/"failedCells"/.test(txt), 'JSON body still carries failedCells');
  });

  await ok('read_doc_markdown appends a truncation note when blocks are incomplete', async () => {
    try { require.resolve('feishu-docx'); } catch (_) {
      console.log('       (feishu-docx not installed — skipping render assertion)');
      return;
    }
    const fixturePath = require('path').join(__dirname, 'test-fixtures', 'doc-blocks', 'sample-1.json');
    if (!require('fs').existsSync(fixturePath)) {
      console.log('       (no fixture — skipping render assertion)');
      return;
    }
    const blocks = JSON.parse(require('fs').readFileSync(fixturePath, 'utf8'));
    const ctx = {
      resolveDocId: async (x) => x,
      getOfficialClient: () => ({
        getDocBlocks: async () => ({ items: blocks, total: 2, hasMore: true }),
      }),
    };
    const res = await handlers.read_doc_markdown({ document_id: 'd' }, ctx);
    const md = res.content[0].text;
    assert.ok(/truncated/i.test(md), `markdown output must flag incompleteness: ${md.slice(-120)}`);
  });

  console.log(`\n=== test-doc-blocks-pagination: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-doc-blocks-pagination harness error:', e); process.exit(1); });
}

module.exports = { run };
