# Credentials File Format

Single source of truth for all feishu-user-plugin credentials, introduced in v1.3.7.

## Path

```
~/.feishu-user-plugin/credentials.json
```

Mode `0600` (owner read/write only). The directory `~/.feishu-user-plugin/` is created with mode `0700`.

## Schema

```json
{
  "version": 1,
  "active": "default",
  "profiles": {
    "default": {
      "LARK_COOKIE": "session=...; sl_session=...",
      "LARK_APP_ID": "cli_xxxxxxxxxxxxxxxx",
      "LARK_APP_SECRET": "yyyyyyyyyyyyyyyy",
      "LARK_USER_ACCESS_TOKEN": "u-xxxxxxxx",
      "LARK_USER_REFRESH_TOKEN": "r-xxxxxxxx",
      "LARK_UAT_EXPIRES": 1735689600
    },
    "alt": {
      "LARK_COOKIE": "...",
      "LARK_APP_ID": "...",
      "LARK_APP_SECRET": "...",
      "LARK_USER_ACCESS_TOKEN": "...",
      "LARK_USER_REFRESH_TOKEN": "...",
      "LARK_UAT_EXPIRES": 1735693200
    }
  },
  "profileHints": {}
}
```

### Fields

| Field | Type | Purpose |
|-------|------|---------|
| `version` | integer | Schema version. Currently `1`. |
| `active` | string | Name of the profile to use when no override is given. Must be a key in `profiles`. |
| `profiles` | object | Map of `<profileName> → profileBlock`. Each profile block holds the same `LARK_*` keys the MCP server reads from `process.env`, plus the optional `events` array. |
| `profileHints` | object | Multi-profile auto-switch cache. Map of `<resourceKey> → <profileName>`. Populated automatically by the auto-switch middleware. |

### Profile block keys

#### `LARK_*` env keys

| Key | Required for | Notes |
|-----|--------------|-------|
| `LARK_COOKIE` | User-identity messaging | Full cookie string including HttpOnly cookies (`session`, `sl_session`). |
| `LARK_APP_ID` | Official API + UAT refresh | App credential. |
| `LARK_APP_SECRET` | Official API + UAT refresh | App credential. |
| `LARK_USER_ACCESS_TOKEN` | P2P chat reading + UAT-first writes | OAuth access token. |
| `LARK_USER_REFRESH_TOKEN` | UAT auto-refresh | OAuth refresh token. |
| `LARK_UAT_EXPIRES` | UAT lifecycle | Unix epoch (seconds). Optional — decoded from token if absent. |

#### `events` array (optional, v1.3.9)

```json
"events": ["im.message.receive_v1", "approval.instance.created_v4"]
```

List of Feishu real-time event types the WebSocket client subscribes to for this profile.

- **Default** (when absent or empty): `["im.message.receive_v1"]`
- Managed by `getProfileEvents(name)` / `setProfileEvents(name, list)` in `src/auth/credentials.js`.
- The owner MCP process reads this list at WS start and on `_maybeReconfigure()` to decide whether to restart the WebSocket client.
- Supported event types are those exposed by the Feishu WS SDK. Adding an unsupported type is a no-op for the SDK but wastes a subscription slot.

Example — add approval events to the default profile:

```bash
node -e '
const c = require("./src/auth/credentials");
c.setProfileEvents("default", ["im.message.receive_v1", "approval.instance.created_v4"]);
console.log(c.getProfileEvents("default"));
'
```

After editing, either restart the MCP server or call `manage_ws_status(action=reconfig)` to apply.

#### `larkHash` (optional, v1.3.11)

```json
"larkHash": "cdf3423ce6e643cdf21af46f1f263347"
```

32-char-hex Lark Desktop account hash from `~/Library/Containers/com.bytedance.macos.feishu/Data/Library/Application Support/LarkShell/sdk_storage/<hash>/`. When this field is set, the MCP owner heartbeat (15 s) watches the matching `cookie_store.db` mtime and auto-flips `credentials.json::active` to this profile when the user activates that account in Lark Desktop. macOS-only in v1.3.11.

- **Default** (when absent): no auto-switch wiring for this profile — manual `switch_profile` MCP tool call only.
- Managed by `getProfileLarkHash(name)` / `setProfileLarkHash(name, hash)` / `findProfileByHash(hash)` in `src/auth/credentials.js`.
- Bound by `setup` (auto-detect on `fresh` / `update`) or explicitly via `setup --bind-hash <hash> --profile <name>`.
- Cookies still come from `LARK_COOKIE` per profile — Lark's encrypted `cookie_store.db` is never read or decrypted.

Example — bind two profiles to two Lark Desktop accounts:

```bash
node -e '
const c = require("./src/auth/credentials");
c.setProfileLarkHash("default", "cdf3423ce6e643cdf21af46f1f263347");
c.setProfileLarkHash("work",    "abaf65b9880cf7e612abb5a54c512a51");
console.log(c.findProfileByHash("cdf3423ce6e643cdf21af46f1f263347"));  // → "default"
'
```

After binding, the MCP owner heartbeat takes over: switching the active account in Lark Desktop flips `credentials.json::active` within ~15 s. The cross-process sync (v1.3.9 §A.2) then propagates the new active to every running MCP process.

## Invariants

1. **Atomic writes.** Every write goes through `tmp file + rename` to prevent partial reads under concurrent access (multiple MCP processes, Claude Code reading config simultaneously, UAT refresh lock holders).
2. **Single active profile.** Exactly one of `profiles.*` is active at any time, named by `active`. `switch_profile` is the only way to flip it.
3. **0600 permissions.** Enforced on every write (`fs.chmodSync` after rename).
4. **Schema versioning.** Future schema changes bump `version`. Readers must check and refuse to load unknown major versions.

## Backward compatibility

The MCP server reads credentials in this order:

1. `~/.feishu-user-plugin/credentials.json` if it exists → use the active profile's env block.
2. Otherwise: fall back to `process.env.LARK_*` for the default profile, and `process.env.LARK_PROFILES_JSON` for named profiles. This is the v1.3.6 behaviour and stays intact for users who have not migrated.

`persistToConfig({ ... })` (used by cookie heartbeat and UAT refresh) writes to:
- `credentials.json` if it exists (the active profile's keys are updated atomically).
- The discovered MCP config (`~/.claude.json` etc.) otherwise (v1.3.6 behaviour).

## Migration

```bash
npx feishu-user-plugin migrate              # dry-run; prints what would be written
npx feishu-user-plugin migrate --confirm    # writes credentials.json
```

The migrator:
1. Calls `findMcpConfig()` to locate the existing harness config.
2. Reads the env block.
3. Parses `LARK_PROFILES_JSON` if set (registers each named profile).
4. Builds the credentials.json structure with `active="default"` and all discovered profiles.
5. Atomic writes to `~/.feishu-user-plugin/credentials.json` with `0600`.

After migration the harness configs are left untouched. The MCP server now prefers `credentials.json`; if it's later removed, the harness env block remains as fallback. Users who want to fully strip credentials from harness configs can do it manually — there's no auto-rewrite step in v1.3.7 to keep the migration reversible.

## Why this exists

Before v1.3.7 each harness (Claude Code, Codex) duplicated the credentials in its own config (`~/.claude.json` mcpServers env block, `~/.codex/config.toml` mcp_servers.env). The cookie heartbeat and UAT refresh would auto-persist to whichever config was discovered first by `findMcpConfig()`. The other harness's copy went stale until the next OAuth re-run.

Consolidating into a single file makes the rotation-on-refresh model work consistently across harnesses: every MCP process reads from the same file and every refresh writes back to the same file.
