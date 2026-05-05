# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.8 — cookie wire format 反向工程 + 多 profile 自动切换 + 实时事件

三块独立性较强，需要新依赖或新协议（DevTools 抓包 / WSClient / 路由中间件），单独成版便于灰度。

### A. Cookie wire format 反向工程

v1.3.7 已为 `send_image_as_user` 加了清晰报错，但底层协议仍未跑通。本版主线。

- [ ] `send_image_as_user` — 录飞书 web 客户端发图时的 protobuf payload，对照补全 `proto/lark.proto` 的 IMAGE 元数据字段（宽高 / MIME / 缩略图 / 原图大小）。验证 P2P + 群聊两条路径
- [ ] `send_audio_as_user` — 同上，AUDIO 子结构（duration / waveform）
- [ ] `send_sticker_as_user` — 同上，sticker_id 来源（飞书 sticker pack 列表 API 探查）
- [ ] `send_card_as_user` 真·用户身份 — 录卡片发送 protobuf，实现 type=14 用户身份。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**（handler 里 via=bot fallback）
- [ ] `search_messages` — 按关键词搜聊天历史。先试 UAT `/open-apis/im/v1/messages/search` 是否暴露，不存在则逆向 cookie 路径

### B. 多 profile 自动切换

v1.3.6 引入了 `list_profiles` / `switch_profile`（手动）。下一步：让 agent 调一个文档/群/bitable 时自动选对的 profile。**依赖 v1.3.7 已落地的 `~/.feishu-user-plugin/credentials.json`**（profileHints 字段写在那里）。

**触发场景**: 同一 agent 持有多个 profile（主公司账号 + 客户账号 + 个人 vault），跑 `read_doc(<外部客户 docx URL>)` 时主账号 403，客户账号有权限。当前需要先 `switch_profile` 再 `read_doc`，出错才知道。

**实现**:
- [ ] 中间件：在 `CallToolRequestSchema` handler 外包 `try → catch 401/403/permission_denied → switch + retry` 装饰。仅对**读取类**工具生效（白名单：`read_*` / `list_*` / `get_*` / `search_*` / `download_*`），写操作不自动切
- [ ] resourceKey 提取：doc_token / app_token / chat_id / oc_xxx / file_token / wiki node 等都做 key，从 args 里 grep token-like 字段
- [ ] 缓存：`Map<resourceKey, profileName>` 持久化到 `credentials.json::profileHints`
- [ ] 错误码白名单：只对 `91403` / `1254301` / `1254000` / `access_denied` / `docx_no_permission` 触发切换；`access_token expired` / 5xx / 网络错误不切换
- [ ] stderr 日志：`profile <X> 在 <resource> 上 403，自动切到 <Y> 重试`；工具响应加 `viaProfile` 字段
- [ ] 失败兜底：所有 profile 都拒绝时返回综合错误，列出每个 profile 各自的错误
- [ ] default-only 用户零开销 —— 没注册第二个 profile 就直接走原路径
- [ ] 可选工具 `manage_profile_hints(action=list|clear, resource_key?)`
- [ ] README 增"多账号自动切换"小节，讲清白名单 / 缓存 / 写操作必须 explicit 的规则

**风险**: 错误的 profile 切换可能"代某账号操作"。务必只在读操作里自动切；写操作必须 explicit `switch_profile`，或显式 `via_profile="auto"` 才允许 fallback。

### C. WebSocket 实时事件

让 MCP server 接收飞书实时事件，从"单向操作"变成"双向对话"。

**解锁场景**: 发消息后等回复并自动获取；群消息实时监听并总结；审批通过/拒绝、文档评论、日程变更等事件驱动。

**技术路径**:
- 飞书 WebSocket 长连接（仅 feishu.cn，不支持 Lark 国际版）
- 出站网络即可，无需公网 URL
- 复用 `@larksuiteoapi/node-sdk` 的 `WSClient`
- MCP server 启动时后台开连接，事件缓存到内存队列，`get_new_events` 工具拉取

