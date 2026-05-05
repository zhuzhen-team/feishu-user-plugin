#!/usr/bin/env node
'use strict';
// Verifies CLAUDE.md is in sync with AGENTS.md (Codex) and
// skills/feishu-user-plugin/references/CLAUDE.md (skill reference copy).
//
// Pre-commit hook (scripts/sync-claude-md.sh) already auto-regenerates these
// from CLAUDE.md, but this script gives prepublishOnly + CI a hard gate.
//
// Match logic mirrors validate.yml's diff steps:
//   AGENTS.md = "# feishu-user-plugin — Codex Instructions\n" + tail -n +2 CLAUDE.md
//   skills/.../CLAUDE.md = identical to CLAUDE.md

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

// AGENTS.md: header replaced with "# feishu-user-plugin — Codex Instructions"
const claudeBody = claude.split('\n').slice(1).join('\n'); // drop first line
const expectedAgents = '# feishu-user-plugin — Codex Instructions\n' + claudeBody;
const actualAgents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

const failures = [];
if (actualAgents !== expectedAgents) {
  failures.push('AGENTS.md is out of sync with CLAUDE.md');
  failures.push('Fix: bash scripts/sync-claude-md.sh (or edit CLAUDE.md and re-stage)');
}

const skillRef = path.join(ROOT, 'skills', 'feishu-user-plugin', 'references', 'CLAUDE.md');
const actualSkillRef = fs.readFileSync(skillRef, 'utf8');
if (actualSkillRef !== claude) {
  failures.push('skills/feishu-user-plugin/references/CLAUDE.md is out of sync with CLAUDE.md');
  failures.push('Fix: bash scripts/sync-claude-md.sh (or edit CLAUDE.md and re-stage)');
}

if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('OK: CLAUDE.md / AGENTS.md / skill reference all in sync');
