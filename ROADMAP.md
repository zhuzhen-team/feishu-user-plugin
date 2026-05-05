# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.9 — 机器级 SSOT 完整化 + cookie protobuf 抓包 + md→wiki 同步 + 工程债务

### A. 机器级 SSOT 完整化（v1.3.9 主线）

v1.3.7/v1.3.8 已经把 cookie / UAT / app credentials / profileHints 收敛到 `~/.feishu-user-plugin/credentials.json`，这一版把剩下两个分散点也收敛 + 让"安装即机器级"成为默认路径：

- [ ] **A.1 WebSocket 机器级（单 owner + 共享 event log + 单一 drain 游标）**

  - 路径：`~/.feishu-user-plugin/ws-owner.lock`（O_CREAT|O_EXCL，谁拿到谁是 WS owner）+ `~/.feishu-user-plugin/events.jsonl`（append-only event log）+ `~/.feishu-user-plugin/events.cursor`（**单一全局 drain 位置**）
  - MCP boot 试拿 `ws-owner.lock`：拿到→启 `WSClient` 把 event 序列化追加到 `events.jsonl`；拿不到→不开 WS，定时 stat `events.jsonl` 看新数据
  - `get_new_events` 工具：**每台机器只一份 cursor** —— 任何 harness 调一次就推进游标，drain 后其它 harness 看不到这条。同一台机器上的 N 个 harness 等同一个消费者
  - cursor 读+写用单独 lock 保护，避免并发 drain 看到同一行
  - owner 死了 / 锁过期 → 下一个 MCP 进程自动接管，event log 不丢
  - events.jsonl 大小封顶（10 MB or N 天），rotate 成 events.jsonl.old
  - 同时把 v1.3.8 那条"multiple MCP processes get duplicate events" 的限制从 CLAUDE.md / Troubleshooting 删掉
  - 顺手实现 **manage_ws_status(action=info|reconnect)** —— 暴露 owner pid、`getReconnectInfo()`、buffer stats、注册的事件类型；reconnect 主动断开重连

- [ ] **A.2 Active profile 跨进程同步**

  - dispatcher 入口 stat `credentials.json`：mtime 变化时重新读 `active`，跟当前 in-memory `currentProfile` 不同就触发 `setActiveProfile`（invalidate cached `userClient` / `officialClient`）
  - 成本：每次 tool call 多一次 `stat`（~10μs on macOS），可接受
  - 效果：Claude Code 里调 `switch_profile alt` 后，Codex 下一次 tool call 自动跟上

- [ ] **A.3 setup CLI 非交互模式自动机器级**

  - 现状：`npx feishu-user-plugin setup --app-id X --app-secret Y` 在 `nonInteractive=true` 时跳过了 pointer-only 询问，每个 harness 仍写一份 LARK_*
  - 修法：
    - 检测到 `credentials.json` 已存在 → non-interactive 默认 `--pointer-only`
    - 首次安装（没 credentials.json）→ setup 内部直接跑一次 `migrate` 写 credentials.json，harness env 只放 `FEISHU_PLUGIN_PROFILE=default`
  - 安装 prompt 文字不动，只让 setup CLI 自己变聪明 —— 新装用户 zero-config 走 SSOT；老用户重跑 setup 也自动收敛

- [ ] **A.4 实时事件类型扩展**（顺手做，不强制）

  - `createWSServer` 的 `registrations` 已经参数化，加一组：`approval.instance` / `calendar.calendar.event.changed_v4` / 文档评论事件（待查 SDK 是否暴露）
  - 默认仍只 enable `im.message.receive_v1`，新事件由 env / config flag 控制（避免老用户突然多收一堆没消费的事件）

### B. Cookie wire format 反向工程（v1.3.8 完成 A.0 工具链；A.1-A.5 待实际抓包）

v1.3.8 已 ship 工具链：

- `scripts/decode-feishu-protobuf.js` — 按 `proto/lark.proto` 解码 + 报告未知字段（带 round-trip 自测）
- `scripts/capture-feishu-protobuf.js` — 每种类型的抓包 recipe + 批量 DECODE 命令
- `docs/COOKIE-PROTOBUF-CAPTURES.md` — 流程文档 + 每类占位
- 全套实施 plan 在 `docs/superpowers/plans/2026-05-05-v1.3.8-cookie-protobuf.md`

剩余抓包工作：

- [ ] `send_image_as_user` — Playwright 录飞书 web 客户端发图时的 protobuf payload，对照补全 IMAGE 元数据（宽高 / MIME / 缩略图 / 原图大小）。**完成后必须更新 `src/clients/user.js::_sendMsg` 的 IMAGE 错误兜底**（v1.3.8 已把"deferred to v1.3.8"措辞改成 v1.3.9）
- [ ] `send_audio_as_user` — AUDIO 子结构（duration / waveform）
- [ ] `send_sticker_as_user` — sticker_id 来源（飞书 sticker pack 列表 API 探查）
- [ ] `send_card_as_user` 真·用户身份 — 录卡片 protobuf，实现 type=14。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**（v1.3.8 已把 description 里 "deferred to v1.3.7" 改成 v1.3.9）
- [ ] `search_messages` — 先试 UAT `/open-apis/im/v1/messages/search`，不暴露则逆向 cookie 路径

抓包步骤详见 `docs/COOKIE-PROTOBUF-CAPTURES.md`。

### C. 本地 md → 飞书知识库同步（从 v1.3.4/1.3.6/1.3.7/1.3.8 持续推迟）

- [ ] md parser 选型（remark / markdown-it / unified）
- [ ] `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
- [ ] wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
- [ ] 图片内联：md `![alt](./img.png)` → `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
- [ ] 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → `file_path` 快捷
- [ ] CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
- [ ] 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### D. Token 优化：`read_doc_markdown` 工具

- [ ] 新增 `read_doc_markdown(document_id)`：用 `feishu-docx` 把 docx blocks 转 markdown 返回。`get_doc_blocks` 对结构化场景仍保留；`read_doc_markdown` 给 RAG / digest 类用例省 2-3x token（实测 216 KB JSON vs 90 KB markdown）。需评估 `feishu-docx` 是否支持飞书最新 block types

### E. 工程债务：`src/config/` 目录化拆分

- [ ] 拆 `src/config.js`（364 行）→ `src/config/discovery.js`（findMcpConfig）+ `src/config/persistence.js`（atomic write + persistToConfig）+ `src/config/setup.js`（writeNewConfig）。条件触发：等 config.js 真长大或多 harness 配置规则差异变多时再做

### F. 测试残留

- [ ] **`switch_profile` 多 profile 实测 e2e**：v1.3.8 之前 Plan-2-blocked，现 Plan 2 已 ship。tests/ 里写一个用 mock 第二 profile 的 e2e（临时改 `~/.feishu-user-plugin/credentials.json` 加 dummy alt）跑 setActiveProfile → cached client 失效 → 下次 tool call 重建 → cookie/UAT 命中新 profile
- [ ] **测试群解散** `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`（"81-tool-test temp group renamed"）—— 卡在群 owner 权限转让，从 v1.3.6 持续遗留

### G. OpenClaw 偏好文件（用户明确说先不管，留底）

- [ ] OpenClaw 的偏好文件

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有
