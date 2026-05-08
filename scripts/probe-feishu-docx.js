// scripts/probe-feishu-docx.js
//
// One-shot: pull a representative document, run feishu-docx MarkdownRenderer,
// and emit a coverage report — what blocks appeared, what got rendered.
//
// Usage:
//   node scripts/probe-feishu-docx.js <docx_token | URL>
//
// feishu-docx API shape (v0.7.0):
//   new MarkdownRenderer({ document: { document_id }, blocks: [...] })
//   renderer.parse()  → string markdown
//   renderer.fileTokens  → { [token]: { token, type } }
//
// The constructor expects { document, blocks } — NOT a flat array.
// Our getDocBlocks() returns { items: [...] }.  The first item is the Page
// block whose block_id IS the document_id.  We reshape before passing in.

'use strict';

const fs   = require('fs');
const path = require('path');

const { LarkOfficialClient } = require('../src/clients/official');
const credentials = require('../src/auth/credentials');

let MarkdownRenderer;
try {
  ({ MarkdownRenderer } = require('feishu-docx'));
} catch (e) {
  console.error('feishu-docx not installed — run: npm install feishu-docx@^0.7.0');
  process.exit(1);
}

// Block type numeric → human label (subset covering planted types)
const BLOCK_LABELS = {
  1:  'Page',
  2:  'Text',
  3:  'Heading1',
  4:  'Heading2',
  5:  'Heading3',
  6:  'Heading4',
  12: 'Bullet',
  13: 'Ordered',
  14: 'Code',
  15: 'Quote',
  17: 'TodoList',
  19: 'Callout',
  22: 'Divider',
  23: 'File',
  27: 'Grid',
  28: 'GridColumn',
  29: 'Image',
  31: 'Table',
  32: 'TableCell',
  33: 'View',
  34: 'QuoteContainer',
  35: 'SyncedBlock',
};

