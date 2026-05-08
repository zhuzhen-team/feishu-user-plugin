# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.9 — 机器级 SSOT 完整化 + cookie protobuf 阶段一 + 小项收尾

> **🔵 Brainstorm 已完成（2026-05-07）**——3 specs + 3 plans 已写完并 commit。
> **新会话开始执行时先读** `docs/superpowers/v1.3.9-execution-status.md`（实施顺序、设计决策冻结点、不要重做的事）。
> Specs: `docs/superpowers/specs/2026-05-07-v1.3.9-{machine-ssot,cookie-protobuf-phase2,small-items}.md`
> Plans: `docs/superpowers/plans/2026-05-07-v1.3.9-{machine-ssot,cookie-protobuf-phase2,small-items}.md`

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

### B. Cookie wire format 反向工程 — 阶段一

v1.3.8 已 ship 工具链：

- `scripts/decode-feishu-protobuf.js` — 按 `proto/lark.proto` 解码 + 报告未知字段（带 round-trip 自测）
- `scripts/capture-feishu-protobuf.js` — 每种类型的抓包 recipe + 批量 DECODE 命令
- `docs/COOKIE-PROTOBUF-CAPTURES.md` — 流程文档 + 每类占位
- 全套实施 plan 在 `docs/superpowers/plans/2026-05-05-v1.3.8-cookie-protobuf.md`

v1.3.9 抓包目标（兑现 v1.3.7/v1.3.8 历史承诺）：

- [ ] **B.1 `send_image_as_user`** — Playwright 录飞书 web 客户端发图时的 protobuf payload，对照补全 IMAGE 元数据（宽高 / MIME / 缩略图 / 原图大小）。**完成后必须更新 `src/clients/user.js::_sendMsg` 的 IMAGE 错误兜底**（把"deferred to v1.3.9"措辞清掉）
- [ ] **B.4 `send_card_as_user` 真·用户身份** — 录卡片 protobuf，实现 type=14。**实现完成后必须删除 v1.3.6 的 bot-default 兜底**

抓包步骤详见 `docs/COOKIE-PROTOBUF-CAPTURES.md`。

### D. Token 优化：`read_doc_markdown` 工具

- [ ] 新增 `read_doc_markdown(document_id)`：用 `feishu-docx` 把 docx blocks 转 markdown 返回。`get_doc_blocks` 对结构化场景仍保留；`read_doc_markdown` 给 RAG / digest 类用例省 2-3x token（实测 216 KB JSON vs 90 KB markdown）。需评估 `feishu-docx` 是否支持飞书最新 block types

### F. 测试残留

- [ ] **`switch_profile` 多 profile 实测 e2e**：v1.3.8 之前 Plan-2-blocked，现 Plan 2 已 ship。tests/ 里写一个用 mock 第二 profile 的 e2e（临时改 `~/.feishu-user-plugin/credentials.json` 加 dummy alt）跑 setActiveProfile → cached client 失效 → 下次 tool call 重建 → cookie/UAT 命中新 profile

## v1.3.9 ⇢ v1.3.10 过渡专项 — Growth / 推广 / 影响力

> v1.3.9 ship 后**立刻**执行，不再往后推。完成后展开成 `docs/superpowers/specs/2026-MM-DD-growth-launch.md` 单独 spec。

### 真实目标（用户确认 2026-05-07）

**全要**：
1. 企业内（公司）真实使用
2. 国内 dev 社区影响力（飞书生态 + 中文 dev 圈）
3. 国际 MCP 社区可见度（Anthropic / Claude Code 圈子）
4. 吸引外部贡献者
5. 个人技术 IP 背书

### 当前状态（2026-05-07 数据快照）

| 指标 | 值 |
|---|---|
| GitHub stars | **1**（仅自己）|
| Forks | 1 |
| 仓库年龄 | ~2 个月（创建 2026-03-07）|
| npm 日下载基线 | 5-30；发版日尖峰 100-130 **几乎都是 CI / 自己机器**，真实用户日活估 5-15 |
| Topics | 9 个（claude / claude-code / feishu / lark / mcp / im / messaging / protobuf / reverse-engineering），覆盖好 |
| GitHub 一句话描述 | **过时** —— 仍写 "reverse-engineered protocol for user-identity messaging"，没体现 82 工具 all-in-one |
| GitHub Discussions | 关闭 |
| OG image | 默认 GitHub 渲染（无品牌）|
| Homepage URL | 空 |
| README | 详尽但**全英文 + 无 demo GIF / 截图** |

