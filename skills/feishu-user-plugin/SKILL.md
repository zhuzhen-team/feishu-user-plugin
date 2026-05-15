---
name: feishu-user-plugin
version: "1.3.12"
description: "All-in-one Feishu MCP server + CLI tool — send messages as yourself (incl. batch_send), read group/P2P chats (auto-expands merge_forward), manage docs/tables/wiki (full CRUD)/drive, OKR (with progress writes), calendar (read+write), Tasks v2, multi-profile auto-switch, real-time WS events. v1.3.12: search_messages tool (Protobuf phase 2 B.5, UAT-only), CLI tool mode (`tool list` / `tool help <name>` / `tool <name> '<json>'`), IdentityState state machine + credentials hot-reload (no-restart UAT reload), displayLabel + sender semantics pack for LLM consumption, WS owner PID liveness check, gitleaks secret scan."
allowed-tools: send_to_user, send_to_group, send_as_user, send_image_as_user, send_file_as_user, send_post_as_user, batch_send, send_card_as_user, search_contacts, create_p2p_chat, get_chat_info, get_user_info, get_login_status, list_profiles, switch_profile, manage_profile_hints, read_p2p_messages, list_user_chats, list_chats, read_messages, search_messages, send_message_as_bot, reply_message, forward_message, delete_message, update_message, add_reaction, delete_reaction, pin_message, create_group, update_group, list_members, manage_members, search_docs, read_doc, get_doc_blocks, create_doc, manage_doc_block, read_doc_markdown, manage_bitable_app, manage_bitable_table, manage_bitable_field, manage_bitable_view, manage_bitable_record, upload_bitable_attachment, list_wiki_spaces, search_wiki, list_wiki_nodes, get_wiki_node, create_wiki_node, update_wiki_node, move_wiki_node, copy_wiki_node, delete_wiki_node, list_files, create_folder, upload_drive_file, manage_drive_file, upload_image, upload_file, download_message_resource, download_doc_image, list_user_okrs, get_okrs, list_okr_periods, create_okr_progress_record, list_okr_progress_records, delete_okr_progress_record, list_calendars, list_calendar_events, get_calendar_event, create_calendar_event, update_calendar_event, delete_calendar_event, respond_calendar_event, get_freebusy, list_tasks, get_task, create_task, update_task, complete_task, delete_task, manage_task_members, get_new_events, manage_ws_status
user_invocable: true
---

# Feishu User Plugin

All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages as yourself — text, image, file, rich text (post)
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts
- **User OAuth** (user_access_token): Read P2P (direct message) chat history

This plugin replaces and extends the official Feishu MCP. No need to install two packages.

## Trigger Conditions

Activate when the user mentions:
- Sending Feishu messages ("发飞书消息给 XXX", "send a message to XXX on Feishu")
- Reading Feishu chats ("读飞书群聊 / 单聊", "read Feishu chat history")
- Feishu documents ("搜飞书文档", "search Feishu docs")
- Feishu tables ("查飞书表格", "query Bitable")
- Feishu wiki ("搜飞书知识库", "search wiki")
- Login status ("飞书登录状态", "check Feishu login")
- **Multi-account** ("加一个飞书账号", "切换到 work 账号", "add another Feishu account", "switch to my work account") — see Multi-Account Workflow below

## 9 Built-in Skills

### /send — Send message as yourself
Parse "recipient: message" format, auto-detect user vs group, confirm before sending.

### /reply — Read messages and reply
Search chat → read recent messages → show summary → user picks a message → reply.

### /digest — Chat message digest
Search chat → read N days of messages → filter valuable content → summarize key insights.

### /search — Search contacts
Search users and groups by name, display results grouped by type.

### /doc — Document operations
Search (search_docs), read (read_doc), create (create_doc) — three in one.

### /table — Bitable operations
Query (`manage_bitable_table(action=list)` → `manage_bitable_field(action=list)` → `manage_bitable_record(action=search)`), create / update / delete records via `manage_bitable_record(action=create|update|delete)`.

### /wiki — Wiki management
List spaces (list_wiki_spaces), search content (search_wiki), browse nodes (list_wiki_nodes).

### /drive — Drive file management
List files in folders, create new folders in Feishu Drive.

### /status — Check login status
Check cookie / app credentials / UAT — all three auth layers at once.

## Auth Configuration

| Env Variable | Who Provides | Purpose | Required |
|---|---|---|---|
| LARK_COOKIE | **You** | Send messages as yourself | Yes (for messaging) |
| LARK_APP_ID | **You** (create a Feishu app) | Official API access | Yes |
| LARK_APP_SECRET | **You** (from your Feishu app) | Official API access | Yes |
| LARK_USER_ACCESS_TOKEN | **You** (OAuth flow) | Read P2P chat history | Yes (for P2P reading) |
| LARK_USER_REFRESH_TOKEN | **You** (OAuth flow) | UAT auto-refresh | Yes (for P2P reading) |

