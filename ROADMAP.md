# feishu-user-plugin Roadmap

## 已完成

### v1.0 — 核心功能
- [x] Cookie 身份消息发送（text, image, file, post, sticker, audio）
- [x] 联系人搜索、P2P 聊天创建
- [x] Official API 消息读取（bot + UAT 双路）
- [x] 文档搜索/读取/创建、Doc blocks
- [x] Bitable 基础查询（list tables/fields, search records）
- [x] Bitable 基础写入（create/update record）
- [x] Wiki 空间/搜索/节点
- [x] Drive 文件列表/创建文件夹
- [x] 联系人查找（email/mobile）
- [x] 三层认证（Cookie + App + UAT）+ 自动刷新
- [x] Playwright 自动化 Cookie 提取流程
- [x] CLI 工具（setup, oauth, status, keepalive）
- [x] CI/CD 自动发布（GitHub Actions → npm）
- [x] 9 个 Skills（/send, /reply, /digest, /search, /doc, /table, /wiki, /drive, /status）

### v1.2.1 — Bitable 完整化 + Bug 修复
- [x] upload_image / upload_file 修复（SDK multipart 响应兼容）
- [x] get_chat_info 支持 oc_xxx 格式（Official API + protobuf 双路）
- [x] create_bitable — 创建多维表格应用
- [x] create_bitable_table — 创建数据表
- [x] create/update/delete_bitable_field — 字段管理
- [x] delete_bitable_record — 单条删除
- [x] batch_create/update/delete_bitable_records — 批量操作（max 500）
- [x] list_bitable_views — 视图列表

### v1.3.0 — SDK 全功能覆盖 (30 new tools, 46→76)
- [x] Bot 主动发消息 (`send_message_as_bot`)
- [x] 消息撤回/编辑 (`delete_message`, `update_message`)
- [x] 表情回复 (`add_reaction`, `delete_reaction`)
- [x] 消息置顶 (`pin_message`, `unpin_message`)
- [x] 群组管理 (`create_group`, `update_group`, `list_members`, `add_members`, `remove_members`)
- [x] 文档内容编辑 (`create_doc_block`, `update_doc_block`, `delete_doc_blocks`)
- [x] Bitable 补全 (`get_bitable_record`, `delete_bitable_table`)
- [x] 云盘文件操作 (`copy_file`, `move_file`, `delete_file`)
- [x] 日历管理 (`list_calendars`, `create_calendar_event`, `list_calendar_events`, `delete_calendar_event`, `get_freebusy`)
- [x] 任务管理 (`create_task`, `get_task`, `list_tasks`, `update_task`, `complete_task`)

### v1.3.x — 稳定性 + Codex + 发布安全 + Bitable 补全
- [x] fix: Lark SDK logger 重定向到 stderr（MCP 断连根因修复）
- [x] fix: 进程级 uncaughtException / unhandledRejection 兜底
- [x] fix: persistToConfig 原子写入（防 Claude Code 读写竞态）
- [x] feat: Codex TOML 配置支持（setup --client codex/both）
- [x] feat: 发布三层版本确认（Claude 规则 + prepublishOnly + CI tag 校验）
- [x] feat: get_bitable_meta / copy_bitable / update_bitable_table / create_bitable_view / delete_bitable_view

### v1.3.3 — 掉线根治 + APP_ID 校验 + 图片读取
- [x] fix: 全局 `console.log` / `console.info` 重定向到 stderr（防任何依赖意外污染 MCP stdio）
- [x] fix: 所有 `fetch` 加 `AbortController` 超时（默认 30s），避免 Feishu API 卡住导致 MCP 客户端超时断链（这是 v1.3.2 仍偶发掉线的真因）
- [x] fix: `create_doc` / `create_bitable` / `create_folder` 的 `(as user)` 标签现在按 UAT 调用是否真成功打标，不再仅看 `hasUAT`；UAT 失败时明确显示 `(as app — UAT unavailable or failed; X owned by the app, not you)`
- [x] feat: 启动时探测 `LARK_APP_ID` / `LARK_APP_SECRET` 有效性，无效时在 stderr 报错并指向团队 README；非阻塞（用户可能只用 cookie 身份）
- [x] feat: `get_login_status` 返回 APP_ID + 应用名，便于一眼看出配的是不是团队官方 app
- [x] feat: `download_image` tool — 通过 message_id + image_key 下载消息里的图片，以 MCP image content 形式回传，模型能直接看到像素（不再只拿到 key 字符串）

