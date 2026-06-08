#!/usr/bin/env node
'use strict';
// Regenerates server.json so it never drifts from package.json + src/server.js.
// Reads:
//   - package.json: version, description (truncated to ~220 chars for display)
//   - src/server.js TOOLS: tool list (name + description from inputSchema.description)
// Preserves:
//   - display_name, icon, repository, license, categories, tags,
//     installations, environment_variables (these don't drift, edited by hand)
// CI gate (validate.yml) re-runs this and diffs — drift = build fail.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_JSON = path.join(ROOT, 'server.json');
const PKG = require(path.join(ROOT, 'package.json'));
const { TOOLS } = require(path.join(ROOT, 'src', 'server'));

// Truncate a description to at most `limit` chars for the registry catalog.
// Cuts at the last word boundary (when one exists in the tail) and appends an
// ellipsis, so server.json never ends a description mid-word — the full text
// still reaches MCP clients at runtime via tools/list (this is catalog
// metadata only). PR #121 review.
function truncateForCatalog(s, limit = 200) {
  if (s.length <= limit) return s;
  const slice = s.slice(0, limit - 1); // leave room for the ellipsis
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > limit * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.replace(/[\s,;.:—-]+$/, '') + '…';
}

function deriveToolEntry(t) {
  // Strip the "[Plugin]"/"[Cookie]"/etc category prefix from descriptions for compactness.
  const desc = (t.description || '').replace(/^\[[^\]]+\]\s*/, '');
  return { name: t.name, description: truncateForCatalog(desc.split('\n')[0], 200) };
}

const existing = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf8'));

// Truncate package.json description for the marketplace display field.
// The package.json one is intentionally long for npm searches; server.json
// trims it for cleaner cards.
const shortDesc = PKG.description.replace(/\s+/g, ' ').slice(0, 220);

const next = {
  name: PKG.name,
  display_name: existing.display_name || 'Feishu User Plugin for Claude Code',
  description: shortDesc,
  version: PKG.version,
  icon: existing.icon || 'https://www.feishu.cn/favicon.ico',
  repository: existing.repository || { type: 'git', url: PKG.repository?.url || '' },
  license: existing.license || PKG.license || 'MIT',
  categories: existing.categories || ['communication', 'messaging', 'productivity'],
  tags: existing.tags || ['feishu', 'lark', 'im', 'messaging', 'docs', 'bitable', 'wiki', 'protobuf', 'plugin', 'claude-code'],
  tools: TOOLS.map(deriveToolEntry),
  installations: existing.installations || {
    'claude-code': { type: 'stdio', command: 'npx', args: ['-y', 'feishu-user-plugin'] },
  },
  environment_variables: existing.environment_variables || [
    { name: 'LARK_COOKIE',             description: 'Feishu web login cookie string (required for user identity messaging)', required: true },
    { name: 'LARK_APP_ID',             description: 'Feishu Open Platform App ID (required for official API)',                required: true },
    { name: 'LARK_APP_SECRET',         description: 'Feishu Open Platform App Secret (required for official API)',            required: true },
    { name: 'LARK_USER_ACCESS_TOKEN',  description: 'OAuth user_access_token for P2P chat reading (run: npx feishu-user-plugin oauth)', required: true },
    { name: 'LARK_USER_REFRESH_TOKEN', description: 'OAuth refresh_token for automatic UAT renewal (obtained via OAuth flow)', required: true },
  ],
};

const cmd = process.argv[2] || 'write';
const nextStr = JSON.stringify(next, null, 2) + '\n';

if (cmd === 'check') {
  const cur = fs.readFileSync(SERVER_JSON, 'utf8');
  if (cur !== nextStr) {
    console.error('ERROR: server.json is out of sync with package.json + src/server.js TOOLS.');
    console.error('Fix: node scripts/sync-server-json.js');
    process.exit(1);
  }
  console.log(`OK: server.json in sync (${TOOLS.length} tools, v${PKG.version})`);
  process.exit(0);
}

fs.writeFileSync(SERVER_JSON, nextStr);
console.log(`Regenerated server.json (${TOOLS.length} tools, v${PKG.version})`);
