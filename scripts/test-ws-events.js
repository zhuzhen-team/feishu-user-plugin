#!/usr/bin/env node
'use strict';
// Manual e2e: spawn MCP server, wait for WS connect, send a message to a test
// chat (configurable via TEST_CHAT_ID env), then call get_new_events and verify
// the message appears.
//
// Skipped on CI (POSIX 77) when no LARK_APP_ID/SECRET/UAT or no TEST_CHAT_ID.

const { spawn } = require('child_process');
const path = require('path');
const { readCredentials } = require('../src/auth/credentials');

const creds = readCredentials();
const TEST_CHAT_ID = process.env.TEST_CHAT_ID;
if (!creds.LARK_APP_ID || !creds.LARK_APP_SECRET || !TEST_CHAT_ID) {
  console.error('Skipped: needs LARK_APP_ID/SECRET (real, not mock) and TEST_CHAT_ID env.');
  process.exit(77);
}

(async () => {
  console.log('Spawning MCP server with WS...');
  const child = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  let buf = ''; const responses = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) try { const m = JSON.parse(line); if (m.id != null) responses.set(m.id, m); } catch {}
  });
  let wsConnected = false;
  child.stderr.on('data', (d) => {
    const s = d.toString();
    process.stderr.write('  child: ' + s);
    if (/WS connected/i.test(s)) wsConnected = true;
  });

  const send = (id, method, params) => child.stdin.write(JSON.stringify({jsonrpc:'2.0', id, method, params})+'\n');
  const wait = (id, ms = 10000) => new Promise((res, rej) => {
    const t = setInterval(() => { if (responses.has(id)) { clearInterval(t); res(responses.get(id)); } }, 50);
    setTimeout(() => { clearInterval(t); rej(new Error('timeout id=' + id)); }, ms);
  });

  send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ws-test', version: '0' }});
  await wait(1);

  // Wait for WS to connect (up to 15s).
  const wsStart = Date.now();
  while (!wsConnected && Date.now() - wsStart < 15000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!wsConnected) {
    console.error('FAIL: WS did not connect within 15s.');
    child.kill();
    process.exit(1);
  }
  console.log('  WS connected after', Date.now() - wsStart, 'ms');

  // Send a test message via send_message_as_bot (requires bot to be in TEST_CHAT_ID).
  const stamp = `ws-test-${Date.now()}`;
  send(2, 'tools/call', { name: 'send_message_as_bot', arguments: { chat_id: TEST_CHAT_ID, msg_type: 'text', payload: { text: stamp } } });
  await wait(2, 15000);
  console.log('  sent test message:', stamp);

  // Wait a few seconds for the WS round-trip.
  await new Promise(r => setTimeout(r, 5000));

  send(3, 'tools/call', { name: 'get_new_events', arguments: { since_seconds: 30, max_events: 50 } });
  const r3 = await wait(3, 5000);
  const txt = r3.result?.content?.[0]?.text || '';
  const found = txt.includes(stamp);
  console.log('  get_new_events response includes stamp?', found);

  child.kill();

  if (!found) {
    console.error('FAIL: WS did not deliver the test message via get_new_events.');
    console.error('Response:', txt.slice(0, 500));
    process.exit(1);
  }
  console.log('PASS: WS delivered the test message.');
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
