#!/usr/bin/env node
/**
 * Quick test for feishu-user-plugin
 *
 * Usage:
 *   node src/test-send.js                  # Check login status
 *   node src/test-send.js search <query>   # Search contacts
 *   node src/test-send.js send <chatId> <message>  # Send message
 *   node src/test-send.js info <chatId>    # Get chat info
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { LarkUserClient } = require('./clients/user');

async function main() {
  const cookie = process.env.LARK_COOKIE;
  if (!cookie) {
    console.error('Set LARK_COOKIE in .env or environment');
    process.exit(1);
  }

  const client = new LarkUserClient(cookie);
  await client.init();
  console.log(`Logged in as: ${client.userName || client.userId}\n`);

  const cmd = process.argv[2];

  if (!cmd) {
    console.log('Session active. Available commands:');
    console.log('  node src/test-send.js search <query>');
    console.log('  node src/test-send.js send <chatId> <message>');
    console.log('  node src/test-send.js info <chatId>');
    return;
  }

  switch (cmd) {
    case 'search': {
      const query = process.argv[3];
      if (!query) { console.error('Usage: search <query>'); process.exit(1); }
      const results = await client.search(query);
      console.log('Results:');
      for (const r of results) {
        console.log(`  [${r.type}] ${r.title} (ID: ${r.id})`);
      }
      break;
    }
    case 'send': {
      const chatId = process.argv[3];
      const text = process.argv[4] || '[feishu-user-plugin] test message';
      if (!chatId) { console.error('Usage: send <chatId> [message]'); process.exit(1); }
      const result = await client.sendMessage(chatId, text);
      console.log('Send result:', result.success ? 'Success' : `Failed (status: ${result.status})`);
      break;
    }
    case 'info': {
      const chatId = process.argv[3];
      if (!chatId) { console.error('Usage: info <chatId>'); process.exit(1); }
      const info = await client.getGroupInfo(chatId);
      console.log('Chat info:', JSON.stringify(info, null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch(console.error);
