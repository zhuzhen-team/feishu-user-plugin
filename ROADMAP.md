# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.10 待办

### A. Lark Desktop 多账号联动 — "无感切换" 主题

**用户需求（确认 2026-05-08）**：用户在 Feishu Desktop 切到账号 B → MCP 自动跟着用账号 B 凭证，不需要任何 CLI 命令、不需要 MCP 工具调用。

**已经摸过的事实（v1.3.9 ship 前 spike）**：
- macOS Lark 数据目录：`~/Library/Containers/com.bytedance.macos.feishu/Data/Library/Application Support/LarkShell/sdk_storage/`
- 一个 `<hash>/` 子目录 = 一个登录过的账号
- 每个 hash 下有 `cookie_store.db` —— **加密 SQLite**（非标准格式，root 有 `db-newkey-mark` 标记，看起来 Lark 自己的 keyed encryption）
- 解密 key 大概率在 macOS Keychain，反向工程 + 维护脆弱

**v1.3.10 实施方案**（不解密 cookies，用 mtime 触发）：

1. **schema 扩展**：`credentials.json::profiles[*]` 加可选 `larkHash` 字段（用户人肉绑定一次：哪个 profile 对应哪个 Lark 账号目录）
2. **setup CLI 自动检测**：第一次 setup 时扫 `sdk_storage/` 找最近 mtime 的 hash 自动绑到当前 profile；多账号场景下打印检测到的 hash 列表让用户选
3. **MCP 监控**：owner heartbeat 每 15s `stat sdk_storage/*/cookie_store.db`，发现有 hash 的 mtime > 当前 active profile 的 larkHash mtime → 查 credentials.json 找哪个 profile 绑定了这个 hash → 自动 `setActiveProfile()` 触发跨进程同步（A.2 路径）
4. **Cookie 仍由用户提供**：MCP 不读 Lark 加密 cookie；只用 mtime 信号决定切换。每次切换后用 credentials.json 里那个 profile 自己存的 cookie + UAT
5. **未绑定 hash 的处理**：用户在 Lark 切到没绑过的账号 → MCP stderr 提示 "detected new Lark account hash <X>, run `setup --profile <name> --bind-hash <X>` to associate"

**风险 / 边界**：
- 用户 cookie 还是会过期（Lark Desktop 登录刷新不会自动同步过来）—— 用户需定期重抓 cookie 或用 keepalive cron
- Linux / Windows Lark 桌面端的目录结构可能不同（v1.3.10 优先 macOS，其它平台后续）
- Lark 升级版本可能改 sdk_storage 路径或加密格式 —— 用 try/catch + 回退手动模式

**dependencies**：无（用 fs.statSync 即可）

**predicted scope**：~1-1.5 天单独 PR

### B. 其它 v1.3.10 主线
（保留位置 — md→wiki 同步、search_messages、config 拆分、OpenClaw 等仍按原 plan）

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
