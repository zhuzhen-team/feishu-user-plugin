# feishu-user-plugin — Claude Code Instructions

## What This Is
All-in-one Feishu plugin for Claude Code with three auth layers:
- **User Identity** (cookie auth): Send messages (text, image, file, post) as yourself
- **Official API** (app credentials): Read group messages, docs, tables, wiki, drive, contacts, upload files
- **User OAuth UAT** (user_access_token): Read P2P chat history, list all user's chats

## MCP Prompts (v1.3.7)

The 9 Claude Code skills are also exposed as MCP prompts (`prompts/list` + `prompts/get`) so Codex, Cursor, OpenClaw, and Windsurf — which cannot load Claude Code skills — get the same guided UX. Prompt bodies are read at server start from `skills/feishu-user-plugin/references/`.

| Prompt | Description |
|--------|-------------|
| `/send` | Send a message as yourself (non-bot) |
| `/reply` | Read recent messages and reply |
| `/digest` | Summarise recent group or P2P messages |
| `/search` | Search Feishu contacts or groups |
| `/doc` | Search, read, or create a Feishu document |
| `/table` | Operate on a Feishu Bitable (multi-dimensional table) |
| `/wiki` | Search and browse a Feishu Wiki space |
| `/drive` | List files or create folders in Feishu Drive |
| `/status` | Check all three auth layers (cookie, app, UAT) |

Each prompt accepts a single `arguments` free-form string (mirroring the `$ARGUMENTS` convention used by Claude Code skills). `status` has no arguments.

## Tool Categories (82 tools)

Per-tool descriptions live in each tool's MCP `inputSchema.description`. This section lists names + cross-domain caveats only.

### User Identity — Messaging (cookie protobuf, 8 tools)
`send_to_user` / `send_to_group` / `send_as_user` / `send_image_as_user` / `send_file_as_user` / `send_post_as_user` / `send_card_as_user` / `batch_send`

- All cookie sends auto-resolve `oc_xxx` chat IDs to numeric since v1.3.7 (C1.4: `getChatInfo → search → numeric`, cached).
- Plain-text sends accept `ats:[{userId,name}]` — the marker `@<name>` must appear in `text`; spliced into a real AT element that triggers notifications.
- `send_post_as_user` paragraphs accept `{tag:"text"}` / `{tag:"a",href,text}` / `{tag:"at",userId,name}` elements; `at` element triggers a real notification.
- `send_image_as_user` is **broken via cookie protobuf** (HTTP 400 — wire format incomplete). Workaround: `send_message_as_bot(msg_type="image")`. Wire-format reverse-engineering deferred to v1.3.8. See Known Limitations.

### User Identity — Contacts & Info (5 tools)
`search_contacts` / `create_p2p_chat` / `get_chat_info` / `get_user_info` / `get_login_status`

- `get_chat_info` accepts both `oc_xxx` and numeric chat_id (Official API + protobuf fallback).

### User OAuth UAT — P2P Chat (2 tools)
`read_p2p_messages` / `list_user_chats`

- `list_user_chats` returns **groups only** (Feishu API limit). For P2P chat list, use `search_contacts` → `create_p2p_chat`.
- All docx / bitable / drive / wiki / OKR / calendar / tasks create+edit are UAT-first by default — UAT first, bot fallback, with ⚠ warning in response when forced to bot. Resources consistently owned by the caller.

### Official API — IM (15 tools)
`list_chats` / `read_messages` / `send_message_as_bot` / `reply_message` / `forward_message` / `delete_message` / `update_message` / `add_reaction` / `delete_reaction` / `pin_message` / `create_group` / `update_group` / `list_members` / `manage_members` / `download_message_resource`

- `read_messages` resolves chat name → bot list → `im.chat.search` → cookie `search_contacts`. Auto-falls back to UAT for external groups. `merge_forward` auto-expands; text messages get `urls[]` + `feishuDocs[]` extracted (disable with `expand_merge_forward=false`).
- `update_message` only supports `msg_type=text|interactive` (Feishu limit; rejected before API call).
- `forward_message` auto-detects `receive_id_type` from prefix (`ou_`/`on_`/`email`/...).
- `manage_members` requires `member_id_type` to match the IDs you pass (`open_id` default; pass `union_id`/`user_id` explicitly to avoid 9499).
- `download_message_resource(kind=image|file)` MUST pass `save_path` when payload > 2 MiB (Anthropic 5 MB inline cap). For `merge_forward` children use `parentMessageId`, not child id.

### Official API — Docs (5 tools)
`search_docs` / `read_doc` / `get_doc_blocks` / `create_doc` / `manage_doc_block` / `download_doc_image`