### v1.3.4 — Wiki 贯通 + 文档图片读写 + OKR + 日历 + 外部群降级硬化
- [x] feat: 统一 ID resolver（`src/resolver.js`）— 所有 docx/bitable 工具的 id 参数透明接受原生 token / wiki node / Feishu URL，10 分钟 LRU 缓存
- [x] feat: `get_wiki_node` 工具 — 单独暴露 wiki node → obj_token+obj_type 解析
- [x] feat: `create_doc` / `create_bitable` 支持 `wiki_space_id`(+ `wiki_parent_node_token`) 直接挂进 Wiki，走 `move_docs_to_wiki`
- [x] feat: `download_image` 新增 docx 图片模式（`doc_token` + `image_token`），走 `drive/v1/medias/<token>/download`
- [x] feat: `create_doc_block` / `update_doc_block` 新增 `image_path` / `image_token` 快捷参数，内部完成"占位块 + media upload + replace_image patch"三步走
- [x] feat: `src/doc-blocks.js` — docx block 构造器骨架，为 v1.3.5 本地 md 同步预留
- [x] feat: OKR 读取 — `list_user_okrs` / `get_okrs` / `list_okr_periods`
- [x] feat: 日历读取 — `list_calendars` / `list_calendar_events` / `get_calendar_event`
- [x] fix: `read_messages` / `read_p2p_messages` 降级硬化 — 响应加 `via` + `via_reason` 字段；`src/error-codes.js` 按错误码路由（外部租户 / 权限 / 不在群 → UAT；频控 / 5xx / ECONNRESET → 退避 2s 重试再 UAT）；search_contacts 预判的外部群跳过 bot
- [x] fix: 无 UAT 时不再直接抛 Feishu 原始 payload，改为指向 `npx feishu-user-plugin oauth` 的清晰错误信息
- [x] fix: `_uatREST` 支持数组 query 参数（OKR `period_ids`、`okr_ids` 等需要重复 key）

### v1.3.5 — UAT race 硬化 + Fallback 告警 + merge_forward 展开

- [x] fix: UAT refresh 跨进程文件锁（`~/.claude/feishu-uat-refresh.lock`，O_CREAT|O_EXCL，30s stale detection）。多 MCP 进程并发刷新时严格串行化，进入临界区后再重读已持久化配置；后到的进程 adopt 胜者的新 token,不重复消耗已轮换的 refresh token
- [x] fix: UAT refresh 前重读已持久化配置（JWT exp 解析 + `_adoptPersistedUATIfNewer` 双层保险）
- [x] fix: `get_login_status` 真调一次 `listChatsAsUser` 验证 UAT,不再只报告 token 已配置
- [x] feat: `_asUserOrApp` 静默 fallback 到 bot 写操作时返回 `fallbackWarning`,handler 在 MCP 响应里以 ⚠️ 显式提示"资源归属 bot 不是你,跑 oauth 然后重启"
- [x] feat: `read_messages` / `read_p2p_messages` 自动展开 `merge_forward` 占位。通过 `GET /im/v1/messages/{parent_id}` 拉子消息数组,子消息挂 `parentMessageId` / `originChatId` / `upperMessageId`,保留原始 sender / time
- [x] feat: `read_messages` 文本消息自动抽取 `urls` 数组;飞书文档链接进一步归入 `feishuDocs`,让 agent 直接喂 `read_doc` / `get_doc_blocks`
- [x] feat: 新增 `download_file` 工具,下载消息里 msg_type=file 的附件(base64 + 可选 save_path)。merge_forward 子消息的 image/file 必须用父消息 ID 下载
- [x] feat: `scripts/test-uat-race.js` — 多进程锁争抢的验证脚本(4 worker spawn,断言互斥 + 时间线不重叠)
- [x] chore: 一次性清理 28 份 bot-owned 文档 / bitable / 空壳文件夹(遗留的 fallback 创建残留),留下 7 份 Obsidian 同步脚本参考 + 数学摇滚知识库同步

### v1.3.6 — 上传完整化 + 多账号 + batch_send + send_card_as_user (bot-default)

- [x] 上传能力完整化
  - `uploadDocMedia` → `uploadMedia` 通用化,支持 8 种 parent_type(docx/sheet/bitable × image/file + doc_image/doc_file 兼容)
  - docx file block 写入:`create_doc_block` 多 `file_path` / `file_token`,`update_doc_block` 多 `file_token`。处理飞书自动用 view 容器(block_type=33)包裹 file 块(block_type=23)的坑——先查内层再 replace_file
  - 新增 `upload_drive_file` 工具:`drive/v1/files/upload_all` parent_type=explorer,支持 `wiki_space_id` 直接挂到 wiki(走 `attachToWiki(obj_type=file)`)
  - 新增 `upload_bitable_attachment` 工具:`uploadMedia` with parent_type=bitable_image/bitable_file,返回的 file_token 可直接塞进 Bitable Attachment 字段
