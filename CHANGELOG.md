# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.10] - 2026-05-09

Growth track 一次性 ship + Official MCP Registry 上架。本版无新工具（84 不变），主体是发现入口、文档语气与发布元数据：仓库一句话描述与 npm description 同步、GitHub Pages 中文优先 SEO landing 上线、`README.md` 主版本切到中文、`docs/launch/` 13 文件 launch 草稿就位、Dockerfile 给 Glama listing introspection 用、自定义 OG image 替代 GitHub 默认渲染、CONTRIBUTING.md 双语重写。所有用户可见文档统一去除 reverse-engineering / 暴力探测 / 营销腔 / 合规免责段。

### Added
- **Official MCP Registry 上架**：仓库根 `mcp-registry.json` 是 registry 元数据契约（schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`），`packages[].registryType=npm` + `transport.type=stdio` + 5 个 LARK_* 环境变量声明。`package.json::mcpName=io.github.EthanQC/feishu-user-plugin` 提供命名空间归属，与现有 OpenClaw 格式 `server.json` 并行不冲突。v1.3.10 起包同步推到 `registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin`，下游 Smithery / mcp.run / LobeHub 自动拉取。
- **Dockerfile + .dockerignore**：仓库根 `node:20-alpine` + `npm ci --omit=dev`，`CMD ["node", "src/index.js"]` 走 stdio。Glama 等需 Docker introspection 的 marketplace 检查可直接跑（MCP server 启动不需要 LARK_* env，工具调用时才校验，所以 introspection 不需要凭证）。
- **GitHub Pages 中文优先 SEO landing**：`https://ethanqc.github.io/feishu-user-plugin/`（中文）+ `/en.html`（英文）。jekyll-cayman + jekyll-seo-tag + jekyll-sitemap，源在 `docs/`；`docs/_config.yml` exclude 内部 dev 文档（REFACTOR-NOTES、TESTING-METHODOLOGY、CREDENTIALS-FORMAT、COOKIE-PROTOBUF-CAPTURES、superpowers/）保持 SEO 信号集中。仓库 Homepage URL 指向 Pages。
- **OG image 1200×630（中文 stat 卡）**：`docs/og.png`（rendered from `docs/og.svg`）+ `scripts/generate-og-image.js`（@resvg/resvg-js + 系统 PingFang SC 字体）。jekyll-seo-tag defaults 引用 + `twitter:card=summary_large_image`，社交分享卡替代 GitHub 默认渲染。
- **`docs/launch/` 13 文件 launch material**：MCP 收录（awesome-mcp-servers 提交模板 / mcp-registry 提交步骤 / Anthropic Connectors 与 Cursor Marketplace 推迟到 v1.4 的阻塞清单）+ 中文长稿（掘金 3 实战场景 / 知乎专栏首篇 / 知乎答题目标清单）+ 平台短稿（V2EX 周五帖 / 飞书开放平台社区贴 / HelloGitHub 月刊自荐 / 阮一峰 weekly issue）+ 英文 X long thread。所有 drafts，等用户 dispatch。
- **CONTRIBUTING.md 双语重写**：post-v1.3.7 layout（`src/clients/official/<domain>.js` + `src/tools/<domain>.js` + `_registry.js` ctx 契约）+ 4 个 pre-commit gate（CLAUDE.md sync / 三角等价 / 工具数徽章 / smoke）+ commit 前缀 + 9 步新增工具流程。中文优先，英文并列段。
- **GitHub Discussions 启用**：作为社群运营 + 维护信号渠道，`announcements` / `Q&A` / `show-and-tell` 默认 categories。
- **4 个 good-first-issue**（#61-#64）：CHANGELOG 历史回填 v1.3.0-v1.3.5；`README.en.md` section header 工具数对齐到 84；`read_doc_markdown` 测试覆盖；Cursor / Windsurf / OpenClaw 9 prompt 兼容矩阵。
- **`.github/pull_request_template.md` 更新**：丢弃过时的 `test-send.js` / `test-all.js` checklist，换成 4 个真实 gate（smoke / 三角等价 / CLAUDE.md sync / 依赖审）。

