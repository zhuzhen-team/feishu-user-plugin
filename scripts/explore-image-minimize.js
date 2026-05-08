#!/usr/bin/env node
'use strict';
// Minimize IMAGE Content fields. Start with known-working combo, drop one field
// at a time and observe which omissions still pass.

const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

const claudeCfg = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.claude.json'), 'utf8'));
const env = claudeCfg.mcpServers?.['feishu-user-plugin']?.env || {};
process.env.LARK_COOKIE = env.LARK_COOKIE;
process.env.LARK_APP_ID = env.LARK_APP_ID;
process.env.LARK_APP_SECRET = env.LARK_APP_SECRET;

const PLUGIN_ROOT = path.join(__dirname, '..');
const { LarkUserClient } = require(path.join(PLUGIN_ROOT, 'src/clients/user'));
const { LarkOfficialClient } = require(path.join(PLUGIN_ROOT, 'src/clients/official'));
const { generateCid, generateRequestId } = require(path.join(PLUGIN_ROOT, 'src/utils'));

const TEST_IMAGE = path.join(PLUGIN_ROOT, '.playwright-mcp/captures/test-small.png');
const TEST_GROUP_NAME = '飞书plugin测试群';

const errProto = protobuf.parse(`
  syntax = "proto3";
  message ErrorResponse {
    optional string message = 1;
    optional int32 code = 2;
    optional int32 subCode = 3;
    optional string detail = 4;
    optional string trace = 5;
    optional string requestId = 6;
  }
`).root;
const ErrorResponse = errProto.lookupType('ErrorResponse');

async function fetchProto(url, opts) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = require('node:https').request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function encodeVarint(n) {
  const bytes = [];
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function encodeWireField(num, type, val) {
  if (type === 'varint') return Buffer.concat([Buffer.from([(num << 3) | 0]), encodeVarint(val)]);
  if (type === 'string') {
    const v = Buffer.from(val, 'utf8');
    return Buffer.concat([Buffer.from([(num << 3) | 2]), encodeVarint(v.length), v]);
  }
  throw new Error('unknown type');
}

function buildContent(fields) {
  return Buffer.concat(fields.map(([n, t, v]) => encodeWireField(n, t, v)));
}

async function trySendRaw(userClient, chatId, msgType, contentBytes, label) {
  const proto = userClient.proto;
  const PutMessageRequest = proto.lookupType('PutMessageRequest');
  const Packet = proto.lookupType('Packet');

  const restReq = PutMessageRequest.encode(PutMessageRequest.create({
    type: msgType, chatId, cid: generateCid(), isNotified: true, version: 1,
  })).finish();
  const contentField = Buffer.concat([
    Buffer.from([(2 << 3) | 2]),
    encodeVarint(contentBytes.length),
    contentBytes,
  ]);
  const reqBuf = Buffer.concat([contentField, restReq]);

  const packetBuf = Packet.encode(Packet.create({
    payloadType: 1,
    cmd: 5,
    cid: generateRequestId(),
    payload: reqBuf,
  })).finish();

  const res = await fetchProto('https://internal-api-lark-api.feishu.cn/im/gateway/', {
    method: 'POST',
    headers: userClient._protoHeaders(5, '5.7.0'),
    body: packetBuf,
  });

  let parsedErr = null;
  try { parsedErr = ErrorResponse.toObject(ErrorResponse.decode(res.body)); } catch (_) {}

  const status = res.status === 200 ? '✓ OK' : `✗ ${res.status}`;
  const errMsg = parsedErr?.message?.slice(0, 100) || '';
  console.log(`${status} [${label}] ${errMsg}`);
  return { ok: res.status === 200, status: res.status, err: errMsg };
}

(async () => {
  const oc = new LarkOfficialClient(process.env.LARK_APP_ID, process.env.LARK_APP_SECRET);
  const r = await oc.uploadImage(TEST_IMAGE, 'message');
  const imageKey = r.imageKey;
  console.log('imageKey:', imageKey);

  const userClient = new LarkUserClient(process.env.LARK_COOKIE);
  await userClient.init();
  const sr = await userClient.search(TEST_GROUP_NAME);
  const chatId = sr.find(x => x.type === 'group' && x.title.includes(TEST_GROUP_NAME)).id;
  console.log('chatId:', chatId);

  // ALL fields baseline (known to work)
  const allFields = [
    [2, 'string', imageKey],     // imageKey
    [4, 'varint', 50],           // ?
    [5, 'varint', 50],           // ?
    [8, 'string', 'image/png'],  // mime?
    [9, 'varint', 141],          // size?
    [10, 'string', imageKey],    // thumbnail?
  ];

  console.log('\n=== Verify baseline (all 6 fields) ===');
  await trySendRaw(userClient, chatId, 5, buildContent(allFields), 'baseline all fields');

  console.log('\n=== Drop each field individually ===');
  // Field labels: imageKey is required; we test which of the OTHER 5 are required
  const others = [4, 5, 8, 9, 10];
  for (const dropField of others) {
    const subset = allFields.filter(([n]) => n !== dropField);
    const result = await trySendRaw(userClient, chatId, 5, buildContent(subset), `omit field ${dropField}`);
  }

  console.log('\n=== Drop pairs / minimize ===');
  // Just imageKey alone (already known to fail)
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0]]), 'just imageKey');
  // imageKey + field 10 (thumb)
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0], allFields[5]]), 'imageKey + thumb(10)');
  // imageKey + 4 + 5 (dims)
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0], allFields[1], allFields[2]]), 'imageKey + 4 + 5');
  // imageKey + 4 + 5 + 10
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0], allFields[1], allFields[2], allFields[5]]), 'imageKey + 4 + 5 + 10');
  // imageKey + 8 + 10 (mime + thumb)
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0], allFields[3], allFields[5]]), 'imageKey + mime(8) + thumb(10)');
  // imageKey + 4 + 5 + 8 (no size, no thumb)
  await trySendRaw(userClient, chatId, 5, buildContent([allFields[0], allFields[1], allFields[2], allFields[3]]), 'imageKey + 4 + 5 + mime(8)');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
