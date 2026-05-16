#!/usr/bin/env node
// scripts/verify-app-name.js — diagnostic: does the current app have the
// tenant-side `application:application:self_manage` scope?
//
// Hits Feishu's app-info endpoint with the current credentials' APP_ID/SECRET
// and prints either the resolved app name (scope is granted) or the error
// code (with remediation pointing at docs/AUTH-SETUP.md).
//
// Usage:
//   node scripts/verify-app-name.js
//
// Exit codes:
//   0  scope works, displayLabel will say "[Bot] AppName"
//   1  99991672 — scope missing, displayLabel will fall back to "[Bot] (cli_xxx)"
//   2  other auth failure (wrong APP_ID/SECRET, network, etc.)

'use strict';

const { readCredentials } = require('../src/auth/credentials');

async function main() {
  const creds = readCredentials() || {};
  const appId = creds.LARK_APP_ID;
  const appSecret = creds.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    console.error('No LARK_APP_ID/SECRET in credentials. Run `npx feishu-user-plugin setup` first.');
    process.exit(2);
  }
  console.error(`Probing app info for APP_ID=${appId}…`);

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.app_access_token) {
    console.error(`app_access_token request failed: ${JSON.stringify(tokenData)}`);
    process.exit(2);
  }

  const infoRes = await fetch(`https://open.feishu.cn/open-apis/application/v6/applications/${appId}?lang=zh_cn`, {
    headers: { 'Authorization': `Bearer ${tokenData.app_access_token}` },
  });
  const info = await infoRes.json();

  if (info.code === 0 && info.data?.app?.app_name) {
    console.error(`OK — app name resolves to "${info.data.app.app_name}". displayLabel will read "[Bot] ${info.data.app.app_name}".`);
    process.exit(0);
  }
  if (info.code === 99991672) {
    console.error('FAIL — code 99991672. The tenant-side scope `application:application:self_manage` is not granted.');
    console.error('Fix:');
    console.error(`  1. Open https://open.feishu.cn/app/${appId}/safe — "应用身份" tab`);
    console.error('  2. Add scope `application:application:self_manage` (marked 免审权限 — no admin review needed)');
    console.error('  3. Save; no re-publish required');
    console.error('  4. Re-run this script to confirm');
    process.exit(1);
  }
  console.error(`FAIL — unexpected response: code=${info.code} msg=${info.msg || JSON.stringify(info)}`);
  process.exit(2);
}

main().catch((e) => { console.error(`Threw: ${e.message}`); process.exit(2); });
