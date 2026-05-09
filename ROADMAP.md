# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。

## v1.3.11 待办

### A. Lark Desktop 多账号联动 — "无感切换" 主题

**用户需求（确认 2026-05-08）**：用户在 Feishu Desktop 切到账号 B → MCP 自动跟着用账号 B 凭证，不需要任何 CLI 命令、不需要 MCP 工具调用。

**已经摸过的事实（v1.3.9 ship 前 spike）**：
- macOS Lark 数据目录：`~/Library/Containers/com.bytedance.macos.feishu/Data/Library/Application Support/LarkShell/sdk_storage/`
- 一个 `<hash>/` 子目录 = 一个登录过的账号
- 每个 hash 下有 `cookie_store.db` —— 加密 SQLite（非标准格式，root 有 `db-newkey-mark` 标记，看起来 Lark 自己的 keyed encryption）
- 解密 key 大概率在 macOS Keychain，工程量大且维护脆弱

**v1.3.11 实施方案**（不解密 cookies，用 mtime 触发）：

1. **schema 扩展**：`credentials.json::profiles[*]` 加可选 `larkHash` 字段（用户人肉绑定一次：哪个 profile 对应哪个 Lark 账号目录）
2. **setup CLI 自动检测**：第一次 setup 时扫 `sdk_storage/` 找最近 mtime 的 hash 自动绑到当前 profile；多账号场景下打印检测到的 hash 列表让用户选
3. **MCP 监控**：owner heartbeat 每 15s `stat sdk_storage/*/cookie_store.db`，发现有 hash 的 mtime > 当前 active profile 的 larkHash mtime → 查 credentials.json 找哪个 profile 绑定了这个 hash → 自动 `setActiveProfile()` 触发跨进程同步（v1.3.9 A.2 路径）
4. **Cookie 仍由用户提供**：MCP 不读 Lark 加密 cookie；只用 mtime 信号决定切换。每次切换后用 credentials.json 里那个 profile 自己存的 cookie + UAT
5. **未绑定 hash 的处理**：用户在 Lark 切到没绑过的账号 → MCP stderr 提示 "detected new Lark account hash <X>, run `setup --profile <name> --bind-hash <X>` to associate"

**风险 / 边界**：
- 用户 cookie 仍会过期（Lark Desktop 登录刷新不会自动同步过来）—— 用户需定期重抓 cookie 或用 keepalive cron
- Linux / Windows Lark 桌面端的目录结构可能不同（v1.3.11 优先 macOS，其它平台后续）
- Lark 升级版本可能改 sdk_storage 路径或加密格式 —— 用 try/catch + 回退手动模式

**dependencies**：无（用 fs.statSync 即可）

**predicted scope**：~1-1.5 天单独 PR

### 主线

- [ ] **C. 本地 md → 飞书知识库同步**（v1.3.4 / 1.3.6 / 1.3.7 / 1.3.8 / 1.3.9 / 1.3.10 持续推迟；v1.3.11 主角）
  - md parser 选型（remark / markdown-it / unified）
  - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
  - wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
  - 图片内联：md `![alt](./img.png)` → `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
  - 文件附件 inline：md `[xxx.pdf](./xxx.pdf)` → `file_path` 快捷
  - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
  - 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）

### Protobuf 阶段二

- [ ] **B.5 `search_messages`** — 先试 UAT `/open-apis/im/v1/messages/search`，不暴露则尝试 cookie 路径

### 工程债务

- [ ] **E. `src/config/` 目录化拆分**（条件触发：等 config.js 真长大或多 harness 配置规则差异变多再做。届时拆 `discovery.js` / `persistence.js` / `setup.js`）
- [ ] **G. OpenClaw 偏好文件**

## v1.4 候选

- [ ] **Anthropic Connectors Directory 提交**：需 `.mcpb` 打包 + `manifest.json::privacy_policies` + README "Privacy Policy" 段。缺一项即被拒。详细阻塞清单见 `docs/launch/anthropic-directory-prep.md`
- [ ] **Cursor Marketplace 提交**：需 `.cursor-plugin/plugin.json` manifest。详细阻塞清单见 `docs/launch/cursor-marketplace-prep.md`
- [ ] **MCP Registry CI 自动 publish**：把 `mcp-publisher publish mcp-registry.json` 接进 GitHub Actions release workflow，用 `github-oidc` 模式取代手动 PAT login
- [ ] **百度站长 / Google Search Console 主动提交**：当 stars 涨起来 / 想要更快 indexing 时再做（被动 sitemap.xml + robots.txt 已就位）

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### Windsurf MCP Marketplace
- 无公开第三方提交渠道（仅官方 partnership 邀请）
- 靠 Official MCP Registry 同步覆盖即可

### 已删除（不会做）

- ~~`send_audio_as_user`~~（用户 2026-05-07 决定删除：使用频率低，反向工程成本不值）
- ~~`send_sticker_as_user`~~（用户 2026-05-07 决定删除：价值最低，且需先调研飞书 sticker pack API）
- ~~测试群解散 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`~~（用户已不在该群，搁置）
