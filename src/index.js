#!/usr/bin/env node
require('./logger'); // installs global stdout guard — MUST be first

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
// Local dev fallback: MCP clients inject env vars from config's env block at spawn time.
// This dotenv line only matters when running locally with a .env file (e.g. during development).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { LarkUserClient } = require('./clients/user');
const { LarkOfficialClient } = require('./clients/official');
const { resolveToObj, resolveToken, parseFeishuInput } = require('./resolver');

// External tool modules (extracted in v1.3.7 phase A). Each exports
// { schemas: [...], handlers: { [name]: async (args, ctx) => MCPResponse } }.
// They get merged into TOOLS at module load and dispatched via the switch
// default branch. Task 28 will replace this hand-wired dispatch with
// src/server.js's registry-based one.
const EXTERNAL_TOOL_MODULES = [
  require('./tools/bitable'),
  require('./tools/calendar'),
  require('./tools/contacts'),
  require('./tools/diagnostics'),
  require('./tools/docs'),
  require('./tools/drive'),
  require('./tools/groups'),
  require('./tools/messaging-bot'),
  require('./tools/messaging-user'),
  require('./tools/okr'),
  require('./tools/profile'),
  require('./tools/uploads'),
  require('./tools/wiki'),
];

// --- Chat ID Mapper ---

class ChatIdMapper {
  constructor() {
    this.nameCache = new Map(); // oc_id → chat name
    this.lastRefresh = 0;
    this.TTL = 5 * 60 * 1000; // 5 min cache
  }

  async _refresh(official) {
    if (Date.now() - this.lastRefresh < this.TTL) return;
    try {
      const chats = await official.listAllChats();
      this.nameCache.clear();
      for (const chat of chats) {
        this.nameCache.set(chat.chat_id, chat.name || '');
      }
      this.lastRefresh = Date.now();
    } catch (e) {
      console.error('[feishu-user-plugin] ChatIdMapper refresh failed:', e.message);
    }
  }

  // Case-insensitive name matching helper
  static _nameMatch(haystack, needle, exact = false) {
    if (!haystack || !needle) return false;
    const h = haystack.toLowerCase(), n = needle.toLowerCase();
    return exact ? h === n : h.includes(n);
  }

  async findByName(name, official) {
    await this._refresh(official);
    // Exact match first (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name, true)) return ocId;
    }
    // Partial match (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name)) return ocId;
    }
    return null;
  }

  async resolveToOcId(chatIdOrName, official) {
    if (!chatIdOrName) return null;
    if (chatIdOrName.startsWith('oc_')) return chatIdOrName;
    // Also accept raw numeric IDs (from search_contacts)
    if (/^\d+$/.test(chatIdOrName)) return chatIdOrName;
    // Strategy 1: Search in bot's group list cache
    const cached = await this.findByName(chatIdOrName, official);
    if (cached) return cached;
    // Strategy 2: Use im.v1.chat.search API (finds groups even if not in cache)
    try {
      const results = await official.chatSearch(chatIdOrName);
      for (const chat of results) {
        this.nameCache.set(chat.chat_id, chat.name || '');
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName, true)) return chat.chat_id;
      }
      // Partial match on search results (case-insensitive)
      for (const chat of results) {
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName)) return chat.chat_id;
      }
    } catch (e) {
      console.error('[feishu-user-plugin] chatSearch fallback failed:', e.message);
    }
    return null;
  }

  // Strategy 3: Use search_contacts (cookie-based) to find external groups by name
  // Returns numeric chat_id that works with UAT readMessagesAsUser
  async resolveViaContacts(chatName, userClient) {
    if (!userClient) return null;
    try {
      const results = await userClient.search(chatName);
      const groups = results.filter(r => r.type === 'group');
      // Exact match first (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName, true)) return String(g.id);
      }
      // Partial match (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName)) return String(g.id);
      }
    } catch (e) {
      console.error('[feishu-user-plugin] search_contacts fallback failed:', e.message);
    }
    return null;
  }
}

// --- Client Singletons + Profiles ---

let userClient = null;
let officialClient = null;
const chatIdMapper = new ChatIdMapper();

// Profile system (v1.3.6).
// Default behaviour is identical to pre-1.3.6: LARK_COOKIE / LARK_APP_ID / etc.
// from process.env act as profile "default". To register more profiles, set
// LARK_PROFILES_JSON in the MCP env to a JSON object:
//   { "alt": { "LARK_COOKIE": "...", "LARK_APP_ID": "...", ... }, ... }
// Then call switch_profile to change which credential set is active.
let currentProfile = 'default';

