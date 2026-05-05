#!/usr/bin/env node
'use strict';
// Decode a captured Feishu protobuf payload against proto/lark.proto.
//
// Usage:
//   node scripts/decode-feishu-protobuf.js Packet            < /path/to/payload.bin
//   echo "0a..." | node scripts/decode-feishu-protobuf.js Packet --hex
//   node scripts/decode-feishu-protobuf.js Packet --b64 'CgRwYWNr...'
//
// Output:
//   - Decoded JSON of the named message
//   - "Unknown fields detected" section listing tag numbers + wire types we
//     don't have in the proto (these are what we need to add).

const path = require('path');
const protobuf = require('protobufjs');

async function main() {
  const args = process.argv.slice(2);
  const messageName = args[0];
  if (!messageName) {
    console.error('Usage: node scripts/decode-feishu-protobuf.js <MessageName> [--hex | --b64 <data>]');
    process.exit(2);
  }
  const flagIdx = args.indexOf('--hex');
  const b64Idx = args.indexOf('--b64');

  let buf;
  if (b64Idx !== -1) {
    buf = Buffer.from(args[b64Idx + 1], 'base64');
  } else if (flagIdx !== -1) {
    const hex = await readStdin();
    buf = Buffer.from(hex.replace(/\s+/g, ''), 'hex');
  } else {
    buf = await readStdinBuffer();
  }

  const proto = await protobuf.load(path.join(__dirname, '..', 'proto', 'lark.proto'));
  const T = proto.lookupType(messageName);
  const decoded = T.decode(buf);
  const obj = T.toObject(decoded, { defaults: false, bytes: String });
  // Walk the buffer to find unknown field tags.
  const unknown = scanUnknownFields(buf, T);
  console.log(JSON.stringify(obj, _dumpBytes, 2));
  if (unknown.length) {
    console.log('\n--- Unknown fields detected ---');
    for (const u of unknown) console.log(`  field ${u.tag} (wire type ${u.wireType}, ${u.length} bytes): ${u.preview}`);
    console.log('\nFor each unknown tag, add the field to proto/lark.proto and re-run to see the decoded shape.');
  } else {
    console.log('\n--- All fields known ---');
  }
}

function _dumpBytes(_, v) {
  if (Buffer.isBuffer(v)) return `<${v.length} bytes 0x${v.slice(0, 16).toString('hex')}${v.length > 16 ? '…' : ''}>`;
  return v;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function readStdinBuffer() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Walks raw protobuf bytes, decoding tag headers, and reports tags whose
// number+wireType is not present in the schema. Matches protobufjs's reader
// state machine but operates entry-point-only (no recursion into subtrees).
function scanUnknownFields(buf, type) {
  const known = new Set(type.fieldsArray.map(f => f.id));
  const reader = protobuf.Reader.create(buf);
  const out = [];
  while (reader.pos < reader.len) {
    const tagInt = reader.uint32();
    const tag = tagInt >>> 3;
    const wireType = tagInt & 7;
    const start = reader.pos;
    let value;
    try {
      value = readValueByWireType(reader, wireType);
    } catch (e) {
      out.push({ tag, wireType, length: 0, preview: `decode error: ${e.message}` });
      break;
    }
    if (!known.has(tag)) {
      const len = reader.pos - start;
      let preview;
      if (Buffer.isBuffer(value)) preview = `0x${value.slice(0, 24).toString('hex')}${value.length > 24 ? '…' : ''}`;
      else preview = String(value).slice(0, 80);
      out.push({ tag, wireType, length: len, preview });
    }
  }
  return out;
}

function readValueByWireType(reader, wireType) {
  switch (wireType) {
    case 0: return reader.uint64();        // varint
    case 1: return reader.fixed64();       // 64-bit
    case 2: return Buffer.from(reader.bytes()); // length-delimited
    case 5: return reader.fixed32();       // 32-bit
    default: reader.skipType(wireType); return null;
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