### Changed
- **README 主版本切到中文**：`README.md` 中文优先，`README.en.md` 是英文镜像；旧 `README_CN.md`（v1.3.4 起停滞，工具数仍写 74）删除。`package.json::files` 加 `README.en.md` 让 npm tarball 同时含两份。
- **About description 中文化**：GitHub repo 一句话描述从 "Feishu MCP Server using reverse-engineered protocol for user-identity messaging (not bot)" 换成中文版（"飞书 MCP 服务器：让 Claude Code 与 Codex 直接接管你的飞书工作流..."）；npm description 走 `package.json` 英文版（"All-in-one Feishu MCP server for Claude Code & Codex — 84 tools across 3 auth layers..."）保持国际可见度。
- **topics 删 `reverse-engineering`**：标签 9 → 8（claude / claude-code / feishu / im / lark / mcp / messaging / protobuf）。
- **README + Pages + docs/launch/ 全部去 reverse-engineering / 暴力探测 / brute-force 框架**：用户可见文档统一改为 plain technical 语气，不再把 cookie + protobuf 协议路径写成"反向工程 / 暴力探测"。`send-as-user` 仍是核心差异化锚点，描述为"基于 cookie + protobuf 协议路径"。
- **删 ToS / 合规免责段**：README 与 Pages landing 顶部"个人 / 内部用途, 非商业 SaaS"段全部移除（用户判定为 performative，LICENSE + 技术现实已足够）。
- **`docs/launch/awesome-mcp-servers-pr.md` 增补 Glama listing 要求**：Glama bot 在 PR #6090 用 `missing-glama` label 标记并要求提交到 `glama.ai/mcp/servers` + 加 score badge。entry line 模板更新为含 Glama badge 版本（待 Glama listing 通过后才渲染分数）。
- **`docs/launch/mcp-registry-submission.md` 改为 agent-driven 版本**：从"用户跑 mcp-publisher CLI"换成"agent 装好 + 用 `gh auth token` 直连 login + publish"，仅 GitHub OAuth 一次点击在用户侧（v1.3.10 ship 完后用 `github-oidc` 模式接进 GitHub Actions release workflow，CI 全自动）。

### Removed
- **`README_CN.md`（5 个版本 stale）**：内容由新主版本 `README.md` 取代。
- **demo 终端截图与生成脚本**：`docs/demo-send-as-user.{svg,png}` + `scripts/generate-demo-image.js` 全部移除（用户判定 README 不需要静态截图，OG image 已覆盖社交分享场景）。
- **README 顶部 ToS / 合规免责段**：移除（详见 Changed 段）。

### Deferred to v1.3.11
- **A. Lark Desktop 多账号联动**（v1.3.10 原计划主线，平移到 v1.3.11）：用户在 Feishu Desktop 切账号 → MCP 自动跟进。schema 扩展 + setup CLI 自动检测 + owner heartbeat stat sdk_storage mtime + 未绑定 hash 的处理路径。预计 1-1.5 天单独 PR。
- **C. 本地 md → 飞书知识库同步**（v1.3.4 起持续推迟）：md parser 选型、`src/doc-blocks.js` 构造器补齐、wikilink 三级解析、图片 / 文件 inline、CLI 子命令 vs MCP 工具取舍、增量 diff 策略。
- **B.5 `search_messages`**：先试 UAT `/open-apis/im/v1/messages/search`，不暴露则尝试 cookie 路径。
- **E. `src/config/` 目录化拆分**（条件触发）。
- **G. OpenClaw 偏好文件**。

### 已调研但暂不实施
- **Anthropic Connectors Directory**：需 `.mcpb` 打包 + `manifest.json::privacy_policies` + README "Privacy Policy" 段；缺一项即被拒。规划 v1.4 任务，详见 `docs/launch/anthropic-directory-prep.md`。
- **Cursor Marketplace**：需 `.cursor-plugin/plugin.json` manifest。规划 v1.4，详见 `docs/launch/cursor-marketplace-prep.md`。
- **Windsurf MCP Marketplace**：无公开第三方提交渠道（仅官方 partnership 邀请）。靠 Official MCP Registry 同步覆盖。
- **百度站长 / Google Search Console 主动提交**：用户决定靠自然爬取 + 反链。`docs/sitemap.xml` 与 `docs/robots.txt` 已就位作为被动准备，未来想提交时直接 paste-and-go。

