#!/usr/bin/env node
'use strict';
// Simulates wiki:wiki scope insufficient and verifies the upload fallback path
// surfaces a clear error rather than burying the wiki failure under a generic
// "uploaded to drive root, attach failed" silent miss.
//
// Approach: monkey-patch attachToWiki on the LarkOfficialClient prototype to
// throw a 91403 (the production wiki "no permission" code), then call
// upload_drive_file with wiki_space_id and check the response.

const { readCredentials } = require('../src/auth/credentials');
const creds = readCredentials();
if (!creds.LARK_APP_ID || !creds.LARK_APP_SECRET || !creds.LARK_USER_ACCESS_TOKEN) {
  console.error('Skipped: needs LARK_APP_ID / LARK_APP_SECRET / UAT (skip on CI).');
  process.exit(77); // POSIX skip code
}

(async () => {
  const { LarkOfficialClient } = require('../src/clients/official');
  const client = new LarkOfficialClient(creds.LARK_APP_ID, creds.LARK_APP_SECRET);
  client.loadUAT();

  const original = client.attachToWiki?.bind(client);
  if (!original) { console.error('attachToWiki not present — wiki domain may not be loaded.'); process.exit(2); }

  client.attachToWiki = async function(...args) {
    const err = new Error('attachToWiki failed (HTTP 403, code=91403): wiki scope not granted');
    err.code = 91403;
    throw err;
  };

  const tmpFile = '/tmp/feishu-test-attach-fallback.txt';
  require('fs').writeFileSync(tmpFile, 'attach-fallback-test ' + Date.now());

  // Need a real folder_token: this script is opportunistic — pass via env
  // FEISHU_TEST_FOLDER_TOKEN. Skip cleanly otherwise.
  const folderToken = process.env.FEISHU_TEST_FOLDER_TOKEN;
  if (!folderToken) {
    console.error('Skipped: set FEISHU_TEST_FOLDER_TOKEN env (a real Drive folder token you can write to) to exercise this fallback.');
    require('fs').unlinkSync(tmpFile);
    process.exit(77);
  }

  try {
    const res = await client.uploadDriveFile({
      file_path: tmpFile,
      file_name: 'attach-fallback-test.txt',
      folder_token: folderToken,
      parent_type: 'explorer',
      wiki_space_id: '0000000000000000', // bogus; attachToWiki monkey-patch throws 91403 either way
    });
    console.log('Result:', JSON.stringify(res, null, 2));
    if (res?._wikiAttachWarning || res?.error || /91403|wiki/i.test(JSON.stringify(res))) {
      console.log('PASS: upload surfaces the wiki attach failure');
      process.exit(0);
    }
    console.log('FAIL: upload did not surface the wiki attach failure');
    process.exit(1);
  } catch (e) {
    // The monkey-patched attachToWiki throws — uploadDriveFile may rethrow.
    // That's also acceptable as long as the message preserves the wiki failure.
    if (/91403|wiki/i.test(e.message)) {
      console.log('PASS: upload surfaces the wiki attach failure via thrown error:', e.message);
      process.exit(0);
    }
    console.error('FAIL: upload threw, but message does not mention wiki/91403:', e.message);
    process.exit(1);
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
