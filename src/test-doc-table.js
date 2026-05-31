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
function stub({ cellIds, cellsInCreate = true, cellHasText = true, resolvableCells } = {}) {
  const calls = { createBody: null, updates: [], creates: [], childFetches: [] };
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
    async updateDocBlock(documentId, blockId, body) { calls.updates.push({ blockId, body }); return { block: {} }; },
    async createDocBlock(documentId, parent, children) { calls.creates.push({ parent, children }); return { blocks: [] }; },
  };
  return { self, calls };
}

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