**实现**:
- [ ] EventBuffer 类（内存队列、容量上限、按时间 / chat_id 过滤）
- [ ] WSClient 启动逻辑（集成到 main，和 MCP stdio 互不干扰）
- [ ] `im.message.receive_v1` 事件处理
- [ ] `get_new_events` 工具
- [ ] 断线重连 + 错误处理
- [ ] 文档：事件订阅配置指南
- [ ] 可选：审批 / 日程 / 文档评论事件

### D. v1.3.7 Phase A/B 拆分残留（推迟到 Phase B 但 B 跑完后未动）

- [ ] `src/auth/credentials.js` 当前只是 re-export `src/config`；`src/auth/uat.js` / `src/auth/cookie.js` 还没拆出来。详见 `docs/REFACTOR-NOTES.md` 的 "Phase B 推迟项"
- [ ] `src/config/` 目录化拆分（Phase B 替换凭证存储后 config.js 主体被重写，但目录化未做）

### E. v1.3.7 单一可信源凭证 — 激进切换路径（v1.3.7 选了 backward-compat，未切完）

v1.3.7 落地了 credentials.json + setActiveProfile + UAT 写回单文件，但保留了 env block 真凭证作 backward-compat。原 plan 是更激进的"指针化"切换：

- [ ] harness env block 改成只放 `FEISHU_PLUGIN_PROFILE=default` 一个变量，真凭证完全从 credentials.json 读
- [ ] `setup` CLI 改写：写凭证文件 + 向所有发现的 harness 配置只写"指针 env"
- [ ] 启动 stderr 警告：检测到旧 env 配置仍在用时，提示"建议运行 `npx feishu-user-plugin migrate` 迁到单一可信源"（当前 startup 行只显示 source，没建议）

### F. v1.3.7 文档/工具基建遗留

- [ ] `server.json` 自动生成：当前还写着 v1.2.0 / 33 tools，应从 package.json + TOOLS 数组生成
- [ ] CI tool count 自校验：`node -e "import('./src/server.js').then(m=>console.log(m.TOOLS.length))"` vs README badge / SKILL.md
- [ ] CI 校验 `server.json` 字段一致性（与 F 第 1 项的"自动生成"配套）
- [ ] CI 校验 `CHANGELOG.md` 包含本 tag 对应小节（防止"打 tag 但忘了写 changelog"）
- [ ] `scripts/check-docs-sync.js` 在 prepublishOnly 跑，diff CLAUDE.md vs AGENTS.md vs skills/references/CLAUDE.md
- [ ] pre-commit 工具增减校验 README 工具数 badge（补充 CI 校验，给本地一道闸）

### G. v1.3.7 C7 复测残留

- [ ] `upload_drive_file` 带 `wiki_space_id` 模式，wiki scope 不全时直接 attach 失败的兜底路径未测
- [ ] `switch_profile` 多 profile 实测 — 阻塞在测试用第二 profile（需要真实 LARK_APP_ID + UAT）。Plan 2 (B) 落地后必须再做这步：用 mock 第二 profile 写 e2e 测试，否则 `setActiveProfile` 的 client-cache 失效路径仍未端到端验证

### H. v1.3.6 测试残留清理

- [ ] 测试群 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`（"81-tool-test temp group renamed"）解散 — 当前需 owner 权限，需先把群 owner 转给本人或让原 owner 解散

### I. OpenClaw 偏好文件

- [ ] OpenClaw 的偏好文件（用户明确说先不管，留底）

## v1.3.9 — 本地 md → 飞书知识库同步

依赖 md parser 选型 + `src/doc-blocks.js` 补齐，独立性较高，从 v1.3.4/1.3.6/1.3.7/1.3.8 持续推迟。

- [ ] md parser 选型（remark / markdown-it / unified）
- [ ] `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
- [ ] wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
- [ ] 图片内联：md `![alt](./img.png)` → 复用 `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
- [ ] 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → 复用 `file_path` 快捷
- [ ] CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
- [ ] 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

## 已调研但暂不实施

### Token 优化（文档转 Markdown）
- `get_doc_blocks` 返回的 JSON 比等价 markdown 大 2-3x（实测 216 KB vs 90 KB）
- 但 `read_doc` 已返回纯文本，`get_doc_blocks` 用户就是要结构化数据
- 如有需求可加 `read_doc_markdown` 工具，用 `feishu-docx` 做客户端转换

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有