- [x] OAuth scope 扩充:加 `drive:file:upload`、`sheets:spreadsheet`(team app 后台同步开通并发布 v3.7.0)
- [x] `batch_send` 工具:多目标 fan-out(text/image/file/post),按 delay_ms 节流,per-target ok/error
- [x] 多 profile:`list_profiles` / `switch_profile` 工具,通过 `LARK_PROFILES_JSON` 注册多套凭证,热切换不重启
- [x] `send_card_as_user`(bot-default):via=bot 走 `send_message_as_bot('interactive', card)`,via=user 在 v1.3.6 显式返回 deferred 错误。一旦 v1.3.7 实现 user-identity 卡片必须**移除 bot-default**

### v1.3.7 — 计划中（v1.3.6 实测发现 + 架构重构 + 跨 harness + 自动化）

> **基础约定**:本版工作量很大,一次性合并风险高。建议拆三个子分支,分别 PR 合入:
> A. `refactor/structure` — 代码目录重构(风险最高,先单独跑)
> B. `feat/cross-harness` — Skills→prompts + 单一可信源凭证 + hooks
> C. `fix/v1.3.6-testing-bugs` — bug 修复 + 工具增删合并 + 写日历 + Tasks
> 子 agent 派发顺序:A → 等合并 → B / C 并行

#### A. 代码目录重构(用户已批,本版必须做完)

当前 `src/` 15 文件平铺 + 两个 god file:`index.js` 1979 行、`official.js` 1944 行。每加一个 feature 都让这两个文件再涨几十行,新人读代码先要花一小时定位 handler。

- [x] 拆出 `src/server.js`:MCP bootstrap、ListTools/CallTool handler 注册、stdio 启动、ctx 装配、startup diagnostics(195 行)
- [x] `src/tools/` 14 个域模块,每个 `{ schemas, handlers }` 结构,在 server.js 用 `TOOL_MODULES.flatMap` 集中注册:messaging-user / messaging-bot / im-read / contacts / groups / docs / bitable / drive / wiki / uploads / calendar / okr / profile / diagnostics
- [x] `src/clients/user.js` — 旧 `client.js` 搬过来(Cookie + Protobuf 网关)
- [x] `src/clients/official/` 拆完:base.js(底座 + UAT 跨进程锁 + 公共 helper)+ 10 个域文件(im / docs / bitable / drive / wiki / uploads / calendar / okr / contacts / groups)+ index.js(mixin 组装器)。base.js 1944 → 426 行(78% 减)
- [ ] `src/auth/credentials.js` 占位(re-export `src/config`),`uat.js` / `cookie.js` 推迟到 Phase B(与单一可信源凭证迁移同批做,详见 `docs/REFACTOR-NOTES.md`)
- [ ] `src/config/` 拆分推迟到 Phase B(同上理由,Phase B 替换凭证存储后 config.js 主体被重写)
- [x] 保留:`resolver.js` / `doc-blocks.js` / `error-codes.js` / `utils.js` / `logger.js`(新)
- [x] 跟改:`package.json` `main` 字段(仍 `src/index.js`,变成 6 行入口)、`scripts/mcp_stdio_bridge.js` 路径(`src/index.js` 仍存在)、CLAUDE.md / AGENTS.md / skill reference 全部同步,CHANGELOG.md 待 v1.3.7 发布时整理
- [x] 单元保护:`scripts/smoke.js` 冻结 baseline(81 工具 + login_status shape),每个 commit 自动跑 diff 拦截回归。29 个 commit 全程 smoke 绿
- [x] **风险 tradeoff 文档**:`docs/REFACTOR-NOTES.md` 完成,含目录结构图、决策树、禁忌清单、Phase B 推迟项

#### B. Skill → MCP prompts + 单一可信源凭证 + hooks(用户已批)

##### B1. 把 9 个 skills 暴露成 MCP prompts

**当前问题**:Claude Code 直接读 `skills/*.md` frontmatter,跟 MCP 协议无关 → Codex / OpenClaw / Cursor / Windsurf 全看不到。

