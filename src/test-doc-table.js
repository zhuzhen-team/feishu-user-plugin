#!/usr/bin/env node
// Unit tests for createDocTable (manage_doc_block create mode F — tables).
//
// Guards the payload contract (block_type=31 table, row_size/column_size), the
// cell-fill behaviour (UPDATE an existing auto-created text block — no stray
// empty blocks — else CREATE one), and the fail-loud behaviour when the table's
// cells cannot be resolved (so large docs never silently drop content). Pure
// unit: the client methods (_asUserOrApp / getBlockChildren / updateDocBlock /
// createDocBlock) are stubbed, so no network. End-to-end behaviour is verified
// separately against live Feishu (create doc → table → read back → delete).
'use strict';

const assert = require('assert');
const docs = require('./clients/official/docs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  OK  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

// Build a stubbed `this` for createDocTable.
//   cellIds          — the table's cells (row-major)
//   cellsInCreate    — true: create response carries cell ids; false: forces a
//                      scoped getBlockChildren(table) lookup
//   cellHasText      — true: each cell already has an auto text block (UPDATE);
//                      false: empty cell (CREATE)
//   resolvableCells  — cell ids that getBlockChildren(table) will return (defaults
//                      to cellIds); set shorter to exercise fail-loud
//   updateFails      — optional (blockId, attemptNo) => Error|null; attemptNo is
//                      1-based per block. Lets tests inject transient/persistent
//                      cell-fill failures (the 2026-06-07 mode-F field report).
function stub({ cellIds, cellsInCreate = true, cellHasText = true, resolvableCells, updateFails } = {}) {
  const calls = { createBody: null, updates: [], creates: [], childFetches: [], updateAttempts: {} };
  const self = {
    async _asUserOrApp({ body }) {
      calls.createBody = body;
      const tbl = { block_id: 'tbl1' };
      if (cellsInCreate) tbl.children = cellIds;
      return { data: { children: [tbl] }, _viaUser: true, _fallbackWarning: null };
    },
    async getBlockChildren(documentId, blockId) {
      calls.childFetches.push(blockId);
      if (blockId === 'tbl1') {
        const ids = resolvableCells || cellIds;
        return { items: ids.map(id => ({ block_id: id, block_type: 32 })) };
      }
      // a cell → its auto text block (or none)
      return { items: cellHasText ? [{ block_id: 't-' + blockId, block_type: 2 }] : [] };
    },
    async updateDocBlock(documentId, blockId, body) {
      calls.updateAttempts[blockId] = (calls.updateAttempts[blockId] || 0) + 1;
      if (updateFails) {
        const err = updateFails(blockId, calls.updateAttempts[blockId]);
        if (err) throw err;
      }
      calls.updates.push({ blockId, body });
      return { block: {} };
    },
    async createDocBlock(documentId, parent, children) { calls.creates.push({ parent, children }); return { blocks: [] }; },
  };
  return { self, calls };
}

// Production both-identities failure messages, verbatim shape from
// identity-state.js::withIdentityFallback — classifyError extracts the FIRST
// `code=` occurrence (the UAT-side code).
const TRANSIENT_BOTH = () => new Error(
  'updateDocBlock failed on both identities. as user: code=2200 msg=check incr user_access_token scope fail. as app: updateDocBlock failed (HTTP 403, code=1770032): forBidden',
);
const PERMANENT_BOTH = () => new Error(
  'updateDocBlock failed on both identities. as user: code=99991668 msg=access denied. as app: updateDocBlock failed (HTTP 403, code=1770032): forBidden',
);

async function run() {
  console.log('=== test-doc-table ===');

  await ok('builds block_type=31 payload + fills by UPDATEing each cell\'s existing text (no stray blocks)', async () => {
    const { self, calls } = stub({ cellIds: ['c00', 'c01', 'c10', 'c11'], cellsInCreate: true, cellHasText: true });
    const r = await docs.createDocTable.call(self, 'docX', 'docX', { rows: 2, columns: 2, cells: [['A', 'B'], ['C', 'D']] });
    const tableBody = calls.createBody.children[0];
    assert.strictEqual(tableBody.block_type, 31, 'table block_type must be 31 (not 40)');
    assert.strictEqual(tableBody.table.property.row_size, 2);
    assert.strictEqual(tableBody.table.property.column_size, 2);
    assert.deepStrictEqual(r.cells, [['c00', 'c01'], ['c10', 'c11']], 'cells mapped row-major');
    assert.strictEqual(r.filled, 4);
    assert.strictEqual(calls.updates.length, 4, 'should UPDATE 4 existing cell text blocks');
    assert.strictEqual(calls.creates.length, 0, 'should NOT create extra blocks when the cell already has a text block');
    assert.strictEqual(calls.updates[0].body.update_text_elements.elements[0].text_run.content, 'A');
    assert.strictEqual(r.viaUser, true);
  });

  await ok('CREATEs a text block when a cell has no auto text block', async () => {
    const { self, calls } = stub({ cellIds: ['c0', 'c1'], cellsInCreate: true, cellHasText: false });
    const r = await docs.createDocTable.call(self, 'd', 'd', { rows: 1, columns: 2, cells: [['X', 'Y']] });
    assert.strictEqual(r.filled, 2);
    assert.strictEqual(calls.creates.length, 2, 'should CREATE a text block in each empty cell');
    assert.strictEqual(calls.updates.length, 0);
    assert.strictEqual(calls.creates[0].children[0].block_type, 2, 'created child is a text block');
  });

  await ok('resolves cells via scoped getBlockChildren when the create response lacks them', async () => {
    const { self, calls } = stub({ cellIds: ['c0', 'c1'], cellsInCreate: false, cellHasText: true });
    const r = await docs.createDocTable.call(self, 'd', 'd', { rows: 1, columns: 2, cells: [['X', 'Y']] });
    assert.deepStrictEqual(r.cells, [['c0', 'c1']]);
    assert.strictEqual(r.filled, 2);
    assert.ok(calls.childFetches.includes('tbl1'), 'should scope-fetch the table block children when create response lacks cells');
  });

  await ok('fails loud (throws) when cells cannot be fully resolved — never silently drops content', async () => {
    // create response lacks cells AND scoped lookup returns too few (e.g. >500-block doc)
    const { self } = stub({ cellIds: ['c0', 'c1'], cellsInCreate: false, resolvableCells: ['c0'] });
    let threw = false, msg = '';
    try { await docs.createDocTable.call(self, 'd', 'd', { rows: 1, columns: 2, cells: [['X', 'Y']] }); }
    catch (e) { threw = true; msg = e.message; }
    assert.ok(threw, 'should throw rather than return a low-filled success');
    assert.ok(/resolved only 1\/2 cells/.test(msg), `error should name the shortfall: ${msg}`);
  });

  await ok('leaves omitted/blank cells empty and counts only filled', async () => {
    const { self, calls } = stub({ cellIds: ['c0', 'c1', 'c2', 'c3'], cellsInCreate: true, cellHasText: true });
    const r = await docs.createDocTable.call(self, 'd', 'd', { rows: 2, columns: 2, cells: [['only', ''], [null, 'here']] });
    assert.strictEqual(r.filled, 2, 'blank/null cells are skipped');
    assert.strictEqual(calls.updates.length, 2);
  });

  // --- v1.3.17: cell-fill resilience (mode-F partial failure field report) ---

  await ok('retries transient cell-fill failures and still fills every cell', async () => {
    // c01's update fails twice with the production code=2200 transient, then clears.
    const { self, calls } = stub({
      cellIds: ['c00', 'c01', 'c10', 'c11'],
      updateFails: (blockId, attempt) => (blockId === 't-c01' && attempt <= 2 ? TRANSIENT_BOTH() : null),
    });
    const r = await docs.createDocTable.call(self, 'd', 'd', {
      rows: 2, columns: 2, cells: [['A', 'B'], ['C', 'D']], retryDelaysMs: [1, 1],
    });
    assert.strictEqual(r.filled, 4, 'all 4 cells filled after retries');
    assert.ok(!r.failedCells || r.failedCells.length === 0, 'no failedCells when retries succeed');
    assert.strictEqual(calls.updateAttempts['t-c01'], 3, 'failing cell attempted 3 times (1 + 2 retries)');
  });

  await ok('reports failedCells {row,col,cellId,textBlockId,reason} and keeps filling on persistent failure', async () => {
    const { self, calls } = stub({
      cellIds: ['c00', 'c01', 'c10', 'c11'],
      updateFails: (blockId) => (blockId === 't-c01' ? PERMANENT_BOTH() : null),
    });
    const r = await docs.createDocTable.call(self, 'd', 'd', {
      rows: 2, columns: 2, cells: [['A', 'B'], ['C', 'D']], retryDelaysMs: [1, 1],
    });
    assert.strictEqual(r.tableBlockId, 'tbl1', 'partial result keeps tableBlockId');
    assert.strictEqual(r.filled, 3, 'other cells still filled');
    assert.strictEqual(r.failedCells.length, 1);
    const f = r.failedCells[0];
    assert.strictEqual(f.row, 0);
    assert.strictEqual(f.col, 1);
    assert.strictEqual(f.cellId, 'c01');
    assert.strictEqual(f.textBlockId, 't-c01');
    assert.ok(/code=99991668/.test(f.reason), `reason carries the underlying error: ${f.reason}`);
    assert.strictEqual(calls.updateAttempts['t-c01'], 1, 'permanent errors are NOT retried');
  });

  await ok('records the failed cell after exhausting transient retries and continues', async () => {
    const { self, calls } = stub({
      cellIds: ['c0', 'c1'],
      updateFails: (blockId) => (blockId === 't-c0' ? TRANSIENT_BOTH() : null),
    });
    const r = await docs.createDocTable.call(self, 'd', 'd', {
      rows: 1, columns: 2, cells: [['X', 'Y']], retryDelaysMs: [1, 1],
    });
    assert.strictEqual(r.filled, 1);
    assert.strictEqual(r.failedCells.length, 1);
    assert.strictEqual(calls.updateAttempts['t-c0'], 3, 'transient retried to exhaustion (1 + 2 retries)');
    assert.strictEqual(calls.updateAttempts['t-c1'], 1, 'later cell still attempted');
  });

  await ok('aborts after 3 consecutive cell failures and marks the remainder skipped', async () => {
    const { self, calls } = stub({
      cellIds: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
      updateFails: () => PERMANENT_BOTH(),
    });
    const r = await docs.createDocTable.call(self, 'd', 'd', {
      rows: 2, columns: 3, cells: [['a', 'b', 'c'], ['d', 'e', 'f']], retryDelaysMs: [1, 1],
    });
    assert.strictEqual(r.filled, 0);
    assert.strictEqual(r.failedCells.length, 6, 'every provided cell accounted for');
    const attempted = r.failedCells.filter(f => !f.skipped);
    const skipped = r.failedCells.filter(f => f.skipped);
    assert.strictEqual(attempted.length, 3, 'stops attempting after 3 consecutive failures');
    assert.strictEqual(skipped.length, 3, 'remaining cells reported as skipped');
    assert.ok(skipped.every(f => f.cellId), 'skipped entries still carry cellId for manual repair');
    assert.strictEqual(Object.keys(calls.updateAttempts).length, 3, 'no API calls for skipped cells');
  });

  await ok('rejects rows/columns < 1', async () => {
    const { self } = stub({ cellIds: [] });
    for (const bad of [{ rows: 0, columns: 2 }, { rows: 2, columns: 0 }, { rows: -1, columns: 1 }]) {
      let threw = false;
      try { await docs.createDocTable.call(self, 'd', 'd', bad); } catch (_) { threw = true; }
      assert.ok(threw, `rows/columns ${JSON.stringify(bad)} should throw`);
    }
  });

  console.log(`\n=== test-doc-table: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-doc-table harness error:', e); process.exit(1); });
}

module.exports = { run };
