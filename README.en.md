# feishu-user-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-84-orange.svg)](docs/TOOLS.md)
[![npm](https://img.shields.io/npm/v/feishu-user-plugin.svg)](https://www.npmjs.com/package/feishu-user-plugin)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[中文](README.md) · **English** · [Docs](https://ethanqc.github.io/feishu-user-plugin/en) · [CHANGELOG](CHANGELOG.md) · [npm](https://www.npmjs.com/package/feishu-user-plugin)

Feishu / Lark MCP server covering IM, docs, bitable, wiki, drive, calendar, tasks v2, OKR, and realtime events. **84 tools · 3 auth layers · 9 MCP prompts · MIT licensed · Node ≥18**.

Works with Claude Code, Codex, Cursor, Windsurf, VS Code, Claude Desktop, OpenClaw, and any MCP-compatible client.

What sets it apart from other Feishu MCPs: a cookie + protobuf protocol path that supports **user-identity messaging** — Feishu's official open API has no `send_as_user` scope, and bot-token messages are tagged `sender_type: "app"`.

## vs the official Feishu/Lark tools (released 2026)

- [`larksuite/lark-openapi-mcp`](https://github.com/larksuite/lark-openapi-mcp) — official OpenAPI MCP, **⚠ Beta**, last updated 2025-08 (9 months stale). Their README explicitly states "File upload/download not yet supported" and "Direct document editing not supported"; 1271 endpoint tools but preset.default only enables ~20, the rest "not undergone compatibility testing".
- [`larksuite/cli`](https://github.com/larksuite/cli) — official CLI (9.9k stars, actively maintained), 17 business domains, 200+ commands + 24 AI Agent Skills, but it's a **CLI, not an MCP server**. Codex / Cursor / Windsurf etc would have to shell out to it.

**When to use this repo**: you need to send messages as your real user identity / read P2P chat history (architecturally exclusive); or you want native MCP-protocol access without needing mail/approval/HR/meeting-minutes etc that this repo doesn't cover.

**When to use the official**: you need mail / approval / attendance / HR / hiring / meeting-minutes etc business-system domains; or you're locked into Claude Code's CLI-only form factor.

Full honest comparison: [docs/COMPARISON.md](docs/COMPARISON.md).

## Quick example

```
You: send Wang Xiao Ming a message as me: "finished the code review, 3 nits"
Claude: [calls send_to_user]  Sent
```

```
You: summarize today's discussion in the engineering group after 9am, post a daily digest to #daily
Claude: [read_messages → summarize → send_to_group]  Sent
```

## Quick start

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth         # OAuth UAT
# restart Claude Code / Codex
```

Cookie capture (Playwright auto-QR / DevTools manual), Feishu app creation, per-client config — see [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md).

## Three auth layers

| Layer | Credentials | Capabilities | Tools |
|---|---|---|---|
| User identity (cookie + protobuf) | `LARK_COOKIE` | Send text / image / file / post / @ / batch as the user | 8 |
| Official API (bot) | `LARK_APP_ID` + `LARK_APP_SECRET` | Group messages, docs, bitable, wiki, drive, calendar, tasks v2, OKR, contacts, realtime WS | 70+ |
| User OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P chat reading, user chat list; resources owned by the user when creating | 2 explicit + UAT-first across the suite |

Layers are independent — configure any subset.

## Capabilities

- **Send messages as you** (8): text / image / file / rich-text post / cards / batch; differentiator — Feishu's official API has no `send_as_user`
- **Read groups & P2P chats** (17): group messages / P2P / `merge_forward` auto-expanded / URL + Feishu doc links auto-extracted / external groups auto-fallback to UAT
- **Document suite** (27): Feishu docs (with `read_doc_markdown` saving ~60% tokens) / bitable (batch up to 500) / wiki (full write CRUD) / drive
- **Productivity** (21): calendar (read+write) / tasks v2 (with member management) / OKR (read + progress records) / contacts
- **Realtime events** (2): machine-level SSOT WS, every event delivered exactly once across the entire machine
- **Diagnostics & multi-account** (4): N profiles auto-switched per call, writes never auto-switch (avoids accidental cross-account creates)

Full tool list + cross-domain caveats + usage patterns: [docs/TOOLS.md](docs/TOOLS.md).

## 9 MCP prompts (slash commands)

| Prompt | Purpose |
|---|---|
| `/send` | Send a message as yourself |
| `/reply` | Read recent messages then reply |
| `/digest` | Summarise recent group / P2P messages |
| `/search` | Search contacts / groups |
| `/doc` | Search / read / create a Feishu doc |
| `/table` | Operate on a bitable |
| `/wiki` | Search wiki space |
| `/drive` | List drive files / create folder |
| `/status` | Check all three auth layers |

## MCP Client Configuration

### Claude Code

Add to `~/.claude.json` `mcpServers` (recommended global) or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "feishu-user-plugin": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

Or via CLI: `npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>`.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.feishu-user-plugin]
command = "npx"
args = ["-y", "feishu-user-plugin"]

[mcp_servers.feishu-user-plugin.env]
LARK_COOKIE = "your-cookie-string"
LARK_APP_ID = "cli_xxxxxxxxxxxx"
LARK_APP_SECRET = "your-app-secret"
LARK_USER_ACCESS_TOKEN = "your-uat"
LARK_USER_REFRESH_TOKEN = "your-refresh-token"
```

Or via CLI: `npx feishu-user-plugin setup --client codex --app-id <APP_ID> --app-secret <APP_SECRET>`.

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json` in your project (note: top-level key is `servers`, not `mcpServers`):

```json
{
  "servers": {
    "feishu": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

### OpenClaw

Add to `~/.openclaw/openclaw.json` (note: key path is `mcp.servers`, not `mcpServers`):

```json
{
  "mcp": {
    "servers": {
      "feishu-user-plugin": {
        "command": "npx",
        "args": ["-y", "feishu-user-plugin"],
        "env": {
          "LARK_COOKIE": "your-cookie-string",
          "LARK_APP_ID": "cli_xxxxxxxxxxxx",
          "LARK_APP_SECRET": "your-app-secret",
          "LARK_USER_ACCESS_TOKEN": "your-uat",
          "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
        }
      }
    }
  }
}
```

Or via CLI: `openclaw mcp set feishu-user-plugin '{"command":"npx","args":["-y","feishu-user-plugin"],"env":{...}}'`.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["-y", "feishu-user-plugin"],
      "env": {
        "LARK_COOKIE": "your-cookie-string",
        "LARK_APP_ID": "cli_xxxxxxxxxxxx",
        "LARK_APP_SECRET": "your-app-secret",
        "LARK_USER_ACCESS_TOKEN": "your-uat",
        "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

## Multi-account

`~/.feishu-user-plugin/credentials.json` supports multiple profiles (default + any number of additional), so one machine handles multiple Feishu accounts / multiple tenants.

```bash
npx feishu-user-plugin list-profiles
npx feishu-user-plugin switch-profile <name>
npx feishu-user-plugin keepalive --all       # cross-profile keepalive
```

Read-path tools auto-retry across profiles on errors `91403` / `1254301` / `1254000` / `99991672` / `HTTP 403`. Writes never auto-switch (avoids creating resources under the wrong account). Per-call override: pass `via_profile: "<name>"` to pin to a specific profile.

Details: [docs/TOOLS.md "Multi-profile auto-switch"](docs/TOOLS.md#多-profile-auto-switchv138).

## Realtime events

A single MCP process per machine holds the WS owner lock. All MCP processes share `events.jsonl`, every event delivered exactly once across the entire machine.

```bash
mcp call manage_ws_status --action info
mcp call manage_ws_status --action claim --force true
```

Default subscriptions: `["im.message.receive_v1"]`. To subscribe to other events (approval / calendar / vc / etc.), edit `credentials.json::profiles[<active>].events`, then call `manage_ws_status(action=reconfig)` to apply without restart.

Only `feishu.cn` is supported — Lark international (`lark.com`) WSClient is not available.

## Limitations

- **Cookie lifetime**: 12-24 hours without heartbeat; re-login at feishu.cn to get a fresh cookie
- **Protocol drift**: cookie + protobuf path depends on Feishu web client protocol; Feishu updates may break user-identity messaging (bot capabilities unaffected)
- **Cards**: cookie path's card sending is server-disabled; bot path works
- **Lark international**: realtime events WS not supported
- **Not implemented**: `search_messages`, md → wiki sync (see [ROADMAP.md](ROADMAP.md))

## Documentation

| Document | Role |
|----------|------|
| [docs/TOOLS.md](docs/TOOLS.md) | Tool reference + cross-domain caveats + usage patterns |
| [docs/AUTH-SETUP.md](docs/AUTH-SETUP.md) | Install / 3 auth layers / cookie capture / OAuth scopes |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Error codes & diagnosis |
| [docs/RELEASING.md](docs/RELEASING.md) | Release flow + team-skills sync + announcement rules |
| [docs/REFACTOR-NOTES.md](docs/REFACTOR-NOTES.md) | File responsibility matrix |
| [docs/CREDENTIALS-FORMAT.md](docs/CREDENTIALS-FORMAT.md) | Credentials schema |
| [docs/TESTING-METHODOLOGY.md](docs/TESTING-METHODOLOGY.md) | Testing playbook |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution flow (bilingual) |
| [ROADMAP.md](ROADMAP.md) | Roadmap (forward-only) |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

Full docs/ index: [docs/README.md](docs/README.md).

## Contributing

Issues / PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

If a Feishu protocol change breaks a tool — open an issue with the error log.

## Privacy

A locally-run MCP server. Credentials stay on the user's machine; no telemetry, no phone-home. Full text: [PRIVACY.md](PRIVACY.md).

- **Collected**: nothing by the plugin itself; the five `LARK_*` envs are supplied by the user from their own Feishu / Lark account
- **Processed**: only the messages / docs / bitable / wiki / drive / calendar / tasks / OKR / contacts the user explicitly requests via MCP tool calls
- **Stored**: `~/.feishu-user-plugin/credentials.json` (mode 0600); optional event log at `~/.feishu-user-plugin/events.jsonl`
- **Third-party**: only the user's own Feishu tenant and the AI client the user runs (Claude Code / Codex / Cursor / etc.)
- **Retention**: entirely user-controlled; `rm -rf ~/.feishu-user-plugin && npm uninstall -g feishu-user-plugin` removes everything
- **Contact**: [GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues); security disclosures with `[security]` prefix in the title

## License

[MIT](LICENSE)

## Acknowledgments

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) — early Feishu web protocol research (Python)
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) — underlying API research
- [Model Context Protocol](https://modelcontextprotocol.io) — MCP spec + Anthropic / PulseMCP / GitHub / Stacklok joint registry
