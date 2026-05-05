# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.8] - 2026-05-05

本次更新主线是多 profile 自动切换和 WebSocket 实时事件两块新能力，同时把 v1.3.7 推迟的 auth 模块拆分和凭证 pointer-only 模式补齐，并加固 CI 闸门（server.json 自动重生、SKILL.md allowed-tools 与 TOOLS 1:1 校验、CHANGELOG section 校验、文档三方同步校验）。工具数 80 → 82。

### Added
- **多 profile 自动切换 (B)**：当 `~/.feishu-user-plugin/credentials.json` 配了 ≥2 profile，读取类工具（`read_*` / `list_*` / `get_*` / `search_*` / `download_*` 加 `manage_bitable_*` 的 read-action 变体）遇到 91403 / 1254301 / 1254000 / 99991672 / HTTP 403 时自动尝试其它 profile 重试。命中后 resourceKey → profile 写入 `profileHints`，下次直接走对的账号。写操作绝不自动切；显式 `via_profile="alt"` 单次锁定，`via_profile="auto"` 在写操作上手动允许。
- **新工具 manage_profile_hints**：`action=list|set|clear, resource_key?, profile?`，检查或编辑 profile 命中缓存。
- **WebSocket 实时事件 (C)**：MCP server 启动时后台连飞书 WSClient（仅 feishu.cn，Lark 国际版不支持），事件入 1000 容量 FIFO buffer。新工具 `get_new_events(event_type?, event_types?, chat_id?, since_seconds?, max_events=50, peek=false)` 拉取，默认 drain 语义；当前注册 `im.message.receive_v1`。
- **Cookie protobuf 工具链 (A.0)**：`scripts/decode-feishu-protobuf.js` 解码 + 报告未知字段；`scripts/capture-feishu-protobuf.js` 抓包 recipe；`docs/COOKIE-PROTOBUF-CAPTURES.md` 流程文档。下版本用这套真做 send_image / audio / sticker / card / search_messages 反向。
- **`FEISHU_PLUGIN_PROFILE` 启动 env (E.1)**：让 harness 各自指向不同 profile，启动时校验存在（拼错直接 exit 2，不静默 fall through）。
- **`setup --pointer-only` 模式 (E.2)**：harness env 只写 `FEISHU_PLUGIN_PROFILE=default`，真凭证全部留 `credentials.json`，消除 UAT 刷新后两端 diverge。

### Changed
- **`src/auth/uat.js` + `src/auth/cookie.js` 拆分 (D.1, D.2)**：从 `clients/official/base.js` 和 `clients/user.js` 拆出来，client 实例上变 1-line delegate；状态字段保留在客户端实例。base.js 减约 200 行，关掉 v1.3.7 Phase B 的拆分欠账。
- **启动诊断更主动 (E.3)**：credentials.json + 旧 LARK_* env 双存在打 NOTE 提示 env 已被忽略；env-only 用户打 TIP 建议运行 `npx feishu-user-plugin migrate --confirm`。

### Fixed
- **server.json 长期 drift**：长期停在 v1.2.0 / 33 tools 且包含已删工具。新增 `scripts/sync-server-json.js` 从 package.json + TOOLS 自动重生，prepublishOnly 与 CI 验证 drift；本版同步到 v1.3.8 / 82 tools。
- **`check-tool-count.js` 扩展**：除 README badge 之外同时校验 `SKILL.md::allowed-tools` 与 TOOLS 一致，避免 SKILL.md 单独 drift 漏掉。
- **G.1 wiki-attach 兜底回归脚本**：`scripts/test-wiki-attach-fallback.js` 把 `attachToWiki` monkey-patch 成抛 91403，验证 `upload_drive_file` 把失败透出来而不是默默上传到 drive root。POSIX skip 77 缺凭证时跳过。

