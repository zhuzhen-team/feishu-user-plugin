// src/server.js — MCP bootstrap, tool registration, request dispatch.
//
// What this owns:
//   - Loading every src/tools/<domain>.js module and flattening its schemas.
//   - Building the ctx object that handlers receive (factory closures + profile state).
//   - The MCP Server instance and its ListTools / CallTool request handlers.
//   - Startup diagnostics (auth status, APP_ID validation).
//
// What it does NOT own:
//   - Tool definitions: those live in src/tools/<domain>.js.
//   - Feishu API calls: those live in src/clients/{user,official}.
//   - Auth lifecycle (cookie heartbeat, UAT refresh, file lock): src/auth/*.
//   - Config discovery / persistence: src/config/*.

const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// Local dev fallback: MCP clients inject env vars from config's env block at
// spawn time. This dotenv line only matters when running locally with a .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { LarkUserClient } = require('./clients/user');
const { LarkOfficialClient } = require('./clients/official');
const { resolveToken } = require('./resolver');
const { listPrompts, getPrompt } = require('./prompts');
const credentials = require('./auth/credentials');

// --- Tool modules ---
// Adding a new domain: create src/tools/<x>.js exporting { schemas, handlers }
// and append it here. The schemas are concatenated into the MCP tools/list
// response; the handlers are looked up by name when tools/call comes in.
const TOOL_MODULES = [
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

const TOOLS = TOOL_MODULES.flatMap((m) => m.schemas);
const HANDLERS = Object.fromEntries(TOOL_MODULES.flatMap((m) => Object.entries(m.handlers)));

// --- Profile system + client singletons ---
// Profile resolution order (see src/auth/credentials.js):
//   1. ~/.feishu-user-plugin/credentials.json — single source of truth (v1.3.7+)
//   2. process.env.LARK_* — legacy default profile (v1.3.6 behaviour)
//   3. process.env.LARK_PROFILES_JSON — legacy named profiles
//
// switch_profile (handler in tools/profile.js) calls ctx.setActiveProfile(n)
// which resets the cached client singletons; the next tool call rebuilds them.
// When credentials.json exists, switching also persists the active field so
// cross-process MCP servers see the same active profile after restart.

let userClient = null;
let officialClient = null;
// The "current" profile this in-memory MCP server is pinned to. Initialised
// from the persisted active profile (credentials.json) at boot, but in-process
// switches may diverge from the persisted active until the next server restart.
let currentProfile = credentials.getActiveProfileName();

function profileEnv(name) {
  return credentials.getActiveProfileEnv(name);
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
  officialClient = new LarkOfficialClient(appId, appSecret);
  // Load UAT directly from the active profile env. With credentials.json the
  // env may differ from process.env (whose LARK_USER_* may be missing if the
  // user moved creds out of harness configs); using profileEnv() here keeps
  // the source of truth consistent with what get*Client() reads above.
  loadUATFromEnv(officialClient, env);
  return officialClient;
}

// Mirror of LarkOfficialClient.loadUAT() but sourced from a specific env block
// instead of process.env, so credentials.json profiles work uniformly.
function loadUATFromEnv(client, env) {
  const token = env.LARK_USER_ACCESS_TOKEN;
  const refresh = env.LARK_USER_REFRESH_TOKEN;
  const expires = parseInt(env.LARK_UAT_EXPIRES || '0');
  if (!token) return;
  client._uat = token;
  client._uatRefresh = refresh || null;
  client._uatExpires = expires || client._decodeTokenExpiry(token);
}

// Resolver helper: turn document_id / app_token / wiki node / Feishu URL into
// a native token. No-op for already-native inputs. See src/resolver.js.
async function resolveDocId(input) {
  if (!input) return input;
  return resolveToken(input, getOfficialClient());
}

// --- ctx ---
// What handlers receive in their second argument. Kept stable so tools/* don't
// reach back into server.js for state. Adding a new ctx field: also document
// it in src/tools/_registry.js docstring.
function buildCtx() {
  return {
    getUserClient,
    getOfficialClient,
    listProfiles: () => credentials.listProfileNames(),
    getActiveProfile: () => currentProfile,
    setActiveProfile: (n) => {
      // Validate the profile exists (throws if unknown) before nuking client cache.
      credentials.getActiveProfileEnv(n);
      currentProfile = n;
      userClient = null;
      officialClient = null;
      // Persist the active-field flip when credentials.json exists so peer MCP
      // servers see the new active profile on next read. Tolerated when no file.
      try { credentials.setActiveProfile(n); } catch (_) {}
    },
    resolveDocId,
  };
}

// --- MCP server ---

const server = new Server(
  { name: 'feishu-user-plugin', version: require('../package.json').version },
  { capabilities: { tools: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return await handler(args || {}, buildCtx());
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  return getPrompt(name, args || {});
});

// --- Process-level error handlers ---
// Prevent stray promise rejections or uncaught exceptions from killing the MCP server.
process.on('uncaughtException', (err) => {
  console.error('[feishu-user-plugin] Uncaught exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[feishu-user-plugin] Unhandled rejection:', reason);
});

// --- main ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Startup diagnostics — use the resolved active-profile env so users on
  // credentials.json (where process.env may not have LARK_*) get accurate flags.
  let activeEnv = {};
  try { activeEnv = profileEnv(currentProfile); } catch (_) { /* unknown profile is reported below */ }
  const hasCanonical = !!credentials.readCanonical();
  const hasCookie = !!activeEnv.LARK_COOKIE;
  const hasApp = !!(activeEnv.LARK_APP_ID && activeEnv.LARK_APP_SECRET);
  const hasUAT = !!activeEnv.LARK_USER_ACCESS_TOKEN;
  const source = hasCanonical ? `credentials.json profile=${currentProfile}` : 'env vars (legacy)';
  console.error(`[feishu-user-plugin] MCP Server v${require('../package.json').version} — ${TOOLS.length} tools, ${listPrompts().length} prompts`);
  console.error(`[feishu-user-plugin] Auth: Cookie=${hasCookie ? 'YES' : 'NO'} App=${hasApp ? 'YES' : 'NO'} UAT=${hasUAT ? 'YES' : 'NO'} (source: ${source})`);
  if (!hasCookie) console.error('[feishu-user-plugin] WARNING: LARK_COOKIE not set — user identity tools (send_to_user, etc.) will fail');
  if (!hasApp) console.error('[feishu-user-plugin] WARNING: LARK_APP_ID/SECRET not set — official API tools (read_messages, docs, etc.) will fail');
  if (!hasUAT) console.error('[feishu-user-plugin] WARNING: LARK_USER_ACCESS_TOKEN not set — P2P chat reading (read_p2p_messages) will fail');

  // Validate APP_ID/SECRET against Feishu before serving any tool calls.
  // Catches the "Claude filled in a wrong/stale APP_ID during install" failure
  // mode that otherwise surfaces as cryptic 401s on every Official API call
  // (looks like "MCP 掉线" to the user). Non-blocking — we warn but still serve,
  // because the user may only need user-identity (cookie) tools.
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

module.exports = { main, TOOLS, HANDLERS };

if (require.main === module) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