function loadProfileMap() {
  const raw = process.env.LARK_PROFILES_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    console.error(`[feishu-user-plugin] LARK_PROFILES_JSON parse failed: ${e.message}`);
  }
  return {};
}

function profileEnv(name) {
  if (name === 'default') {
    return {
      LARK_COOKIE: process.env.LARK_COOKIE,
      LARK_APP_ID: process.env.LARK_APP_ID,
      LARK_APP_SECRET: process.env.LARK_APP_SECRET,
      LARK_USER_ACCESS_TOKEN: process.env.LARK_USER_ACCESS_TOKEN,
      LARK_USER_REFRESH_TOKEN: process.env.LARK_USER_REFRESH_TOKEN,
    };
  }
  const profiles = loadProfileMap();
  if (!profiles[name]) throw new Error(`Profile "${name}" not found. Available: ${['default', ...Object.keys(profiles)].join(', ')}`);
  return profiles[name];
}

async function getUserClient() {
  if (userClient) return userClient;
  const env = profileEnv(currentProfile);
  const cookie = env.LARK_COOKIE;
  if (!cookie) throw new Error(
    `LARK_COOKIE not set for profile "${currentProfile}". To fix:\n` +
    '1. Open https://www.feishu.cn/messenger/ and log in\n' +
    '2. DevTools → Network tab → Disable cache → Reload → Click first request → Request Headers → Cookie → Copy value\n' +
    '   (Do NOT use document.cookie or Application→Cookies — they miss HttpOnly cookies like session/sl_session)\n' +
    '3. Paste the cookie string into your .mcp.json env LARK_COOKIE field, then restart Claude Code\n' +
    'If Playwright MCP is available: navigate to feishu.cn/messenger/, let user log in, then use context.cookies() to get the full cookie string including HttpOnly cookies.'
  );
  userClient = new LarkUserClient(cookie);
  await userClient.init();
  return userClient;
}

function getOfficialClient() {
  if (officialClient) return officialClient;
  const env = profileEnv(currentProfile);
  const appId = env.LARK_APP_ID;
  const appSecret = env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error(
    `LARK_APP_ID and LARK_APP_SECRET not set for profile "${currentProfile}".\n` +
    'For team members: these should be pre-filled in your .mcp.json. Check that the config was copied correctly from the team-skills README.\n' +
    'For external users: create a Custom App at https://open.feishu.cn/app, get the App ID and App Secret, add them to your .mcp.json env.'
  );
  // Honor profile-specific UAT env if present (LarkOfficialClient.loadUAT uses
  // process.env directly; we patch the env temporarily for non-default profiles)
  const prevUAT = process.env.LARK_USER_ACCESS_TOKEN;
  const prevRT = process.env.LARK_USER_REFRESH_TOKEN;
  if (currentProfile !== 'default') {
    if (env.LARK_USER_ACCESS_TOKEN) process.env.LARK_USER_ACCESS_TOKEN = env.LARK_USER_ACCESS_TOKEN;
    if (env.LARK_USER_REFRESH_TOKEN) process.env.LARK_USER_REFRESH_TOKEN = env.LARK_USER_REFRESH_TOKEN;
  }
  officialClient = new LarkOfficialClient(appId, appSecret);
  officialClient.loadUAT();
  if (currentProfile !== 'default') {
    process.env.LARK_USER_ACCESS_TOKEN = prevUAT;
    process.env.LARK_USER_REFRESH_TOKEN = prevRT;
  }
  return officialClient;
}

// --- Tool Definitions ---