### Deferred to v1.3.9
- Cookie protobuf 实际抓包：`send_image_as_user` / `send_audio_as_user` / `send_sticker_as_user` / `send_card_as_user` 真用户身份 / `search_messages`。工具链已 ship（`scripts/decode-feishu-protobuf.js` 等），抓包 session 留下版本一并做。
- 机器级 SSOT 完整化：WebSocket 单 owner + 共享 events.jsonl + 单一 drain 游标；active profile 跨进程 stat 同步；setup 非交互模式自动 pointer-only。
- 本地 md → 飞书 wiki 同步、`read_doc_markdown` 工具、`src/config/` 目录化拆分。
- `switch_profile` 多 profile e2e（mock 第二 profile 测 setActiveProfile cache 失效路径）。
- 测试群 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e` 解散（卡 group owner 权限转让）。

### Test scenarios
- 调用 `read_doc` 命中外部租户文档时观察 stderr 出现 `profile-router: default → alt on read_doc (code=91403)`，结果回到 alt profile 的内容
- 用 `send_to_user` 给自己发条文本后调 `get_new_events`，看到对应的 `im.message.receive_v1` 事件
- 跑 `npx feishu-user-plugin migrate --confirm` 后重启 MCP，启动 stderr 显示 `Auth: ... source: credentials.json profile=default`，所有工具调用照常

## [1.3.7] - 2026-05-04

### Added
- **Wiki write (5 tools)**: `create_wiki_node` / `update_wiki_node` / `move_wiki_node` / `copy_wiki_node` / `delete_wiki_node`. UAT-first. `create_wiki_node` builds doc/sheet/bitable/mindnote/file/docx/slides directly inside a wiki space, or `node_type=shortcut` for a pointer. `update_wiki_node` only patches `title` (Feishu wiki API doesn't accept content edits — those go through docx/bitable/sheet). `move`/`copy` accept `target_parent_token` + optional `target_space_id` for cross-space migration. `delete_wiki_node` calls `DELETE /wiki/v2/spaces/{id}/nodes/{token}` via raw REST (SDK doesn't type it) — only deletes the node pointer, not the underlying drive resource.
- **OKR progress writes (3 tools)**: `create_okr_progress_record` / `list_okr_progress_records` / `delete_okr_progress_record`. UAT-first. Requires `okr:okr.content:write` scope. `create` accepts a simplified `content_text` (auto-wrapped into Feishu's block schema) plus optional `source_title` / `source_url` / `progress_percent`. `list` extracts `{progress_id, target_id, target_type}` triples from `get_okrs` since Feishu has no native list endpoint.
- **Calendar write (5 tools)**: `create_calendar_event` / `update_calendar_event` / `delete_calendar_event` / `respond_calendar_event` / `get_freebusy`. UAT-first. Requires `calendar:calendar.event:write` scope. `start_time` / `end_time` are objects: `{timestamp:"<unix-seconds>", timezone?}` or `{date:"YYYY-MM-DD"}`. `delete` accepts `meeting_chat_id` to also dissolve the linked meeting chat. `respond` is the RSVP path.
- **Tasks v2 (7 tools, new domain)**: `list_tasks` / `get_task` / `create_task` / `update_task` / `complete_task` / `delete_task` / `manage_task_members`. UAT-first. Requires `task:task` scope. v2 uses `task_guid` instead of v1 numeric `task_id`. `update_task` requires explicit `update_fields=["summary","due","completed_at",...]` — Feishu only patches the listed fields. `complete_task(completed=true|false)` is a convenience wrapper.
- **MCP prompts (9)**: `/send` `/reply` `/digest` `/search` `/doc` `/table` `/wiki` `/drive` `/status`. Mirror the Claude Code skills via `prompts/list` + `prompts/get`, so Codex / Cursor / OpenClaw / Windsurf get the same guided UX. Reference bodies are read at server start from `skills/feishu-user-plugin/references/`.
- **Single-source credentials store**: `~/.feishu-user-plugin/credentials.json` (mode 0600, schema `docs/CREDENTIALS-FORMAT.md`). Multiple MCP processes (Claude Code + Codex sharing the file) see token rotations consistently — closes the "Codex still has the old UAT after a refresh in Claude Code" drift. Cookie heartbeat + UAT refresh persist back atomically. Opt-in: `npx feishu-user-plugin migrate` (dry-run) / `migrate --confirm` (writes). Env vars remain as backward-compat fallback. Server's `Auth:` startup line on stderr shows source (`credentials.json profile=default` vs `env vars (legacy)`).
- **Semi-automated regression**: `scripts/test-all-tools.js` walks every tool with representative payloads. `tests/baseline/` snapshots `tools-list.json` / `prompts-list.json` / `login-status-shape.json`; `npm run smoke` diffs against them, `npm run smoke:baseline` regenerates after intentional schema change. `docs/TESTING-METHODOLOGY.md` documents when to use unit / smoke / live MCP / `test-all-tools`.

### Fixed
- **C1.4 — `send_*_as_user` silently dropped messages with `oc_xxx` chat IDs**: cookie protobuf gateway's `PutMessageRequest.chatId` only recognizes numeric IDs; an `oc_xxx` was treated as unknown and the server returned an empty packet. Now auto-resolves `oc_xxx` via `getChatInfo(name) → cookie search(name) → numeric` and caches the mapping. Covers `send_as_user` / `send_image_as_user` / `send_file_as_user` / `send_post_as_user` / `send_card_as_user` / `batch_send`. Numeric IDs pass through unchanged. Resolution failure throws a clear error.
- **`list_wiki_nodes` returned 131006 in spaces the bot wasn't invited to**: `list_wiki_spaces` was already UAT-first, but `list_wiki_nodes` was bot-only. Made `list_wiki_nodes` UAT-first to match.
- **C1.15 — `get_user_info` showed current user as external tenant**: `getUserById` previously hit contact API first (requires `contact:user.base:readonly`); some OAuth configs returned no permission for same-tenant queries and the user was wrongly downgraded. Now UAT-first, contact API as fallback.
- **`manage_drive_file(action=delete)` printed `task=undefined`**: `DELETE /drive/v1/files/{token}` is synchronous and returns no `task_id`. Switched to `File deleted ({type})` when no task_id, `File deletion queued: task=...` when one is returned.
- **`send_image_as_user` failed silently**: cookie protobuf gateway rejects the simple `{imageKey}` content payload (HTTP 400) because Feishu Web actually encodes images with extra metadata (dimensions, MIME, thumbnails) that aren't in `proto/lark.proto`. Now throws a clear error pointing to `send_message_as_bot(msg_type="image", payload={image_key:"..."})` as the workaround. Wire format reverse-engineering deferred to v1.3.8 (needs Chrome DevTools traffic capture).
- Documented common error codes in tool schemas: 9499 (`manage_members` missing `member_id_type`, default `open_id`), 1062501 / 1061002 (`manage_drive_file` missing `type`).

### Changed
- **Phase A refactor**: 7,500-line `src/index.js` split into `src/tools/<domain>.js` (handlers + schemas) and `src/clients/official/<domain>.js` (API methods). `src/server.js` orchestrates registration; `src/tools/_registry.js` provides shared `ctx` (factories, profile state, `resolveDocId`). See `docs/REFACTOR-NOTES.md` for the file-responsibility matrix.
- **Tool consolidation (82 → 80)**: 21 bitable tools collapsed into 5 `manage_bitable_*` dispatchers (app / table / field / view / record, each with `action=list|create|update|delete|...`). 3 doc-block tools → `manage_doc_block(action=create|update|delete)`. 3 drive ops → `manage_drive_file(action=copy|move|delete)`. 2 download tools → `download_message_resource(kind=image|file)` + `download_doc_image`. Semantics unchanged; parameters collapsed onto an `action` field.
- **Writes default to UAT**: every `create`/`edit` for docx / bitable / drive / wiki / OKR / calendar / tasks runs through `_asUserOrApp` — UAT first, bot only as fallback. Forced bot fallback appends a ⚠ warning to the response (and points to `npx feishu-user-plugin oauth`) so the ownership shift surfaces immediately.
- **ID input normalization**: docx / bitable tools' `document_id` / `app_token` accept native token (`doccnXXX` / `docxXXX` / `bascnXXX`), wiki node token (`wikcnXXX` / `wikmXXX` / `wiknXXX`), and full Feishu URLs. Internally resolved via `getWikiNode` with a 10-minute cache.
- **Upload scope inventory**: `uploadMedia` / `upload_drive_file` / `upload_bitable_attachment` / `manage_doc_block(image_path|file_path)` collectively need `drive:drive`, `drive:file:upload`, `docs:document.media:upload`, and `sheets:spreadsheet` (sheet uploads only). Documented in CLAUDE.md and the OAuth scope table.
- **team-skills sync via PR**: post-merge hook in this repo now opens an auto-merging PR against team-skills instead of pushing to main. CI `validate.yml` enforces a version triangle across `plugin.json` / `SKILL.md` / `README.md` first `### vX.Y.Z` heading.

