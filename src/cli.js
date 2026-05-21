#!/usr/bin/env node
/**
 * CLI entry point for feishu-user-plugin
 *
 * Usage:
 *   npx feishu-user-plugin          → Start MCP server (default, used by Claude Code)
 *   npx feishu-user-plugin setup    → Interactive setup wizard
 *   npx feishu-user-plugin oauth    → Run OAuth flow for UAT
 *   npx feishu-user-plugin status   → Check auth status
 *   npx feishu-user-plugin keepalive → Refresh cookie + UAT (for cron)
 */

const cmd = process.argv[2];

switch (cmd) {
  case 'setup':
    require('./setup');
    break;
  case 'oauth':
    require('./oauth');
    break;
  case 'status':
    checkStatus();
    break;
  case 'keepalive':
    keepalive();
    break;
  case 'list-prompts': {
    const { listPrompts } = require('./prompts');
    for (const p of listPrompts()) {
      console.log(`/${p.name} — ${p.description}`);
      for (const a of (p.arguments || [])) console.log(`  - ${a.name}${a.required ? ' (required)' : ''}: ${a.description}`);
    }
    break;
  }
  case 'tool':
    runTool();
    break;
  case 'migrate':
    migrate();
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  default:
    // Default: start MCP server (used by Claude Code / MCP clients)
    require('./index');
    break;
}

function printHelp() {
  console.log(`
feishu-user-plugin — All-in-one Feishu MCP Server

Commands:
  (default)   Start MCP server (used by Claude Code / Codex)
  setup       Interactive setup wizard — writes MCP config
  oauth       Run OAuth flow to obtain user_access_token
  status      Check authentication status
  keepalive   Refresh cookie + UAT to prevent expiration (for cron jobs)
  migrate     One-time consolidation: copy creds from harness configs into
              ~/.feishu-user-plugin/credentials.json (single source of truth).
              Dry-run by default. Add --confirm to actually write.
  tool        Invoke any MCP tool from the shell (v1.3.12):
              \`tool list\`                — list all tool names
              \`tool help <name>\`         — print schema for <name>
              \`tool <name> '<json-args>'\` — invoke <name>, print response
  help        Show this help

Setup options:
  --app-id <id>       App ID (non-interactive mode)
  --app-secret <s>    App Secret (non-interactive mode)
  --cookie <c>        Cookie string (optional)
  --client <target>   Config target: claude (default), codex, or both
  --force             Overwrite existing default profile in credentials.json
  --profile <name>    Create or update a named profile (replaces LARK_PROFILES_JSON
                      for new setups). Without --activate, leaves the active
                      profile unchanged so adding work2 doesn't yank you off default.
  --activate          When used with --profile, also flip credentials.json::active
                      to the named profile.

OAuth options (v1.3.9):
  npx feishu-user-plugin oauth --profile <name>
                      Get UAT for a specific profile. Default = currently active.

Keepalive options (v1.3.9):
  npx feishu-user-plugin keepalive --all
                      Refresh cookie + UAT for ALL profiles in credentials.json.
                      Default (no flag) = active profile only (back-compat).

Quick Start (Claude Code):
  1. npx feishu-user-plugin setup
  2. Follow the prompts to configure credentials
  3. Restart Claude Code

Quick Start (Codex):
  1. npx feishu-user-plugin setup --client codex
  2. Follow the prompts to configure credentials
  3. Restart Codex

Multi-account (v1.3.9):
  1. npx feishu-user-plugin setup --app-id X1 --app-secret S1 --cookie C1
  2. npx feishu-user-plugin oauth                          # default profile UAT
  3. npx feishu-user-plugin setup --profile work2 --app-id X2 --app-secret S2 --cookie C2
  4. npx feishu-user-plugin oauth --profile work2          # work2 profile UAT
  5. In Claude Code: switch_profile(name="work2") MCP tool to flip live

Auto-renewal (optional):
  Add to crontab to keep tokens alive even when Claude Code is closed:
  crontab -e → add: 0 */4 * * * npx feishu-user-plugin keepalive --all >> /tmp/feishu-keepalive.log 2>&1
`);
}

