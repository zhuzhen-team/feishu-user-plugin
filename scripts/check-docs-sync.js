#!/usr/bin/env node
'use strict';
// Verifies CLAUDE.md is in sync with AGENTS.md (Codex).
//
// Pre-commit hook (scripts/sync-claude-md.sh) already auto-regenerates AGENTS.md
// from CLAUDE.md, but this script gives prepublishOnly + CI a hard gate.
//
// Match logic mirrors validate.yml's diff step:
//   AGENTS.md = "# feishu-user-plugin — Codex 指令\n" + tail -n +2 CLAUDE.md

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

// AGENTS.md: header replaced with "# feishu-user-plugin — Codex 指令"
const claudeBody = claude.split('\n').slice(1).join('\n'); // drop first line
const expectedAgents = '# feishu-user-plugin — Codex 指令\n' + claudeBody;
const actualAgents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

const failures = [];
if (actualAgents !== expectedAgents) {
  failures.push('AGENTS.md is out of sync with CLAUDE.md');
  failures.push('Fix: bash scripts/sync-claude-md.sh (or edit CLAUDE.md and re-stage)');
}

if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('OK: CLAUDE.md / AGENTS.md in sync');