## [1.3.6] - 2026-05-03

### Added
- **Upload completeness**: `uploadDocMedia` → `uploadMedia` accepting 8 `parent_type`s (docx / sheet / bitable × image / file + legacy doc_*). New `create_doc_block` modes for files (`file_path` / `file_token`, block_type 23, auto view-wrap). `update_doc_block` accepts `file_token` to swap existing file blocks. New `upload_drive_file` (`drive/v1/files/upload_all`; optional `wiki_space_id` auto-attaches via `move_docs_to_wiki`). New `upload_bitable_attachment` (`parent_type=bitable_image|bitable_file`).
- **`batch_send` tool**: fan-out the same or different content to multiple targets in one call. Each target dispatches sequentially with anti-rate-limit throttling and reports per-target `ok` / `error`. Identity is the cookie user unless `target.via=bot`.
- **Multi-profile support**: `list_profiles` / `switch_profile` tools + `LARK_PROFILES_JSON` env. Hot-swap credentials without restarting the MCP server; cached client instances rebuild against the new profile.
- **`send_card_as_user` (bot-routed default)**: send Feishu interactive cards. v1.3.6 routes through the bot identity; the `as_user` suffix is reserved for v1.3.7's reverse-engineered cookie path. `via="user"` returns an explicit not-yet-implemented error.

