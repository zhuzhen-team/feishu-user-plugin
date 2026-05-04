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
  require('./tools/im-read'),
  require('./tools/messaging-bot'),
  require('./tools/messaging-user'),
  require('./tools/okr'),
  require('./tools/profile'),
  require('./tools/uploads'),
  require('./tools/wiki'),
];

// --- Client Singletons + Profiles ---

let userClient = null;
let officialClient = null;

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
  // get_chat_info / read_p2p_messages / list_user_chats / list_chats / read_messages → src/tools/im-read.js
  // get_login_status → src/tools/diagnostics.js

  // ========== IM — Read paths — extracted to src/tools/im-read.js ==========
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

    // get_chat_info / read_p2p_messages / list_user_chats / list_chats / read_messages
    //   → src/tools/im-read.js (dispatched via default branch)
    // get_user_info → src/tools/contacts.js
    // get_login_status → src/tools/diagnostics.js (dispatched via default branch)

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
