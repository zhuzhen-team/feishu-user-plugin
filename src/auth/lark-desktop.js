// src/auth/lark-desktop.js — Lark Desktop sdk_storage detection (v1.3.11 §A).
//
// macOS-only: Linux/Windows return null from getSdkStorageDir() and all
// callers no-op gracefully. We never read the encrypted cookie_store.db —
// only stat its mtime to detect account switches. Profile↔hash bindings
// live in credentials.json::profiles[*].larkHash.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HASH_RE = /^[a-f0-9]{32}$/;

// Debounce + freshness windows for the heartbeat reactor.
const SWITCH_DEBOUNCE_MS = 5_000;
const UNBOUND_FRESH_WINDOW_MS = 60_000;

function _macSdkStorageDir() {
  return path.join(
    os.homedir(),
    'Library/Containers/com.bytedance.macos.feishu/Data/Library/Application Support/LarkShell/sdk_storage'
  );
}

function getSdkStorageDir() {
  if (process.platform !== 'darwin') return null;
  const dir = _macSdkStorageDir();
  try {
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch (_) {
    return null;
  }
}

// List Lark account hash directories under sdk_storage, sorted by
// cookie_store.db mtime descending. Hash dirs without a cookie_store.db
// are filtered (account never logged in / cleared).
//
// Returns: [{ hash, mtimeMs, dir }]
function listAccountHashes({ dir } = {}) {
  const root = dir || getSdkStorageDir();
  if (!root) return [];
  let entries;
  try { entries = fs.readdirSync(root); } catch (_) { return []; }
  const out = [];
  for (const name of entries) {
    if (!HASH_RE.test(name)) continue;
    const accountDir = path.join(root, name);
    const dbPath = path.join(accountDir, 'cookie_store.db');
    let mtimeMs;
    try { mtimeMs = fs.statSync(dbPath).mtimeMs; } catch (_) { continue; }
    out.push({ hash: name, mtimeMs, dir: accountDir });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

function mostRecentHash(opts = {}) {
  const list = listAccountHashes(opts);
  return list.length > 0 ? list[0] : null;
}

// Pure-ish reactor logic, dependency-injected for unit tests.
//
// Inputs:
//   prevSnapshot: { [hash]: mtimeMs } from the previous heartbeat
//   lastSwitchAt: ms timestamp of the last auto-switch (debounce key)
//   seenUnboundHashes: Set<hash> — emit hint once per hash per session
//   credsApi: { getActiveProfileName, getProfileLarkHash, findProfileByHash }
//   listFn: () => [...] — defaults to listAccountHashes() with auto-detected dir
//   now: ms — defaults to Date.now()
//   log: (msg) => void — defaults to console.error (the unbound-hash hint goes here)
//
// Returns:
//   { switchTo: { hash, profile } | null, isUnbound: boolean, hash?: string }
//
// Mutates seenUnboundHashes (adds the hash when it emits a hint).
function detectSwitch({
  prevSnapshot,
  lastSwitchAt,
  seenUnboundHashes,
  credsApi,
  listFn,
  now,
  log,
} = {}) {
  if (!credsApi) credsApi = require('./credentials');
  if (!listFn) listFn = () => listAccountHashes();
  if (typeof now !== 'number') now = Date.now();
  if (typeof log !== 'function') log = console.error;

  if (now - lastSwitchAt < SWITCH_DEBOUNCE_MS) {
    return { switchTo: null, isUnbound: false };
  }

  const list = listFn();
  if (list.length === 0) return { switchTo: null, isUnbound: false };

  const top = list[0];
  const activeProfile = credsApi.getActiveProfileName();
  const activeHash = credsApi.getProfileLarkHash(activeProfile);
  if (top.hash === activeHash) return { switchTo: null, isUnbound: false };

  // Only act on a true mtime advance — this prevents repeatedly switching
  // when the snapshot baseline shows a stable older delta.
  const prev = prevSnapshot[top.hash] || 0;
  if (top.mtimeMs <= prev) return { switchTo: null, isUnbound: false };

  const targetProfile = credsApi.findProfileByHash(top.hash);
  if (!targetProfile) {
    const isFresh = (now - top.mtimeMs) < UNBOUND_FRESH_WINDOW_MS;
    if (isFresh && seenUnboundHashes && !seenUnboundHashes.has(top.hash)) {
      seenUnboundHashes.add(top.hash);
      log(
        `[feishu-user-plugin] Lark Desktop active account hash ${top.hash} is not bound to any MCP profile. ` +
        `Run: npx feishu-user-plugin setup --profile <name> --bind-hash ${top.hash}`
      );
    }
    return { switchTo: null, isUnbound: true, hash: top.hash };
  }

  return { switchTo: { hash: top.hash, profile: targetProfile }, isUnbound: false };
}

module.exports = {
  HASH_RE,
  SWITCH_DEBOUNCE_MS,
  UNBOUND_FRESH_WINDOW_MS,
  getSdkStorageDir,
  listAccountHashes,
  mostRecentHash,
  detectSwitch,
};
