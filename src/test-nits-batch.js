// src/test-nits-batch.js
//
// Regression tests for the v1.3.17 nit cluster:
//   - repairTail must grow its scan window past a >8KB partial trailing record
//     (and empty out a whole-file single corrupt record), not give up.
//   - manage_bitable_record must reject batches > 500 with a clear local error.
//   - getBlockChildren must paginate to completion (createDocTable >500 cells).
//
// Pure unit test — temp file + stubbed client, no network.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { repairTail, appendEvent } = require('./events/event-log');
const bitable = require('./tools/bitable');
const docsClient = require('./clients/official/docs');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = async (n, fn) => {
    try { await fn(); pass++; console.log('  PASS', n); }
    catch (e) { fail++; console.error('  FAIL', n, '—', e.message); }
  };

  // --- repairTail: >8KB partial tail past the initial window ---
  await check('repairTail truncates a >8KB partial tail back to the last complete line', () => {
    const p = path.join(os.tmpdir(), `fup-rt-${process.pid}-${Date.now()}.jsonl`);
    fs.writeFileSync(p, 'line1\nline2\n' + 'x'.repeat(10000));  // 10KB partial, no trailing \n
    const r = repairTail(p, 8192);
    assert.equal(r.repaired, true);
    assert.equal(fs.readFileSync(p, 'utf8'), 'line1\nline2\n', 'must keep the two complete lines, drop the partial');
    fs.rmSync(p, { force: true });
  });
  await check('repairTail empties a whole-file single corrupt record (no \\n anywhere)', () => {
    const p = path.join(os.tmpdir(), `fup-rt2-${process.pid}-${Date.now()}.jsonl`);
    fs.writeFileSync(p, 'y'.repeat(20000));  // 20KB, no \n at all
    const r = repairTail(p, 8192);
    assert.equal(r.repaired, true);
    assert.equal(fs.statSync(p).size, 0, 'corrupt single-record file truncated to empty');
    fs.rmSync(p, { force: true });
  });
  await check('repairTail leaves a clean \\n-terminated file untouched', () => {
    const p = path.join(os.tmpdir(), `fup-rt3-${process.pid}-${Date.now()}.jsonl`);
    fs.writeFileSync(p, 'a\nb\n');
    const r = repairTail(p, 8192);
    assert.equal(r.repaired, false);
    assert.equal(fs.readFileSync(p, 'utf8'), 'a\nb\n');
    fs.rmSync(p, { force: true });
  });

  // --- bitable batch 500-cap ---
  const ctx = { getOfficialClient: () => ({}), resolveDocId: async (x) => x };
  await check('manage_bitable_record(create) rejects > 500 records', async () => {
    const records = new Array(501).fill({ fields: {} });
    await assert.rejects(
      () => bitable.handlers.manage_bitable_record({ action: 'create', app_token: 'a', table_id: 't', records }, ctx),
      /500/);
  });
  await check('manage_bitable_record(delete) rejects > 500 record_ids', async () => {
    const record_ids = new Array(600).fill('rec');
    await assert.rejects(
      () => bitable.handlers.manage_bitable_record({ action: 'delete', app_token: 'a', table_id: 't', record_ids }, ctx),
      /500/);
  });

  // --- getBlockChildren pagination ---
  await check('getBlockChildren follows page_token to completion', async () => {
    let call = 0;
    const fakeThis = {
      _asUserOrApp: async ({ query }) => {
        call++;
        if (!query.page_token) return { data: { items: [{ block_id: 'a' }, { block_id: 'b' }], has_more: true, page_token: 'P2' } };
        return { data: { items: [{ block_id: 'c' }], has_more: false } };
      },
    };
    const r = await docsClient.getBlockChildren.call(fakeThis, 'doc', 'blk');
    assert.equal(call, 2, 'should make 2 paginated calls');
    assert.deepEqual(r.items.map((i) => i.block_id), ['a', 'b', 'c'], 'should concatenate all pages');
  });

  console.log(`\nnits-batch: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`nits-batch: ${fail} check(s) failed`);
  console.log('nits-batch.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
