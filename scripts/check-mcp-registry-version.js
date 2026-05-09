#!/usr/bin/env node
'use strict';
// Verifies mcp-registry.json::version + packages[0].version == package.json::version.
// Wired into:
//   - .github/workflows/publish.yml — pre-publish gate so CI never publishes to the
//     official MCP Registry with a stale version string.
//   - .github/workflows/validate.yml — PR-time gate so any version bump on
//     package.json without a matching bump on mcp-registry.json fails before merge.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pkgVersion = pkg.version;

const registryPath = path.join(ROOT, 'mcp-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const registryVersion = registry.version;

if (!Array.isArray(registry.packages) || registry.packages.length === 0) {
  console.error('ERROR: mcp-registry.json has no packages[] entries');
  process.exit(1);
}
const pkgEntryVersion = registry.packages[0].version;

const sources = [
  { label: 'package.json', version: pkgVersion, path: 'package.json' },
  { label: 'mcp-registry.json::version', version: registryVersion, path: 'mcp-registry.json' },
  { label: 'mcp-registry.json::packages[0].version', version: pkgEntryVersion, path: 'mcp-registry.json' },
];

const allEqual = sources.every((s) => s.version === sources[0].version);

if (!allEqual) {
  console.error('ERROR: mcp-registry.json version mismatch with package.json!');
  sources.forEach((s) => console.error(`  ${s.label}: ${s.version}`));
  console.error('Fix: bump mcp-registry.json::version AND mcp-registry.json::packages[0].version');
  console.error(`     to match package.json (${pkgVersion}).`);
  process.exit(1);
}

console.log(`OK: mcp-registry.json version ${pkgVersion}`);
