---
title: feishu-user-plugin · Feishu / Lark MCP Server for Claude Code & Codex
description: All-in-one Feishu / Lark MCP server — 84 tools, 3 auth layers, send messages as YOU (not a bot). Open source MIT.
keywords: Feishu MCP, Lark MCP, Claude Code Feishu, Claude Code Lark, Codex Feishu, MCP server, send as user, Feishu AI agent, Lark agent
lang: en
---

# feishu-user-plugin

> **All-in-one Feishu / Lark MCP server** — let Claude Code, Codex, Cursor, Windsurf, and any MCP client **operate Feishu as YOU**, not as a bot.

**84 tools · 3 auth layers · 9 MCP prompts · MIT licensed · Node ≥18**

[GitHub Repository](https://github.com/EthanQC/feishu-user-plugin){: .btn .btn-primary }
[npm](https://www.npmjs.com/package/feishu-user-plugin){: .btn }
[中文文档](./index.html){: .btn }
[Changelog](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md){: .btn }

---

## What problem does it solve

Feishu's official open API **has no `send_as_user` scope**: even with a `user_access_token`, every message is tagged `sender_type: "app"` — recipients see a bot avatar and "sent by [app name]".

In many flows that's a blocker, not a UX problem:

- Bot-sent "weekly reports" get ignored — there's no "real human @ed me" presence
- Automated DMs feel obviously not-written-by-you
- Building Feishu RAG mixes user-identity and bot-identity in compliance-grey territory
- You want Claude Code as your Feishu copilot, but every message it sends gives the game away

`feishu-user-plugin` fuses three auth layers into one MCP server, so Claude Code / Codex can do **bot grunt work** (read groups, scrape docs, bulk-update bitable) **and** **speak as you** (send messages, @ teammates, reply to reviews).

## Three auth layers at a glance

| Layer | Credentials | What it does | Tool count |
|---|---|---|---|
| **User identity** | `LARK_COOKIE` (cookie + reverse-engineered protobuf) | Send as YOU: text / image / file / post / card / @ / batch | 8 |
| **Official API** | `LARK_APP_ID` + `LARK_APP_SECRET` | Group messages · Docs · Bitable · Wiki · Drive · Calendar · Tasks v2 · OKR · Contacts · Realtime WS events | 70+ |
| **User OAuth UAT** | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | Read P2P chat history · list user chats · creates docs/bitable/calendar resources owned by YOU | 2 explicit + UAT-first across the suite |

All three configured = full power. Configure only one = that layer's tools work.

## Core capabilities at a glance

**Messaging (user identity)**
- `send_to_user` / `send_to_group` — text to any chat
- `send_image_as_user` — v1.3.9: send images as you (cookie protobuf brute-force discovery)
- `send_file_as_user` / `send_post_as_user` — files, rich-text posts (with @ mentions and links)
- `batch_send` — multiple sends in one call
- All auto-resolve `oc_xxx` chat IDs to numeric, cached 10 min

**Messaging (official API)**
- `read_messages` / `read_p2p_messages` — group / P2P; external groups auto-fallback to UAT; merge_forward auto-expanded; text auto-extracts URLs + Feishu doc links
- `reply_message` / `forward_message` / `update_message` / `pin_message` / `add_reaction` and the rest of the bot suite
- `download_message_resource` — pull images / files out of messages

**Document suite**
- Docs: `search_docs` / `read_doc` / `read_doc_markdown` (v1.3.9 returns markdown directly, ~60% token savings) / `manage_doc_block` (image / file block shortcuts)
- Bitable: `manage_bitable_app|table|field|view|record` + `upload_bitable_attachment`, batch up to 500 records
- Wiki: `list_wiki_spaces` / `search_wiki` / `create/update/move/copy/delete_wiki_node`
- Drive: `list_files` / `create_folder` / `manage_drive_file` / `upload_drive_file` (supports direct-to-Wiki upload)

**Productivity**
- Calendar: `list/create/update/delete/respond_calendar_event` + `get_freebusy`
- Tasks v2: `list/create/update/complete/delete_task` + `manage_task_members`
- OKR: `list_user_okrs` / `get_okrs` / `create/list/delete_okr_progress_record`

**Realtime events (v1.3.9)**
- Machine-level SSOT: a single MCP process holds the WS owner lock, all processes share `events.jsonl`, every event delivered **exactly once across the entire machine**
- `get_new_events` for incremental drain; `manage_ws_status` to diagnose / reconnect / steal / reconfigure

**Multi-account** (v1.3.8 / v1.3.9 multi-profile auto-switch)
- Run multiple cookie / app / UAT sets on one machine; tool calls auto-route to the right profile by chat / resource ownership
- Auto-retry across profiles on errors 91403 / 1254301 / 1254000 / 99991672 / HTTP 403

## 9 MCP prompts (slash commands)

Available in Claude Code / Codex / Cursor / OpenClaw / Windsurf:

| Prompt | What it does |
|---|---|
| `/send` | Send a message as yourself |
| `/reply` | Read recent messages then reply |
| `/digest` | Summarise recent group / P2P messages |
| `/search` | Search contacts / groups |
| `/doc` | Search / read / create a Feishu doc |
| `/table` | Operate on a bitable |
| `/wiki` | Search Wiki space |
| `/drive` | List drive files / create folder |
| `/status` | Check all three auth layers |

## Quick start

```bash
# 1. Setup wizard writes to ~/.claude.json
npx feishu-user-plugin setup --app-id <YOUR_APP_ID> --app-secret <YOUR_APP_SECRET>

# 2. OAuth for UAT
npx feishu-user-plugin oauth

# 3. Restart Claude Code / Codex
```

In Claude Code, just talk:

> You: "Send as me to Wang Xiao Ming: 'finished the code review, 3 nits'"
>
> Claude: *[calls send_as_user]* Sent ✓

Full install, Cookie capture (Playwright automation), and multi-client config: see [GitHub README](https://github.com/EthanQC/feishu-user-plugin#readme).

## Compatible clients

- **Claude Code** (CLI / Desktop / Web / IDE extensions)
- **Codex**
- **Cursor**, **Windsurf**, **OpenClaw**, any MCP-compatible client

## Compliance & usage scope

⚠️ **This project is for personal and internal-enterprise use only — not a commercial SaaS product.**

- The **cookie + protobuf reverse-engineering layer** is not endorsed by Feishu. Comply with Feishu's *Developer Service Agreement* and your organisation's IT policy.
- The **official API layer** uses Feishu's public open APIs and requires a self-built application with appropriate scopes.
- Don't commit `LARK_COOKIE` / `LARK_USER_REFRESH_TOKEN` to any public repo. (`~/.feishu-user-plugin/credentials.json` is mode 0600 by default.)
- Evaluate legal / compliance risk before any public commercial deployment or multi-tenant SaaS use.

## Links

- [GitHub source](https://github.com/EthanQC/feishu-user-plugin)
- [npm package](https://www.npmjs.com/package/feishu-user-plugin)
- [Changelog](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md)
- [中文文档](./index.html)
- [Issues / Discussions](https://github.com/EthanQC/feishu-user-plugin/issues)
- [MIT License](https://github.com/EthanQC/feishu-user-plugin/blob/main/LICENSE)

---

<small>Maintained with [Claude Code](https://claude.com/claude-code) + [feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin).</small>