### Test scenarios
- 验证 `npm view feishu-user-plugin version` 返回 `1.3.10`
- `mcp-publisher publish mcp-registry.json` 推到 registry，`curl https://registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin` 返回 v1.3.10 元数据
- GitHub Pages https://ethanqc.github.io/feishu-user-plugin/ 与 `/en.html` 都返回 200，`<head>` 含 `og:image` 指向 `docs/og.png`
- `docs/sitemap.xml` 由 jekyll-sitemap 自动生成，含 index + en 两个 URL
- punkpeye/awesome-mcp-servers PR #6090 entry 带 Glama badge（待用户在 Glama 完成 listing 后渲染分数）
- 所有用户可见文档（README / README.en / docs/index / docs/en / docs/launch/*）均不再含 "反向工程" / "reverse engineering" / "暴力探测" / "brute-force" 字样

## [1.3.9] - 2026-05-08

D 系列首项 ship：新增 `read_doc_markdown` 工具，用 `feishu-docx` 把 docx blocks 转换为 markdown 字符串输出，替代 `get_doc_blocks` 的结构化 JSON，给 RAG / digest / 摘要类调用省 ~60% token（实测 216 KB JSON vs 90 KB markdown）。A 系列主线 ship：WS 机器级 SSOT + active profile 跨进程同步 + setup CLI 4 行决策矩阵 + per-profile events 字段。工具数 83 → 84。

### Added
- **`manage_ws_status(action=info|reconnect|claim|rotate|reconfig)` (A.1)**：5-action 工具，`info` 给 owner / WS / log / cursor / config 状态 dump；`reconnect` / `rotate` / `reconfig` 是 owner-only；`claim` 接管 stale lock，`force=true` 强夺活跃 owner。`rotate` 触发 `events.jsonl` → `events.jsonl.old` 轮转。`reconfig` 重读 `credentials.json::profiles[active].events` 并重新注册事件类型，无需重启。
- **WS 机器级 SSOT (A.1)**：单 owner 进程持 `~/.feishu-user-plugin/ws-owner.lock`（O_CREAT|O_EXCL，30 s stale），事件写 `events.jsonl`（append-only，10 MB soft / 20 MB hard cap，超限 rotate 成 `.old`），全局共享 `events.cursor.json` 保护以 cursor-specific lock 避免并发 drain 重读。多 harness 同事件不再重复；owner 死亡 / 锁过期后下一个 MCP 进程自动接管，event log 不丢。
- **Active profile 跨进程同步 (A.2)**：dispatcher 入口 stat `credentials.json` mtime；变化时重新读 `active`，与 in-memory `currentProfile` 不同即触发 `setActiveProfile`（invalidate `userClient` / `officialClient` 缓存）。成本 ~10μs/call（macOS stat）。`FEISHU_PLUGIN_PROFILE` env 退化为 bootstrap-only；`credentials.json::active` 为唯一跨进程权威来源。
- **setup CLI 4 行决策矩阵 (A.3)**：非交互模式自动判断 `fresh` / `auto-migrate` / `preserve` / `update` 四种路径；新增 `--force` flag 强制重写 + `--profile <name>` 指定目标 profile。`credentials.json` 已存在时默认 `--pointer-only`；首次安装自动 migrate，harness env 只写 `FEISHU_PLUGIN_PROFILE=default`，消除多 harness token diverge。
- **per-profile events 字段 (A.4)**：`credentials.json::profiles[*].events` 可选数组，缺省 `["im.message.receive_v1"]`；支持 `approval.instance.created_v4` / `calendar.calendar.event.changed_v4` 等。编辑后调 `manage_ws_status(action=reconfig)` 立即生效，不需重启。`FEISHU_PLUGIN_EXTRA_EVENTS` env 仅在首次 bootstrap 时写入，不覆盖已有字段。
- **`read_doc_markdown(document_id)` (D)**：返回 markdown 字符串而非结构化 JSON，省 ~60% token；依赖 `feishu-docx@^0.7.0`，后处理器 `_normaliseEmbeds` 位于 `src/tools/docs.js`。嵌入图片 / 文件以 `feishu://image_token/<TOKEN>` / `feishu://file_token/<TOKEN>` 占位符形式保留，配合 `download_doc_image` 取二进制内容。`document_id` 同样接受原生 token / wiki node token / 飞书 URL，分辨率逻辑与其它 doc 工具相同。

### Fixed
- **`send_image_as_user` 不再报 HTTP 400 (B.1)**：v1.3.9 通过暴力探测 cookie protobuf gateway 拿到 IMAGE 最小有效字段集 — `Content.imageKey` (字段 2) + `Content.thumbnailKey` (字段 10) 即可发送成功；宽 / 高 / mime / size 全部可选。`proto/lark.proto` 加了 `imageWidth=4 / imageHeight=5 / mimeType=8 / fileSize=9 / thumbnailKey=10` 五个字段；`sendImage()` 默认 thumbnailKey = imageKey（飞书在缩略图未单独上传时接受同 key）。`scripts/explore-image-minimize.js` 留作未来字段验证起点。

### Removed
- **`send_card_as_user(via="user")` 路径删除 (B.4)** — v1.3.9 通过 brute-force 确认 cookie protobuf gateway 的 `cmd=5 type=14 (CARD)` 路径在服务端 auth 层就被拒绝（任何字段组合都返回同一句 `richText and card type need for card message`，验证发生在 Content 解析之前）。结论是用户身份发卡片在 Feishu cookie auth tier 被服务端禁用，brute-force 不可解。`send_card_as_user` 工具保留，但 `via` 参数和 `via="user"` 代码分支彻底移除，工具固定走 bot (Official API)。`as_user` 后缀作历史命名保留，避免破坏调用方。`scripts/explore-card-protobuf.js` 留作参考，下次会话不需要重复 brute-force。

### Test
- **`switch_profile` 多 profile e2e (F.1)**：验证原子 credentials.json 更新 + 进程内 cache 失效。位于 `src/test-switch-profile.js`，CI-friendly（dummy 凭证不联网）。

### Test scenarios
- 调用 `read_doc_markdown(<docx_token>)`，确认返回 markdown 字符串而非 JSON；HTML 标签如 `<b>` `<em>` 已被转成 `**` `*` 等价物
- 包含 mention 链接 `[doc](wikcnXXX)` 的文档应保留原样，不被错判为 file token 占位符
- 启动 MCP 看 stderr 是否出现 `WS connected (profile=default)`；`~/.feishu-user-plugin/ws-owner.lock` 应存在
- 多 MCP 进程同时跑 → 仅一个看 `WS connected`，其它静默 → `manage_ws_status(action=info)` 看 `is_owner` 字段

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
