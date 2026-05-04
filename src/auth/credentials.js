// src/auth/credentials.js — single-source-of-truth credentials API.
//
// Phase A (v1.3.7) creates this stub so future callers can target the canonical
// path `src/auth/credentials` instead of `src/config`. It currently just
// re-exports the existing config module — same behaviour, same atomic-write,
// same multi-config (Claude / Codex / .mcp.json) discovery.
//
// Phase B replaces the body with:
//   - A single ~/.feishu-user-plugin/credentials.json file (0600 perms)
//   - Profile-aware load/save (default + named profiles in one file)
//   - One-time migrate() helper that pulls existing creds out of every
//     discovered MCP config (~/.claude.json, ~/.codex/config.toml, etc.)
//     into the canonical file, then writes pointer-only env blocks back.
//   - All harness configs become "FEISHU_PLUGIN_PROFILE=default" pointer envs
//     that read this single source of truth.
//
// Until then, callers see the legacy config module's API:
//   { findMcpConfig, readCredentials, persistToConfig, writeNewConfig, SERVER_NAMES }
module.exports = require('../config');