- `manage_doc_block(action=create)` has image (`image_path`/`image_token`) and file (`file_path`/`file_token`) shortcuts; FILE blocks (block_type=23) are auto-wrapped in VIEW container (block_type=33), plugin walks into the inner file block before `replace_file` PATCH.
- `download_doc_image` same 2 MiB cap as `download_message_resource`.
- All `document_id` / `app_token` accept native token / wiki node token / full Feishu URL (resolved via `getWikiNode`, 10 min cache).

### Official API — Bitable (5 tools, v1.3.7 consolidation)
`manage_bitable_app(action=create|copy|get_meta)` / `manage_bitable_table` / `manage_bitable_field` / `manage_bitable_view` / `manage_bitable_record` / `upload_bitable_attachment`

- `manage_bitable_field(action=update)` requires `type` even when only renaming (Feishu API limit).
- `manage_bitable_record` create/update/delete accept arrays (single or up to 500).
- `manage_bitable_app(action=create)` accepts optional `wiki_space_id` (+ `wiki_parent_node_token`) for direct Wiki placement.
- `upload_bitable_attachment` returns `file_token` → write into Attachment field via `manage_bitable_record(action=create|update, records=[{fields:{<field>:[{file_token:"..."}]}}])`.

### Official API — Wiki (9 tools)
`list_wiki_spaces` / `search_wiki` / `list_wiki_nodes` / `get_wiki_node` / `create_wiki_node` / `update_wiki_node` / `move_wiki_node` / `copy_wiki_node` / `delete_wiki_node`