- [ ] 在 `src/server.js` 注册 `ListPromptsRequestSchema` + `GetPromptRequestSchema` handler
- [ ] 把 `skills/feishu-user-plugin/` 下 9 个 skill 转换成 MCP prompts: `/send` `/reply` `/digest` `/search` `/doc` `/table` `/wiki` `/drive` `/status`
- [ ] prompt 模板加入参数 schema(arguments),让客户端能弹表单
- [ ] 保留 `skills/` 目录(Claude Code 仍按现有方式读),通过同一份内容生成,避免双写
- [ ] CLI 增 `npx feishu-user-plugin list-prompts` 验证

##### B2. 单一可信源凭证文件

**当前问题**:`findMcpConfig` 只写第一个命中的 config → Codex/Claude Desktop/Cursor 多 harness 共存时 cookie / UAT 刷新只更新一处,其他 harness 拿到旧 token 直接 401。

- [ ] 设计文件 `~/.feishu-user-plugin/credentials.json`(0600 权限)
  ```json
  {
    "version": 1,
    "profiles": {
      "default": {
        "LARK_COOKIE": "...",
        "LARK_APP_ID": "...",
        "LARK_APP_SECRET": "...",
        "LARK_USER_ACCESS_TOKEN": "...",
        "LARK_USER_REFRESH_TOKEN": "...",
        "LARK_UAT_EXP": 1234567890
      },
      "alt": { ... }
    },
    "active": "default"
  }
  ```
- [ ] `src/auth/credentials.js`:`load()` / `save()`(原子写)/ `getActiveProfile()` / `setActiveProfile(name)` / `migrateFromMcpConfigs()`(一次性,把旧 ~/.claude.json 等 4 处 env 块合并迁过来,迁完打印 diff 让用户确认)
- [ ] 所有 harness 配置的 env block 改成只放 `FEISHU_PLUGIN_PROFILE=default` 一个变量,真凭证从单一文件读
- [ ] `setup` CLI 改写:写凭证文件,然后向所有发现的 harness 配置写"指针 env"
- [ ] `keepalive` / 心跳 / UAT refresh 全改为只写凭证文件(单点),所有 harness 进程下次读自动拿到新值
- [ ] `list_profiles` / `switch_profile` 改为读写凭证文件的 active 字段
- [ ] 兼容:旧 env 配置仍能用,但启动时 stderr 警告"建议运行 `npx feishu-user-plugin migrate` 迁到单一可信源"
- [ ] **OpenClaw 的偏好文件先放一放**(用户明确不管)

##### B3. Hooks(commit / push 自动同步)

- [ ] `.git/hooks/pre-commit`(用 husky / simple-git-hooks 装,跨机生效):
  - CLAUDE.md 改了 → 自动跑 `tail -n +2 CLAUDE.md > /tmp/body.md && { echo "# feishu-user-plugin — Codex Instructions"; cat /tmp/body.md; } > AGENTS.md` + `git add AGENTS.md`
  - CLAUDE.md 改了 → `cp CLAUDE.md skills/feishu-user-plugin/references/CLAUDE.md` + git add
  - `package.json` 版本变了 → 校验 `.claude-plugin/plugin.json` `skills/feishu-user-plugin/SKILL.md` 三方一致,不一致拒绝 commit
  - 工具增减(grep TOOLS 数组长度) → 校验 README.md 工具数 badge / heading
  - server.json 工具数 + 版本号 → 自动从 package.json + TOOLS 数组生成
- [ ] `.git/hooks/post-push`(只在 push 到 main 后触发):
  - 同步 team-skills 仓库:`cp -r skills/ /Users/abble/team-skills/plugins/feishu-user-plugin/skills/` + `cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/`
  - 在 team-skills 仓库 `git checkout -b sync/feishu-vX.Y.Z` + `git add` + commit + push + `gh pr create` + `gh pr merge --auto`
  - 同步 README 三方对照(本仓 vs team-skills 仓 vs SKILL.md)的工具数与更新日志
  - 失败不阻塞 push,但 stderr 红字提醒"team-skills 同步失败,请手动检查"
- [ ] `scripts/check-docs-sync.js`:本地 `prepublishOnly` 里跑,diff CLAUDE.md vs AGENTS.md vs skills/references/CLAUDE.md,不一致退出非零
- [ ] CI: `.github/workflows/validate.yml` 增校验
  - tool count: `node -e "import('./src/server.js').then(m=>console.log(m.TOOLS.length))"` vs README badge / SKILL.md
  - server.json 字段一致性
  - CHANGELOG.md 包含本 tag 对应小节

#### C. v1.3.6 实测发现的 bug 修复 + 工具增删合并 + 写日历 + Tasks

