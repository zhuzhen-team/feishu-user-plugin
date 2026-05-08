#!/usr/bin/env node
'use strict';
// CARD (type=14) protobuf field exploration. Probe field numbers + types.

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
const { generateCid, generateRequestId } = require(path.join(PLUGIN_ROOT, 'src/utils'));

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
  while (n >= 0x80) { bytes.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

function encodeWireField(num, type, val) {
  if (type === 'varint') return Buffer.concat([Buffer.from([(num << 3) | 0]), encodeVarint(val)]);
  if (type === 'string' || type === 'bytes') {
    const v = type === 'string' ? Buffer.from(val, 'utf8') : val;
    const tag = (num << 3) | 2;
    if (num < 16) return Buffer.concat([Buffer.from([tag]), encodeVarint(v.length), v]);
    // For field numbers > 15, tag is multi-byte varint
    return Buffer.concat([encodeVarint(tag), encodeVarint(v.length), v]);
  }
  throw new Error('unknown type');
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
  const errMsg = parsedErr?.message?.slice(0, 120) || '';
  console.log(`${status} [${label}] ${errMsg}`);
  return { ok: res.status === 200, status: res.status, err: errMsg };
}

(async () => {
  const userClient = new LarkUserClient(process.env.LARK_COOKIE);
  await userClient.init();
  const sr = await userClient.search(TEST_GROUP_NAME);
  const chatId = sr.find(x => x.type === 'group' && x.title.includes(TEST_GROUP_NAME)).id;
  console.log('chatId:', chatId);

  const card = JSON.stringify({
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '[explore-card] please ignore' } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: 'Cookie protobuf test card' } }],
  });
  const cardBuf = Buffer.from(card, 'utf8');
  console.log('card json size:', cardBuf.length);

  console.log('\n=== Phase A: try type=14 with each unused field number ===');
  // Known used: 1(text), 2(imageKey), 3(title), 6(fileKey), 7(audioKey), 11(fileName), 14(richText), 24(stickerSetId), 25(stickerId)
  // Unused (potential card field): 4, 5, 8, 9, 10, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23
  const candidates = [4, 5, 8, 9, 10, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  for (const fieldNum of candidates) {
    // Try as string (JSON)
    const ckS = encodeWireField(fieldNum, 'string', card);
    const res = await trySendRaw(userClient, chatId, 14, ckS, `field ${fieldNum} string=cardJSON`);
    if (res.ok) {
      console.log(`\n🎯 SUCCESS at field ${fieldNum}!`);
    }
  }

  console.log('\n=== Phase B: special — Content field 14 is richText. Try CARD via richText? ===');
  // Skip — richText is for POST type. CARD is different.

  console.log('\n=== Phase C: combos — maybe card needs type at multiple fields ===');
  // Like image needed thumb. Try card at field 8 + 9 + 10 + 16 etc.
  // Skip for now — Phase A may have answered.
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
