#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const { TOOLS } = require(path.join(__dirname, '..', 'src', 'server'));
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
// Find the canonical "N tools" reference. Pick the highest-confidence match.
const m = readme.match(/(\d+)\s+tools/);
if (!m) { console.error('No "N tools" badge in README.md'); process.exit(1); }
const claimed = parseInt(m[1], 10);
if (claimed !== TOOLS.length) {
  console.error(`README claims ${claimed} tools, src/server.js has ${TOOLS.length}`);
  process.exit(1);
}
console.log(`OK: ${TOOLS.length} tools`);