##### C1. 必修 bug(实测确认,共 14 个)

- [ ] **`send_image_as_user`** — Cookie protobuf 路径 IMAGE 编码失败(状态 0)。需要重新对照飞书 web 客户端发图时的 protobuf payload 抓包,修 `client.js::_sendMsg` 的 image branch
- [ ] **`send_audio_as_user`** — 同上,AUDIO 编码失败
- [ ] **`send_sticker_as_user`** — 任意 sticker_id 都失败。要么修(从飞书拿 sticker_id 列表),要么直接删(见 C2)
- [ ] **`send_as_user` / `send_post_as_user` 不接受 `oc_xxx`** — 数字 ID 才工作。在工具入口加自动 oc_→numeric 解析(走 `get_chat_info` 拿 numeric chatId)
- [x] **`forward_message`** — schema 加 `receive_id_type` 枚举(chat_id/open_id/union_id/user_id/email),handler 透传 (v1.3.7)
- [x] **`forward_message` 用 `send_to_user` 返回的数字 ID 报 invalid receive_id** — handler 自动按 ID 前缀判别(ou_/on_/email/...)。explicit `receive_id_type` 仍可覆盖 (v1.3.7)
- [x] **`update_message` 仅 text/interactive 有效** — schema enum 收紧到 `[text, interactive]`,description 改写;handler 提前拒绝不支持的 msg_type 并返回明确错误 (v1.3.7)
- [x] **`pin_message(pinned=false)`** — `client.im.pin.delete` 改为 `path: {message_id}`(SDK 实际签名),原本传 `data` 导致 unpin 拿不到 message_id (v1.3.7)
- [ ] **`create_bitable_field`** — UAT 路径返回 `1254001 WrongRequestBody`,app 路径 `91403 Forbidden`。复现:全新建的 UAT-owned bitable 都触发。需要看是否最近改 `_uatREST` body 序列化时 break 掉了 field 创建。git bisect 定位
- [x] **`move_file`** — schema 加 `type` 枚举必填(file/folder/docx/sheet/bitable/...),client 方法透传到 body;同时切到 `_asUserOrApp`(用户拥有的资源 bot 通常无 edit 权限) (v1.3.7)
- [x] **`delete_file`** — `_safeSDKCall` → `_asUserOrApp`,UAT-first;`type` 透传到 query (v1.3.7)
- [x] **`copy_file`** — `_safeSDKCall` → `_asUserOrApp`,UAT-first (v1.3.7)
- [x] **`manage_members(action=remove)`** — schema 加 `member_id_type` 枚举(默认 open_id),client 方法接收并透传。9499 是 ID 跟 type 不匹配引起的;现在可显式指定 union_id / user_id 以匹配传入 ID 形态 (v1.3.7)
- [ ] **`find_user`** — 实现只回 email/mobile 字段,不回 open_id。要么修(回完整 user object 含 open_id / name),要么删(见 C2,跟 search_contacts 重叠)
- [ ] **`get_user_info` 把自己当外部租户** — 自己看自己反而拿不到名,senderName: null。`tenant_key` 比较逻辑或 fallback 顺序出错。重写
- [x] **`get_wiki_node` 用 `search_wiki` 返回的 docs_token 报 not found** — handler 先尝试 wiki API,失败时按 token 前缀(docx/bascn/shtcn/...)推断 obj_type 并返回 synthesized node-shape,这样 caller 能拿到 obj_type/obj_token 直接喂给 read_doc / list_bitable_tables 等 (v1.3.7)
- [x] **`list_wiki_spaces` 静默返空数组** — 改走 `_asUserOrApp` UAT-first;bot 路径返回空时附 `scopeHint` 提示缺 `wiki:wiki:readonly` 或未邀请 bot 进 space (v1.3.7)

##### C2. 工具删除(共 4 个)

- [x] **删 `send_sticker_as_user`** — 任意 id 都失败 + agent 极少用 + 修复成本高于价值 (v1.3.7)
- [x] **删 `send_audio_as_user`** — Cookie 路径坏 + agent 极少发语音 + bot 路径已有 `send_message_as_bot(msg_type='audio')` 兜底 (v1.3.7)
- [x] **删 `find_user`** — 与 `search_contacts` 完全重叠,且更弱(只接受 email/mobile,不回 open_id) (v1.3.7)
- [ ] **删 `download_image`** — 与 `download_file` 完全重叠。合并为单一 `download_message_resource(message_id, key, kind=image|file, save_path?)`,kind 从 message content 自动判别也行;**MUST 强制要求 save_path 当文件 > 2 MB 时,避免再次撞 Anthropic API 5 MB 上限**

