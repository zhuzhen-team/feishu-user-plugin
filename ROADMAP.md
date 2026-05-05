# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.9 — cookie wire format 抓包 + md → wiki 同步

### A. Cookie wire format 反向工程（v1.3.8 完成 A.0 工具链；A.1-A.5 待实际抓包）

v1.3.8 已 ship 工具链：

- `scripts/decode-feishu-protobuf.js` — 按 `proto/lark.proto` 解码 + 报告未知字段（带 round-trip 自测）
- `scripts/capture-feishu-protobuf.js` — 每种类型的抓包 recipe + 批量 DECODE 命令
- `docs/COOKIE-PROTOBUF-CAPTURES.md` — 流程文档 + 每类占位
- 全套实施 plan 在 `docs/superpowers/plans/2026-05-05-v1.3.8-cookie-protobuf.md`（5 个 phase 详细步骤）

剩余抓包工作（v1.3.9）：

- [ ] `send_image_as_user` — 用 Playwright 录飞书 web 客户端发图时的 protobuf payload，对照补全 `proto/lark.proto` 的 IMAGE 元数据字段（宽高 / MIME / 缩略图 / 原图大小）。验证 P2P + 群聊两条路径
- [ ] `send_audio_as_user` — 同上，AUDIO 子结构（duration / waveform）
- [ ] `send_sticker_as_user` — 同上，sticker_id 来源（飞书 sticker pack 列表 API 探查）
- [ ] `send_card_as_user` 真·用户身份 — 录卡片发送 protobuf，实现 type=14 用户身份。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**（handler 里 via=bot fallback）
- [ ] `search_messages` — 按关键词搜聊天历史。先试 UAT `/open-apis/im/v1/messages/search` 是否暴露，不存在则逆向 cookie 路径

抓包步骤（详见 `docs/COOKIE-PROTOBUF-CAPTURES.md`）：

1. Playwright MCP 打开 `feishu.cn/messenger/`，验证 cookie session 已激活（页面会落到 `<tenant>.feishu.cn/next/messenger/`）
2. 注入 `window.fetch` monkey-patch 截获 `/im/gateway/` POST body
3. 通过 web UI 发对应类型的消息到自己（"我自己"）
4. `node scripts/decode-feishu-protobuf.js Packet --b64 "$(cat /tmp/feishu-captures/<type>-1.b64)"` 解码、提示未知字段
5. 补 proto、重 decode 直到 "All fields known"
6. 实现 `src/clients/user.js::send<Type>` 方法 + tools 层

### B. 本地 md → 飞书知识库同步（从 v1.3.4/1.3.6/1.3.7/1.3.8 持续推迟）

依赖 md parser 选型 + `src/doc-blocks.js` 补齐，独立性较高。

- [ ] md parser 选型（remark / markdown-it / unified）
- [ ] `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
- [ ] wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
- [ ] 图片内联：md `![alt](./img.png)` → 复用 `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
- [ ] 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → 复用 `file_path` 快捷
- [ ] CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
- [ ] 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### C. v1.3.7 测试残留清理（持续）

- [ ] 测试群 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`（"81-tool-test temp group renamed"）解散 — 当前需 owner 权限，需先把群 owner 转给本人或让原 owner 解散

### D. OpenClaw 偏好文件（用户明确说先不管，留底）

- [ ] OpenClaw 的偏好文件

## 已调研但暂不实施

### Token 优化（文档转 Markdown）
- `get_doc_blocks` 返回的 JSON 比等价 markdown 大 2-3x（实测 216 KB vs 90 KB）
- 但 `read_doc` 已返回纯文本，`get_doc_blocks` 用户就是要结构化数据
- 如有需求可加 `read_doc_markdown` 工具，用 `feishu-docx` 做客户端转换

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有
