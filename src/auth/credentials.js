// src/auth/credentials.js — single-source-of-truth credentials API.
//
// Reads from `~/.feishu-user-plugin/credentials.json` (created by the `migrate`
// CLI subcommand, schema documented at docs/CREDENTIALS-FORMAT.md). Falls back
// to legacy MCP-config discovery (src/config) when the file is absent so v1.3.6
// users have zero behaviour change until they opt in.
//
// What this owns:
//   - credentials.json read / write (atomic, 0600 perms)
//   - profile lookup for the running MCP server
//   - persistence target for cookie heartbeat + UAT refresh
//
// What it does NOT own:
//   - Profile switching mechanics (lives in src/server.js — this module just
//     exposes `setActiveProfile` for the handler to call).
//   - Cookie heartbeat (still lives in src/clients/user.js, calls
//     `persistToConfig` here).
//   - UAT refresh + cross-process file lock (still lives in
//     src/clients/official/base.js, calls `readCredentials` + `persistToConfig`
//     here). Plan to extract into src/auth/{cookie,uat}.js once stable.
//
// Public API (stable for callers):
//   - readCredentials() → flat env block of the active profile (back-compat
//     drop-in for src/config::readCredentials)
//   - persistToConfig(updates) → writes the updates onto the active profile's
//     env block; falls back to legacy mcpServers persistence when no
//     credentials.json exists (back-compat drop-in)
//   - readCanonical() → full {version, active, profiles, profileHints} object,
//     or null if no credentials.json yet
//   - getActiveProfileEnv(name?) → env block for a named profile (defaults to
//     the active one), with legacy LARK_PROFILES_JSON / process.env fallback
//   - getActiveProfileName() → string
//   - listProfileNames() → string[] (always includes "default")
//   - setActiveProfile(name) → atomic write of the `active` field
//   - migrate({ dryRun }) → CLI helper; reads legacy config and writes
//     credentials.json
//
// Re-exports for callers still on the legacy-only paths:
//   - findMcpConfig, writeNewConfig, SERVER_NAMES (from src/config)

const fs = require('fs');
const os = require('os');
const path = require('path');

const legacy = require('../config');

// --- Constants ---

const SCHEMA_VERSION = 1;
const ENV_KEYS = [
  'LARK_COOKIE',
  'LARK_APP_ID',
  'LARK_APP_SECRET',
  'LARK_USER_ACCESS_TOKEN',
  'LARK_USER_REFRESH_TOKEN',
  'LARK_UAT_EXPIRES',
];

// --- Path resolution ---

function _credentialsDir() {
  return path.join(os.homedir(), '.feishu-user-plugin');
}

function _credentialsPath() {
  return path.join(_credentialsDir(), 'credentials.json');
}

// --- Atomic file IO ---

function _atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) {}
  // chmod the dir if it pre-existed with looser perms
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  // chmod again post-rename in case of umask interference
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

