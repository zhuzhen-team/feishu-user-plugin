---
title: feishu-user-plugin · Feishu / Lark MCP Server for Claude Code & Codex
description: All-in-one Feishu / Lark MCP server. 85 tools, 3 auth layers, send messages as your user identity. Open source MIT.
keywords: Feishu MCP, Lark MCP, Claude Code Feishu, Claude Code Lark, Codex Feishu, MCP server, send as user, Feishu AI agent, Lark agent
lang: en
---

# feishu-user-plugin

Feishu / Lark MCP server covering IM, docs, bitable, wiki, drive, calendar, tasks v2, OKR, realtime events. **85 tools · 3 auth layers · 9 MCP prompts · MIT licensed · Node ≥18**.

[GitHub](https://github.com/EthanQC/feishu-user-plugin){: .btn .btn-primary }
[npm](https://www.npmjs.com/package/feishu-user-plugin){: .btn }
[中文文档](./index.html){: .btn }
[CHANGELOG](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md){: .btn }

Works with Claude Code, Codex, Cursor, Windsurf, VS Code, Claude Desktop, OpenClaw, and any MCP-compatible client.

What sets it apart from other Feishu MCPs: a cookie + protobuf protocol path that supports **user-identity messaging** — Feishu's official open API has no `send_as_user` scope, and bot-token messages are tagged `sender_type: "app"`.

## Three auth layers

| Layer | Credentials | Capabilities | Tool count |
|---|---|---|---|
| User identity | `LARK_COOKIE` | Send text / image / file / post / @ / batch as the user | 8 |
| Official API (bot) | `LARK_APP_ID` + `LARK_APP_SECRET` | Group messages, docs, bitable, wiki, drive, calendar, tasks v2, OKR, contacts, realtime WS events | 70+ |
| User OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P chat reading, user chat list; resources owned by the user when creating docs / bitable / calendar | 2 explicit + UAT-first across the suite |

Layers are independent — configure any subset.

## Core capabilities

**Messaging (user identity)**
- `send_to_user` / `send_to_group` — send text to any chat
- `send_image_as_user` — send images as the user (v1.3.9)
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
- Machine-level SSOT: a single MCP process holds the WS owner lock, all processes share `events.jsonl`, with per-profile drain cursors (v1.4.0), every event delivered exactly once across the machine
- `get_new_events` for incremental drain; `manage_ws_status` to diagnose / reconnect / steal / reconfigure

**Multi-account** (v1.3.8 / v1.3.9 multi-profile auto-switch)
- Run multiple cookie / app / UAT sets on one machine; tool calls auto-route to the right profile by chat / resource ownership
- Auto-retry across profiles on errors 91403 / 1254301 / 1254000 / 99991672 / HTTP 403; writes never auto-switch

## 9 MCP prompts (slash commands)

| Prompt | Purpose |
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
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth     # User OAuth UAT
# restart Claude Code / Codex
```

Cookie capture: ask Claude Code "set up my Feishu cookie" and it'll automate via Playwright (QR scan login + extract); or open feishu.cn DevTools, copy the entire Cookie header from any request (don't use `document.cookie` — `session` / `sl_session` are HttpOnly).

```
You: send to Wang Xiao Ming as me: "finished the code review, 3 nits"
Claude: [calls send_to_user]  Sent
```

Full install, per-client config, and tool index: [GitHub README](https://github.com/EthanQC/feishu-user-plugin#readme).

## Links

- [GitHub source](https://github.com/EthanQC/feishu-user-plugin)
- [npm package](https://www.npmjs.com/package/feishu-user-plugin)
- [Changelog](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md)
- [中文文档](./index.html)
- [Issues / Discussions](https://github.com/EthanQC/feishu-user-plugin/issues)
- [MIT License](https://github.com/EthanQC/feishu-user-plugin/blob/main/LICENSE)