##### C3. 工具合并(净减约 6 个,但语义更干净)

- [ ] **bitable 21 → 5** — 5 个 manage 工具:`manage_bitable_app(action=create|copy|get_meta)` / `manage_bitable_table(action=create|update|delete|list)` / `manage_bitable_field(action=create|update|delete|list)` / `manage_bitable_view(action=create|delete|list)` / `manage_bitable_record(action=create|update|delete|search|get,batch?)`。schema 列表瘦,LLM 选起来更快
- [ ] **doc block 3 → 1** — `manage_doc_block(action=create|update|delete)`,保留 image_path / file_path / image_token / file_token 等所有快捷参数
- [ ] **drive 3 → 1** — `manage_drive_file(action=copy|move|delete,type)`,顺便强制 `type` 必填
- [ ] **README 写"unpin_message"是错的** — 实际 `pin_message(pinned=bool)` 就够了。同步改 README 工具数

##### C4. 工具新增(共 12 个,补上 v1.3.6 的空白)

**写日历(5 个,scope 已经在 v1.3.4 申请过的 calendar:calendar.event:read 基础上补 .write)**:
- [ ] `create_calendar_event(calendar_id, summary, start_time, end_time, description?, location?, attendees?, meeting_link_type?)`
- [ ] `update_calendar_event(calendar_id, event_id, ...)` — patch 语义
- [ ] `delete_calendar_event(calendar_id, event_id)`
- [ ] `respond_calendar_event(calendar_id, event_id, status=accept|tentative|decline)` — 接受/拒绝邀请
- [ ] `get_freebusy(user_ids[], start_time, end_time)` — 查空闲

**Tasks 整组(7 个,完全空白,需要新申请 task scope)**:
- [ ] `list_tasks(filter?, sort?)`
- [ ] `get_task(task_id)`
- [ ] `create_task(summary, description?, due_time?, members?, repeat_rule?)`
- [ ] `update_task(task_id, ...)`
- [ ] `complete_task(task_id)` / `uncomplete_task(task_id)`
- [ ] `delete_task(task_id)`
- [ ] `add_task_member(task_id, user_ids[])` / `remove_task_member`

##### C5. Wiki / OKR 读写补全(用户问到了)

- [ ] **Wiki 写**:当前只有 read,没有 `create_wiki_node` / `update_wiki_node` / `delete_wiki_node` / `move_wiki_node` / `copy_wiki_node`。补这 5 个
- [ ] **OKR 写**:OKR open API 写能力非常受限(飞书侧不开放完整 CRUD,只有 progress 更新和评论)。能补的:
  - `create_okr_progress_record(progress_id, content)` — 进展记录
  - `list_okr_progress_records(progress_id)`
  - `delete_okr_progress_record(progress_record_id)`
  - 不能补的:create/update/delete OKR 本体(API 不存在),需要在 README 明确写"只能读 + 写进展"

##### C6. v1.3.6 测试残留清理(用户明确说不需要其确认)

测试期间创建、因 `delete_file` / `manage_members` bug 没法清理的资源:
- [ ] 测试群:`oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`("81-tool-test temp group renamed")
- [ ] 测试 bitable 应用:`UqV7bAot3aDBW9sgYoUcZFjQncd`("81-tool-test-bitable-v2")
- [ ] 测试 bitable 副本:`C8BDb5YP6a8MdusMFWnc91Ownhq`("81-tool-test-bitable-v2-copy")
- [ ] 测试 folder:`DC1QfDvs6lDxgcdAqStcuKQznRh`("81-tool-test-folder-v2")
- [ ] 测试上传文件:`TLHubz5pzok3d0xhtAnc14eUnde`(test.txt 拷贝在 drive)
- [ ] 测试 docx 至少 3 篇(含 "81-tool-test docs" 等)
- [ ] 测试群 chat 内残留消息:可批量 delete(只能删 bot 自己发的,user-发的需要手动)
- 清理时机:C1 中 `delete_file` 改成 `_asUserOrApp` 之后,这些资源能直接被工具删掉。如果用户想立刻删,飞书 web 端登录后批量删

##### C7. 必须重测的工具(v1.3.6 实测因外因没测彻底,v1.3.7 修完 bug 必须回归)

