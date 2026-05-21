// src/auth/env-backfill.js — backfill `process.env.LARK_*` from canonical
// credentials store, for legacy callers that read env directly.
//
// Motivation: v1.3.7+ canonical store is at ~/.feishu-user-plugin/credentials.json,
// but the original CLI flows + e2e tests + dev probes (e.g. test-all.js,
// test-comprehensive.js, scripts/probe-feishu-docx.js, scripts/test-wiki-attach-
// fallback.js) constructed clients with `process.env.LARK_*`. After users move
// creds to canonical, those env vars are empty in a fresh shell and the legacy
// paths fall over.
//
// This helper sets process.env values from canonical if and only if they aren't
// already set, preserving precedence: explicit shell env > canonical fallback.
// Safe to call multiple times — idempotent. Safe to call before canonical
// exists (no-op, legacy harness env still wins).

'use strict';

const SNAP_KEYS = [
  'LARK_COOKIE',
  'LARK_APP_ID',
  'LARK_APP_SECRET',
  'LARK_USER_ACCESS_TOKEN',
  'LARK_USER_REFRESH_TOKEN',
  'LARK_UAT_EXPIRES',
];

function backfillFromCanonical() {
  try {
    const { readCredentials } = require('./credentials');
    const creds = readCredentials();
    for (const k of SNAP_KEYS) {
      if (!process.env[k] && creds[k]) process.env[k] = String(creds[k]);
    }
  } catch (_) { /* canonical may not exist; legacy path unaffected */ }
}

module.exports = { backfillFromCanonical, SNAP_KEYS };