### Changed
- OAuth scopes added: `drive:file:upload` (narrower scope for `drive/v1/files/upload_all`), `sheets:spreadsheet` (sheet image / file uploads). Existing users must re-run `npx feishu-user-plugin oauth` to pick them up.

## [1.3.5] - 2026-04-24

### Fixed
- **Cross-process UAT refresh lock**: file lock at `~/.claude/feishu-uat-refresh.lock` (`O_CREAT|O_EXCL`, 30s stale detection) serializes UAT refresh across concurrent MCP processes. Inside the critical section, the lock holder re-reads `~/.claude.json` to see whether a peer already rotated the token; if so it adopts the fresh one. Closes the "Codex spawned 6 MCP servers, all raced to refresh" failure mode that was burning refresh tokens on 2026-04-23.
- **`get_login_status` UAT health check**: now actually exercises the UAT (calls `listChatsAsUser({pageSize:1})`) instead of just checking presence. Surfaces "configured but 401" cases that previously stayed silent until the next real tool call.

### Added
- **Bot-fallback ⚠️ warning**: every write tool that silently fell back from UAT to bot identity (`create_doc` / `create_bitable` / `create_folder` / `create_doc_block` / etc.) now appends a `fallbackWarning` to the response so users see the ownership change immediately. Before, callers only learned days later when a teammate could read their "private" resource.
- **Auto-expand `merge_forward`**: `read_messages` / `read_p2p_messages` walk a `merge_forward` placeholder into its child messages by default (`expand_merge_forward=false` to opt out). Children carry `parentMessageId` (use that, NOT the child id, when downloading their media). Text children get `urls[]` + `feishuDocs[]` extracted so agents can feed them straight into `read_doc` / WebFetch.
- **`download_file` tool**: download a file attachment (`msg_type=file`). Returns base64 + mimeType + byte count; optional `save_path` writes to disk. Same parent-id rule for `merge_forward` children as `download_image`.

## [1.3.4] - 2026-04-22

