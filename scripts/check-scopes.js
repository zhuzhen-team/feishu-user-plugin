#!/usr/bin/env node
'use strict';

// Validates src/oauth.js::SCOPES against:
//  1) BANLIST — scope names we've confirmed do NOT exist in Feishu's catalog
//     (caused OAuth 422 / runtime 20043). Add new ones here when discovered.
//  2) docs/AUTH-SETUP.md mentions — every scope in SCOPES must appear at least
//     once in AUTH-SETUP.md, so the doc never drifts behind the code.
//
// Why this gate exists: Feishu's OAuth server SILENTLY accepted some malformed
// scope names pre-2026-05 (they were ignored, UAT just lacked the scope); from
// May 2026 it started rejecting the whole authorize request with 422 +
// "scope <name> 有误". A single bad name in SCOPES locks every user out of
// `npx oauth`. This script catches it in CI before merge.

const path = require('path');
const fs = require('fs');

const repoRoot = path.join(__dirname, '..');

// --- Step 1: extract SCOPES constant from src/oauth.js ---
const oauthSrc = fs.readFileSync(path.join(repoRoot, 'src', 'oauth.js'), 'utf8');
const m = oauthSrc.match(/const\s+SCOPES\s*=\s*'([^']+)'/);
if (!m) {
  console.error('check-scopes: could not find `const SCOPES = \'...\'` in src/oauth.js');
  process.exit(1);
}
const scopes = m[1].split(/\s+/).filter(Boolean);

// --- Step 1b: ADDITIONAL_APP_SCOPES — tenant-side scopes that the plugin requires
// but that don't live in SCOPES (because they can't be granted via OAuth — only
// in the Feishu app console "应用身份" tab). Validated against AUTH-SETUP.md only.
const ADDITIONAL_APP_SCOPES = [
  // Used by LarkOfficialClient.getAppName() to resolve self-app display label.
  // Without it, `senderType=app` messages fall back to "[Bot] (cli_xxx)".
  // Feishu marks this scope as 免审权限 (no admin review needed).
  'application:application:self_manage',
];

// --- Step 2: BANLIST of known-bad scope names ---
//
// Each entry: { bad: '<name>', reason: '<why>', replacement: '<correct names>' }
// Append-only — never remove an entry (it's a regression guard).
const BANLIST = [
  {
    bad: 'calendar:calendar.event:write',
    reason: 'Feishu catalog has no such scope. The catalog splits write into 4 verbs.',
    replacement: 'calendar:calendar.event:create + calendar:calendar.event:update + calendar:calendar.event:delete + calendar:calendar.event:reply',
  },
  {
    bad: 'okr:okr.content:write',
    reason: 'Feishu catalog uses :writeonly (one word) not :write.',
    replacement: 'okr:okr.content:writeonly',
  },
];

// --- Step 3: validate ---
const failures = [];

for (const entry of BANLIST) {
  if (scopes.includes(entry.bad)) {
    failures.push(
      `BANLIST hit: SCOPES contains \`${entry.bad}\`.\n` +
      `  Reason: ${entry.reason}\n` +
      `  Replace with: ${entry.replacement}`
    );
  }
}

// docs/AUTH-SETUP.md must mention every scope. Catches silent additions
// to SCOPES that never made it into the OAuth setup docs.
const authSetupPath = path.join(repoRoot, 'docs', 'AUTH-SETUP.md');
const authSetup = fs.readFileSync(authSetupPath, 'utf8');
const missingFromDocs = scopes.filter(s => s !== 'offline_access' && !authSetup.includes(s));
if (missingFromDocs.length) {
  failures.push(
    `${missingFromDocs.length} scope(s) in SCOPES not mentioned in docs/AUTH-SETUP.md:\n` +
    missingFromDocs.map(s => `  - ${s}`).join('\n') +
    `\n  Add them to the scope table around line 117 (\`## OAuth Scopes\` section).`
  );
}

// Same enforcement for tenant-only scopes.
const missingAppScopes = ADDITIONAL_APP_SCOPES.filter(s => !authSetup.includes(s));
if (missingAppScopes.length) {
  failures.push(
    `${missingAppScopes.length} tenant-side scope(s) not in docs/AUTH-SETUP.md:\n` +
    missingAppScopes.map(s => `  - ${s}`).join('\n') +
    `\n  Add them to the "应用身份额外 scope" section.`
  );
}

if (failures.length) {
  console.error('check-scopes: FAIL\n');
  for (const f of failures) console.error(f + '\n');
  process.exit(1);
}

console.log(`check-scopes: OK (${scopes.length} OAuth + ${ADDITIONAL_APP_SCOPES.length} tenant-only scopes, ${BANLIST.length} banned names guarded)`);
