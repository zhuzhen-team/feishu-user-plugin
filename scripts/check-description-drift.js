#!/usr/bin/env node
'use strict';
// Verifies every manifest description / long_description references only
// the current package.json::version (or no version at all).
//
// Catches the "plugin.json description stuck at v1.3.8 for 3 releases"
// class of bug: a CI gate would have flagged it on the v1.3.9 release PR.
//
// Rule: every `vX.Y.Z` token inside the listed description fields must
// equal the current package.json::version. To keep a description across
// releases without churn, drop the version reference entirely.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;

// Match `vX.Y.Z` only (must have leading `v`) — avoids false positives on
// schema versions like "0.3" or random numbers.
const VERSION_PATTERN = /v(\d+\.\d+\.\d+)/g;

const SOURCES = [
  { label: 'package.json::description',                   file: 'package.json',                          extract: (raw) => JSON.parse(raw).description },
  { label: '.claude-plugin/plugin.json::description',     file: '.claude-plugin/plugin.json',            extract: (raw) => JSON.parse(raw).description },
  { label: '.cursor-plugin/plugin.json::description',     file: '.cursor-plugin/plugin.json',            extract: (raw) => JSON.parse(raw).description },
  { label: 'mcp-registry.json::description',              file: 'mcp-registry.json',                     extract: (raw) => JSON.parse(raw).description },
  { label: '.mcpb/manifest.json::description',            file: '.mcpb/manifest.json',                   extract: (raw) => JSON.parse(raw).description },
  { label: '.mcpb/manifest.json::long_description',       file: '.mcpb/manifest.json',                   extract: (raw) => JSON.parse(raw).long_description },
  { label: 'skills/feishu-user-plugin/SKILL.md description', file: 'skills/feishu-user-plugin/SKILL.md', extract: extractSkillDescription },
];

function extractSkillDescription(raw) {
  // SKILL.md frontmatter has  description: "..."  on a single line.
  const m = raw.match(/^description:\s*"((?:[^"\\]|\\.)*)"/m);
  return m ? m[1].replace(/\\"/g, '"') : null;
}

const failures = [];

for (const src of SOURCES) {
  const fullPath = path.join(ROOT, src.file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`${src.label}: source file ${src.file} does not exist`);
    continue;
  }

  let description;
  try {
    description = src.extract(fs.readFileSync(fullPath, 'utf8'));
  } catch (e) {
    failures.push(`${src.label}: parse error — ${e.message}`);
    continue;
  }

  if (!description) continue; // Field absent — nothing to check.

  for (const m of description.matchAll(VERSION_PATTERN)) {
    const found = m[1];
    if (found !== VERSION) {
      failures.push(`${src.label}: references v${found}, but package.json is v${VERSION}`);
    }
  }
}

if (failures.length) {
  console.error('description drift detected:');
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\nFix: update each description to reference v${VERSION}, or remove the version reference entirely (e.g. drop "v1.3.8: feature X" → "feature X").`);
  process.exit(1);
}

console.log(`OK: all manifest descriptions reference v${VERSION} (or no version reference)`);
