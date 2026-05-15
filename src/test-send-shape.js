// src/test-send-shape.js — verify all 8 send_*_as_user tool handlers
// return the v1.3.12 unified shape: {ok, viaUser, fallbackWarning?, messageId?}
//
// Pre-v1.3.12 the user-identity send tools returned plain text
// ("Text sent as user to oc_xxx"); send_card_as_user already returned
// a bot-path messageId text. The new shape is JSON inside an MCP text
// content block so the LLM can read ok / viaUser / messageId structurally
// without regex.

'use strict';

const assert = require('node:assert/strict');
const { handlers: msgHandlers } = require('./tools/messaging-user');

// Parse a tool MCP response { content: [{type:'text', text: '...'}] } where
// the text is JSON. Returns the parsed object, or null if the text isn't JSON
// (e.g. disambiguation message from send_to_user with multiple matches).
function parseJsonResponse(resp) {
  const t = resp?.content?.[0]?.text;
  if (typeof t !== 'string') return null;
  try { return JSON.parse(t); } catch (_) { return null; }
}

// Stub MCP ctx with controllable per-call behavior.
function fakeCtx({ sendImpl, botSendImpl } = {}) {
  const userClient = {
    sendMessage: async (chat, text /* , opts */) => sendImpl({ chat, text, kind: 'text' }),
    sendImage:   async (chat, key /* , opts */) => sendImpl({ chat, key, kind: 'image' }),
    sendFile:    async (chat, key, name /* , opts */) => sendImpl({ chat, key, name, kind: 'file' }),
    sendPost:    async (chat, title, paragraphs /* , opts */) => sendImpl({ chat, title, paragraphs, kind: 'post' }),
    search: async () => [], // tests below avoid send_to_user / send_to_group multi-match
    createChat: async () => 'oc_fake',
  };
  return {
    getUserClient: async () => userClient,
    getOfficialClient: () => ({
      sendMessageAsBot: async (chat, msgType, payload) => botSendImpl({ chat, msgType, payload }),
    }),
    resolveDocId: async (x) => x,
  };
}

async function run() {
  // --- 1. send_as_user → ok / viaUser=true / status passed through ---
  {
    const ctx = fakeCtx({
      sendImpl: async () => ({ success: true, status: 0 }),
    });
    const resp = await msgHandlers.send_as_user({ chat_id: '7234567890123', text: 'hi' }, ctx);
    const parsed = parseJsonResponse(resp);
    assert.ok(parsed, 'send_as_user should return JSON-parseable shape');
    assert.equal(parsed.ok, true, 'ok flag present and true on success');
    assert.equal(parsed.viaUser, true, 'cookie/user path → viaUser=true');
    assert.equal(parsed.fallbackWarning, undefined);
  }

  // --- 2. send_as_user failure → ok=false ---
  {
    const ctx = fakeCtx({
      sendImpl: async () => ({ success: false, status: 70003 }),
    });
    const resp = await msgHandlers.send_as_user({ chat_id: '7234567890123', text: 'hi' }, ctx);
    const parsed = parseJsonResponse(resp);
    assert.ok(parsed);
    assert.equal(parsed.ok, false, 'failed send → ok=false');
    assert.equal(parsed.viaUser, true);
  }

  // --- 3. send_image_as_user, send_file_as_user, send_post_as_user — same shape ---
  for (const [name, args] of [
    ['send_image_as_user', { chat_id: '7234567890123', image_key: 'img_xxx' }],
    ['send_file_as_user',  { chat_id: '7234567890123', file_key: 'file_xxx', file_name: 'a.pdf' }],
    ['send_post_as_user',  { chat_id: '7234567890123', title: 'T', paragraphs: [] }],
  ]) {
    const ctx = fakeCtx({
      sendImpl: async () => ({ success: true, status: 0 }),
    });
    const resp = await msgHandlers[name](args, ctx);
    const parsed = parseJsonResponse(resp);
    assert.ok(parsed, `${name} should return JSON shape`);
    assert.equal(parsed.ok, true, `${name} ok=true on success`);
    assert.equal(parsed.viaUser, true, `${name} viaUser=true`);
  }

  // --- 4. send_card_as_user → viaUser=false + messageId ---
  {
    const ctx = fakeCtx({
      botSendImpl: async () => ({ messageId: 'om_card_123' }),
    });
    const resp = await msgHandlers.send_card_as_user({ chat_id: '7234567890123', card: {} }, ctx);
    const parsed = parseJsonResponse(resp);
    assert.ok(parsed, 'send_card_as_user JSON');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.viaUser, false, 'card path goes via bot → viaUser=false');
    assert.equal(parsed.messageId, 'om_card_123');
  }

  // --- 5. unified shape: no extra fields beyond {ok, viaUser, description?, fallbackWarning?, messageId?, status?} ---
  {
    const ctx = fakeCtx({
      sendImpl: async () => ({ success: true, status: 0 }),
    });
    const resp = await msgHandlers.send_as_user({ chat_id: '7234567890123', text: 'hi' }, ctx);
    const parsed = parseJsonResponse(resp);
    const allowed = new Set(['ok', 'viaUser', 'description', 'fallbackWarning', 'messageId', 'status']);
    for (const k of Object.keys(parsed)) {
      assert.ok(allowed.has(k), `send_as_user returned unexpected key '${k}' — unified shape allows only ${[...allowed].join(', ')}`);
    }
  }

  console.log('send-shape.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