// `tool` subcommand — invoke any MCP tool from the shell (v1.3.12).
//
// Usage:
//   npx feishu-user-plugin tool list
//   npx feishu-user-plugin tool help <name>
//   npx feishu-user-plugin tool <name> '<json-args>'
//
// Reuses src/server.js's HANDLERS + buildCtx, so behaviour is identical to
// calling the tool from an MCP client. Output: tool's content[0].text
// (which is JSON for most tools — pipe through `jq` if you like).
async function runTool() {
  const { TOOLS, HANDLERS, buildCtx } = require('./server');
  const sub = process.argv[3];

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  npx feishu-user-plugin tool list
      List all ${TOOLS.length} registered tool names.
  npx feishu-user-plugin tool help <name>
      Print the inputSchema for <name>.
  npx feishu-user-plugin tool <name> '<json-args>'
      Invoke <name> with the given JSON args, print response text to stdout.

Examples:
  npx feishu-user-plugin tool list
  npx feishu-user-plugin tool help send_as_user
  npx feishu-user-plugin tool get_login_status '{}'
  npx feishu-user-plugin tool search_messages '{"query":"周报","page_size":5}'
`);
    process.exit(sub ? 0 : 2);
  }

  if (sub === 'list') {
    for (const t of TOOLS) {
      console.log(t.name);
    }
    return;
  }

  if (sub === 'help') {
    const name = process.argv[4];
    if (!name) { console.error('Usage: tool help <name>'); process.exit(2); }
    const t = TOOLS.find((x) => x.name === name);
    if (!t) { console.error(`Unknown tool: ${name}. Try \`tool list\`.`); process.exit(2); }
    console.log(`# ${t.name}\n`);
    console.log(t.description || '(no description)');
    console.log('\n## inputSchema\n');
    console.log(JSON.stringify(t.inputSchema || {}, null, 2));
    return;
  }

  // Dispatch path: sub is the tool name, argv[4] is the JSON args.
  const name = sub;
  const handler = HANDLERS[name];
  if (!handler) { console.error(`Unknown tool: ${name}. Try \`tool list\`.`); process.exit(2); }

  const jsonArgs = process.argv[4] || '{}';
  let args;
  try { args = JSON.parse(jsonArgs); }
  catch (e) {
    console.error(`tool ${name}: failed to parse JSON args (${e.message}). Pass a single quoted JSON string, e.g. '{"key":"value"}'.`);
    process.exit(2);
  }

  try {
    const ctx = buildCtx();
    const result = await handler(args, ctx);
    const text = result?.content?.[0]?.text;
    if (typeof text === 'string') {
      console.log(text);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    if (result?.isError) process.exit(1);
  } catch (e) {
    console.error(`tool ${name}: ${e.message}`);
    process.exit(1);
  }
}

function migrate() {
  const { migrate: runMigrate } = require('./auth/credentials');
  const confirm = process.argv.includes('--confirm');
  const result = runMigrate({ dryRun: !confirm });
  process.exit(result.ok ? 0 : 1);
}

async function keepalive() {
  const { LarkUserClient } = require('./clients/user');
  const { LarkOfficialClient } = require('./clients/official');
  const cred = require('./auth/credentials');

  // v1.3.9: --all flag iterates every profile in credentials.json,
  // refreshing cookie + UAT for each. Default behavior (no flag) refreshes
  // only the active profile (back-compat with v1.3.6+ cron usage).
  const all = process.argv.includes('--all');
  const targetProfiles = all ? cred.listProfileNames() : [cred.getActiveProfileName() || 'default'];

  let totalOk = true;
  for (const profileName of targetProfiles) {
    let env;
    try { env = cred.getActiveProfileEnv(profileName); }
    catch (e) {
      console.error(`[keepalive][${profileName}] cannot read profile: ${e.message}`);
      totalOk = false;
      continue;
    }
    if (!env.LARK_COOKIE && !env.LARK_APP_ID) {
      console.error(`[keepalive][${profileName}] no credentials. Run: npx feishu-user-plugin setup --profile ${profileName} ...`);
      totalOk = false;
      continue;
    }
    let ok = true;

    // 1. Refresh Cookie
    if (env.LARK_COOKIE && env.LARK_COOKIE !== 'SETUP_NEEDED') {
      try {
        const client = new LarkUserClient(env.LARK_COOKIE);
        await client.init();
        cred.persistProfileUpdate(profileName, { LARK_COOKIE: client.cookieStr });
        console.log(`[keepalive][${profileName}] cookie refreshed (user: ${client.userName})`);
      } catch (e) {
        console.error(`[keepalive][${profileName}] cookie refresh FAILED: ${e.message}`);
        ok = false;
      }
    }

    // 2. Refresh UAT (also writes to the same profile via auth/uat.js → persistToConfig
    //    which goes through the active profile path. For --all we need to switch
    //    active temporarily so the write lands on the right profile.)
    if (env.LARK_APP_ID && env.LARK_APP_SECRET && env.LARK_USER_ACCESS_TOKEN && env.LARK_USER_ACCESS_TOKEN !== 'SETUP_NEEDED' && env.LARK_USER_REFRESH_TOKEN) {
      const prevActive = cred.getActiveProfileName();
      const needSwitch = all && prevActive !== profileName;
      try {
        if (needSwitch) cred.setActiveProfile(profileName);
        // v1.3.14 — direct field assignment is the source of truth; do NOT
        // also set process.env (previous comment claimed LarkOfficialClient
        // would read process.env, but loadUAT() is dead code and process.env
        // pollution leaked between iterations of the --all loop).
        const official = new LarkOfficialClient(env.LARK_APP_ID, env.LARK_APP_SECRET);
        official._uat = env.LARK_USER_ACCESS_TOKEN;
        official._uatRefresh = env.LARK_USER_REFRESH_TOKEN;
        official._uatExpires = 0; // force refresh
        await official._refreshUAT();
        console.log(`[keepalive][${profileName}] UAT refreshed`);
      } catch (e) {
        console.error(`[keepalive][${profileName}] UAT refresh FAILED: ${e.message}`);
        ok = false;
      } finally {
        if (needSwitch) {
          try { cred.setActiveProfile(prevActive); } catch (_) {}
        }
      }
    }
    if (!ok) totalOk = false;
  }

  if (totalOk) console.log(`[keepalive] all profiles refreshed (${targetProfiles.length} profile${targetProfiles.length === 1 ? '' : 's'})`);
  else console.error(`[keepalive] one or more profiles failed`);
  process.exit(totalOk ? 0 : 1);
}

