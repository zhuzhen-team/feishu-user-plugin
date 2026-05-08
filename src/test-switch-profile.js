// src/test-switch-profile.js
// e2e test: validate switch_profile invalidates cached clients + persists active.
//
// CAUTION: this test temporarily modifies ~/.feishu-user-plugin/credentials.json.
// Backup is taken at start and restored at end (try/finally). If the test
// crashes mid-run, the backup file is named cred-backup-<ts>.json — restore
// manually if you see one in /tmp/.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');

const credPath = path.join(os.homedir(), '.feishu-user-plugin', 'credentials.json');

function _readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function _writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
}

async function run() {
  // Warn user before doing anything
  console.error('[test-switch-profile] WARNING: temporarily modifying ~/.feishu-user-plugin/credentials.json. Stop running MCP processes (pkill -f feishu-user-plugin) to avoid interference.');

  const ts = Date.now();
  const backupPath = path.join(os.tmpdir(), `cred-backup-${ts}.json`);
  const originalCanonical = _readJson(credPath);

  // Backup existing file (or note absence)
  if (originalCanonical) {
    fs.copyFileSync(credPath, backupPath);
  } else {
    _writeJson(backupPath, { absent: true });
  }
  console.error(`[test-switch-profile] backup → ${backupPath}`);

  try {
    // Write fixture with active=default + two profiles (default + alt)
    // Use user's real default profile if available (so the APP_ID check works),
    // otherwise fall back to dummy. The test only needs a recognisable prefix.
    const baseDefault = (originalCanonical?.profiles?.default) || {
      LARK_APP_ID: 'cli_test_def_xxxxxxxx',
      LARK_APP_SECRET: 'test_secret_def',
    };

    const dummyAlt = {
      LARK_APP_ID: 'cli_test_alt_xxxxxxxx',
      LARK_APP_SECRET: 'test_secret_alt',
      LARK_COOKIE: 'session=fake_alt_cookie',
      LARK_USER_ACCESS_TOKEN: 'u-fake-alt-uat',
      LARK_USER_REFRESH_TOKEN: 'fake-alt-refresh',
    };

    const fixture = {
      version: 1,
      active: 'default',
      profiles: { default: baseDefault, alt: dummyAlt },
      profileHints: {},
    };
    _writeJson(credPath, fixture);

    // Bust require cache so credentials.js re-reads the fresh fixture on next require.
    // Also bust resolver / server in case they cache credential-derived state.
    for (const mod of ['./auth/credentials', './resolver', './tools/profile']) {
      try {
        delete require.cache[require.resolve(mod)];
      } catch (_) { /* module may not be in cache yet — harmless */ }
    }
    // server.js import chain is large; skip busting it to avoid side-effects.
    // We replicate the minimal ctx surface below instead.

    // ── Minimal ctx (mirrors what src/server.js builds, minus MCP transport) ──
    const credentials = require('./auth/credentials');
    const { LarkUserClient } = require('./clients/user');
    const { LarkOfficialClient } = require('./clients/official');

    let userClient = null;
    let officialClient = null;
    let currentProfile = credentials.getActiveProfileName();

    async function getUserClient() {
      if (userClient) return userClient;
      const env = credentials.getActiveProfileEnv(currentProfile);
      // Do NOT call await userClient.init() — that hits the network.
      userClient = new LarkUserClient(env.LARK_COOKIE || 'dummy');
      return userClient;
    }

    function getOfficialClient() {
      if (officialClient) return officialClient;
      const env = credentials.getActiveProfileEnv(currentProfile);
      officialClient = new LarkOfficialClient(env.LARK_APP_ID, env.LARK_APP_SECRET);
      return officialClient;
    }

    const ctx = {
      getUserClient,
      getOfficialClient,
      listProfiles: () => credentials.listProfileNames(),
      getActiveProfile: () => currentProfile,
      setActiveProfile: (n) => {
        // Validate profile exists (throws if not)
        credentials.getActiveProfileEnv(n);
        currentProfile = n;
        userClient = null;
        officialClient = null;
        // Persist to credentials.json (already validated above)
        credentials.setActiveProfile(n);
      },
    };

    const profile = require('./tools/profile');

    // ── Assertion 1: initial state ──
    assert.equal(currentProfile, 'default', 'initial profile should be "default"');
    const c1 = getOfficialClient();
    // Use baseDefault's actual APP_ID if present, otherwise the dummy prefix
    const expectedDefaultPrefix = baseDefault.LARK_APP_ID || 'cli_test_def_';
    assert.equal(c1.appId, expectedDefaultPrefix, 'first client uses default profile APP_ID');

    // ── Assertion 2: switch to alt ──
    await profile.handlers.switch_profile({ name: 'alt' }, ctx);
    assert.equal(currentProfile, 'alt', 'currentProfile should be "alt" after switch');

    // ── Assertion 3: credentials.json::active updated ──
    const fresh = _readJson(credPath);
    assert.equal(fresh.active, 'alt', 'credentials.json::active should be "alt"');

    // ── Assertion 4: cached client invalidated; next getOfficialClient rebuilds ──
    const c2 = getOfficialClient();
    assert.notEqual(c2, c1, 'client instance should differ after profile switch');
    assert.ok(c2.appId.startsWith('cli_test_alt_'), `alt client APP_ID should start with "cli_test_alt_" (got "${c2.appId}")`);

    // ── Assertion 5: switch back to default ──
    await profile.handlers.switch_profile({ name: 'default' }, ctx);
    assert.equal(currentProfile, 'default', 'currentProfile should be "default" after switch back');
    const afterSwitch = _readJson(credPath);
    assert.equal(afterSwitch.active, 'default', 'credentials.json::active should be "default" after switch back');

    const c3 = getOfficialClient();
    assert.notEqual(c3, c2, 'client instance should differ again after switch back');
    assert.equal(c3.appId, expectedDefaultPrefix, 'client after switch-back uses default profile APP_ID');

    console.log('switch-profile-e2e: PASS');
  } finally {
    // Restore original credentials.json (or remove if it didn't exist)
    if (originalCanonical) {
      _writeJson(credPath, originalCanonical);
    } else {
      try { fs.unlinkSync(credPath); } catch (_) {}
    }
    console.error(`[test-switch-profile] restored credentials.json from ${backupPath}`);
    // Clean up backup on success (it's in /tmp/, so not critical, but tidy)
    try { fs.unlinkSync(backupPath); } catch (_) {}
  }
}

if (require.main === module) {
  run().catch((e) => {
    console.error('switch-profile-e2e: FAIL', e);
    process.exit(1);
  });
}

module.exports = { run };