### Getting Your Cookie (Automated via Playwright)

**Prerequisite: Playwright MCP must be installed.** If not, run:
```
npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright
```
Then restart Claude Code.

**Automated flow (recommended, zero manual cookie copying):**
> Just tell Claude Code: "Help me set up my Feishu cookie"
>
> Claude Code will automatically:
> 1. Open feishu.cn in a browser via Playwright
> 2. Show you the QR code — scan it with Feishu mobile app
> 3. Extract the full cookie (including HttpOnly) via `context.cookies()`
> 4. Write it to your `.mcp.json` LARK_COOKIE field
> 5. Prompt you to restart Claude Code

**Manual fallback (if Playwright is unavailable):**
1. Open https://www.feishu.cn/messenger/ and log in
2. DevTools → **Network** tab → Disable cache → Reload
3. Click the first request → Request Headers → **Cookie** → right-click → Copy value
4. Paste into your `.mcp.json` env `LARK_COOKIE` field

> Do NOT use `document.cookie` or Application → Cookies — they miss HttpOnly cookies required for auth.

### Creating a Feishu App (for Official API)

1. Go to https://open.feishu.cn/app → Create Custom App (自建应用)
2. Add scopes: `im:message`, `im:message:readonly`, `im:chat:readonly`, `contact:user.base:readonly`
3. Copy the App ID and App Secret to your `.mcp.json`
4. Add the bot to any group chats you want to read

## Multi-Account Workflow (v1.3.9+)

The plugin supports multiple Feishu organization accounts via named profiles
in `~/.feishu-user-plugin/credentials.json`. Each profile has its own
COOKIE / APP_ID / APP_SECRET / UAT.

### When the user says "add another Feishu account" / "加一个飞书账号"

Drive this end-to-end via the Bash tool — DO NOT just print commands and
ask the user to type them. Specifically:

**1. Confirm what's needed**, then collect:
- Profile name (default suggestion: `work2`, `personal`, etc.; let user pick)
- The new account's APP_ID and APP_SECRET (user must register a Custom App
  on https://open.feishu.cn/app for that account's tenant — the existing
  app from the default profile WON'T work for a different tenant)
- The new account's COOKIE — drive Playwright MCP to extract it (see
  "Getting Your Cookie" above; note the **clear cookies first** caveat
  to avoid stale-account contamination)

**2. Run setup (no `--activate` — keep current account active so user
isn't yanked off mid-session):**
```bash
npx feishu-user-plugin setup --profile <name> --app-id <X2> --app-secret <S2> --cookie <C2>
```

**3. Run OAuth for the new profile** (this opens a browser tab; user must
click "授权" in the consent page — that part is unavoidable):
```bash
npx feishu-user-plugin oauth --profile <name>
```
After consent, UAT is written to `credentials.json::profiles[<name>]`.

**4. Confirm via list_profiles MCP tool** — should now see both `default`
and `<name>`, with `default` still active.

**5. Tell the user how to switch later** — call `switch_profile(name="<name>")`
MCP tool from Claude Code; cross-process MCP processes auto-sync within ms
via dispatcher mtime hook.

### When the user says "switch to <profile>" / "切到 work 账号"

Just call `switch_profile(name="<profile>")` MCP tool. Don't run any CLI
command. Cached clients reset; next tool call uses the new account.

If the named profile doesn't exist, list_profiles first to show the user
their actual profile names, then ask which they meant.

### When the user says "show all my Feishu accounts" / "我有几个飞书账号"

Call `list_profiles` MCP tool. Show the active marker.

### Optional cron for keepalive (multi-profile)

If the user has multiple profiles with UAT, suggest:
```bash
crontab -e   # add this line:
0 */4 * * * npx feishu-user-plugin keepalive --all >> /tmp/feishu-keepalive.log 2>&1
```
The `--all` flag iterates every profile in credentials.json (without it,
only the active profile gets refreshed — sufficient for single-account
users but multi-account users will see other profiles' UATs expire).

## Known Limitations

- Image/file sending requires uploading via Official API first to get keys
  (`upload_image` → `send_image_as_user(image_key=...)`).
- `send_card_as_user` always routes through bot identity. User-identity
  (cookie protobuf) card sending was confirmed server-side disabled in
  v1.3.9 (exhaustive brute-force).
- Cookie session valid for ~12h; auto-refreshed via built-in heartbeat
  (4h interval). UAT valid 2h, refresh_token valid 7 days; run `keepalive`
  cron weekly to prevent refresh_token expiration.
- "Seamless" auto-switch tied to which account is active in Feishu Desktop
  is **not yet implemented** (designed for v1.3.10; see ROADMAP). For now,
  call `switch_profile` MCP tool when you want to flip.
