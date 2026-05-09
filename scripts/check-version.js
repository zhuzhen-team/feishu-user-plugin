#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Source 1: package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pkgVersion = pkg.version;

// Source 2: .claude-plugin/plugin.json
const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
const pluginVersion = plugin.version;

// Source 3: skills/feishu-user-plugin/SKILL.md frontmatter version line
const skillMd = fs.readFileSync(path.join(ROOT, 'skills', 'feishu-user-plugin', 'SKILL.md'), 'utf8');
const skillMatch = skillMd.match(/^version:\s*["']?([^"'\s]+)["']?/m);
if (!skillMatch) {
  console.error('ERROR: Could not find version in skills/feishu-user-plugin/SKILL.md frontmatter');
  process.exit(1);
}
const skillVersion = skillMatch[1];

// Source 4: .cursor-plugin/plugin.json
const cursorPlugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.cursor-plugin', 'plugin.json'), 'utf8'));
const cursorVersion = cursorPlugin.version;

const sources = [
  { label: 'package.json', version: pkgVersion, path: 'package.json' },
  { label: '.claude-plugin/plugin.json', version: pluginVersion, path: '.claude-plugin/plugin.json' },
  { label: 'skills/feishu-user-plugin/SKILL.md', version: skillVersion, path: 'skills/feishu-user-plugin/SKILL.md' },
  { label: '.cursor-plugin/plugin.json', version: cursorVersion, path: '.cursor-plugin/plugin.json' },
];

const versions = sources.map((s) => s.version);
const allEqual = versions.every((v) => v === versions[0]);

if (!allEqual) {
  console.error('ERROR: Version triangle mismatch!');
  sources.forEach((s) => console.error(`  ${s.path}: ${s.version}`));
  process.exit(1);
}

console.log(`OK: version ${pkgVersion}`);
