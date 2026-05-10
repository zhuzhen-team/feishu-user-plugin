#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const { TOOLS } = require(path.join(__dirname, '..', 'src', 'server'));

const failures = [];

// Source 1: README.md tool count — accepts "N tools" (English) or "N 工具" (Chinese)
// since README.md is Chinese-primary while README.en.md mirrors in English.
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const readmeMatch = readme.match(/(\d+)\s*(?:tools|工具)/);
if (!readmeMatch) {
  failures.push('No "N tools" / "N 工具" marker in README.md');
} else if (parseInt(readmeMatch[1], 10) !== TOOLS.length) {
  failures.push(`README.md claims ${readmeMatch[1]} tools, src/server.js has ${TOOLS.length}`);
}

// Source 2: SKILL.md `allowed-tools` frontmatter — comma-separated list.
const skillMd = fs.readFileSync(path.join(__dirname, '..', 'skills', 'feishu-user-plugin', 'SKILL.md'), 'utf8');
const skillMatch = skillMd.match(/^allowed-tools:\s*(.+)$/m);
if (!skillMatch) {
  failures.push('No `allowed-tools:` line in skills/feishu-user-plugin/SKILL.md frontmatter');
} else {
  const skillTools = skillMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  const skillSet = new Set(skillTools);
  const toolSet = new Set(TOOLS.map(t => t.name));
  const missingFromSkill = [...toolSet].filter(t => !skillSet.has(t)).sort();
  const extraInSkill = [...skillSet].filter(t => !toolSet.has(t)).sort();
  if (missingFromSkill.length || extraInSkill.length) {
    failures.push(`SKILL.md allowed-tools out of sync (server has ${TOOLS.length}, SKILL.md has ${skillTools.length}):`);
    if (missingFromSkill.length) failures.push(`  missing from SKILL.md: ${missingFromSkill.join(', ')}`);
    if (extraInSkill.length)     failures.push(`  extra in SKILL.md (not registered): ${extraInSkill.join(', ')}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`OK: ${TOOLS.length} tools (README badge + SKILL.md allowed-tools both match)`);
