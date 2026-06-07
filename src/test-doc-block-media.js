#!/usr/bin/env node
// Unit tests for the image/file block 3-step write flows (2026-06-07 systemic
// audit): create placeholder → upload media → PATCH replace. Before the fix a
// step-2/3 failure threw a raw error that did not name the placeholder block —
// the empty block stayed in the document as an orphan with no repair path, and
// transient Feishu flakes (rate limit / 5xx / code=2200) were never retried
// (unlike createDocTable's cell fill).
'use strict';

const assert = require('assert');
const docs = require('./clients/official/docs');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log(`  OK  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

const TRANSIENT = () => new Error('updateDocBlock failed (HTTP 503, code=99991400): rate limited');
const PERMANENT = () => new Error('updateDocBlock failed (HTTP 403, code=1770032): forBidden');

// Stub for createDocBlockWithImage. Dispatches _asUserOrApp on label:
//   *.placeholder → returns the created placeholder block
//   *.replaceImage / *.replaceFile → behavior driven by patchFails
function imageStub({ patchFails, uploadFails } = {}) {
  const calls = { patches: 0, uploads: 0 };
  const self = {
    async _asUserOrApp({ label }) {
      if (label.endsWith('.placeholder')) {
        return { data: { children: [{ block_id: 'ph1', block_type: 27 }] }, _viaUser: true, _fallbackWarning: null };
      }
      calls.patches++;
      if (patchFails) {
        const err = patchFails(calls.patches);
        if (err) throw err;
      }
      return { data: {}, _viaUser: true };
    },
    async uploadMedia() {
      calls.uploads++;
      if (uploadFails) {
        const err = uploadFails(calls.uploads);
        if (err) throw err;
      }
      return { fileToken: 'img_tok_1', viaUser: true };
    },
  };
  return { self, calls };
}

// Stub for createDocBlockWithFile — the create response returns the inner FILE
// block directly (block_type 23) so the view-walk is skipped.
function fileStub({ patchFails } = {}) {
  const calls = { patches: 0 };
  const self = {
    async _asUserOrApp({ label }) {
      if (label.endsWith('.placeholder')) {
        return { data: { children: [{ block_id: 'fb1', block_type: 23 }] }, _viaUser: true, _fallbackWarning: null };
      }
      calls.patches++;
      if (patchFails) {
        const err = patchFails(calls.patches);
        if (err) throw err;
      }
      return { data: {}, _viaUser: true };
    },
    async uploadMedia() { return { fileToken: 'box_tok_1', viaUser: true }; },
  };
  return { self, calls };
}

async function run() {
  console.log('=== test-doc-block-media ===');

  await ok('image: retries a transient PATCH failure and succeeds', async () => {
    const { self, calls } = imageStub({ patchFails: (n) => (n === 1 ? TRANSIENT() : null) });
    const r = await docs.createDocBlockWithImage.call(self, 'd', 'd', { imagePath: '/tmp/x.png', retryDelaysMs: [1, 1] });
    assert.strictEqual(r.blockId, 'ph1');
    assert.strictEqual(calls.patches, 2, 'transient PATCH retried');
  });

  await ok('image: permanent PATCH failure throws a structured error naming the orphan placeholder', async () => {
    const { self } = imageStub({ patchFails: () => PERMANENT() });
    let err = null;
    try {
      await docs.createDocBlockWithImage.call(self, 'd', 'd', { imagePath: '/tmp/x.png', retryDelaysMs: [1, 1] });
    } catch (e) { err = e; }
    assert.ok(err, 'must throw on permanent failure');
    assert.strictEqual(err.blockId, 'ph1', 'error must carry the placeholder blockId');
    assert.ok(/ph1/.test(err.message), 'message must name the placeholder for cleanup/repair');
    assert.ok(/img_tok_1/.test(err.message), 'message should carry the uploaded token so the caller can re-attach without re-uploading');
  });

  await ok('image: upload failure also names the placeholder (orphan exists before upload)', async () => {
    const { self } = imageStub({ uploadFails: () => PERMANENT() });
    let err = null;
    try {
      await docs.createDocBlockWithImage.call(self, 'd', 'd', { imagePath: '/tmp/x.png', retryDelaysMs: [1, 1] });
    } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.blockId, 'ph1');
    assert.ok(/ph1/.test(err.message));
  });

  await ok('image: transient upload failure is retried', async () => {
    const { self, calls } = imageStub({ uploadFails: (n) => (n === 1 ? TRANSIENT() : null) });
    const r = await docs.createDocBlockWithImage.call(self, 'd', 'd', { imagePath: '/tmp/x.png', retryDelaysMs: [1, 1] });
    assert.strictEqual(r.blockId, 'ph1');
    assert.strictEqual(calls.uploads, 2, 'transient upload retried');
  });

  await ok('file: permanent PATCH failure throws a structured error naming the orphan block', async () => {
    const { self } = fileStub({ patchFails: () => PERMANENT() });
    let err = null;
    try {
      await docs.createDocBlockWithFile.call(self, 'd', 'd', { fileToken: 'box_pre_uploaded', retryDelaysMs: [1, 1] });
    } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.blockId, 'fb1', 'error must carry the file block id');
    assert.ok(/fb1/.test(err.message));
  });

  await ok('file: transient PATCH failure is retried and succeeds', async () => {
    const { self, calls } = fileStub({ patchFails: (n) => (n === 1 ? TRANSIENT() : null) });
    const r = await docs.createDocBlockWithFile.call(self, 'd', 'd', { fileToken: 'box_pre_uploaded', retryDelaysMs: [1, 1] });
    assert.strictEqual(r.blockId, 'fb1');
    assert.strictEqual(calls.patches, 2);
  });

  console.log(`\n=== test-doc-block-media: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-doc-block-media harness error:', e); process.exit(1); });
}

module.exports = { run };
