// src/test-via-user.js — verify the v1.3.12 `via_user` param on
// read_messages controls bot/UAT routing.
//
// Pre-v1.3.12 read_messages auto-failed bot → UAT (skipBot true only when
// chat resolved via cookie search_contacts). No way for the LLM/user to
// say "I know this is mine, go UAT first" or "I want only the bot view".
//
// New: read_messages accepts `via_user: boolean`.
//   - via_user=true  → skip bot, go straight to UAT (alias of skipBot)
//   - via_user=false → bot-only, NEVER fall back to UAT (skipUat new)
//   - undefined      → existing auto-fallback (default)
//
// Test stubs readMessagesWithFallback directly to count which paths fire.

'use strict';

const assert = require('node:assert/strict');
const { handlers } = require('./tools/im-read');

function fakeCtx({ fallbackImpl, asUserImpl }) {
  let lastOpts;
  const official = {
    hasUAT: true,
    readMessagesWithFallback: async (chatId, msgOpts, uc, opts) => {
      lastOpts = opts;
      return fallbackImpl({ chatId, msgOpts, opts });
    },
    readMessagesAsUser: async (chatId, msgOpts, uc) => {
      lastOpts = { via: 'user' };
      return asUserImpl ? asUserImpl({ chatId, msgOpts }) : { items: [], via: 'user' };
    },
    getChatInfo: async () => ({ name: 'fake group' }),
  };
  return {
    getOfficialClient: () => official,
    getUserClient: async () => ({
      search: async () => [],
    }),
    _getLastOpts: () => lastOpts,
  };
}

async function run() {
  // --- 1. via_user=true → skipBot ---
  {
    const ctx = fakeCtx({
      fallbackImpl: ({ opts }) => ({ items: [], opts }),
    });
    const resp = await handlers.read_messages({ chat_id: 'oc_x', via_user: true }, ctx);
    const opts = ctx._getLastOpts();
    assert.ok(opts);
    assert.equal(opts.skipBot, true, 'via_user=true → skipBot=true');
  }

  // --- 2. via_user=false → skipUat ---
  {
    const ctx = fakeCtx({
      fallbackImpl: ({ opts }) => ({ items: [], opts }),
    });
    const resp = await handlers.read_messages({ chat_id: 'oc_x', via_user: false }, ctx);
    const opts = ctx._getLastOpts();
    assert.ok(opts);
    assert.equal(opts.skipUat, true, 'via_user=false → skipUat=true');
  }

  // --- 3. via_user undefined → default auto-fallback (no skip flags) ---
  {
    const ctx = fakeCtx({
      fallbackImpl: ({ opts }) => ({ items: [], opts }),
    });
    const resp = await handlers.read_messages({ chat_id: 'oc_x' }, ctx);
    const opts = ctx._getLastOpts();
    // Either opts is undefined or both skip flags absent — both mean auto-fallback.
    assert.ok(!opts || !opts.skipBot, 'no via_user → no skipBot (auto)');
    assert.ok(!opts || !opts.skipUat, 'no via_user → no skipUat (auto)');
  }

  // --- 4. read_messages schema has via_user param ---
  {
    const { schemas } = require('./tools/im-read');
    const readMessages = schemas.find(s => s.name === 'read_messages');
    assert.ok(readMessages);
    assert.ok(readMessages.inputSchema.properties.via_user,
      'read_messages inputSchema should have via_user property');
    assert.equal(readMessages.inputSchema.properties.via_user.type, 'boolean');
    assert.ok(readMessages.inputSchema.properties.via_user.description.length > 30,
      'via_user description should explain the routing semantics');
  }

  console.log('via-user.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