- [ ] **`download_image`** — 本会话被 Anthropic API 大图 400 反复打断,最终用 download_file 的 round-trip 间接验证,download_image 本身没跑通端到端。修法:增 `save_path`(必传 when size > 2MB),回归测试用一张小 PNG
- [ ] **`switch_profile`** — 当前只配了 default profile,没有第二个能切。设置 LARK_PROFILES_JSON 加 alt profile 后重测
- [ ] **`get_calendar_event`** — 个人日历无任何事件,无 event_id 可拿。C4 写日历完成后,先 create 再 get
- [ ] **`list_wiki_nodes`** — `list_wiki_spaces` 静默返空,无 space_id 可喂。C1 修完 wiki scope 警告后回归
- [ ] **`delete_bitable_table`** — "The last table cannot be deleted" 是飞书 API 限制(非 bug),回归时先创建第二张表再删原表
- [ ] **`upload_drive_file` 带 `wiki_space_id` 模式** — wiki scope 不全时直接 attach 失败的兜底路径未测

##### C8. 测试方法论(避免下次再踩)

- [ ] 写 `docs/TESTING-METHODOLOGY.md`(允许新建一份)记录:
  - Playwright `browser_take_screenshot` 默认 fullPage 会撞 Anthropic API 5MB / 8000px 上限 → 用 `browser_snapshot`(文本 DOM)优先,实在要图就 viewport-only + resize 到 1280×800
  - download_image / download_file 同样要 save_path 优先,base64 inline 仅当 < 2MB
  - 测试沙箱固定:飞书plugin测试群(`oc_6ae081b457d07e9651d615493b7f1096`),临时 bitable / docx / folder 名带 `test-YYYY-MM-DD` 前缀,便于 grep 清理
- [ ] 写 `scripts/test-all-tools.js` — 半自动化全回归脚本,创建临时资源 → 每个工具调一次 → 收集成功/失败 → 自动清理。手动跑 `npm run test:tools` 在每次发版前

#### D. 文档与版本同步规则(用户已批,留在 CLAUDE.md 不拆,但要补全)

- [ ] CLAUDE.md 现有"Keeping all docs in sync"章节(420–450 行)补上:
  - server.json 必须自动生成,人工不改
  - team-skills 同步走 hook,不再人工 cp
  - CLAUDE.md / AGENTS.md 走 pre-commit hook 自动同步
  - README 工具数走 CI 校验(对照 TOOLS.length)
- [ ] CHANGELOG.md 补 v1.3.5 / v1.3.6 漏记的小节(从 git log 反推)
- [ ] 修 README 过时:Calendar 写"5 tools"(实际 v1.3.6 是 3 只读,v1.3.7 补到 8) / Tasks 写"5 tools"(实际 v1.3.6 是 0,v1.3.7 补到 7) / unpin_message 不存在(应是 pin_message(pinned=false))
- [ ] 修 server.json 过时:写"v1.2.0 + 33 tools",应反映本版实际数

#### E. 工具数预估(本版本)

- v1.3.6:81
- 删 4(sticker / audio / find_user / download_image)= 77
- 合并 bitable 21→5、doc block 3→1、drive 3→1 净减 20 = 57
- 加写日历 5 + tasks 7 + wiki 写 5 + okr 写 3 = 20 → 77
- 最终预估 **~77 个工具**,语义更干净,LLM 选工具更快
- 注:`send_card_as_user` 真·用户身份、`search_messages`、`get_new_events` 推迟到 v1.3.8(见下),不计入本版工具数

### v1.3.8 — WebSocket 实时事件 + 逆向工程 + 本地 md 同步(从 v1.3.7 拆出)

> 这三块独立性较强,且都需要新依赖或新协议(WSClient / 飞书 web protobuf 抓包 / md parser),与 v1.3.7 的"重构 + bug 修 + 工具增删"主线不在一个面上。单独成版便于灰度。

#### v1.3.8.A. 逆向工程任务(从 v1.3.6 推迟,继续保留)

- [ ] `send_card_as_user` 真·用户身份 — 录飞书 web 客户端发卡片时的 protobuf payload,实现 type=14 用户身份发送。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**(handler 里 via=bot fallback)
- [ ] `search_messages` — 按关键词搜聊天历史。先试 UAT `/open-apis/im/v1/messages/search` 是否存在,不存在则逆向 cookie 路径

#### v1.3.8.B. 本地 md 同步(从 v1.3.4/1.3.6 拆出再推迟,继续保留)

- [ ] 本地 md → 飞书知识库同步
  - md parser 依赖选型(remark / markdown-it / unified)
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析:按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联:md `![alt](./img.png)` → 复用 `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline:md `[xxx.pdf](./xxx.pdf)` → 复用 `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff:已存在 wiki 节点的更新策略(全量覆盖 / 按 block_id 精细 diff)