function _readFile() {
  try {
    const raw = fs.readFileSync(_credentialsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (parsed.version !== SCHEMA_VERSION) {
      console.error(`[feishu-user-plugin] credentials.json schema version ${parsed.version} unsupported (expected ${SCHEMA_VERSION}). Ignoring file, falling back to legacy config.`);
      return null;
    }
    if (!parsed.profiles || typeof parsed.profiles !== 'object') return null;
    if (typeof parsed.active !== 'string' || !parsed.profiles[parsed.active]) {
      console.error(`[feishu-user-plugin] credentials.json has invalid active profile "${parsed.active}". Ignoring.`);
      return null;
    }
    if (!parsed.profileHints) parsed.profileHints = {};
    return parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[feishu-user-plugin] credentials.json read failed: ${e.message}. Falling back to legacy config.`);
    }
    return null;
  }
}

// --- Public API ---

function readCanonical() {
  return _readFile();
}

function getActiveProfileName() {
  const f = _readFile();
  return f ? f.active : 'default';
}

function listProfileNames() {
  const f = _readFile();
  if (f) return Object.keys(f.profiles);
  // Legacy: default + LARK_PROFILES_JSON keys
  let extras = [];
  try {
    const raw = process.env.LARK_PROFILES_JSON;
    if (raw) extras = Object.keys(JSON.parse(raw) || {});
  } catch (_) {}
  return ['default', ...extras];
}

function getActiveProfileEnv(name) {
  const f = _readFile();
  const target = name || (f ? f.active : 'default');

  if (f) {
    const profile = f.profiles[target];
    if (!profile) {
      throw new Error(`Profile "${target}" not found in credentials.json. Available: ${Object.keys(f.profiles).join(', ')}`);
    }
    return _normalizeEnv(profile);
  }

  // Legacy paths: default reads process.env directly; named profiles come from LARK_PROFILES_JSON.
  if (target === 'default') {
    const env = {};
    for (const k of ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
    return env;
  }
  let map = {};
  try {
    const raw = process.env.LARK_PROFILES_JSON;
    if (raw) map = JSON.parse(raw) || {};
  } catch (e) {
    throw new Error(`LARK_PROFILES_JSON parse failed: ${e.message}`);
  }
  const profile = map[target];
  if (!profile) {
    throw new Error(`Profile "${target}" not found. Available: ${['default', ...Object.keys(map)].join(', ')}`);
  }
  return _normalizeEnv(profile);
}

// Coerce numeric LARK_UAT_EXPIRES → string so it round-trips through env-var
// callers (process.env always returns strings).
function _normalizeEnv(profile) {
  const out = {};
  for (const k of ENV_KEYS) {
    if (profile[k] === undefined || profile[k] === null) continue;
    out[k] = typeof profile[k] === 'number' ? String(profile[k]) : profile[k];
  }
  return out;
}

function setActiveProfile(name) {
  const f = _readFile();
  if (!f) {
    throw new Error('No credentials.json — run `npx feishu-user-plugin migrate --confirm` to create one.');
  }
  if (!f.profiles[name]) {
    throw new Error(`Profile "${name}" not found in credentials.json. Available: ${Object.keys(f.profiles).join(', ')}`);
  }
  f.active = name;
  _atomicWriteJson(_credentialsPath(), f);
}

function persistProfileUpdate(profileName, updates) {
  const f = _readFile();
  if (!f) return false;
  if (!f.profiles[profileName]) {
    console.error(`[feishu-user-plugin] persistProfileUpdate: profile "${profileName}" not found in credentials.json`);
    return false;
  }
  // LARK_UAT_EXPIRES sometimes comes through as string; preserve number when possible.
  const normalized = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null) continue;
    if (k === 'LARK_UAT_EXPIRES' && typeof v === 'string') {
      const n = parseInt(v, 10);
      normalized[k] = Number.isFinite(n) ? n : v;
    } else {
      normalized[k] = v;
    }
  }
  Object.assign(f.profiles[profileName], normalized);
  _atomicWriteJson(_credentialsPath(), f);
  return true;
}

// Back-compat drop-in for src/config::readCredentials. Resolution order:
//   1. credentials.json (active profile)
//   2. process.env.LARK_* (MCP-server context — harness injects env at spawn)
//   3. legacy mcpServers discovery via src/config (CLI context where the
//      caller process did not get the env block)
// The order matters: smoke.js + the MCP server want the in-process env to
// win over disk discovery (so the diff baseline matches the spawn env).
// CLI commands like `status` and `keepalive` have no env, so they fall
// through to the legacy reader.
function readCredentials() {
  const f = _readFile();
  if (f) {
    return _normalizeEnv(f.profiles[f.active]);
  }
  const env = {};
  for (const k of ENV_KEYS) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (Object.keys(env).length > 0) return env;
  return legacy.readCredentials();
}

// Back-compat drop-in for src/config::persistToConfig. Routes writes to:
//   - credentials.json (active profile) when the file exists
//   - legacy mcpServers env block otherwise
function persistToConfig(updates) {
  const f = _readFile();
  if (f) {
    return persistProfileUpdate(f.active, updates);
  }
  return legacy.persistToConfig(updates);
}

// --- Migration (called by `npx feishu-user-plugin migrate`) ---

function migrate({ dryRun = true } = {}) {
  const filePath = _credentialsPath();
  const existing = _readFile();
  if (existing) {
    console.log(`credentials.json already exists at ${filePath}`);
    console.log(`active profile: ${existing.active}`);
    console.log(`profiles: ${Object.keys(existing.profiles).join(', ')}`);
    console.log('');
    console.log('No migration needed. To re-create from harness configs, delete the file first:');
    console.log(`  rm ${filePath}`);
    return { ok: true, alreadyMigrated: true };
  }

  // Discover legacy creds
  const found = legacy.findMcpConfig();
  if (!found) {
    console.error('No MCP config found. Run `npx feishu-user-plugin setup` first.');
    return { ok: false, reason: 'no-config' };
  }

  const defaultProfile = {};
  for (const k of ENV_KEYS) {
    if (found.serverEnv[k] !== undefined && found.serverEnv[k] !== null) {
      defaultProfile[k] = k === 'LARK_UAT_EXPIRES' ? parseInt(found.serverEnv[k], 10) || 0 : found.serverEnv[k];
    }
  }

  // Merge LARK_PROFILES_JSON if present
  const profiles = { default: defaultProfile };
  const rawExtras = found.serverEnv.LARK_PROFILES_JSON;
  if (rawExtras) {
    try {
      const parsed = JSON.parse(rawExtras);
      for (const [name, env] of Object.entries(parsed)) {
        if (name === 'default') {
          console.error(`[migrate] Skipping LARK_PROFILES_JSON entry "default" (collision with primary profile).`);
          continue;
        }
        const cleaned = {};
        for (const k of ENV_KEYS) {
          if (env[k] !== undefined && env[k] !== null) {
            cleaned[k] = k === 'LARK_UAT_EXPIRES' ? parseInt(env[k], 10) || 0 : env[k];
          }
        }
        profiles[name] = cleaned;
      }
    } catch (e) {
      console.error(`[migrate] LARK_PROFILES_JSON parse failed: ${e.message}. Skipping extra profiles.`);
    }
  }

  const credentials = {
    version: SCHEMA_VERSION,
    active: 'default',
    profiles,
    profileHints: {},
  };

  console.log(`Source: ${found.configPath}${found.projectPath ? ` (project: ${found.projectPath})` : ''}`);
  console.log(`Target: ${filePath}`);
  console.log(`Profiles found: ${Object.keys(profiles).join(', ')}`);
  console.log('');
  for (const [name, env] of Object.entries(profiles)) {
    console.log(`  [${name}]`);
    for (const k of ENV_KEYS) {
      if (env[k] === undefined) continue;
      const display = k.includes('SECRET') || k.includes('TOKEN') || k.includes('COOKIE')
        ? `${String(env[k]).slice(0, 12)}…(${String(env[k]).length} chars)`
        : env[k];
      console.log(`    ${k}: ${display}`);
    }
  }
  console.log('');

  if (dryRun) {
    console.log('Dry run — no file written. Re-run with `--confirm` to persist.');
    return { ok: true, dryRun: true, credentials };
  }

  _atomicWriteJson(filePath, credentials);
  console.log(`✓ Wrote ${filePath} (mode 0600)`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Restart Claude Code / Codex so the MCP server adopts the new credentials source.');
  console.log('  2. Existing harness env blocks remain untouched as a fallback.');
  console.log('  3. To start fresh: delete the file and re-run migrate.');
  return { ok: true, credentials };
}

// --- Re-exports for back-compat ---

module.exports = {
  // canonical API
  readCanonical,
  getActiveProfileName,
  listProfileNames,
  getActiveProfileEnv,
  setActiveProfile,
  persistProfileUpdate,
  migrate,
  // back-compat with src/config
  readCredentials,
  persistToConfig,
  findMcpConfig: legacy.findMcpConfig,
  writeNewConfig: legacy.writeNewConfig,
  SERVER_NAMES: legacy.SERVER_NAMES,
  // constants
  SCHEMA_VERSION,
  ENV_KEYS,
};