(async () => {
  const rawDocId = process.argv[2];
  if (!rawDocId) {
    console.error('Usage: node scripts/probe-feishu-docx.js <docx_token | URL>');
    process.exit(2);
  }

  // --- Auth ---
  // credentials.getActiveProfileEnv() reads ~/.feishu-user-plugin/credentials.json
  // (if it exists) or process.env.  When running as a standalone script (not inside
  // the MCP server process), neither is populated — fall back to ~/.claude.json.
  let env = credentials.getActiveProfileEnv();
  if (!env.LARK_APP_ID) {
    try {
      const claudeCfg = JSON.parse(require('fs').readFileSync(
        require('path').join(require('os').homedir(), '.claude.json'), 'utf8'));
      const srv = (claudeCfg.mcpServers || {})['feishu-user-plugin'];
      if (srv && srv.env) env = { ...srv.env };
    } catch (_) {}
  }
  if (!env.LARK_APP_ID || !env.LARK_APP_SECRET) {
    console.error('LARK_APP_ID / LARK_APP_SECRET not configured');
    process.exit(1);
  }
  const c = new LarkOfficialClient(env.LARK_APP_ID, env.LARK_APP_SECRET);
  if (env.LARK_USER_ACCESS_TOKEN) c.loadUAT(env.LARK_USER_ACCESS_TOKEN);

  // --- Fetch blocks ---
  let blocks;
  try {
    const result = await c.getDocBlocks(rawDocId);
    blocks = result.items;
  } catch (e) {
    console.error('getDocBlocks failed:', e.message || e);
    process.exit(1);
  }

  if (!blocks || blocks.length === 0) {
    console.error('No blocks returned — check doc permissions and token');
    process.exit(1);
  }

  // --- Block type histogram ---
  const typeCount = {};
  for (const b of blocks) {
    const t = b.block_type;
    typeCount[t] = (typeCount[t] || 0) + 1;
  }

  console.log('\nBlock types in document:');
  for (const [t, n] of Object.entries(typeCount).sort((a, b) => a[0] - b[0])) {
    const label = BLOCK_LABELS[t] || `Unknown(${t})`;
    console.log(`  type ${String(t).padEnd(3)} ${label.padEnd(18)} × ${n}`);
  }

  // --- Save fixture ---
  const fixtureDir  = path.join(__dirname, '..', 'src', 'test-fixtures', 'doc-blocks');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, 'sample-1.json');
  fs.writeFileSync(fixturePath, JSON.stringify(blocks, null, 2));
  console.log(`\nFixture saved: ${fixturePath}`);

  // --- Reshape for MarkdownRenderer ---
  // Page block is the first block; its block_id is the document_id for this doc.
  const pageBlock  = blocks.find(b => b.block_type === 1);
  const documentId = pageBlock ? pageBlock.block_id : blocks[0].block_id;

  const docInput = {
    document: { document_id: documentId },
    blocks,
  };

  // --- Run renderer ---
  let md;
  try {
    const renderer = new MarkdownRenderer(docInput);
    md = renderer.parse();
  } catch (e) {
    console.error('\nMarkdownRenderer threw:', e.message || e);
    console.error('(fixture already saved — Task 2 can use it)');
    process.exit(3);
  }

  if (!md) {
    console.error('\nMarkdownRenderer returned empty string');
    process.exit(3);
  }

  // --- Sizes ---
  const jsonSize = JSON.stringify(blocks).length;
  const mdSize   = md.length;
  console.log(`\nJSON size:      ${jsonSize}`);
  console.log(`Markdown size:  ${mdSize}`);
  console.log(`Ratio:          ${(mdSize / jsonSize * 100).toFixed(1)}%  (target 30-50%)`);

  // --- Excerpt ---
  console.log('\n--- Markdown excerpt (first 500 chars) ---');
  console.log(md.slice(0, 500));

  // --- Coverage analysis: which planted block types appear in markdown? ---
  console.log('\n--- Coverage analysis ---');
  const plantedTypes = [3, 4, 5, 6, 2, 12, 13, 17, 14, 15, 22, 19, 31, 32];
  for (const t of plantedTypes) {
    if (typeCount[t] === undefined) continue;
    const label = BLOCK_LABELS[t] || `type_${t}`;
    // Heuristic checks for presence in markdown
    let present = 'UNKNOWN';
    if (t === 3)  present = /^#\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 4)  present = /^##\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 5)  present = /^###\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 6)  present = /^####\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 2)  present = 'YES (paragraph text present by default)';
    if (t === 12) present = /^\s*[-*]\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 13) present = /^\s*\d+\.\s/m.test(md) ? 'YES' : 'MISSING';
    if (t === 17) present = /\- \[[ x]\]/.test(md) ? 'YES' : 'MISSING';
    if (t === 14) present = /```/.test(md) ? 'YES' : 'MISSING';
    if (t === 15) present = /^>/m.test(md) ? 'YES' : 'MISSING';
    if (t === 22) present = /^---/m.test(md) ? 'YES' : 'MISSING';
    if (t === 19) present = md.includes('Callout') || /^>\s*\[!/m.test(md) || /callout/i.test(md) ? 'PARTIAL' : 'UNKNOWN — inspect manually';
    if (t === 31) present = /^\|/m.test(md) ? 'YES' : 'MISSING';
    if (t === 32) present = 'N/A (cells rendered inside Table block)';
    console.log(`  type ${String(t).padEnd(3)} ${label.padEnd(18)} → ${present}`);
  }

  // Check inline styles in text
  console.log('\n--- Inline style presence in markdown ---');
  console.log(`  bold        → ${/\*\*\w/.test(md) ? 'YES (**...)' : 'MISSING'}`);
  console.log(`  italic      → ${/\*[^*]/.test(md) || /_[^_]/.test(md) ? 'YES (*...)' : 'MISSING'}`);
  console.log(`  inline-code → ${/`[^`]/.test(md) ? 'YES (\`...\`)' : 'MISSING'}`);
  console.log(`  strikethrough → ${/~~\w/.test(md) ? 'YES (~~...)' : 'MISSING'}`);
  console.log(`  link        → ${/\[.*\]\(http/.test(md) ? 'YES ([text](url))' : 'MISSING'}`);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