async function checkStatus() {
  const { LarkUserClient } = require('./clients/user');
  const { LarkOfficialClient } = require('./clients/official');
  const { findMcpConfig } = require('./config');
  const { readCanonical, getActiveProfileName, listProfileNames, readCredentials } = require('./auth/credentials');

  const canonical = readCanonical();
  const found = findMcpConfig();
  const creds = readCredentials();

  console.log('=== feishu-user-plugin Auth Status ===\n');
  if (canonical) {
    const path = require('path');
    const os = require('os');
    console.log(`Source: ${path.join(os.homedir(), '.feishu-user-plugin', 'credentials.json')} (canonical)`);
    console.log(`Active profile: ${getActiveProfileName()}`);
    console.log(`Available profiles: ${listProfileNames().join(', ')}`);
  } else if (found) {
    console.log(`Source: ${found.configPath}${found.projectPath ? ` (project: ${found.projectPath})` : ''} (legacy)`);
    console.log('Tip: run `npx feishu-user-plugin migrate --confirm` to consolidate creds into ~/.feishu-user-plugin/credentials.json.');
  } else {
    console.log('Source: NOT FOUND (run: npx feishu-user-plugin setup)');
  }
  console.log('');

  // Cookie
  const cookie = creds.LARK_COOKIE;
  if (cookie && cookie !== 'SETUP_NEEDED') {
    try {
      const client = new LarkUserClient(cookie);
      await client.init();
      console.log(`Cookie: OK (user: ${client.userName || client.userId})`);
    } catch (e) {
      console.log(`Cookie: FAILED — ${e.message}`);
    }
  } else {
    console.log('Cookie: NOT SET');
  }

  // App credentials
  const appId = creds.LARK_APP_ID;
  const appSecret = creds.LARK_APP_SECRET;
  console.log(`App credentials: ${appId && appSecret ? 'OK' : 'NOT SET'}`);

  // UAT
  const uat = creds.LARK_USER_ACCESS_TOKEN;
  const rt = creds.LARK_USER_REFRESH_TOKEN;
  if (uat && uat !== 'SETUP_NEEDED') {
    console.log(`UAT: SET (refresh_token: ${rt ? 'YES' : 'NO'})`);
    if (appId && appSecret) {
      const official = new LarkOfficialClient(appId, appSecret);
      // Set UAT fields directly (bypassing loadUAT which reads from process.env)
      official._uat = uat;
      official._uatRefresh = rt || null;
      official._uatExpires = parseInt(creds.LARK_UAT_EXPIRES || '0');
      try {
        await official.listChatsAsUser({ pageSize: 1 });
        console.log('  UAT test: OK (can list chats)');
      } catch (e) {
        console.log(`  UAT test: FAILED — ${e.message}`);
      }
    }
  } else {
    console.log('UAT: NOT SET (run: npx feishu-user-plugin oauth)');
  }
}
