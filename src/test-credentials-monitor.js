// src/test-credentials-monitor.js — unit test for src/auth/credentials-monitor.js.
//
// Pre-v1.3.12 hot-reload was partial: server.js stat-ed credentials.json mtime
// and dispatched setActiveProfile() on change, but the UAT in-memory token,
// _userNameCache, and lockfile heartbeat never observed the change. Users had
// to restart Claude Code after `npx oauth` for the new UAT to take effect.
//
// CredentialsMonitor unifies the mtime + content-hash diff into a single
// poll triggered per tool call. Owners register hooks for the parts they
// care about: onUatChange / onCookieChange / onProfileSwitch / onCacheInvalidate.
//
// We test against a temporary credentials.json in a tmpdir so the test is
// isolated from any real ~/.feishu-user-plugin state.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const { createCredentialsMonitor } = require('./auth/credentials-monitor');

function writeCreds(dir, obj) {
  const p = path.join(dir, 'credentials.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  return p;
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-monitor-'));
  const credPath = path.join(dir, 'credentials.json');

  const baseCreds = {
    version: 1,
    active: 'default',
    profiles: {
      default: {
        LARK_APP_ID: 'cli_a',
        LARK_USER_ACCESS_TOKEN: 'uat_v1',
        LARK_USER_REFRESH_TOKEN: 'ref_v1',
        LARK_COOKIE: 'cookie_v1',
      },
    },
  };
  writeCreds(dir, baseCreds);

  // Inject path so monitor doesn't read real ~/.feishu-user-plugin
  const monitor = createCredentialsMonitor({ path: credPath });

  // --- 1. First sync establishes baseline; no hooks fire ---
  let uatFired = 0, cookieFired = 0, profileFired = 0, cacheFired = 0;
  monitor.onUatChange(() => uatFired++);
  monitor.onCookieChange(() => cookieFired++);
  monitor.onProfileSwitch(() => profileFired++);
  monitor.onCacheInvalidate(() => cacheFired++);

  monitor.sync();
  assert.equal(uatFired, 0, 'baseline sync should not fire hooks');
  assert.equal(cookieFired, 0);
  assert.equal(profileFired, 0);
  assert.equal(cacheFired, 0);

  // --- 2. Change UAT field → onUatChange fires, others don't ---
  // We must advance the mtime AFTER content change; on fast filesystems writing
  // the same path repeatedly within the same ms gives identical mtime. Set
  // explicit mtime so behaviour doesn't depend on FS clock granularity.
  const after1 = { ...baseCreds, profiles: { default: { ...baseCreds.profiles.default, LARK_USER_ACCESS_TOKEN: 'uat_v2', LARK_USER_REFRESH_TOKEN: 'ref_v2' } } };
  writeCreds(dir, after1);
  fs.utimesSync(credPath, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
  monitor.sync();
  assert.equal(uatFired, 1, 'onUatChange should fire on UAT diff');
  assert.equal(cookieFired, 0, 'unchanged cookie → no cookie hook');
  assert.equal(profileFired, 0, 'unchanged active → no profile hook');
  assert.equal(cacheFired, 1, 'any change should fire onCacheInvalidate once');

  // --- 3. Same content, just touch mtime → no hook fires (content hash guards) ---
  fs.utimesSync(credPath, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  monitor.sync();
  assert.equal(uatFired, 1, 'touch (no content change) should not fire UAT');
  assert.equal(cacheFired, 1);

  // --- 4. Change cookie → onCookieChange fires ---
  const after2 = { ...after1, profiles: { default: { ...after1.profiles.default, LARK_COOKIE: 'cookie_v2' } } };
  writeCreds(dir, after2);
  fs.utimesSync(credPath, new Date(Date.now() + 3000), new Date(Date.now() + 3000));
  monitor.sync();
  assert.equal(cookieFired, 1);
  assert.equal(profileFired, 0);

  // --- 5. Change active profile → onProfileSwitch fires (legacy parity) ---
  const after3 = { ...after2, active: 'work', profiles: { default: after2.profiles.default, work: { LARK_APP_ID: 'cli_b' } } };
  writeCreds(dir, after3);
  fs.utimesSync(credPath, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  monitor.sync();
  assert.equal(profileFired, 1, 'active flip → onProfileSwitch fires');

  // --- 6. Hook receives the new credentials snapshot as argument ---
  let receivedToken = null;
  monitor.onUatChange((snap) => { receivedToken = snap?.LARK_USER_ACCESS_TOKEN; });
  const after4 = { ...after3, profiles: { ...after3.profiles, work: { LARK_APP_ID: 'cli_b', LARK_USER_ACCESS_TOKEN: 'uat_work_v1', LARK_USER_REFRESH_TOKEN: 'ref_work_v1' } } };
  writeCreds(dir, after4);
  fs.utimesSync(credPath, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  monitor.sync();
  assert.equal(receivedToken, 'uat_work_v1', 'UAT hook should receive the active profile env block');

  // --- 7. Monitor handles missing file gracefully (no throw) ---
  fs.unlinkSync(credPath);
  monitor.sync(); // should not throw

  // --- 8. File reappears later → next sync detects + fires ---
  writeCreds(dir, baseCreds);
  fs.utimesSync(credPath, new Date(Date.now() + 6000), new Date(Date.now() + 6000));
  monitor.sync();
  // baseCreds.active='default' diff from previous 'work' → profile change
  // baseCreds.UAT='uat_v1' diff from previous 'uat_work_v1' → uat change
  assert.ok(profileFired >= 2);
  assert.ok(uatFired >= 2);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('credentials-monitor.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