### Added
- **Wiki-hosted content is now first-class**: every docx and bitable tool accepts the `document_id` / `app_token` parameter in three forms — native token (unchanged), wiki node token (`wikcnXXX` / `wikmXXX` / `wiknXXX`), or a full Feishu URL (`https://xxx.feishu.cn/docx/XXX`, `.../wiki/XXX`, `.../base/XXX`). A new `src/resolver.js` parses the input, calls `wiki/v2/spaces/get_node` when needed to resolve to `obj_token` + `obj_type`, and caches the mapping for 10 min. Zero-lookup path for direct URLs.
- **`get_wiki_node` tool**: explicitly resolves a Wiki node to its backing object (`obj_type` + `obj_token` + `space_id`). Useful when you need to branch behaviour on whether a node points at a docx, bitable, sheet, mindnote, file, or slides.
- **Create docx / bitable directly under Wiki**: `create_doc` / `create_bitable` accept optional `wiki_space_id` (and `wiki_parent_node_token` for nested placement). Plugin creates the resource in drive, then calls `wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki` to attach it. Returns `wikiNodeToken` on success, `wikiAttachTaskId` when Feishu queues the move, or a warning if attach fails (resource still in drive).
- **Docx image read**: `download_image` now has a docx mode — pass `image_token` (from `get_doc_blocks` image block) and optional `doc_token` (native / wiki node / URL). Routes through `drive/v1/medias/{token}/download`, returns base64 as MCP image content so the model sees the pixels.
- **Docx image write**: `create_doc_block` gains two shortcut parameters — `image_path` (local file) automatically runs the three-step Feishu flow (create empty image block → upload via `drive/v1/medias/upload_all` with `parent_type=docx_image` and the new block_id → patch with `replace_image`); `image_token` reuses an already-uploaded media token. `update_doc_block` accepts `image_token` to swap the picture in an existing image block.
- **`list_user_okrs` / `get_okrs` / `list_okr_periods` tools**: read a user's OKRs, batch fetch full objective + key result details (progress, alignments, mentions), and enumerate periods. UAT-first with app fallback when the OKR scope is granted.
- **`list_calendars` / `list_calendar_events` / `get_calendar_event` tools**: list the user's calendars (primary / shared / subscribed), list events in a time window, and fetch full event details (attendees, location, meeting links, attachments).

### Fixed
- **External-group `read_messages` hardening**: new `src/error-codes.js` classifies bot failures. Known-needs-UAT codes (`240001` external tenant, `70009` no permission, `70003` / `99991668` bot not in chat, `19001` chat not found) hop straight to UAT. Transient codes (`42101` rate limit, `5xx`, `ECONNRESET`, fetch timeouts) retry once after a 2 s delay before falling back. Response now includes `via: "bot" | "user" | "contacts"` and, when fallback fires, `via_reason` (e.g. `bot_external_tenant`). When the `chat_id` was discovered via `search_contacts` (i.e. definitely external) the bot path is skipped entirely.
- **Raw Feishu payload no longer leaks when UAT is missing**: bot failures with no UAT configured now produce `Cannot read chat <id> as bot (<reason>). To read external/private groups, configure UAT via: npx feishu-user-plugin oauth` — previously the caller got the unwrapped Feishu error JSON.
- **`_uatREST` array query params**: OKR / calendar endpoints that take repeated query keys (e.g. `period_ids=p1&period_ids=p2`) now serialize correctly. Previously `URLSearchParams(query)` would call `toString` on arrays and produce CSV, which Feishu rejects.

### Changed
- Tool count 67 → **74** (+7: `get_wiki_node`, `list_user_okrs`, `get_okrs`, `list_okr_periods`, `list_calendars`, `list_calendar_events`, `get_calendar_event`).
- `getWikiNode(nodeToken, _spaceId)` — `spaceId` parameter position swapped; retained only for backward-compatibility of any external caller. The endpoint itself ignores `space_id`.
- `create_doc_block` no longer requires `children` — callers who use the new `image_path` or `image_token` shortcut omit it. One of `children` / `image_path` / `image_token` must be provided.

## [1.3.3] - 2026-04-20

