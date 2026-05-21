#!/usr/bin/env node
/**
 * Setup wizard for feishu-user-plugin
 *
 * Two modes:
 *   Interactive:     npx feishu-user-plugin setup
 *   Non-interactive: npx feishu-user-plugin setup --app-id xxx --app-secret yyy
 *
 * Writes MCP config to ~/.claude.json top-level mcpServers (global).
 */

const readline = require('readline');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findMcpConfig, writeNewConfig } = require('./config');

// Parse CLI args: --app-id, --app-secret, --cookie, --client, --force, --profile
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app-id' && argv[i + 1]) args.appId = argv[++i];
    else if (argv[i] === '--app-secret' && argv[i + 1]) args.appSecret = argv[++i];
    else if (argv[i] === '--cookie' && argv[i + 1]) args.cookie = argv[++i];
    else if (argv[i] === '--client' && argv[i + 1]) args.client = argv[++i];
    else if (argv[i] === '--pointer-only') args.pointerOnly = true; // kept for backward compat; now implicit default
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--profile' && argv[i + 1]) args.profile = argv[++i];
    else if (argv[i] === '--activate') args.activate = true;
    else if (argv[i] === '--bind-hash' && argv[i + 1]) args.bindHash = argv[++i];
    else if (argv[i] === '--no-bind-hash') args.noBindHash = true;
  }
  return args;
}

