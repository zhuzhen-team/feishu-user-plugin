#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Source 1: package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pkgVersion = pkg.version;

// Source 2: .mcpb/manifest.json
const manifestPath = path.join(ROOT, '.mcpb', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('ERROR: .mcpb/manifest.json not found');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestVersion = manifest.version;

if (!manifestVersion) {
  console.error('ERROR: .mcpb/manifest.json is missing the `version` field');
  process.exit(1);
}

if (pkgVersion !== manifestVersion) {
  console.error('ERROR: .mcpb manifest version mismatch!');
  console.error(`  package.json:        ${pkgVersion}`);
  console.error(`  .mcpb/manifest.json: ${manifestVersion}`);
  process.exit(1);
}

console.log(`OK: .mcpb manifest version ${pkgVersion}`);