- `list_wiki_spaces` / `list_wiki_nodes` are UAT-first; bot path returns `scopeHint` when empty (typically `wiki:wiki:readonly` missing).
- `get_wiki_node` accepts both wiki node tokens AND underlying `obj_token`s from `search_wiki` (synthesizes node-shape).
- `update_wiki_node` only patches `title` (Feishu wiki API doesn't take content edits — those go through docx/bitable/sheet tools).
- `delete_wiki_node` only removes the Wiki node pointer; underlying drive resource needs separate `manage_drive_file(action=delete)`.

### Official API — Drive (5 tools)
`list_files` / `create_folder` / `manage_drive_file(action=copy|move|delete)` / `upload_image` / `upload_file` / `upload_drive_file`

- `manage_drive_file` requires `type` (`file/folder/docx/sheet/bitable/mindnote/slides`) — Feishu rejects with 1061002 / 1062501 otherwise.
- `upload_drive_file` with `wiki_space_id` calls `attachToWiki(obj_type=file)` to place the upload as a Wiki node atomically.

### Official API — OKR (6 tools)
`list_user_okrs` / `get_okrs` / `list_okr_periods` / `create_okr_progress_record` / `list_okr_progress_records` / `delete_okr_progress_record`

- Writes need `okr:okr.content:write` scope.
- `list_okr_progress_records` extracts triples from `get_okrs` (Feishu has no native list endpoint).
- OKR objective/key-result CRUD doesn't exist in Feishu's open API.

### Official API — Calendar (8 tools)
`list_calendars` / `list_calendar_events` / `get_calendar_event` / `create_calendar_event` / `update_calendar_event` / `delete_calendar_event` / `respond_calendar_event` / `get_freebusy`

- Writes need `calendar:calendar.event:write` scope.
- UAT-first for read (primary + shared + subscribed); bot only sees calendars it was explicitly invited to.

### Official API — Tasks v2 (7 tools, v1.3.7 new domain)
`list_tasks` / `get_task` / `create_task` / `update_task` / `complete_task` / `delete_task` / `manage_task_members`

- Identifier is `task_guid`, not v1 numeric `task_id`.
- `update_task` requires explicit `update_fields=["summary","due","completed_at",...]` array — Feishu only patches listed fields.
- Needs `task:task` scope.

### Plugin — Diagnostics & Profiles (4 tools)
`get_login_status` / `list_profiles` / `switch_profile` / `manage_profile_hints`

- `switch_profile` invalidates cached client instances; next call rebuilds against the new profile. Multi-profile registered via `LARK_PROFILES_JSON` env or `credentials.json` profiles map.
- `manage_profile_hints(action=list|set|clear, resource_key?, profile?)` (v1.3.8) inspects / edits the resourceKey → profile cache the auto-switch middleware uses. No-op when credentials.json doesn't exist.

### Plugin — Realtime Events (1 tool, v1.3.8)
`get_new_events`

- WS connection started at MCP boot when APP_ID + APP_SECRET are configured. Connects to feishu.cn — Lark international not supported.
- Buffer cap 1000 events; oldest dropped. Drain semantics: consumers see each event once.
- Currently emits `im.message.receive_v1` only. Future: approval / calendar / docs comments behind config flag.
- Filter by `event_type` / `event_types` / `chat_id` / `since_seconds`. `peek=true` keeps events in buffer.

## Usage Patterns

### Wiki-hosted content (docx / bitable / sheet)
All docx and bitable tools now accept three input forms for their `document_id` / `app_token` parameter:
- Native token (unchanged): `doccnXXX`, `docxXXX`, `bascnXXX`, ...
- Wiki node token: `wikcnXXX`, `wikmXXX`, `wiknXXX`
- Full Feishu URL: `https://xxx.feishu.cn/docx/XXX`, `.../wiki/XXX`, `.../base/XXX`
The plugin resolves wiki nodes to their underlying `obj_token` via `getWikiNode`, then calls the normal docx / bitable endpoint. Results are cached for 10 min to avoid repeated node lookups.

Create content directly into a Wiki space:
- `create_doc` / `manage_bitable_app(action=create)` accept optional `wiki_space_id` (+ `wiki_parent_node_token`). The plugin creates the resource in drive, then calls `wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki` to attach it — returns `wikiNodeToken` on immediate success, or `wikiAttachTaskId` if Feishu queues the move.

### Document images
Read — `download_doc_image(image_token, doc_token?, save_path?)` returns the image as MCP image content (base64 + mimeType). `doc_token` accepts native id / wiki node / URL. Force `save_path` when image > 2 MiB.
Write — `manage_doc_block(action=create)` has image shortcuts:
- `image_path` (absolute local file path) → plugin creates an image block, uploads the pixels via `drive/v1/medias/upload_all`, and patches the block with the uploaded token.
- `image_token` (already uploaded) → plugin creates block and attaches token.
`manage_doc_block(action=update, image_token=...)` swaps the picture in an existing image block.

### OKR
1. `list_okr_periods` — find the period id for current quarter.
2. `list_user_okrs(user_id=<open_id>, period_ids=[...])` — list the target user's OKRs.
3. `get_okrs(okr_ids)` — batch fetch full objective + key result structure with progress + alignments.
`user_id` is required — use your own open_id (from `get_login_status` / `search_contacts`) to read your own OKRs, or a colleague's open_id for theirs (subject to permissions).

Write (v1.3.7, requires `okr:okr.content:write` scope):
4. `create_okr_progress_record(target_id, target_type=1|2, content_text, source_title?, source_url?, progress_percent?)` — `target_type` is 1 for objectives, 2 for key results. `content_text` is auto-wrapped into Feishu's required block format; pass `content` directly for richer payloads (lists, mentions, docs links, gallery).
5. `list_okr_progress_records(okr_id)` — extracts `{progress_id, target_id, target_type}` triples from `get_okrs` (Feishu has no native list endpoint).
6. `delete_okr_progress_record(progress_id)`.

### Calendar
1. `list_calendars` — get your calendars; the one with `type=primary` is your personal calendar.
2. `list_calendar_events(calendar_id, start_time=<unix_sec>, end_time=<unix_sec>)` — list events in a time window.
3. `get_calendar_event(calendar_id, event_id)` — full details (attendees, location, attachments, meeting link).
4. `create_calendar_event(calendar_id, summary, start_time, end_time, ...)` — `start_time` / `end_time` are objects: `{timestamp:"<unix-seconds>", timezone?:"Asia/Shanghai"}` or `{date:"YYYY-MM-DD"}` for all-day. v1.3.7+ requires `calendar:calendar.event:write` scope.
5. `update_calendar_event(calendar_id, event_id, ...patch)` — pass only the fields to change.
6. `delete_calendar_event(calendar_id, event_id, need_notification?)` — pass `meeting_chat_id` to also dissolve the linked meeting chat if any.
7. `respond_calendar_event(calendar_id, event_id, rsvp_status=accept|decline|tentative)` — RSVP as the current UAT identity.
8. `get_freebusy(time_min, time_max, user_ids=[...])` — freebusy windows in RFC3339; useful for finding meeting slots.

### Tasks (v2, v1.3.7)
Whole new domain. Identifier is `task_guid` (not numeric task_id like v1). Requires `task:task` scope.
1. `list_tasks(completed?, type?)` — current user's tasks, paginated.
2. `get_task(task_guid)` — full details.
3. `create_task(summary, due?, members?, ...)` — at minimum `summary`; `due` is `{timestamp:"<unix-millis>", is_all_day?}`.
4. `update_task(task_guid, update_fields=["summary","due","completed_at"], task={...})` — Feishu only patches the listed fields.
5. `complete_task(task_guid, completed=true|false)` — convenience for the completed_at toggle.
6. `delete_task(task_guid)`.
7. `manage_task_members(action=add|remove, task_guid, members=[{id,role:"assignee"|"follower",type?:"user",name?}])`.

### External-group message read
`read_messages` / `read_p2p_messages` expose a `via` field (`"bot"`/`"user"`/`"contacts"`). On known bot failures (external tenant / no permission / not in chat) the plugin hops straight to UAT; transient errors (rate limit / 5xx / ECONNRESET / timeout) retry once with 2 s delay before falling back. Without UAT, the error points to `npx feishu-user-plugin oauth`.

### Multi-profile auto-switch (v1.3.8)
For users with ≥2 profiles in `~/.feishu-user-plugin/credentials.json`. Read-only tools (`read_*` / `list_*` / `get_*` / `search_*` / `download_*`) auto-retry across profiles on `91403 / 1254301 / 1254000 / 99991672 / HTTP 403`. Writes never auto-switch.

Override per call with `via_profile: "<name>"` to pin, or `via_profile: "auto"` to allow auto-switch on a write. Hints persist in `credentials.json::profileHints` and are inspectable via `manage_profile_hints`.

### Multi-profile registration
For more profiles beyond the default, set `LARK_PROFILES_JSON` in the MCP env (or use `credentials.json` profiles map):
```json
{"alt": {"LARK_COOKIE":"...","LARK_APP_ID":"...","LARK_APP_SECRET":"...","LARK_USER_ACCESS_TOKEN":"...","LARK_USER_REFRESH_TOKEN":"..."}}
```

## Auth & Session
- **LARK_COOKIE**: Required for user identity tools. Session auto-refreshed every 4h via heartbeat and persisted to credentials store.
- **LARK_APP_ID + LARK_APP_SECRET**: Required for official API tools.
- **LARK_USER_ACCESS_TOKEN + LARK_USER_REFRESH_TOKEN**: Required for P2P reading. Auto-refreshed on expiry (error codes 99991668/99991663/99991677). Token auto-persisted to credentials store on refresh.
- Cookie expiry: sl_session has 12h max-age, auto-refreshed by heartbeat every 4h.
- UAT expiry: 2h, auto-refreshed via refresh_token.
- Refresh token expiry: 7 days. Use `keepalive` cron to prevent expiration.

### Credentials store (v1.3.7+)
Single source of truth at `~/.feishu-user-plugin/credentials.json` (mode 0600). Schema documented at `docs/CREDENTIALS-FORMAT.md`. The MCP server reads from this file when present; cookie heartbeat and UAT refresh persist back to it atomically. Multiple harnesses (Claude Code, Codex) sharing the same file see token rotations consistently — no more "Codex still has the old UAT" drift after a refresh in Claude Code.

Opt-in migration:
```bash
npx feishu-user-plugin migrate              # dry-run (default) — prints what would be written
npx feishu-user-plugin migrate --confirm    # writes credentials.json
```
After migration the harness env blocks remain as backward-compat fallback. Delete `~/.feishu-user-plugin/credentials.json` to revert to legacy behaviour.

Backward compat: v1.3.6 users without credentials.json see zero behaviour change. The credentials file is preferred only when it exists. The MCP server's `Auth:` startup line on stderr now shows the source (`credentials.json profile=default` vs `env vars (legacy)`) so you can tell at a glance which path is active.

## Required Environment Variables (ALL are required for full functionality)

| Variable | Purpose |
|----------|---------|
| LARK_COOKIE | User identity messaging |
| LARK_APP_ID | Official API access |
| LARK_APP_SECRET | Official API access |
| LARK_USER_ACCESS_TOKEN | P2P chat reading |
| LARK_USER_REFRESH_TOKEN | UAT auto-refresh |

All 5 must be configured. Without UAT, `read_p2p_messages` and `list_user_chats` will not work.

## Installation

### Config location

Credentials are stored in `~/.claude.json` top-level `mcpServers` (global — works in all directories).
**Do NOT put credentials in project-level config** (`projects[*].mcpServers` or `.mcp.json`) — this causes scope issues.

### Non-interactive setup (for Claude Code agents)

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
```

Writes config to `~/.claude.json` top-level `mcpServers` without any interactive prompts. Supports `--cookie` flag too.

### Interactive setup

```bash
npx feishu-user-plugin setup    # Interactive setup wizard
npx feishu-user-plugin oauth    # Get OAuth UAT tokens
npx feishu-user-plugin status   # Check auth status
npx feishu-user-plugin keepalive # Refresh cookie + UAT (for cron jobs)
```

### Token auto-renewal via cron (optional)

To keep tokens alive even when Claude Code is closed:

```bash
crontab -e
# Add: 0 */4 * * * npx feishu-user-plugin keepalive >> /tmp/feishu-keepalive.log 2>&1
```

## Automated Cookie Setup via Playwright

Prerequisite: Playwright MCP installed (`npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright` then restart).

Procedure (three gotchas embedded — skip any and you'll fail):

1. **Clear cookies first.** Playwright MCP uses Edge's persistent profile and may have a cached login from a different account. Run `browser_run_code: await context.clearCookies();` then `browser_navigate: https://www.feishu.cn/messenger/`.
2. **Wait for QR scan.** `browser_take_screenshot` to show the code; tell user to scan with Feishu mobile (and verify which account). Poll `browser_snapshot` until URL leaves `/accounts/`.
3. **Two-step cookie extraction.** `browser_run_code` output contains markdown prefix + console logs that contaminate the cookie string. Stash via `page.evaluate(s => { window.__COOKIE__ = s; }, str)` then read clean via `browser_evaluate: window.__COOKIE__`.
4. **Validate before writing.** Cookie must be pure ASCII (no Chinese, no `###`), contain `session=` AND `sl_session=`, length 500–5000 chars. If > 10000 it's contaminated — STOP, do not write.
5. **Write to config.** Use `persistToConfig` or update `~/.claude.json` → `mcpServers.feishu-user-plugin.env.LARK_COOKIE`.
6. **OAuth for UAT.** `npx feishu-user-plugin oauth` (browser consent flow, auto-saves tokens).
7. **`browser_close` + tell user to restart.** One restart is enough.

## Troubleshooting Guide

### Official API returns 401 / "token invalid" every time
`LARK_APP_ID` is wrong or stale (most common: agent guessed/copied an unrelated APP_ID at install time). `get_login_status` reports `App credentials: INVALID — app_id=<x> rejected by Feishu`; MCP stderr logs `LARK_APP_ID=<x> was REJECTED`. **Fix**: re-run the canonical install prompt from `team-skills/plugins/feishu-user-plugin/README.md` (correct APP_ID + SECRET), restart.

### MCP tools not available
1. Config must be in **top-level** `~/.claude.json` `mcpServers`, NOT under `projects[*]`. For Codex: `~/.codex/config.toml` has `[mcp_servers.feishu-user-plugin]`.
2. Restart after config changes; first call may briefly say "No such tool" while tools register — retry once.

### Cookie authentication fails
- Browser-console `document.cookie` cannot access HttpOnly cookies (`session`, `sl_session`). Use DevTools Network tab → first request → Request Headers → Cookie. Or use Playwright two-step extraction (see above).
- Playwright logs into the wrong account: ALWAYS `context.clearCookies()` before navigating.

### `read_messages` returns an error
Error includes Feishu's actual code + description. Auto-falls back to UAT for external groups. Chat name resolution: bot's group list → `im.chat.search` → cookie `search_contacts`. If all three fail, pass `oc_xxx` or numeric ID directly.

### UAT refresh fails with `invalid_grant`
Refresh token expired or revoked — auto-refresh cannot recover. **Fix**: `npx feishu-user-plugin oauth`, then restart Claude Code / Codex so running MCP processes load the new token.

v1.3.5+ hardening means the "6 MCP processes racing on UAT refresh and burning the token" case is fixed automatically:
- Cross-process file lock at `~/.claude/feishu-uat-refresh.lock` (`O_CREAT|O_EXCL`, 30 s stale)
- Lock holder re-reads persisted config inside the critical section, adopts a peer's fresh token if one was rotated
- `get_login_status` does a real UAT health check (`listChatsAsUser({pageSize:1})`) — no more "configured but actually 401" surprises

### Multiple / duplicate MCP server processes
Codex + Claude Code both can respawn the server per tool session without cleanup; 6 concurrent processes isn't unusual. v1.3.5 neutralises the damage (file lock above) but stale processes still hold memory. **Manual cleanup when you notice**: `pkill -f 'feishu-user-plugin/src/index.js'`. Also: a team-skills plugin must NOT ship `.mcp.json` — if both `~/.claude.json` and team-skills register the same MCP, you get duplicates; delete `.mcp.json` from the team-skills plugin dir.

### `create_*` tool warns "UAT failed, created as BOT"
UAT is failing (expired / scope missing / race), so the plugin fell back to bot. Resource is now owned by the shared bot, tenant-readable. **Fix**: `npx feishu-user-plugin oauth`, restart, delete the bot-owned copy and recreate.

### OAuth CLI fails with "Missing LARK_APP_ID"
`oauth.js` reads from `~/.claude.json` MCP config (not `.env`). Run `npx feishu-user-plugin setup` first.

### `list_user_chats` doesn't return P2P chats
Expected — Feishu API only returns groups. P2P flow: `search_contacts` → `create_p2p_chat` → `read_p2p_messages`.

## Architecture

### Two distribution channels
- **npm package** (`npx feishu-user-plugin`): MCP server code + skills + CLAUDE.md. For external users.
- **team-skills plugin**: Skills + CLAUDE.md only (no .mcp.json). For internal team members.

### Config management
- `src/config.js`: Unified config module. Discovers config in `~/.claude.json` (top-level + project-level), `.mcp.json`, and `~/.codex/config.toml`.
- `setup` writes to `~/.claude.json` (default) or `~/.codex/config.toml` (with `--client codex`), or both (`--client both`).
- `persistToConfig()` finds the correct config entry and writes back atomically (used by heartbeat + UAT refresh).
- All config writes use atomic write (tmp file + rename) to prevent race conditions with Claude Code.

### Multi-client support
- **Claude Code**: JSON config in `~/.claude.json` mcpServers
- **Codex**: TOML config in `~/.codex/config.toml` mcp_servers
- Setup: `npx feishu-user-plugin setup --client codex` or `--client both`
- MCP server code is identical for both clients — only config format differs
- Codex does not support Claude Code slash commands (skills) — only MCP tools are available

## Development & Publishing

### Publishing to npm

```bash
# 1. Update version in package.json
# 2. Commit and tag
git add -A && git commit -m "v1.2.1: description"
git tag v1.2.1
git push && git push --tags
# 3. GitHub Actions auto-publishes to npm on tag push
```

GitHub Actions workflow (`.github/workflows/publish.yml`) auto-publishes on `v*` tags.
NPM_TOKEN is stored as a GitHub repo secret.

### Syncing to team-skills

**IMPORTANT: team-skills 仓库禁止直接推送 main。所有变更必须走 PR。**

What is automatic now (Phase B3 hooks):
- **pre-commit (this repo)**: any change to `CLAUDE.md` auto-syncs `AGENTS.md` + `skills/feishu-user-plugin/references/CLAUDE.md` (script: `scripts/sync-claude-md.sh`).
- **post-merge (this repo, on main)**: copies `skills/` + `.claude-plugin/plugin.json` into `team-skills/plugins/feishu-user-plugin/`, creates `sync/feishu-v<version>` branch, opens a PR with `--auto --merge` (script: `scripts/sync-team-skills.sh`).

What still needs a manual touch in team-skills:
- `README.md` — team-skills has its own README (with team-shared APP_ID/SECRET hardcoded). Tool count, changelog, install prompt all need hand edits.
- `skills/feishu-user-plugin/SKILL.md` — version + `allowed-tools` list.

team-skills PR 流程:
1. 创建 branch: `git checkout -b sync/feishu-v1.x.x` 或 `fix/feishu-xxx`
2. push branch + `gh pr create` + `gh pr merge <number> --auto --merge`
3. CI (`validate.yml`) checks the three-way version triangle (`plugin.json` / `SKILL.md` / first `### vX.Y.Z` in README) — must match or CI fails.
4. If CI fails: fix + push to same branch, CI re-runs, auto-merge proceeds.

Manual sync fallback (hook failed / dry-run / first-time):
```bash
# CLAUDE.md → AGENTS.md + skill ref now handled by pre-commit hook
cp -r skills/. /Users/abble/team-skills/plugins/feishu-user-plugin/skills/
cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/
# Do NOT copy .mcp.json — team-skills plugin should not have one
```

## Development Workflow

### Keeping all docs in sync

When making ANY code change (new tools, bug fixes, features), update these in this repo:
- `CLAUDE.md` — tool count, tool list, usage patterns, known limitations
- `README.md` — tool count badge + heading + tool table, feature highlights, OpenClaw/Claude Code config examples
- `ROADMAP.md` — check off completed items, add new findings
- `package.json` — version + description (tool count). All three of `package.json`, `.claude-plugin/plugin.json`, and `skills/feishu-user-plugin/SKILL.md` must agree on version (CI enforces).
- `prompts/openclaw-setup.md` — only if OpenClaw config changed

`AGENTS.md` (Codex) and `skills/feishu-user-plugin/references/CLAUDE.md` are auto-derived from `CLAUDE.md` by the pre-commit hook — do **not** edit them by hand.

For team-skills repo: see [Syncing to team-skills](#syncing-to-team-skills) above. Bottom line: `skills/` + `plugin.json` auto-sync via post-merge hook; team-skills README + SKILL.md still need manual edits per release.

### Keeping ROADMAP.md up to date
ROADMAP.md is **forward-only** (open `[ ]` tasks for v1.3.8 / v1.4 candidates only). CHANGELOG.md owns the history of completed work. When you finish a task, **delete the line** — don't move it or check it off. When you discover new bugs / feature ideas, add to the matching section (A–I or v1.4). When you research a direction and rule it out, add to "已调研但暂不实施" with the reasoning.

### When adding new tools (post-v1.3.7 layout)
1. Add the underlying API method to the right domain file:
   - Official API → `src/clients/official/<domain>.js` (im, docs, bitable, drive, wiki, calendar, okr, uploads, contacts, groups). Cross-domain helpers stay in `src/clients/official/base.js`.
   - Cookie identity → `src/clients/user.js`.
2. Add the MCP tool schema + handler to `src/tools/<domain>.js`. Each module exports `{ schemas: [...], handlers: { [name]: async (args, ctx) => MCPResponse } }` — see existing tools for the pattern. Handlers receive `ctx` (factories, profile state, resolveDocId — see `src/tools/_registry.js` docstring).
3. If the new file is a brand-new domain (rare), also append it to the `TOOL_MODULES` list in `src/server.js`.
4. Run smoke: `npm run smoke:baseline` to update the baseline (only when adding/removing/renaming tools is intentional), then `npm run smoke` to verify no other regression. For pure body changes (no schema delta) just `npm run smoke` should pass against the existing baseline.
5. `node -c` lint each touched file.
6. Update this file (CLAUDE.md) — tool count, tool list, usage patterns. See `docs/REFACTOR-NOTES.md` for the file-responsibility matrix.
7. Update ROADMAP.md if relevant.

### When fixing bugs
1. Write a standalone test script (`node -e "..."`) to reproduce the bug before fixing
2. After fixing, verify with the same script
3. If the bug affects MCP tool behavior, test via MCP tool call after server restart

### Testing methodology
See `docs/TESTING-METHODOLOGY.md` for the full regression playbook (when to use unit / smoke / live MCP / `scripts/test-all-tools.js`). The semi-automated path is `node scripts/test-all-tools.js`; the smoke gate is `npm run smoke` (regenerate baseline with `npm run smoke:baseline` only when a tool schema delta is intentional).

### Commit conventions
- `feat:` new tools or capabilities
- `fix:` bug fixes
- `docs:` CLAUDE.md, ROADMAP.md, README updates
- `chore:` dependencies, CI, config changes

### Publishing
**IMPORTANT: Version number must ALWAYS be confirmed with the user before publishing.**
Any operation involving `npm version`, modifying `package.json` version, `git tag v*`, or `git push --tags` requires explicit user confirmation of the target version number. Do not auto-decide version numbers.

Three-layer version safety:
1. **Claude rule** (this section): Ask user to confirm version before any publish-related operation
2. **Local gate** (`prepublishOnly`): Interactive confirmation when running `npm publish` locally (skipped in CI)
3. **CI gate** (`.github/workflows/publish.yml`): Tag must match `package.json` version or publish fails

Steps:
1. Confirm target version with user
2. Update `version` in `package.json`
3. `git add <files> && git commit -m "v1.x.x: description"`
4. `git tag v1.x.x && git push && git push --tags`
5. GitHub Actions verifies tag matches package.json, then auto-publishes to npm
6. **After npm confirms the new version is live, draft a release announcement in Chinese for the "AI技术解决（内部）" Feishu group and show it to the user for approval BEFORE sending.** Do not send until the user explicitly approves.

### Release announcement rules (every release)
After a successful publish, draft a group announcement to "AI技术解决（内部）" (chat_id `7599552782038813643`) and ALWAYS show it to the user for review first. Only send after explicit approval.

**Transport**: `send_post_as_user` (rich-text post). No @-mentions — announcements are impersonal broadcasts. No emojis. No marketing language.

**Structure** (in this order; omit a section if it doesn't apply this release):

```
feishu-user-plugin vX.Y.Z 发布

<一到两句开篇总结本次发布的主题，陈述语气，不推销>

修复
• <缺陷描述>：<根因与修复机制，引用具体错误码/接口名/参数>
• ...

新增
• 新增 <tool 名> 工具：<一句话功能描述>。<关键约束或调用条件>
• ...

调整
• <行为变化的描述>
• ...

下版本计划
• <条目>
• ...

升级方式
• 重启 Claude Code / Codex 即可自动拉取 X.Y.Z
• <若有相关新日志/错误提示，说明怎么应对>
• 建议复测 N 个场景：<场景 1>、<场景 2>、<场景 3>
```

**写作规范**:
- **开篇**：一到两句陈述式总结，不宣传、不夸大。参考 v1.3.2："本次更新主要补齐了 X 能力，并修复了 Y 问题；同时将 Z 统一调整为 ..."
- **每条 bullet**：先写用户可见现象，再写底层机制。引用具体错误码（如 1770032 / 91403）、接口名（如 manage_doc_block）、参数名（如 RichText.atIds）——专业读者信赖的是细节
- **字符**：bullet 用 `•`（U+2022），不用 `-` 或 `*`；代码/工具名在正文中直接写，不加反引号
- **禁用**：emoji、🔴🟡🟢 之类严重度标记、`@` 任何人、营销词（"强大"、"全新"、"重磅"）、夸张修辞
- **语气**：技术 release note 的中性语气，像写给同行的内部更新。参考 v1.3.2 全文
- **长度**：单屏为宜，一般 400–700 汉字。每条 bullet 一到三行
- **下版本计划**：复制自上一版公告仍未完成的条目 + 本次发布中暴露的新方向。本版已完成的条目必须删除
- **升级方式**：至少包含重启指令；若本次修了某类错误（如 APP_ID 校验），列出对应诊断日志字样；以"建议复测 N 个场景"收尾，场景要具体可操作

**结尾**：不加 CHANGELOG 链接（v1.3.2 风格未含链接，群内读者不需要）。

**发送前**：始终先用 `send_to_user` 或类似工具发给用户自己审核，或直接以文本形式贴在对话里等用户批准。用户说"发"才调 `send_post_as_user` 到目标群。

## OAuth Scopes (when re-running `npx feishu-user-plugin oauth`)

The v1.3.4 tools require additional scopes on the app + UAT:

| Feature | Scopes to enable on app + include in OAuth |
|---------|-------------------------------------------|
| OKR read | `okr:okr:readonly`, `okr:period:read` |
| OKR progress write (v1.3.7: create/delete_okr_progress_record) | `okr:okr.content:write` |
| Calendar read | `calendar:calendar:readonly`, `calendar:calendar.event:read` |
| Calendar write (v1.3.7: create/update/delete/respond_calendar_event) | `calendar:calendar.event:write` |
| Tasks v2 (v1.3.7: list/get/create/update/complete/delete_task, manage_task_members) | `task:task` |
| Docx/Bitable/Drive media upload (`uploadMedia`, `upload_drive_file`, `upload_bitable_attachment`, `manage_doc_block(action=create, image_path|file_path|...)`) | `drive:drive`, `drive:file:upload`, `docs:document.media:upload`, `sheets:spreadsheet` (only for sheet uploads) |
| Wiki attach (`move_docs_to_wiki`) | `wiki:wiki` (edit scope, the readonly one is insufficient) |

If a tool returns `access_denied` or error code `99991672` (scope not granted), the scope is missing on either the app or the UAT. Re-run `npx feishu-user-plugin oauth` so the UAT picks up the latest scope list (defined in `src/oauth.js`).

## Known Limitations
- CARD message type (type=14) not yet implemented — complex JSON schema
- External tenant users may not be resolvable via `get_user_info` (contact API scope limitation)
- Cookie auth requires human interaction (QR scan) — cannot be fully automated
- Refresh token expires after 7 days without use — set up `keepalive` cron to prevent this
- `manage_bitable_field(action=update)` requires `type` parameter even when only changing field name (Feishu API requirement)
- `list_wiki_spaces` may return empty if bot lacks `wiki:wiki:readonly` permission (v1.3.7+: `scopeHint` field is appended to the response when this happens)
- `delete_wiki_node` calls an undocumented-in-SDK endpoint (`DELETE /wiki/v2/spaces/{id}/nodes/{token}`); v1.3.7 ships it because Feishu's API console exposes it, but if Feishu retires the endpoint the tool will fail with a clear 404 — fall back to `manage_drive_file(action=delete)` on the underlying obj_token in that case.
- `search_wiki` uses same API as `search_docs` — `docs_types` filter may not work as expected
- `send_image_as_user` is currently broken: Feishu's cookie protobuf gateway rejects the simple `{imageKey}` content payload (HTTP 400) because the Feishu Web client encodes images with extra metadata (image dimensions, mime type, etc.) that we don't have in `proto/lark.proto`. Reverse-engineering needs Chrome DevTools traffic capture and is deferred to v1.3.8. v1.3.7 surfaces a clear error pointing to `send_message_as_bot(msg_type="image", ...)` as the workaround. (`send_file_as_user` and `send_post_as_user` work fine — only IMAGE is affected.)
