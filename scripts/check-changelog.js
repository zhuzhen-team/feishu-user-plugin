#!/usr/bin/env node
'use strict';
// Verifies CHANGELOG.md has an "## [vX.Y.Z]" section matching package.json
// version. Run from publish workflow + locally before tagging.
//
// Usage:
//   node scripts/check-changelog.js               → checks current package.json version
//   node scripts/check-changelog.js 1.3.8         → checks given version explicitly

const fs = require('fs');
const path = require('path');

const explicit = process.argv[2];
const pkgVersion = explicit || require(path.join(__dirname, '..', 'package.json')).version;

const cl = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');

// Common section headings used in this repo: "## [v1.3.7]" or "## v1.3.7" or "## 1.3.7" or "### v1.3.7".
const patterns = [
  new RegExp(`^##\\s*\\[?v?${pkgVersion.replace(/\./g, '\\.')}\\]?`, 'm'),
  new RegExp(`^###\\s*v?${pkgVersion.replace(/\./g, '\\.')}`,        'm'),
];
const match = patterns.some(re => re.test(cl));

if (!match) {
  console.error(`ERROR: CHANGELOG.md has no section for v${pkgVersion}.`);
  console.error(`Add "## [v${pkgVersion}]" or "### v${pkgVersion}" with the release notes before tagging.`);
  process.exit(1);
}

console.log(`OK: CHANGELOG.md has v${pkgVersion} section`);
