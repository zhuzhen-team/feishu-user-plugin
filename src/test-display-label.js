#!/usr/bin/env node
// src/test-display-label.js — unit test for LarkOfficialClient._computeDisplayLabel
//
// _computeDisplayLabel maps a formatted message (with senderId/senderType/senderName/
// isRecalled fields) to a human-friendly string for LLM consumption. This covers the
// 6 sender shapes Feishu actually produces:
//
//   1. user with resolved name           → name
//   2. user with senderName=null         → "(open_id)" fallback
//   3. app (bot) with name in cache      → "[Bot] AppName"
//   4. app (bot) without name            → "[Bot] (cli_xxx)"
//   5. anonymous sender                  → "[匿名]"
//   6. system message (no sender)        → "[系统]"
//   7. recalled-message prefix           → "[已撤回] " + base label
//
// Without the implementation this script fails (which is what we want pre-fix).

const { LarkOfficialClient } = require('./clients/official/base');

const client = new LarkOfficialClient('cli_dummy', 'dummy_secret');
client._appNameCache.set('cli_named_bot', 'Claude聊天助手');

const tests = [
  {
    name: 'user with resolved name',
    input: { senderType: 'user', senderId: 'ou_x', senderName: '周宇' },
    expected: '周宇',
  },
  {
    name: 'user with null senderName',
    input: { senderType: 'user', senderId: 'ou_abc123', senderName: null },
    expected: '(ou_abc123)',
  },
  {
    name: 'app with name in cache',
    input: { senderType: 'app', senderId: 'cli_named_bot' },
    expected: '[Bot] Claude聊天助手',
  },
  {
    name: 'app without name',
    input: { senderType: 'app', senderId: 'cli_unknown' },
    expected: '[Bot] (cli_unknown)',
  },
  {
    name: 'anonymous',
    input: { senderType: 'anonymous', senderId: 'ou_x' },
    expected: '[匿名]',
  },
  {
    name: 'system (no senderId)',
    input: { senderId: undefined },
    expected: '[系统]',
  },
  {
    name: 'recalled user message',
    input: { senderType: 'user', senderId: 'ou_x', senderName: '怪兽', isRecalled: true },
    expected: '[已撤回] 怪兽',
  },
  {
    name: 'recalled with null senderName',
    input: { senderType: 'user', senderId: 'ou_y', senderName: null, isRecalled: true },
    expected: '[已撤回] (ou_y)',
  },
];

let failures = 0;
for (const t of tests) {
  let actual;
  try {
    actual = client._computeDisplayLabel(t.input);
  } catch (e) {
    console.error(`FAIL ${t.name}: threw ${e.message}`);
    failures++;
    continue;
  }
  if (actual !== t.expected) {
    console.error(`FAIL ${t.name}: expected ${JSON.stringify(t.expected)}, got ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`OK   ${t.name}`);
  }
}

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${tests.length} display-label tests passed`);
