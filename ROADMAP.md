# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.9 — cookie wire format 抓包 + md→wiki 同步 + 实时事件扩展 + 工程债务

### A. Cookie wire format 反向工程（v1.3.8 完成 A.0 工具链；A.1-A.5 待实际抓包）

v1.3.8 已 ship 工具链：

- `scripts/decode-feishu-protobuf.js` — 按 `proto/lark.proto` 解码 + 报告未知字段（带 round-trip 自测）
- `scripts/capture-feishu-protobuf.js` — 每种类型的抓包 recipe + 批量 DECODE 命令
- `docs/COOKIE-PROTOBUF-CAPTURES.md` — 流程文档 + 每类占位
- 全套实施 plan 在 `docs/superpowers/plans/2026-05-05-v1.3.8-cookie-protobuf.md`（5 个 phase 详细步骤）

剩余抓包工作（v1.3.9）：

- [ ] `send_image_as_user` — 用 Playwright 录飞书 web 客户端发图时的 protobuf payload，对照补全 `proto/lark.proto` 的 IMAGE 元数据字段（宽高 / MIME / 缩略图 / 原图大小）。验证 P2P + 群聊两条路径。**完成后必须更新 `src/clients/user.js::_sendMsg` 的 IMAGE 错误兜底**（v1.3.8 已把"deferred to v1.3.8"措辞改成 v1.3.9，现在 throw 的提示语指向新版本）
- [ ] `send_audio_as_user` — 同上，AUDIO 子结构（duration / waveform）
- [ ] `send_sticker_as_user` — 同上，sticker_id 来源（飞书 sticker pack 列表 API 探查）
- [ ] `send_card_as_user` 真·用户身份 — 录卡片发送 protobuf，实现 type=14 用户身份。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**（`src/tools/messaging-user.js` 里 send_card_as_user 的 description 当前在 v1.3.8 已改为指向 v1.3.9）
- [ ] `search_messages` — 按关键词搜聊天历史。先试 UAT `/open-apis/im/v1/messages/search` 是否暴露，不存在则逆向 cookie 路径

抓包步骤（详见 `docs/COOKIE-PROTOBUF-CAPTURES.md`）：

1. Playwright MCP 打开 `feishu.cn/messenger/`，验证 cookie session 已激活（页面会落到 `<tenant>.feishu.cn/next/messenger/`）
2. 注入 `window.fetch` monkey-patch 截获 `/im/gateway/` POST body
3. 通过 web UI 发对应类型的消息到自己（"我自己"）
4. `node scripts/decode-feishu-protobuf.js Packet --b64 "$(cat /tmp/feishu-captures/<type>-1.b64)"` 解码、提示未知字段
5. 补 proto、重 decode 直到 "All fields known"
6. 实现 `src/clients/user.js::send<Type>` 方法 + tools 层

### B. 实时事件扩展（v1.3.8 ship `im.message.receive_v1`；扩展 + 状态可观测）

- [ ] **更多事件类型** —— `createWSServer` 的 `registrations` 数组已是参数化的，加一组：
  - `approval.instance` 审批通过 / 拒绝
  - `calendar.calendar.event.changed_v4` 日程变更
  - `drive.file.bitable_record_changed_v1` 多维表数据变更（如可订阅）
  - 文档评论事件（待查 SDK 是否暴露）
  - 默认仍只 enable `im.message.receive_v1`，新事件由 env / config flag 控制（避免老用户突然收一堆没消费的事件）
- [ ] **WS 状态可观测工具** `manage_ws_status(action=info|reconnect)` —— 暴露 `WSClient.getReconnectInfo()`（lastConnectTime / nextConnectTime）、当前 buffer stats、注册的事件类型；`reconnect` 主动断开重连，处理"WS 看似没死但其实没在收消息"的诡异 case
- [ ] **`event_id` 去重 hint**：当前 CLAUDE.md 让 consumer 自己 dedup。可选加在 EventBuffer 一层：push 前查最近 N 个 event_id，重复直接丢。但需要先看真实 dup 频率再决定（避免前置优化）

### C. 本地 md → 飞书知识库同步（从 v1.3.4/1.3.6/1.3.7/1.3.8 持续推迟）

依赖 md parser 选型 + `src/doc-blocks.js` 补齐，独立性较高。

- [ ] md parser 选型（remark / markdown-it / unified）
- [ ] `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
- [ ] wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
- [ ] 图片内联：md `![alt](./img.png)` → 复用 `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
- [ ] 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → 复用 `file_path` 快捷
- [ ] CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
- [ ] 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### D. Token 优化：`read_doc_markdown` 工具

之前在"已调研但暂不实施"留底，正式列入 v1.3.9：

- [ ] 新增 `read_doc_markdown(document_id)` 工具，用 `feishu-docx`（或同类库）把 docx blocks 转成 markdown 返回。`get_doc_blocks` 对结构化场景仍保留；`read_doc_markdown` 给 RAG / digest 类用例省 2-3x token（实测 216 KB JSON vs 90 KB markdown）。需评估 `feishu-docx` 是否支持飞书最新 block types，或自己实现一个最小 walker

### E. 工程债务：`src/config/` 目录化拆分

v1.3.7 推迟到 v1.3.8 又评估为低优先级，v1.3.9 正式列入：

- [ ] 拆 `src/config.js`（364 行）→ `src/config/discovery.js`（findMcpConfig）+ `src/config/persistence.js`（atomic write + persistToConfig）+ `src/config/setup.js`（writeNewConfig）。条件触发：等 config.js 真长大或多 harness 配置规则差异变多时再做；如不长大可继续保留单文件

### F. 测试残留

- [ ] **`switch_profile` 多 profile 实测 e2e**：v1.3.8 之前是 Plan-2-blocked，现在 Plan 2 已 ship。需要在 tests/ 里写一个用 mock 第二 profile（譬如临时改 `~/.feishu-user-plugin/credentials.json` 加一个 dummy alt）跑 setActiveProfile → cached client 失效 → 下次 tool call 重建 → cookie/UAT 命中新 profile 的端到端验证
- [ ] **测试群解散** `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`（"81-tool-test temp group renamed"）—— 卡在群 owner 权限转让，从 v1.3.6 持续遗留

### G. OpenClaw 偏好文件（用户明确说先不管，留底）

- [ ] OpenClaw 的偏好文件

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有