#### v1.3.8.C. WebSocket 实时事件

让 MCP server 接收飞书实时事件,从"单向操作"变成"双向对话"。

**解锁场景**:
- 对话式协作:发消息后等待对方回复,自动获取回复内容
- 群消息监控:实时监听指定群的新消息并总结
- 事件驱动:审批通过/拒绝、文档评论、日程变更等实时通知

**技术路径**:
- 飞书 WebSocket 长连接(仅 feishu.cn,不支持 Lark 国际版)
- 出站网络即可,无需公网 URL
- 复用 `@larksuiteoapi/node-sdk` 的 `WSClient`
- MCP server 启动时后台开连接,事件缓存到内存队列,`get_new_events` 工具拉取

**实现清单**:
- [ ] EventBuffer 类(内存队列、容量上限、按时间 / chat_id 过滤)
- [ ] WSClient 启动逻辑(集成到 main,和 MCP stdio 互不干扰)
- [ ] `im.message.receive_v1` 事件处理
- [ ] `get_new_events` 工具定义和 handler
- [ ] 断线重连 + 错误处理
- [ ] 文档:事件订阅配置指南
- [ ] 可选:更多事件类型(审批、日程、文档评论)

#### v1.3.8.D. 多账号自动切换

> v1.3.6 引入了 `list_profiles` / `switch_profile`(纯手动)。下一步:让 agent 调一个文档/群/bitable 时自动选对的 profile,不用人工记"这个文档归属哪个账号"。**依赖 v1.3.7 Phase B 的 `~/.feishu-user-plugin/credentials.json` 已落地**(profileHints 字段写在那里)。

**触发场景**:
- 同一个 agent 同时持有多个 profile(主公司账号 + 客户账号 + 个人 vault)
- 跑 `read_doc(<外部客户的 docx URL>)` 时主账号 403,但客户账号有权限
- 现在:agent 必须先 `switch_profile` 再 `read_doc`,出错才知道
- 想要:自动尝试每个 profile,缓存"这个 doc_token 属于 profile X"

**实现清单**:
- [ ] 中间件:在 server.js 的 `CallToolRequestSchema` handler 外包一层 `try → catch 401/403/permission_denied → switch + retry` 装饰。仅对**读取类**工具生效(白名单:`read_*` / `list_*` / `get_*` / `search_*` / `download_*`),写操作不自动切
- [ ] 缓存:`Map<resourceKey, profileName>` 持久化到 `~/.feishu-user-plugin/credentials.json::profileHints`(B2 已预留字段)
- [ ] resourceKey 提取:doc_token / app_token / chat_id / oc_xxx / oa_xxx / file_token / wiki node 等等都做 key。从 args 里 grep 出 token-like 字段
- [ ] 错误码白名单:只对 `91403`、`1254301`、`1254000` 系列(权限)、`access_denied`、`docx_no_permission` 等触发切换;`access_token expired` / 5xx / 网络错误等不切换(那是别的问题)
- [ ] 日志:stderr 提示"profile <X> 在 <resource> 上 403,自动切到 <Y> 重试"
- [ ] 工具响应里加 `viaProfile` 字段,让 agent 看到本次实际用了哪个 profile
- [ ] 失败兜底:所有 profile 都拒绝时返回综合错误"resource X 在所有 N 个 profile 中均无权限",列出尝试的每个 profile + 它各自的错误
- [ ] 回归:default-only 用户(99% 场景)零开销 —— 没注册第二个 profile 就直接走原路径,不进入 retry loop
- [ ] 新增 `manage_profile_hints(action=list|clear, resource_key?)` 工具(可选):用来排查"这个 doc 现在缓存指向哪个 profile / 把它清掉重新探测"
- [ ] 文档:在 README 增"多账号自动切换"小节,讲清楚白名单 / 缓存 / 写操作仍需 explicit switch 的规则

**风险**:错误的 profile 切换可能造成无意中"代某账号操作"。务必只在**读**操作里自动切;写操作必须 explicit `switch_profile`,或者 caller 显式传 `via_profile="auto"` 才允许跨 profile fallback。

## 已调研但暂不实施

### Token 优化(文档转 Markdown)
- `get_doc_blocks` 返回的 JSON 比等价 markdown 大 2-3x(实测 216KB vs 90KB)
- 但 `read_doc` 已返回纯文本,`get_doc_blocks` 用户就是要结构化数据
- 如有需求可加 `read_doc_markdown` 工具,使用 `feishu-docx` 做客户端转换
