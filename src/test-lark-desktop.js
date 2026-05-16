// src/test-lark-desktop.js — unit tests for src/auth/lark-desktop.js
// + src/auth/credentials.js larkHash bindings.
// Plain assert + fixture-based; no external deps.
//
// Run: `node src/test-lark-desktop.js`

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FIX_ROOT = path.join(os.tmpdir(), 'feishu-test-sdk-storage-' + process.pid + '-' + Date.now());

function makeFixture(hashes) {
  fs.mkdirSync(FIX_ROOT, { recursive: true });
  for (const [hash, mtimeOffset] of hashes) {
    const dir = path.join(FIX_ROOT, hash);
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'cookie_store.db');
    fs.writeFileSync(dbPath, 'fake');
    const t = (Date.now() / 1000) + mtimeOffset;
    fs.utimesSync(dbPath, t, t);
  }
}

function cleanupFixture() {
  fs.rmSync(FIX_ROOT, { recursive: true, force: true });
}

const ld = require('./auth/lark-desktop');

// --- Task 1: read-only basics ---

function testListAccountHashes() {
  cleanupFixture();
  makeFixture([
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', -100],
    ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 0],
    ['cccccccccccccccccccccccccccccccc', -50],
    ['notahash', 0],            // should be filtered out (not 32-hex)
    ['DEADBEEFDEADBEEFDEADBEEFDEADBEEF', 0],   // uppercase — also filtered (we accept lowercase only)
  ]);
  // uppercase entry has no cookie_store.db tweaking — make sure dir exists at minimum
  // (already created; just confirming file presence)
  const list = ld.listAccountHashes({ dir: FIX_ROOT });
  assert.strictEqual(list.length, 3, `filters non-hex names; got ${list.length}: ${list.map(h=>h.hash).join(',')}`);
  assert.strictEqual(list[0].hash, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'sorted by mtime desc');
  assert.strictEqual(list[2].hash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.ok(typeof list[0].mtimeMs === 'number');
  assert.ok(list[0].dir.endsWith('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
  cleanupFixture();
  console.log('PASS: listAccountHashes');
}

function testListAccountHashesEmpty() {
  cleanupFixture();
  fs.mkdirSync(FIX_ROOT, { recursive: true });
  // No hash dirs — should return []
  assert.deepStrictEqual(ld.listAccountHashes({ dir: FIX_ROOT }), []);
  cleanupFixture();
  // Non-existent dir
  assert.deepStrictEqual(ld.listAccountHashes({ dir: '/nonexistent-' + Date.now() }), []);
  console.log('PASS: listAccountHashes empty / missing');
}

function testListAccountHashesIgnoresMissingDb() {
  cleanupFixture();
  fs.mkdirSync(path.join(FIX_ROOT, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), { recursive: true });
  // No cookie_store.db file inside — entry should be skipped (we treat
  // "no DB → never logged in / cleared" so it can't represent an active account)
  const list = ld.listAccountHashes({ dir: FIX_ROOT });
  assert.strictEqual(list.length, 0);
  cleanupFixture();
  console.log('PASS: listAccountHashes ignores hash dirs without cookie_store.db');
}

function testMostRecentHash() {
  cleanupFixture();
  makeFixture([
    ['1111111111111111111111111111aaaa', -200],
    ['2222222222222222222222222222bbbb', 0],
  ]);
  const top = ld.mostRecentHash({ dir: FIX_ROOT });
  assert.strictEqual(top.hash, '2222222222222222222222222222bbbb');
  assert.strictEqual(ld.mostRecentHash({ dir: '/nonexistent-' + Date.now() }), null);
  cleanupFixture();
  console.log('PASS: mostRecentHash');
}

function testGetSdkStorageDirSafety() {
  const dir = ld.getSdkStorageDir();
  if (process.platform === 'darwin') {
    assert.ok(dir === null || typeof dir === 'string');
  } else {
    assert.strictEqual(dir, null);
  }
  console.log('PASS: getSdkStorageDir platform safety');
}

// --- Task 2: profile hash bindings on credentials.js ---

function testProfileHashBindings() {
  const sandbox = path.join(os.tmpdir(), 'feishu-test-creds-' + process.pid + '-' + Date.now());
  fs.mkdirSync(path.join(sandbox, '.feishu-user-plugin'), { recursive: true, mode: 0o700 });
  const credPath = path.join(sandbox, '.feishu-user-plugin', 'credentials.json');

  const baseFile = {
    version: 1,
    active: 'default',
    profiles: {
      default: { LARK_APP_ID: 'cli_aaa' },
      work: { LARK_APP_ID: 'cli_bbb' },
    },
    profileHints: {},
  };
  fs.writeFileSync(credPath, JSON.stringify(baseFile, null, 2));

  const origHome = process.env.HOME;
  process.env.HOME = sandbox;

  // Force re-require so any cached internal state in credentials.js is fresh.
  // (credentials.js doesn't actually cache — it re-reads on every call — but
  // belt-and-suspenders.)
  delete require.cache[require.resolve('./auth/credentials')];
  const credentials = require('./auth/credentials');

  try {
    // Initially unbound
    assert.strictEqual(credentials.findProfileByHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null);
    assert.strictEqual(credentials.getProfileLarkHash('default'), null);
    assert.strictEqual(credentials.getProfileLarkHash('work'), null);

    // Bind default
    credentials.setProfileLarkHash('default', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(credentials.getProfileLarkHash('default'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    assert.strictEqual(credentials.findProfileByHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'default');

    // Bind work
    credentials.setProfileLarkHash('work', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    assert.strictEqual(credentials.findProfileByHash('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), 'work');
    // default still bound
    assert.strictEqual(credentials.findProfileByHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'default');

    // Validation: bad hex
    assert.throws(() => credentials.setProfileLarkHash('default', 'not-hex'),
      /must be 32-char hex/);
    // Validation: missing profile
    assert.throws(() => credentials.setProfileLarkHash('nope', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      /not found/);

    // findProfileByHash with bad input → null
    assert.strictEqual(credentials.findProfileByHash('not-hex'), null);
    assert.strictEqual(credentials.findProfileByHash(null), null);
    assert.strictEqual(credentials.findProfileByHash(undefined), null);

    // Clear by passing null
    credentials.setProfileLarkHash('default', null);
    assert.strictEqual(credentials.getProfileLarkHash('default'), null);
    assert.strictEqual(credentials.findProfileByHash('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), null);
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(sandbox, { recursive: true, force: true });
    delete require.cache[require.resolve('./auth/credentials')];
  }
  console.log('PASS: profile hash bindings');
}

// --- Task 4: detectSwitch logic (pure) ---

function testDetectSwitchDebounce() {
  const result = ld.detectSwitch({
    prevSnapshot: {},
    lastSwitchAt: Date.now() - 1000,        // 1s ago, < 5s debounce
    seenUnboundHashes: new Set(),
    listFn: () => [{ hash: 'a'.repeat(32), mtimeMs: Date.now(), dir: '/x' }],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => null, findProfileByHash: () => 'default' },
  });
  assert.deepStrictEqual(result, { switchTo: null, isUnbound: false });
  console.log('PASS: detectSwitch debounce');
}

function testDetectSwitchAlreadyOnMostRecent() {
  const HASH = 'a'.repeat(32);
  const result = ld.detectSwitch({
    prevSnapshot: {},
    lastSwitchAt: 0,
    seenUnboundHashes: new Set(),
    listFn: () => [{ hash: HASH, mtimeMs: Date.now(), dir: '/x' }],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => HASH, findProfileByHash: () => 'default' },
  });
  assert.deepStrictEqual(result, { switchTo: null, isUnbound: false });
  console.log('PASS: detectSwitch already on most-recent');
}

function testDetectSwitchNoMtimeAdvance() {
  const HASH = 'a'.repeat(32);
  const fixedMtime = Date.now() - 10_000;
  const result = ld.detectSwitch({
    prevSnapshot: { [HASH]: fixedMtime },
    lastSwitchAt: 0,
    seenUnboundHashes: new Set(),
    listFn: () => [{ hash: HASH, mtimeMs: fixedMtime, dir: '/x' }],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => 'b'.repeat(32), findProfileByHash: () => 'work' },
  });
  assert.deepStrictEqual(result, { switchTo: null, isUnbound: false });
  console.log('PASS: detectSwitch no mtime advance');
}

function testDetectSwitchValid() {
  const HASH = 'a'.repeat(32);
  const result = ld.detectSwitch({
    prevSnapshot: { [HASH]: 1000 },
    lastSwitchAt: 0,
    seenUnboundHashes: new Set(),
    listFn: () => [{ hash: HASH, mtimeMs: 5000, dir: '/x' }],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => 'b'.repeat(32), findProfileByHash: () => 'work' },
  });
  assert.deepStrictEqual(result, { switchTo: { hash: HASH, profile: 'work' }, isUnbound: false });
  console.log('PASS: detectSwitch valid switch');
}

function testDetectSwitchUnboundEmitsOnce() {
  const HASH = 'a'.repeat(32);
  const seen = new Set();
  const logs = [];
  const log = (msg) => logs.push(msg);
  const args = {
    prevSnapshot: { [HASH]: 1000 },
    lastSwitchAt: 0,
    seenUnboundHashes: seen,
    listFn: () => [{ hash: HASH, mtimeMs: Date.now(), dir: '/x' }],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => null, findProfileByHash: () => null },
    log,
  };
  let r = ld.detectSwitch(args);
  assert.deepStrictEqual(r, { switchTo: null, isUnbound: true, hash: HASH });
  assert.strictEqual(logs.length, 1, 'first call emits hint');
  assert.match(logs[0], /not bound to any MCP profile/);
  assert.match(logs[0], new RegExp(`--bind-hash ${HASH}`));
  r = ld.detectSwitch(args);
  assert.strictEqual(logs.length, 1, 'second call deduplicated');
  console.log('PASS: detectSwitch unbound emits hint once per session');
}

function testDetectSwitchUnboundStaleNoHint() {
  // mtime older than UNBOUND_FRESH_WINDOW_MS → no hint emitted
  const HASH = 'a'.repeat(32);
  const seen = new Set();
  const logs = [];
  const r = ld.detectSwitch({
    prevSnapshot: { [HASH]: 1000 },
    lastSwitchAt: 0,
    seenUnboundHashes: seen,
    listFn: () => [{ hash: HASH, mtimeMs: Date.now() - 120_000, dir: '/x' }],   // 2 min ago
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => null, findProfileByHash: () => null },
    log: (msg) => logs.push(msg),
  });
  // Stale unbound hash: still reports isUnbound=true but doesn't add to seen / doesn't log
  assert.strictEqual(r.isUnbound, true);
  assert.strictEqual(logs.length, 0);
  assert.strictEqual(seen.size, 0);
  console.log('PASS: detectSwitch unbound stale → no hint');
}

function testDetectSwitchEmptyList() {
  const r = ld.detectSwitch({
    prevSnapshot: {},
    lastSwitchAt: 0,
    seenUnboundHashes: new Set(),
    listFn: () => [],
    credsApi: { getActiveProfileName: () => 'default', getProfileLarkHash: () => null, findProfileByHash: () => null },
  });
  assert.deepStrictEqual(r, { switchTo: null, isUnbound: false });
  console.log('PASS: detectSwitch empty list');
}

// --- Run all ---

function run() {
  testListAccountHashes();
  testListAccountHashesEmpty();
  testListAccountHashesIgnoresMissingDb();
  testMostRecentHash();
  testGetSdkStorageDirSafety();
  testProfileHashBindings();
  testDetectSwitchDebounce();
  testDetectSwitchAlreadyOnMostRecent();
  testDetectSwitchNoMtimeAdvance();
  testDetectSwitchValid();
  testDetectSwitchUnboundEmitsOnce();
  testDetectSwitchUnboundStaleNoHint();
  testDetectSwitchEmptyList();
  console.log('\nAll lark-desktop tests passed.');
}

if (require.main === module) {
  run();
}
module.exports = { run };