async function main() {
  const cliArgs = parseArgs();
  const nonInteractive = !!(cliArgs.appId && cliArgs.appSecret);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('='.repeat(60));
  console.log('  feishu-user-plugin Setup');
  console.log('='.repeat(60));

  // Check existing config
  let existingEnv = {};
  const found = findMcpConfig();
  if (found) {
    existingEnv = found.serverEnv;
    if (found.projectPath) {
      console.log(`\nFound project-level config in ${found.configPath} (project: ${found.projectPath})`);
      console.log('This setup will write to global config instead (recommended).');
      console.log('You can remove the project-level entry later to avoid conflicts.');
    } else {
      console.log(`\nFound existing config in ${found.configPath}`);
    }
    if (!nonInteractive) {
      const update = await ask('Update config? (Y/n): ');
      if (update.toLowerCase() === 'n') {
        console.log('Cancelled.');
        rl.close();
        return;
      }
    }
  }

  // Resolve App credentials
  let appId, appSecret;

  if (nonInteractive) {
    // CLI args provided — no prompting
    appId = cliArgs.appId;
    appSecret = cliArgs.appSecret;
    console.log(`\nApp ID: ${appId}`);
    console.log('App Secret: ***');
  } else {
    // Interactive mode
    console.log('\n--- App Credentials ---');
    console.log('Get these from https://open.feishu.cn/app\n');

    const defaultAppId = existingEnv.LARK_APP_ID || '';
    const defaultAppSecret = existingEnv.LARK_APP_SECRET || '';

    appId = (await ask(`LARK_APP_ID [${defaultAppId || 'required'}]: `)).trim() || defaultAppId;
    if (!appId) {
      console.error('Error: LARK_APP_ID is required.');
      rl.close();
      process.exit(1);
    }

    appSecret = (await ask(`LARK_APP_SECRET [${defaultAppSecret ? '***' : 'required'}]: `)).trim() || defaultAppSecret;
    if (!appSecret) {
      console.error('Error: LARK_APP_SECRET is required.');
      rl.close();
      process.exit(1);
    }
  }

  // Validate app credentials
  console.log('\nValidating app credentials...');
  try {
    const { fetchWithTimeout } = require('./utils');
    const res = await fetchWithTimeout('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      timeoutMs: 10000,
    });
    const data = await res.json();
    if (data.app_access_token) {
      console.log('App credentials: VALID');
    } else {
      console.error(`App credentials: INVALID — ${data.msg || JSON.stringify(data)}`);
      rl.close();
      process.exit(1);
    }
  } catch (e) {
    console.warn(`Could not validate: ${e.message}. Continuing anyway.`);
  }

  // Resolve Cookie
  let cookie;
  if (cliArgs.cookie) {
    cookie = cliArgs.cookie;
  } else {
    const existingCookie = existingEnv.LARK_COOKIE;
    const hasCookie = existingCookie && existingCookie !== 'SETUP_NEEDED' && existingCookie.includes('session=');
    if (hasCookie) {
      cookie = existingCookie;
      console.log('\nKeeping existing cookie (has session token).');
    } else {
      cookie = 'SETUP_NEEDED';
      if (!nonInteractive) {
        console.log('\n--- Cookie ---');
        console.log('No valid cookie found. After setup:');
        console.log('  Tell Claude Code: "帮我设置飞书 Cookie" (with Playwright MCP)');
        console.log('  Or manually copy from DevTools → Network → Cookie header');
      }
    }
  }

  // Resolve UAT
  const existingUAT = existingEnv.LARK_USER_ACCESS_TOKEN;
  const existingRT = existingEnv.LARK_USER_REFRESH_TOKEN;
  const hasUAT = existingUAT && existingUAT !== 'SETUP_NEEDED' && existingUAT.length > 20;

  // Resolve target client
  let client = cliArgs.client || null; // 'claude' | 'codex' | 'both' | null (interactive)
  if (!client && !nonInteractive) {
    console.log('\n--- Target Client ---');
    console.log('  1. Claude Code (default)');
    console.log('  2. Codex');
    console.log('  3. Both');
    const choice = (await ask('Choose target [1]: ')).trim();
    if (choice === '2') client = 'codex';
    else if (choice === '3') client = 'both';
    else client = 'claude';
  }
  if (!client) client = 'claude';

  // --- 4-state SSOT matrix (v1.3.9 A.3) ---
  // Determines how credentials.json is created/updated based on current state.
  //
  //   State 1 (fresh):        credentials.json absent, no harness LARK_* env → create fresh
  //   State 2 (auto-migrate): credentials.json absent, harness LARK_* env exists → migrate
  //   State 3 (preserve):     credentials.json present, no --app-id → touch nothing in file
  //   State 4 (update):       credentials.json present, --app-id given → update/add profile
  const credentials = require('./auth/credentials');
  const credsPath = path.join(os.homedir(), '.feishu-user-plugin', 'credentials.json');
  const credsExist = !!credentials.readCanonical();
  const targetProfile = cliArgs.profile || 'default';
  const harnessHasLark = !!(existingEnv.LARK_APP_ID || existingEnv.LARK_COOKIE || existingEnv.LARK_USER_ACCESS_TOKEN);

  let mode;
  if (!credsExist && !harnessHasLark) mode = 'fresh';
  else if (!credsExist && harnessHasLark) mode = 'auto-migrate';
  else if (credsExist && !cliArgs.appId) mode = 'preserve';
  else mode = 'update';
  console.log(`\nSetup mode: ${mode}`);

  if (mode === 'fresh' || mode === 'update') {
    // Gather profile values — only include keys that have real values.
    const profileValues = {};
    if (appId) profileValues.LARK_APP_ID = appId;
    if (appSecret) profileValues.LARK_APP_SECRET = appSecret;
    if (cookie && cookie !== 'SETUP_NEEDED') profileValues.LARK_COOKIE = cookie;
    else if (existingEnv.LARK_COOKIE && existingEnv.LARK_COOKIE !== 'SETUP_NEEDED') profileValues.LARK_COOKIE = existingEnv.LARK_COOKIE;
    if (existingEnv.LARK_USER_ACCESS_TOKEN && existingEnv.LARK_USER_ACCESS_TOKEN !== 'SETUP_NEEDED') profileValues.LARK_USER_ACCESS_TOKEN = existingEnv.LARK_USER_ACCESS_TOKEN;
    if (existingEnv.LARK_USER_REFRESH_TOKEN) profileValues.LARK_USER_REFRESH_TOKEN = existingEnv.LARK_USER_REFRESH_TOKEN;

    if (mode === 'fresh') {
      fs.mkdirSync(path.dirname(credsPath), { recursive: true, mode: 0o700 });
      const data = { version: 1, active: targetProfile, profiles: { [targetProfile]: profileValues }, profileHints: {} };
      fs.writeFileSync(credsPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      console.log(`Created ${credsPath} with profile "${targetProfile}"`);
    } else {
      // mode === 'update'
      const canonical = credentials.readCanonical();
      const profileExists = !!(canonical && canonical.profiles[targetProfile]);
      if (profileExists && targetProfile === 'default' && !cliArgs.force && !cliArgs.profile) {
        console.error(`Profile "default" already exists. Pass --force to overwrite, or --profile <name> to create a new profile.`);
        rl.close();
        process.exit(1);
      }
      if (profileExists && cliArgs.profile && !cliArgs.force) {
        console.error(`Profile "${targetProfile}" already exists. Pass --force to overwrite, or pick a different --profile name.`);
        rl.close();
        process.exit(1);
      }
      canonical.profiles[targetProfile] = { ...(canonical.profiles[targetProfile] || {}), ...profileValues };
      // v1.3.9 fix: only flip credentials.json::active when --activate is given.
      // Without --activate, adding/updating a non-active profile leaves the
      // current active alone (least-surprise: "I added work2, default is still
      // active, I'll switch when I want via MCP switch_profile").
      if (cliArgs.activate || (cliArgs.force && targetProfile === canonical.active)) {
        canonical.active = targetProfile;
      }
      fs.writeFileSync(credsPath, JSON.stringify(canonical, null, 2) + '\n', { mode: 0o600 });
      console.log(`Updated profile "${targetProfile}" in ${credsPath}`);
      if (cliArgs.activate) console.log(`  → active profile flipped to "${targetProfile}"`);
      else if (canonical.active !== targetProfile) {
        console.log(`  → active profile unchanged ("${canonical.active}"). Pass --activate to flip, or use switch_profile MCP tool at runtime.`);
      }
      if (cliArgs.force) console.warn(`  warning: overwrote existing profile credentials with --force`);
    }
  } else if (mode === 'auto-migrate') {
    // Run migrate to consolidate harness env → credentials.json, then optionally
    // override the default profile with any explicitly provided --app-id.
    const result = credentials.migrate({ dryRun: false });
    if (!result.ok) {
      console.error('Auto-migrate failed; aborting setup.');
      rl.close();
      process.exit(1);
    }
    if (cliArgs.appId) {
      credentials.persistProfileUpdate('default', { LARK_APP_ID: appId, LARK_APP_SECRET: appSecret });
      console.log('Updated default profile with new app credentials.');
    }
  }
  // mode === 'preserve': credentials.json is unchanged; we only update the harness pointer.

  // --- Lark Desktop hash auto-bind (v1.3.11 §A) ---
  // Triggers on fresh / update (i.e. whenever credentials.json was just modified).
  // Skipped via --no-bind-hash. Explicit --bind-hash overrides auto-detect.
  if ((mode === 'fresh' || mode === 'update') && !cliArgs.noBindHash) {
    try {
      const larkDesktop = require('./auth/lark-desktop');
      const hashes = larkDesktop.listAccountHashes();
      if (hashes.length > 0) {
        let chosenHash = cliArgs.bindHash;
        if (!chosenHash) {
          if (hashes.length === 1) {
            chosenHash = hashes[0].hash;
            console.log(`\n[Lark Desktop] Detected single account hash: ${chosenHash}`);
          } else if (nonInteractive) {
            chosenHash = hashes[0].hash;
            console.log(`\n[Lark Desktop] Detected ${hashes.length} accounts; auto-binding "${targetProfile}" to most-recent: ${chosenHash}`);
            console.log(`  Other hashes (run setup --profile <name> --bind-hash <hash> to bind):`);
            hashes.slice(1).forEach((h) => {
              const ts = new Date(h.mtimeMs).toISOString();
              console.log(`    - ${h.hash}  (last active ${ts})`);
            });
          } else {
            console.log(`\n[Lark Desktop] Multiple accounts detected:`);
            hashes.forEach((h, i) => {
              const ts = new Date(h.mtimeMs).toISOString();
              console.log(`  ${i + 1}. ${h.hash}  (last active ${ts})`);
            });
            const pick = (await ask(`Bind profile "${targetProfile}" to which? [1]: `)).trim() || '1';
            const idx = parseInt(pick, 10) - 1;
            chosenHash = (idx >= 0 && idx < hashes.length) ? hashes[idx].hash : hashes[0].hash;
          }
        }
        credentials.setProfileLarkHash(targetProfile, chosenHash);
        console.log(`Bound profile "${targetProfile}" to Lark account hash ${chosenHash}`);
        console.log(`  → MCP will auto-switch to this profile when Lark Desktop activates this account.`);
      }
      // hashes.length === 0 → silent (Lark not installed, or non-darwin) — don't disrupt setup
    } catch (e) {
      console.error(`[Lark Desktop] auto-bind skipped: ${e.message}`);
    }
  }

  // --- Write harness config ---
  // Always write pointer-only env to harness configs (v1.3.9 SSOT).
  // The harness env block only needs FEISHU_PLUGIN_PROFILE; all real creds
  // live in credentials.json.
  console.log('\n--- Writing Config ---');
  // v1.3.9 fix: harness env pointer should reflect what credentials.json::active
  // will end up as, not blindly the targetProfile (which would mislead users
  // who added a non-active profile via --profile alt without --activate).
  const finalCanonical = credentials.readCanonical();
  const harnessActive = finalCanonical?.active || targetProfile;
  const pointerEnv = { FEISHU_PLUGIN_PROFILE: harnessActive };
  const result = writeNewConfig(pointerEnv, undefined, undefined, client, { pointerOnly: true });
  if (result.configPath) console.log(`Written to ${result.configPath} (Claude Code)`);
  if (result.codexConfigPath) console.log(`Written to ${result.codexConfigPath} (Codex)`);
  console.log(`Mode: pointer-only (env block contains only FEISHU_PLUGIN_PROFILE=${targetProfile})`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  Setup Complete!');
  console.log('='.repeat(60));

  const todo = [];
  if (cookie === 'SETUP_NEEDED') todo.push('Get Cookie: tell Claude Code "帮我设置飞书 Cookie"');
  if (!hasUAT) todo.push('Get UAT: run "npx feishu-user-plugin oauth"');
  todo.push('Restart Claude Code');

  console.log('\nNext steps:');
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log('');

  rl.close();
}

main().catch(e => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
