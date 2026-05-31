#!/usr/bin/env node
// Unit tests for createDocTable (manage_doc_block create mode F — tables).
//
// Guards the payload contract (block_type=31 table, row_size/column_size) and
// the cell-fill behaviour (UPDATE an existing auto-created text block when
// present — no stray empty blocks — else CREATE one). Pure unit: the official
// client methods (_asUserOrApp / getDocBlocks / updateDocBlock / createDocBlock)
// are stubbed, so no network. End-to-end behaviour is separately verified
// against live Feishu (create doc → table → read back → delete).
'use strict';

const assert = require('assert');
const docs = require('./clients/official/docs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  OK  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

async function run() {
  console.log('=== test-doc-table ===');

  await ok('createDocTable: builds block_type=31 payload + fills cells by UPDATEing existing text (no stray blocks)', async () => {
    const calls = { create: [], update: [], childCreate: [] };
    const cellIds = ['c00', 'c01', 'c10', 'c11'];
    const fakeThis = {
      async _asUserOrApp({ uatPath, body, label }) {
        calls.create.push({ uatPath, body, label });
        return { data: { children: [{ block_id: 'tbl1' }] }, _viaUser: true, _fallbackWarning: null };
      },
      async getDocBlocks() {
        return { items: [
          { block_id: 'tbl1', block_type: 31, table: { cells: cellIds }, children: cellIds },
          ...cellIds.map((id, i) => ({ block_id: id, block_type: 32, children: ['t' + i] })),
          ...cellIds.map((id, i) => ({ block_id: 't' + i, block_type: 2, text: { elements: [] } })),
        ] };
      },
      async updateDocBlock(doc, blockId, body) { calls.update.push({ blockId, body }); return { block: {} }; },
      async createDocBlock(doc, parent, children) { calls.childCreate.push({ parent, children }); return { blocks: [] }; },
    };
    const r = await docs.createDocTable.call(fakeThis, 'docX', 'docX', {
      rows: 2, columns: 2, cells: [['A', 'B'], ['C', 'D']],
    });
    const tableBody = calls.create[0].body.children[0];
    assert.strictEqual(tableBody.block_type, 31, 'table block_type must be 31 (not 40)');
    assert.strictEqual(tableBody.table.property.row_size, 2);
    assert.strictEqual(tableBody.table.property.column_size, 2);
    assert.deepStrictEqual(r.cells, [['c00', 'c01'], ['c10', 'c11']], 'cells mapped row-major');
    assert.strictEqual(r.filled, 4);
    assert.strictEqual(calls.update.length, 4, 'should UPDATE 4 existing cell text blocks');
    assert.strictEqual(calls.childCreate.length, 0, 'should NOT create extra blocks when cell already has a text block');
    assert.strictEqual(calls.update[0].body.update_text_elements.elements[0].text_run.content, 'A');
    assert.strictEqual(r.viaUser, true);
  });

  await ok('createDocTable: CREATEs a text block when a cell has no auto text block', async () => {
    const cellIds = ['c0', 'c1'];
    const childCreate = [];
    const fakeThis = {
      async _asUserOrApp() { return { data: { children: [{ block_id: 'tbl' }] }, _viaUser: true }; },
      async getDocBlocks() {
        return { items: [
          { block_id: 'tbl', block_type: 31, table: { cells: cellIds }, children: cellIds },
          { block_id: 'c0', block_type: 32, children: [] },
          { block_id: 'c1', block_type: 32, children: [] },
        ] };
      },
      async updateDocBlock() { throw new Error('should not UPDATE when cell has no text child'); },
      async createDocBlock(doc, parent, children) { childCreate.push({ parent, children }); return { blocks: [] }; },
    };
    const r = await docs.createDocTable.call(fakeThis, 'd', 'd', { rows: 1, columns: 2, cells: [['X', 'Y']] });
    assert.strictEqual(r.filled, 2);
    assert.strictEqual(childCreate.length, 2, 'should CREATE a text block in each empty cell');
    assert.strictEqual(childCreate[0].children[0].block_type, 2, 'created child is a text block');
  });

  await ok('createDocTable: leaves omitted/blank cells empty and counts only filled', async () => {
    const cellIds = ['c0', 'c1', 'c2', 'c3'];
    let updates = 0;
    const fakeThis = {
      async _asUserOrApp() { return { data: { children: [{ block_id: 'tbl' }] }, _viaUser: true }; },
      async getDocBlocks() {
        return { items: [
          { block_id: 'tbl', block_type: 31, table: { cells: cellIds }, children: cellIds },
          ...cellIds.map((id, i) => ({ block_id: id, block_type: 32, children: ['t' + i] })),
          ...cellIds.map((id, i) => ({ block_id: 't' + i, block_type: 2 })),
        ] };
      },
      async updateDocBlock() { updates++; return { block: {} }; },
      async createDocBlock() { return { blocks: [] }; },
    };
    // Only 2 of 4 cells have content.
    const r = await docs.createDocTable.call(fakeThis, 'd', 'd', { rows: 2, columns: 2, cells: [['only', ''], [null, 'here']] });
    assert.strictEqual(r.filled, 2, 'blank/null cells are skipped');
    assert.strictEqual(updates, 2);
  });

  await ok('createDocTable: rejects rows/columns < 1', async () => {
    const fakeThis = { async _asUserOrApp() { throw new Error('must not reach create'); }, async getDocBlocks() { return { items: [] }; } };
    for (const bad of [{ rows: 0, columns: 2 }, { rows: 2, columns: 0 }, { rows: -1, columns: 1 }]) {
      let threw = false;
      try { await docs.createDocTable.call(fakeThis, 'd', 'd', bad); } catch (_) { threw = true; }
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