### Fixed
- **MCP mid-session disconnect (root fix)**: All raw `fetch` calls to Feishu now go through `fetchWithTimeout` (AbortController, 30s default). A stalled connection used to hang a tool handler indefinitely; the MCP client would time out and some clients tore down the stdio transport — observed as "MCP 中途掉线" on v1.3.2. This was the real cause, not just the v1.3.1 stdout pollution.
- **stdout pollution (defense-in-depth)**: `src/index.js` now globally redirects `console.log` / `console.info` to stderr at startup, before any other `require`. Any current or future dependency that accidentally writes to stdout can no longer corrupt the JSON-RPC channel. (v1.3.1's Lark-SDK-specific logger override stays as-is.)
- **`(as user)` label lied for docs/bitable/folder creation**: `create_doc` / `create_bitable` / `create_folder` previously labeled every successful call `(as user)` whenever `LARK_USER_ACCESS_TOKEN` was set, even when the UAT call actually failed and silently fell back to app identity. `_asUserOrApp` now threads a real `_viaUser` flag through; failures show `(as app — UAT unavailable or failed; <resource> owned by the app, not you)`.

### Added
- **APP_ID startup validation**: MCP server probes `/auth/v3/app_access_token/internal` at boot. Invalid `LARK_APP_ID` / `LARK_APP_SECRET` (wrong-tenant, stale, or hallucinated by an autoinstall) now produce a clear stderr error pointing at the team-skills install prompt. Non-blocking — users running cookie-only workflows are unaffected.
- **`get_login_status` shows app identity**: Now returns the actual `app_id` plus fetched app name, so users can immediately spot "this isn't my team's app" scenarios.
- **`download_image` tool**: Download an image embedded in a message by `message_id` + `image_key`, returned as MCP image content so the model can see the pixels (not just the key string). Tries UAT first (works for any chat the user is in); falls back to app token (requires the bot to be in the chat).

### Changed
- Tool count 66 → **67** (added `download_image`).
- README tool badge corrected from 76 → 67 (previous 76 was stale and never matched the actual export).

## [1.1.3] - 2026-03-11

### Fixed
- **Case-insensitive chat name matching**: All name resolution strategies (bot group list, im.chat.search, search_contacts) now use case-insensitive matching. "ai技术解决" now correctly matches "AI技术解决（内部）".
- **expires_in NaN bug**: UAT token refresh and OAuth now validate `expires_in` field, defaulting to 7200s if missing/invalid, preventing NaN corruption in config.
- **_populateSenderNames inefficiency**: Fixed redundant condition in cookie-based name fallback.
- **OAuth silent persistence failure**: Now logs warnings when token persistence to `~/.claude.json` fails, instead of silently swallowing errors.
- **Null safety**: Added null check in `resolveToOcId` for undefined chat_id.

## [1.1.2] - 2026-03-11

### Fixed
- **Double OAuth on first install**: `oauth.js` now writes tokens to both `.env` and `~/.claude.json` MCP config directly, so MCP restart picks them up immediately without needing a second OAuth run.
- **readMessagesAsUser fails with start_time but no end_time**: Auto-sets `end_time` to current timestamp when `start_time` is provided but `end_time` is not, preventing "end_time earlier than start_time" error.
- **read_p2p_messages rejects chat names**: Now resolves user/group names automatically via search_contacts.
- **External group messages show sender IDs instead of names**: `_populateSenderNames` now falls back to cookie-based user identity lookup for external tenant users.

## [1.1.1] - 2026-03-11

### Fixed
- **read_messages can't read external groups**: `read_messages` now auto-falls back to UAT when bot API fails (e.g. bot not in group, external groups). No need to manually switch to `read_p2p_messages`.
- **Chat name resolution for external groups**: Added Strategy 3 using `search_contacts` (cookie-based) to find groups not visible to bot or `im.chat.search`.
- **Numeric chat IDs not accepted by read_messages**: `resolveToOcId` now passes through numeric IDs directly.

## [1.1.0] - 2026-03-11

### Fixed
- **read_messages 400 error hidden**: Now shows actual Feishu error code and description instead of just "Request failed with status code 400"
- **Messages returned oldest first**: Default sort is now `ByCreateTimeDesc` (newest messages first) for both `read_messages` and `read_p2p_messages`
- **Chat name resolution**: Added `im.v1.chat.search` API as fallback when bot's group list doesn't contain the target chat
- **get_user_info fails for external users**: Added official contact API fallback (`contact.user.get`) for cross-tenant user lookup
- **Messages lack sender names**: `read_messages` and `read_p2p_messages` now auto-resolve sender IDs to display names
- **UAT persistence writes to npx temp dir**: Now persists refreshed tokens to `~/.claude.json` MCP config instead
- **oauth-auto.js missing offline_access scope**: Added `offline_access` to SCOPES (was missing, causing no refresh_token)
- **README "8 slash commands"**: Corrected to "9 slash commands" (was missing /drive)
- **CLAUDE.md false "type: stdio" warning**: Removed — `"type": "stdio"` is standard and harmless in Claude Code

### Added
- `sort_type` parameter for `read_messages` and `read_p2p_messages` (`ByCreateTimeDesc` / `ByCreateTimeAsc`)
- `senderName` field in message results (auto-resolved from sender ID)
- CLI subcommands: `npx feishu-user-plugin setup` (wizard), `oauth`, `status`
- `src/cli.js` — CLI dispatcher for subcommands
- `src/setup.js` — Interactive setup wizard (writes MCP config, validates credentials)
- `chatSearch()` method in official client (uses `im.v1.chat.search`)
- `getUserById()` method with caching for user name resolution
- `_safeSDKCall()` wrapper that extracts real Feishu errors from Lark SDK AxiosErrors
- `_populateSenderNames()` for batch sender name resolution in message lists

### Changed
- `package.json` bin entry points to `src/cli.js` (supports subcommands, default still starts MCP server)
- team-skills README rewritten for pure npm flow (no clone needed)
- CLAUDE.md OAuth instructions updated to use `npx feishu-user-plugin oauth`
- Error messages across all 33 tools now include actual Feishu error codes

## [1.0.2] - 2026-03-10

### Fixed
- `list_user_chats` description incorrectly claimed "including P2P" — actually only returns groups
- OAuth scope `contact:user.id:readonly` → `contact:user.base:readonly` in README
- Cookie length validation range (500-5000, was 1000-5000)
- Version inconsistency across `server.json`, `plugin.json`, `SKILL.md`, `src/index.js`
- Skill count: 8 → 9 (was missing `/drive`)
- README_CN.md Claude Desktop config missing `env` block

### Added
- Startup auth diagnostics in `src/index.js` (Cookie/App/UAT status logging)
- `LARK_USER_REFRESH_TOKEN` to all MCP config examples
- Troubleshooting for `invalid_grant` errors (28003/20003/20005)
- Troubleshooting for `oauth.js` requiring APP_ID/SECRET in `.env`
- Playwright cookie setup: two-step extraction, `clearCookies()`, ASCII validation
- `LARK_USER_REFRESH_TOKEN` to `server.json` environment_variables

### Changed
- All 5 env vars marked as required for full functionality
- Improved `read_p2p_messages` chat_id description (numeric + oc_xxx both accepted)

## [1.0.0] - 2026-03-09

### Changed
- Renamed from `feishu-user-mcp` to `feishu-user-plugin`
- Converted to Claude Code Plugin standard structure (`.claude-plugin/`, `skills/`)
- Skills moved from `.claude/commands/` to `skills/feishu-user-plugin/references/`
- MCP server config template added (`.mcp.json`)
- All client configurations now use `npx -y feishu-user-plugin`
- Version reset to 1.0.0

### Added
- `.claude-plugin/plugin.json` — Plugin metadata
- `skills/feishu-user-plugin/SKILL.md` — Main skill definition with allowed-tools
- `skills/feishu-user-plugin/references/CLAUDE.md` — Troubleshooting guide

### Fixed
- Version number consistency across `package.json`, `src/index.js`, and `server.json`

## [0.5.1] - 2026-03-08

### Fixed
- `search_docs` — SDK method `docx.builtin.search` does not exist; switched to `client.request()` with `/open-apis/suite/docs-api/search/object`
- `search_wiki` — SDK method `wiki.node.search` does not exist; switched to suite docs search API
- Message timestamp parsing — Feishu returns millisecond strings; added `_normalizeTimestamp()` to convert to seconds

### Changed
- Updated README to reflect all 33 tools with full documentation
- Updated `server.json` manifest with complete tool list
- Updated `.env.example` with UAT fields

### Added
- `src/test-all.js` — comprehensive test suite for all tools

## [0.5.0] - 2026-03-06

### Added
- P2P (direct message) chat reading via `read_p2p_messages`
- OAuth v2 authorization flow (`src/oauth.js`, `src/oauth-auto.js`)
- `list_user_chats` — list all chats the user is in
- Third auth layer: User OAuth UAT for P2P access
- Auto-refresh of `user_access_token` with `.env` persistence

## [0.4.0] - 2026-03-04

### Added
- Multi-type messaging: image, file, rich text (post), sticker, audio
- Cookie heartbeat — auto-refresh CSRF every 4h to extend session
- Chat name auto-resolution — pass group name instead of `oc_xxx` ID

## [0.3.0] - 2026-03-01

### Added
- Initial release: 27 tools, 8 slash commands, dual backend
- User identity messaging via reverse-engineered Protobuf protocol
- Official API integration for docs, Bitable, wiki, drive, contacts
- Support for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf
