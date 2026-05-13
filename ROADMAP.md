# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 战略定位：聚焦官方做不到 / 做不好的差异化（cookie + protobuf 用户身份路径 + 文档生态 + 实时事件 SSOT + 多 profile 自动切换 + MCP 协议原生）。明确**不再扩展**与官方重叠的业务系统域（mail / approval / attendance / hr / minutes 等）。详见 [docs/COMPARISON.md](./docs/COMPARISON.md)。

## v1.3.12 待办

### 待决策（先确认再开工）

- [ ] **仓名是否改成 `feishu-mcp-server`**：当前 `feishu-user-plugin` 中 "plugin" 是 Claude Code skill 框架特定术语，搜"飞书 mcp"/"飞书 cli"/"飞书 plugin"找不到本仓（GitHub 搜索实测）。改名让 SEO + 搜索友好（跟 github/github-mcp-server / suekou/mcp-notion-server / korotovsky/slack-mcp-server 命名一致）。npm package name 保留 `feishu-user-plugin` 不动以维持老用户 `npm install` 兼容。GitHub 自动 redirect 旧 URL。

### 主线

- [ ] **C. md ↔ 飞书 wiki 双向无损同步**（v1.3.4 起多次推迟；v1.3.12 主角）
  - **正向 md → wiki**：
    - md parser 选型（remark / markdown-it / unified）
    - `src/doc-blocks.js` 补齐 heading / bullet / ordered / code / quote / divider / table / todo / callout 构造器
    - wikilink `[[page]]` 解析：按 md 文件名 / 标题 / 用户自定义 mapping 三级策略
    - 图片内联：md 图片语法（`![alt](./img.png)`）→ `uploadMedia(parent_type='docx_image')` + `image_path` 快捷
    - 文件附件 inline：md 链接到本地文件（`[label](./file.pdf)`）→ `file_path` 快捷
    - CLI 子命令 `sync-md <path>` vs MCP 工具 `sync_markdown_to_wiki` 取舍
    - 增量 diff：已存在 wiki 节点的更新策略（全量覆盖 / 按 block_id 精细 diff）
  - **反向 wiki → md 导出**（新增）：从飞书文档 / wiki 节点导出成 md，保真度参考 riba2534/feishu-cli "双向无损转换" 标准
- [ ] **Mermaid / PlantUML → 飞书画板**：md 代码块里的 Mermaid / PlantUML 自动转飞书画板（可编辑矢量图，非截图）。独立差异化点，学 riba2534（实测 88 个 Mermaid 93.2% 成功率）+ cso1z 飞书画板写入。配合 C 主线同期做。

### Protobuf 阶段二

- [ ] **B.5 `search_messages`** —— 先试 UAT `/open-apis/im/v1/messages/search`，飞书未暴露则反向 cookie 路径

### 形态扩展（双形态）

- [ ] **CLI 化**（学 cso1z `feishu-tool` 的轻量模式）
  - 设计：`npx feishu-user-plugin tool <tool-name> '<json-args>'` 复用 MCP 工具实现，零额外 argparse / schema 设计
  - 配套子命令：`tool list`（列 84 工具）+ `tool help <name>`（看 schema）
  - 实现成本：~50 行 src/cli.js 扩展（dispatch 到现有 HANDLERS）
  - 新增 docs/CLI.md 文档
  - 价值：扩大用户面（脚本 / cron / 调试 / 演示 / 非 AI 用户）+ 飞书生态搜索覆盖

### 可发现度改造

- [ ] **README h1 / repo description / GitHub topics 加 cli/mcp 关键词**
  - README h1 加"飞书 MCP 服务器 + CLI 工具"
  - repo description 加 `cli` / `mcp` 字样
  - GitHub topics 补 `feishu-mcp` / `feishu-cli` / `mcp-server` / `cli`
  - SEO 目标：搜"飞书 mcp" / "飞书 cli" / "飞书 plugin" 首页能见到本仓
- [ ] **演示视频 / GIF**（占位项，等用户录）—— 学 cso1z 在 README 顶部嵌 B 站演示

### 工程质量

