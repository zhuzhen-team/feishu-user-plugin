'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const { handlers } = require('./tools/docs');

async function run() {
  const fixturePath = path.join(__dirname, 'test-fixtures', 'doc-blocks', 'sample-1.json');
  if (!fs.existsSync(fixturePath)) {
    console.log('read-doc-markdown: no fixture, skipping');
    return;
  }
  const blocks = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  // feishu-docx is a hard dep in v1.3.9, but the handler has a graceful skip;
  // honour the same pattern so the test passes in lean test envs.
  try { require.resolve('feishu-docx'); } catch (_) {
    console.log('read-doc-markdown: feishu-docx not installed, skipping');
    return;
  }

  // Mock ctx: passthrough resolveDocId, return fixture from getDocBlocks.
  const ctx = {
    resolveDocId: async (id) => id,
    getOfficialClient: () => ({
      getDocBlocks: async (_id) => ({ items: blocks }),
    }),
  };

  const result = await handlers.read_doc_markdown({ document_id: 'fixture' }, ctx);
  // handler returns MCP text shape: { content: [{ type: 'text', text: string }] }
  assert.ok(result, 'handler should return a result');
  const md = result.content?.[0]?.text;
  assert.ok(typeof md === 'string', 'handler output should be a markdown string');
  assert.ok(md.length > 0, 'output should be non-empty');

  // Token saving check
  const jsonSize = JSON.stringify(blocks).length;
  const ratio = md.length / jsonSize;
  if (ratio > 0.6) {
    console.warn(`read-doc-markdown: ratio ${(ratio * 100).toFixed(1)}% > 60% — consider tightening post-processor`);
  }

  // Spot-check: post-processor MUST have converted inline HTML tags
  // (these are the bugs the post-processor exists to handle — without them,
  // user-facing output is contaminated with <b>, <em>, <del> raw HTML).
  assert.ok(!md.includes('<b>'), 'output should not contain raw <b> tags');
  assert.ok(!md.includes('<em>'), 'output should not contain raw <em> tags');
  assert.ok(!md.includes('<del>'), 'output should not contain raw <del> tags');
  // External links preserved (the file regex must not over-match)
  assert.ok(md.includes('[Anthropic](https://anthropic.com)'), 'external link [Anthropic] should be preserved');

  console.log(`read-doc-markdown: PASS (ratio ${(ratio * 100).toFixed(1)}%)`);
}

if (require.main === module) {
  run().catch(e => { console.error('read-doc-markdown: FAIL', e); process.exit(1); });
}
module.exports = { run };
