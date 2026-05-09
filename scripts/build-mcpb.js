#!/usr/bin/env node
'use strict';

// scripts/build-mcpb.js
//
// Packages the runtime files + .mcpb/manifest.json into
// dist/feishu-user-plugin-<version>.mcpb (a ZIP with manifest.json at the root).
//
// The .mcpb format is a plain ZIP archive consumed by Claude Desktop / Anthropic
// Connectors Directory. Required layout:
//   manifest.json            (at root, copied from .mcpb/manifest.json)
//   src/...                  (server runtime)
//   proto/...                (protobuf descriptors)
//   skills/...               (MCP prompts source)
//   .claude-plugin/...       (plugin metadata)
//   package.json             (so `node src/index.js` resolves deps after `npm ci`)
//   package-lock.json
//   PRIVACY.md, README.md, LICENSE
//
// node_modules/ is NOT bundled; the connector host runs `npm ci --omit=dev`
// against the bundled package.json once installed (Anthropic convention).
//
// Re-runnable: overwrites dist/feishu-user-plugin-<version>.mcpb on each run.
//
// Usage:
//   node scripts/build-mcpb.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MANIFEST_SRC = path.join(ROOT, '.mcpb', 'manifest.json');

function fail(msg) {
  console.error(`build-mcpb: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST_SRC)) fail('.mcpb/manifest.json not found');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8'));

if (!manifest.version) fail('.mcpb/manifest.json missing `version`');
if (manifest.version !== pkg.version) {
  fail(
    `version mismatch — package.json=${pkg.version} but .mcpb/manifest.json=${manifest.version}. ` +
      `Run: node scripts/check-mcpb-version.js`
  );
}

const VERSION = pkg.version;
const OUT = path.join(DIST, `feishu-user-plugin-${VERSION}.mcpb`);

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

// Files & dirs to bundle. Order matters only for predictable zip output.
// Mirrors package.json::files plus PRIVACY.md and the bundled manifest.json.
const ENTRIES = [
  'manifest.json', // synthesized at staging root from .mcpb/manifest.json
  'src',
  'proto',
  'scripts',
  '.claude-plugin',
  'skills',
  'package.json',
  'package-lock.json',
  'PRIVACY.md',
  'README.md',
  'LICENSE',
];

// Stage in a tmp dir so the zip has manifest.json at the archive root rather
// than .mcpb/manifest.json. Using a tmp dir keeps the source tree clean.
const STAGE = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mcpb-build-'));
try {
  // Copy manifest.json to staging root
  fs.copyFileSync(MANIFEST_SRC, path.join(STAGE, 'manifest.json'));

  // Copy each remaining entry from repo root → staging root
  for (const entry of ENTRIES.slice(1)) {
    const src = path.join(ROOT, entry);
    if (!fs.existsSync(src)) {
      console.warn(`build-mcpb: skipping missing entry: ${entry}`);
      continue;
    }
    const dest = path.join(STAGE, entry);
    copyRecursive(src, dest);
  }

  // Create the ZIP via system `zip` (present on macOS + ubuntu-latest CI).
  // -r recursive, -X strip extra OS attrs for reproducibility, -q quiet.
  // We pass `.` so paths inside the zip are relative to the staging root.
  execFileSync('zip', ['-rqX', OUT, '.'], { cwd: STAGE, stdio: 'inherit' });
} finally {
  fs.rmSync(STAGE, { recursive: true, force: true });
}

const stats = fs.statSync(OUT);
console.log(`OK: built ${path.relative(ROOT, OUT)} (${(stats.size / 1024).toFixed(1)} KB)`);

// --- helpers ------------------------------------------------------------

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      // Skip OS noise + already-built artifacts inside copied dirs
      if (child === '.DS_Store' || child === 'node_modules' || child === 'dist') continue;
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else if (stat.isFile()) {
    fs.copyFileSync(src, dest);
  }
}