- [ ] **CHANGELOG 回填 v1.3.0 - v1.3.5**：从 `git log v1.3.0...v1.3.5` + 对应 commit message 重写每版 entry，参考 v1.3.6+ 已有的 `### Added / Changed / Fixed` 风格。原 issue #61。
- [ ] **`read_doc_markdown` 测试覆盖**：加到 `scripts/test-all-tools.js`，准备一个含 image / file 块的 fixture docx 测占位符产出。原 issue #63。
- [ ] **客户端兼容性测试**：在 Cursor / Windsurf / OpenClaw 各跑 `/send` `/status` 两条 prompt，写测试报告。原 issue #64。
- [ ] **gitleaks 防 cookie 误提交**：仓根加 `.gitleaks.toml`（学 [larksuite/cli](https://github.com/larksuite/cli) 的配置），接进 `.husky/pre-commit` + `.github/workflows/validate.yml`。防意外把 `LARK_COOKIE` / `LARK_APP_SECRET` / UAT 提交进 git
- [ ] **GitHub Copilot review workflow 处理**：本仓最近 100 次 CI run 中 22 次失败都是 "Copilot code review" workflow（GitHub hosted service，非我们 `.github/workflows/` 配置，因 billing/auth 问题永远 fail）。team-skills 仓同样问题 7 次。处理方案：GitHub Settings → Code review → Disable Copilot（让实际工作的 Codex review 单独运作）。需要管理员在 GitHub UI 操作

### 战略性微调

- [ ] **`via` 参数全工具一致化**：当前 `read_messages` / `read_p2p_messages` 有 `via: bot|user|contacts`；写工具有 `via_profile`。统一所有 user-identity 工具暴露 `via_user: true` 切换显式 cookie / UAT 路径（参考 lark-cli `--as user / --as bot`）
- [ ] **工具调用结果 JSON schema 一致化**：所有 `send_*_as_user` 工具返回 `{ok, viaUser, fallbackWarning?, messageId?}` 统一形状

## 已调研但暂不实施

### OKR 本体 CRUD
- 飞书侧 OKR 开放 API 不开放完整 CRUD（只暴露读 + 进展记录写）
- v1.3.7 已实现可补的部分（progress record 三件套），本体 create/update/delete 永远不会有

### Windsurf MCP Marketplace
- 无公开第三方提交渠道（仅官方 partnership 邀请）
- 靠 Official MCP Registry 同步覆盖即可

### OpenClaw plugin 形态
- `larksuite/openclaw-lark` 是飞书官方 OpenClaw 插件（2.16k stars 活跃维护，今天还在更新）
- OpenClaw 主仓 371k stars，是字节亲生 AI Agent 框架
- 第三方做 OpenClaw 飞书插件直接跟官方 openclaw-lark 竞争且无差异化优势
- 详见 [docs/COMPARISON.md](./docs/COMPARISON.md)

### 业务系统域（明确不做）

为聚焦差异化，本仓**不**扩展以下域。需要这些功能请用 [`@larksuiteoapi/lark-mcp`](https://github.com/larksuite/lark-openapi-mcp) 或 [`@larksuite/cli`](https://github.com/larksuite/cli)：

- 邮件（mail）
- 审批（approval）
- 考勤（attendance）
- HR / 招聘（corehr / hire）
- 会议录制 / 纪要（vc / minutes）
- 智能门禁（acs）
- 翻译 / OCR / 语音转文字（translation / ocr / speech-to-text）
- 应用市场 / 百科 / 智能门户（application / baike / workplace）

### 已删除（不会做）

- ~~`send_audio_as_user`~~（用户 2026-05-07 决定删除：使用频率低，反向工程成本不值）
- ~~`send_sticker_as_user`~~（用户 2026-05-07 决定删除：价值最低，且需先调研飞书 sticker pack API）
- ~~测试群解散 `oc_daaa6a50f2a97dc668aaf79ae4dc6e4e`~~（用户已不在该群，搁置）

## 上架提交（仓库已具备所有材料于 v1.3.11，等用户人肉表单提交）

- [ ] **Anthropic Connectors Directory 提交**：v1.3.11 ship 了 `PRIVACY.md` + `.mcpb/manifest.json` + `scripts/build-mcpb.js`。剩下的：`node scripts/build-mcpb.js` 产出 `.mcpb` → 在 https://clau.de/desktop-extention-submission 上传。详见 `docs/launch/submissions/anthropic-directory.md`
- [ ] **Cursor Marketplace 提交**：v1.3.11 ship 了 `.cursor-plugin/plugin.json`。剩下的：去 https://cursor.com/marketplace/publish 提交仓库 URL。详见 `docs/launch/submissions/cursor-marketplace.md`