const TOOLS = [
  // ========== Profile management — extracted to src/tools/profile.js ==========

  // ========== User Identity / batch / card — extracted to src/tools/messaging-user.js ==========

  // search_contacts / create_p2p_chat / get_user_info → src/tools/contacts.js
  // get_chat_info stays here — it'll move with im-read in the next batch.
  {
    name: 'get_chat_info',
    description: '[Official API + User Identity fallback] Get chat details: name, description, member count, owner. Supports both oc_xxx and numeric chat_id.',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string', description: 'Chat ID (oc_xxx or numeric)' } },
      required: ['chat_id'],
    },
  },
  // get_login_status → src/tools/diagnostics.js

  // ========== IM — Official API (User Identity via UAT) ==========
  {
    name: 'read_p2p_messages',
    description: '[User UAT] Read P2P (direct message) chat history using user_access_token. Works for chats the bot cannot access. Returns newest messages first by default. Auto-expands merge_forward messages into their child messages by default — disable with expand_merge_forward=false. Requires OAuth setup.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (numeric from create_p2p_chat, or oc_xxx from list_user_chats). Both formats work.' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
        expand_merge_forward: { type: 'boolean', description: 'Auto-expand merge_forward placeholders into their child messages (default true). Children carry parentMessageId; use that id (not the child id) with download_image / download_file.' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'list_user_chats',
    description: '[User UAT] List group chats the user is in. Note: only returns groups, not P2P. For P2P chats, use search_contacts → create_p2p_chat → read_p2p_messages. Requires OAuth setup.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },

  // ========== IM — Official API (Bot Identity) ==========
  {
    name: 'list_chats',
    description: '[Official API] List all chats the bot has joined. Returns chat_id, name, type.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20, max 100)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
  {
    name: 'read_messages',
    description: '[Official API + UAT fallback] Read message history from any group. Accepts oc_xxx ID, numeric ID, or chat name (auto-searched). Auto-falls back to UAT for external groups the bot cannot access. Returns newest messages first by default, with sender names resolved. Auto-expands merge_forward messages into their child messages (with original sender / time / content preserved) by default — disable with expand_merge_forward=false. Text messages have URLs extracted into `urls`; Feishu doc links are additionally surfaced as `feishuDocs` so agents can feed them straight into read_doc / get_doc_blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx), numeric ID, or chat name (auto-searched via bot groups, im.chat.search, and user contacts)' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
        expand_merge_forward: { type: 'boolean', description: 'Auto-expand merge_forward placeholders into their child messages (default true). Children carry parentMessageId; use that id (not the child id) with download_image / download_file.' },
      },
      required: ['chat_id'],
    },
  },
  // reply_message / forward_message → src/tools/messaging-bot.js

  // ========== Docs — extracted to src/tools/docs.js ==========

  // ========== Bitable — extracted to src/tools/bitable.js ==========

  // ========== Wiki — extracted to src/tools/wiki.js ==========

  // ========== Drive / Upload / Contact — extracted to src/tools/{drive,uploads,contacts}.js ==========

  // ========== IM — Bot Send / Edit / Delete + Reactions + Pins — extracted to src/tools/messaging-bot.js ==========
  // send_card_as_user → src/tools/messaging-user.js
  // delete_message / update_message / add_reaction / delete_reaction / pin_message → src/tools/messaging-bot.js

  // ========== IM — Chat Management — extracted to src/tools/groups.js ==========

  // create_doc_block / update_doc_block / delete_doc_blocks → src/tools/docs.js

  // ========== Bitable — Additional schemas → src/tools/bitable.js ==========

  // ========== Drive — File Operations — extracted to src/tools/drive.js ==========

  // download_image / download_file → src/tools/diagnostics.js
  // get_wiki_node → src/tools/wiki.js
  // list_user_okrs / get_okrs / list_okr_periods → src/tools/okr.js
  // list_calendars / list_calendar_events / get_calendar_event → src/tools/calendar.js

];

// Splice external tool schemas in alongside the legacy inline ones.
// As Tasks 14–27 extract more handlers into src/tools/*.js, the inline TOOLS
// array shrinks and EXTERNAL_TOOL_MODULES grows.
for (const mod of EXTERNAL_TOOL_MODULES) TOOLS.push(...mod.schemas);

// --- Server ---

