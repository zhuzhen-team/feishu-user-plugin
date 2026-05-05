#!/usr/bin/env node
'use strict';
// Companion script to docs/COOKIE-PROTOBUF-CAPTURES.md.
//
// Drives a single capture session: prints the recipe to follow, sets up
// the output dir, and after capture, decodes everything dropped into it.
//
// Usage:
//   node scripts/capture-feishu-protobuf.js IMAGE     # prints the IMAGE recipe
//   node scripts/capture-feishu-protobuf.js DECODE    # decodes everything in /tmp/feishu-captures/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CAPTURE_DIR = '/tmp/feishu-captures';
const TYPES = {
  IMAGE: {
    description: 'Image message via cookie protobuf — cmd=5 PutMessageRequest, content.type=5 (IMAGE)',
    targetMessage: 'Content',
  },
  AUDIO: {
    description: 'Audio message — cmd=5, content.type=7 (AUDIO)',
    targetMessage: 'Content',
  },
  STICKER: {
    description: 'Sticker — cmd=5, content.type=10 (STICKER)',
    targetMessage: 'Content',
  },
  CARD: {
    description: 'Interactive card — cmd=5, content.type=14 (CARD)',
    targetMessage: 'Content',
  },
};

const cmd = process.argv[2] || 'help';

if (cmd === 'DECODE') {
  if (!fs.existsSync(CAPTURE_DIR)) { console.error('No captures yet — run a TYPE first.'); process.exit(1); }
  const files = fs.readdirSync(CAPTURE_DIR).filter(f => f.endsWith('.bin') || f.endsWith('.b64'));
  if (!files.length) { console.error('No capture files in ' + CAPTURE_DIR); process.exit(1); }
  for (const f of files) {
    const type = path.basename(f).split('-')[0].toUpperCase();
    const meta = TYPES[type] || { targetMessage: 'Packet' };
    console.log(`\n=== ${f} (decoding as ${meta.targetMessage}) ===`);
    const fullPath = path.join(CAPTURE_DIR, f);
    const decodeScript = path.join(__dirname, 'decode-feishu-protobuf.js');
    try {
      if (f.endsWith('.b64')) {
        const b64 = fs.readFileSync(fullPath, 'utf8').trim();
        execSync(`node ${decodeScript} ${meta.targetMessage} --b64 ${JSON.stringify(b64)}`, { stdio: 'inherit' });
      } else {
        execSync(`node ${decodeScript} ${meta.targetMessage} < ${fullPath}`, { stdio: 'inherit' });
      }
    } catch (e) { console.error(`  decode failed: ${e.message}`); }
  }
  process.exit(0);
}

if (!TYPES[cmd]) {
  console.log('Usage: node scripts/capture-feishu-protobuf.js [IMAGE|AUDIO|STICKER|CARD|DECODE]');
  console.log('\nCapture types:');
  for (const [k, v] of Object.entries(TYPES)) console.log(`  ${k}  — ${v.description}`);
  console.log('\nRecipe (IMAGE example):');
  console.log('  1. The agent uses Playwright MCP to:');
  console.log('     a. Open https://www.feishu.cn/messenger/ with LARK_COOKIE');
  console.log('     b. Click "我自己" / self-chat');
  console.log('     c. Drag-drop a small test PNG OR click the image button + select file');
  console.log('     d. Wait for the upload to complete');
  console.log('     e. Click "send" and watch network for the POST to /im/gateway/');
  console.log(`  2. Save the raw POST body to ${CAPTURE_DIR}/image-1.bin`);
  console.log(`  3. Run: node scripts/capture-feishu-protobuf.js DECODE`);
  process.exit(0);
}

fs.mkdirSync(CAPTURE_DIR, { recursive: true });
console.log(`=== ${cmd} capture session ===`);
console.log(TYPES[cmd].description);
console.log(`\nCapture dir: ${CAPTURE_DIR}`);
console.log('\nRecipe:');
console.log('  1. Use Playwright MCP to open feishu.cn/messenger/ with cookie auth');
console.log('  2. Send the message of type ' + cmd + ' to "我自己" via the web UI');
console.log('  3. Capture POST /im/gateway/ request body via fetch monkey-patch');
console.log(`  4. Drop the raw body to ${CAPTURE_DIR}/${cmd.toLowerCase()}-1.bin (or .b64)`);
console.log(`  5. Run: node scripts/capture-feishu-protobuf.js DECODE`);
console.log('\nSee docs/COOKIE-PROTOBUF-CAPTURES.md for full step-by-step.');