### 根因诊断（功能不是问题）

82 工具 + 9 prompt + 3 鉴权层、覆盖 IM / Doc / Bitable / Wiki / Drive / Calendar / Tasks / OKR——功能维度已经超过大部分同类。**没人用不是因为功能少，是因为没人发现**。

1. **冷启动期 + 无触发事件**：仓库 2 月龄，没有 HN / KOL / 文章这种突发流量事件，star 数线性慢爬属于正常。需要主动推一把。
2. **GitHub 一句话描述过时**：发现路径上的人看到老描述以为是窄工具就跳过，**5 秒钟的免费修复**。
3. **MCP 生态发现入口未占位**：`awesome-mcp-servers` / `modelcontextprotocol/servers` / Anthropic 官方 MCP directory / Cursor / Windsurf MCP 市场——需要逐个查并提收录 PR。
4. **目标市场错位**：飞书用户 95% 是中国 dev，但 README 全英文 + 没在掘金 / 知乎 / V2EX / 飞书开放平台社区出现，两边都漏。
5. **缺 demo / 截图 / GIF**：MCP 工具靠"一眼就懂"传播，纯文字 README 转化率低。
6. **合规模糊**：cookie + protobuf 反向工程对企业有 ToS 顾虑。需要在 README 顶部明确"个人 / 内部使用，非生产 / 商业产品"减少观望者犹豫。
7. **没有第一推**：100 stars 之前完全靠人工拉，需要一篇技术文章 + 几个社区同步分享。

### 行动清单（v1.3.9 ship 后展开成 spec）

按 ROI 排序：

**低成本 / 立刻可做（半天内全部完成）**
- [ ] 同步 GitHub 仓库一句话描述与 npm description（all-in-one Feishu MCP, 82 tools, 3 auth layers）
- [ ] 开启 GitHub Discussions
- [ ] 设 Homepage URL（指向 npm 包页 / 介绍站 / Notion）
- [ ] 自定义 OG image（社交分享卡片）
- [ ] README 顶部加 ToS / 合规免责声明（明确个人 + 内部用途）
- [ ] README 加 demo GIF（asciinema / loom）—— "claude 自然语言 → 以你身份发飞书消息"

**中成本 / 写内容**
- [ ] README.zh-CN.md 中文版（飞书目标用户主语言）
- [ ] 掘金 + 知乎技术文章 ×1：方向 "让 Claude Code 以你身份发飞书消息——一个 82 工具的飞书 MCP 实战"
- [ ] V2EX 分享节点 + 飞书开放平台开发者社区帖
- [ ] X/Twitter 长 thread + tag MCP 社区 / Anthropic devrel

**高 ROI 但需审批等待**
- [ ] 提 PR 收录到 `awesome-mcp-servers`
- [ ] 提 PR 收录到 `modelcontextprotocol/servers`（若接受第三方）
- [ ] 提交到 Anthropic 官方 MCP directory（claude.ai/mcp）
- [ ] Cursor / Windsurf MCP 插件市场提交

**社群运营 / 长期**
- [ ] CONTRIBUTING.md 完善 + 标若干 `good-first-issue` 招贡献者
- [ ] 每个 release 中英双语 announcement
- [ ] 公司内（你自己 org）至少 2 个团队真实接入并写 case study

## v1.3.10 — md → wiki 同步主线 + protobuf 阶段二 + 工程债务清理

### 主线
- [ ] **C. 本地 md → 飞书知识库同步**（v1.3.4 / 1.3.6 / 1.3.7 / 1.3.8 / 1.3.9 持续推迟；v1.3.10 主角）
  - md parser 选型（remark / markdown-it / unified）
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联：md `![alt](./img.png)` → `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### Protobuf 阶段二
- [ ] **B.5 `search_messages`** — 先试 UAT `/open-apis/im/v1/messages/search`，不暴露则逆向 cookie 路径

### 工程债务
- [ ] **E. `src/config/` 目录化拆分**（条件触发：等 config.js 真长大或多 harness 配置规则差异变多再做。届时拆 `discovery.js` / `persistence.js` / `setup.js`）
- [ ] **G. OpenClaw 偏好文件**

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### 已删除（不会做）

- ~~`send_audio_as_user`~~（用户 2026-05-07 决定删除：使用频率低，反向工程成本不值）
- ~~`send_sticker_as_user`~~（用户 2026-05-07 决定删除：价值最低，且需先调研飞书 sticker pack API）
- ~~测试群解散 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`~~（用户已不在该群，搁置）