const server = new Server(
  { name: 'feishu-user-plugin', version: require('../package.json').version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleTool(name, args || {});
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (o) => {
  // If the underlying method surfaced a fallback warning (UAT unavailable,
  // resource owned by bot), lift it to the top of the response so the human /
  // agent sees it *before* the structured body. Keeps the JSON payload intact.
  const warn = o && typeof o === 'object' && o.fallbackWarning ? `${o.fallbackWarning}\n\n` : '';
  return text(warn + JSON.stringify(o, null, 2));
};
const sendResult = (r, desc) => text(r.success ? desc : `Send failed (status: ${r.status})`);

// Resolver helper: turn document_id / app_token / wiki node / Feishu URL into
// a native token. No-op for already-native inputs. See src/resolver.js.
async function resolveDocId(input) {
  if (!input) return input;
  return resolveToken(input, getOfficialClient());
}

async function handleTool(name, args) {

  switch (name) {
    // Profile management → src/tools/profile.js (dispatched via default branch)

    // send_to_* / batch_send / send_card_as_user → src/tools/messaging-user.js

    // --- User Identity: Contacts & Info ---

    // search_contacts / create_p2p_chat → src/tools/contacts.js

    case 'get_chat_info': {
      // Strategy 1: Official API im.chat.get (supports oc_xxx format)
      if (args.chat_id.startsWith('oc_')) {
        try {
          const info = await getOfficialClient().getChatInfo(args.chat_id);
          return info ? json(info) : text(`No info for chat ${args.chat_id}`);
        } catch (e) {
          console.error(`[feishu-user-plugin] Official getChatInfo failed: ${e.message}`);
        }
      }
      // Strategy 2: Protobuf gateway (supports numeric chat_id)
      try {
        const c = await getUserClient();
        const info = await c.getGroupInfo(args.chat_id);
        if (info) return json(info);
      } catch (e) {
        console.error(`[feishu-user-plugin] Protobuf getChatInfo failed: ${e.message}`);
      }
      return text(`No info for chat ${args.chat_id}`);
    }
    // get_user_info → src/tools/contacts.js
    // get_login_status → src/tools/diagnostics.js (dispatched via default branch)

    // --- User UAT: IM ---

    case 'read_p2p_messages': {
      const official = getOfficialClient();
      let chatId = args.chat_id;
      let uc = null;
      let ucError = null;
      try { uc = await getUserClient(); } catch (e) { ucError = e; }
      // If chat_id is not numeric or oc_, try to resolve as user name → P2P chat
      if (!/^\d+$/.test(chatId) && !chatId.startsWith('oc_')) {
        if (uc) {
          const results = await uc.search(chatId);
          const user = results.find(r => r.type === 'user');
          if (user) {
            const pChatId = await uc.createChat(String(user.id));
            if (pChatId) chatId = String(pChatId);
            else return text(`Found user "${user.title}" but failed to create P2P chat.`);
          } else {
            // Maybe it's a group name
            const group = results.find(r => r.type === 'group');
            if (group) chatId = String(group.id);
            else return text(`Cannot resolve "${args.chat_id}" to a chat. Use search_contacts to find the ID first.`);
          }
        } else {
          const hint = ucError ? `Cookie auth failed: ${ucError.message}. Fix LARK_COOKIE first, or p` : 'P';
          return text(`"${args.chat_id}" is not a valid chat ID. ${hint}rovide a numeric ID or oc_xxx format. Use search_contacts + create_p2p_chat to get the ID.`);
        }
      }
      return json(await official.readMessagesAsUser(chatId, {
        pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
        sortType: args.sort_type,
        expandMergeForward: args.expand_merge_forward !== false,
      }, uc));
    }
    case 'list_user_chats':
      return json(await getOfficialClient().listChatsAsUser({ pageSize: args.page_size, pageToken: args.page_token }));

    // --- Official API: IM ---

    case 'list_chats':
      return json(await getOfficialClient().listChats({ pageSize: args.page_size, pageToken: args.page_token }));
    case 'read_messages': {
      const official = getOfficialClient();
      const msgOpts = {
        pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
        sortType: args.sort_type,
        expandMergeForward: args.expand_merge_forward !== false,
      };
      // Get userClient for name resolution fallback (best-effort)
      let uc = null;
      try { uc = await getUserClient(); } catch (_) {}

      // Path A — chat_id that resolves inside bot's / official search scope.
      const resolvedChatId = await chatIdMapper.resolveToOcId(args.chat_id, official);
      if (resolvedChatId) {
        return json(await official.readMessagesWithFallback(resolvedChatId, msgOpts, uc));
      }

      // Path B — external group discovered only via cookie search_contacts.
      // When we got here the bot definitely can't see it, so skip bot entirely
      // and go straight to UAT with a `contacts` via label.
      if (official.hasUAT) {
        if (!uc) try { uc = await getUserClient(); } catch (_) {}
        const contactChatId = await chatIdMapper.resolveViaContacts(args.chat_id, uc);
        if (contactChatId) {
          return json(await official.readMessagesWithFallback(contactChatId, msgOpts, uc, { skipBot: true, via: 'contacts' }));
        }
      }

      return text(`Cannot resolve "${args.chat_id}" to a chat ID.\nSearched: bot's group list, im.chat.search API, and user contacts (search_contacts).\nTry: provide the oc_xxx or numeric chat ID directly.`);
    }
    // reply_message / forward_message → src/tools/messaging-bot.js (dispatched via default branch)

    // search_docs / read_doc / get_doc_blocks / create_doc → src/tools/docs.js (dispatched via default branch)

    // Bitable handlers → src/tools/bitable.js

    // --- Official API: Wiki ---

    // list_wiki_spaces / search_wiki / list_wiki_nodes → src/tools/wiki.js

    // Drive / Contact / Upload handlers → src/tools/{drive,contacts,uploads}.js

    // --- Official API: Bot Send / Edit / Delete ---
    // send_card_as_user → src/tools/messaging-user.js
    // send_message_as_bot / delete_message / update_message / add_reaction / delete_reaction / pin_message
    //   → src/tools/messaging-bot.js (dispatched via default branch)

    // create_group / update_group / list_members / manage_members → src/tools/groups.js

    // create_doc_block / update_doc_block / delete_doc_blocks → src/tools/docs.js (dispatched via default branch)

    // Bitable additional handlers → src/tools/bitable.js

    // copy_file / move_file / delete_file → src/tools/drive.js

    // download_image / download_file → src/tools/diagnostics.js
    // get_wiki_node → src/tools/wiki.js
    // list_user_okrs / get_okrs / list_okr_periods → src/tools/okr.js
    // list_calendars / list_calendar_events / get_calendar_event → src/tools/calendar.js

    default: {
      // Hand off to extracted tool modules. ctx exposes the closure state
      // (clients, profile state, mappers) that handlers used to grab from the
      // surrounding lexical scope. Task 28 will replace this default-branch
      // dispatch with src/server.js's registry-based routing.
      const ctx = {
        getUserClient,
        getOfficialClient,
        listProfiles: () => ['default', ...Object.keys(loadProfileMap())],
        getActiveProfile: () => currentProfile,
        setActiveProfile: (n) => {
          currentProfile = n;
          userClient = null;
          officialClient = null;
        },
        chatIdMapper,
        resolveDocId,
      };
      for (const mod of EXTERNAL_TOOL_MODULES) {
        if (mod.handlers[name]) return mod.handlers[name](args, ctx);
      }
      return text(`Unknown tool: ${name}`);
    }
  }
}

// --- Process-level error handlers ---
// Prevent stray promise rejections or uncaught exceptions from killing the MCP server.
process.on('uncaughtException', (err) => {
  console.error('[feishu-user-plugin] Uncaught exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[feishu-user-plugin] Unhandled rejection:', reason);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Startup diagnostics
  const hasCookie = !!process.env.LARK_COOKIE;
  const hasApp = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
  const hasUAT = !!process.env.LARK_USER_ACCESS_TOKEN;
  console.error(`[feishu-user-plugin] MCP Server v${require('../package.json').version} — ${TOOLS.length} tools`);
  console.error(`[feishu-user-plugin] Auth: Cookie=${hasCookie ? 'YES' : 'NO'} App=${hasApp ? 'YES' : 'NO'} UAT=${hasUAT ? 'YES' : 'NO'}`);
  if (!hasCookie) console.error('[feishu-user-plugin] WARNING: LARK_COOKIE not set — user identity tools (send_to_user, etc.) will fail');
  if (!hasApp) console.error('[feishu-user-plugin] WARNING: LARK_APP_ID/SECRET not set — official API tools (read_messages, docs, etc.) will fail');
  if (!hasUAT) console.error('[feishu-user-plugin] WARNING: LARK_USER_ACCESS_TOKEN not set — P2P chat reading (read_p2p_messages) will fail');

  // Validate APP_ID/SECRET against Feishu before serving any tool calls.
  // Catches the "Claude filled in a wrong/stale APP_ID during install" failure mode
  // that otherwise surfaces as cryptic 401s on every Official API call (looks like
  // "MCP 掉线" to the user). Non-blocking — we warn but still serve, because the
  // user may only need user-identity (cookie) tools.
  if (hasApp) {
    try {
      const probe = await getOfficialClient().verifyApp();
      if (probe.valid) {
        const nameBit = probe.appName ? ` "${probe.appName}"` : '';
        console.error(`[feishu-user-plugin] App verified: ${probe.appId}${nameBit}`);
      } else {
        console.error(`[feishu-user-plugin] ERROR: LARK_APP_ID=${probe.appId} was REJECTED by Feishu (${probe.error}).`);
        console.error('[feishu-user-plugin] → Every Official API tool call will fail. Likely wrong/stale APP_ID.');
        console.error('[feishu-user-plugin] → Re-run the install prompt from team-skills/plugins/feishu-user-plugin/README.md to get the correct credentials.');
      }
    } catch (e) {
      console.error(`[feishu-user-plugin] WARNING: Could not verify APP_ID (${e.message}); network issue or cold start. Proceeding anyway.`);
    }
  }
}

main().catch(console.error);
