# feishu-user-plugin Roadmap

> 本文件只记**未来**计划。已发布版本的逐项变更见 [CHANGELOG.md](./CHANGELOG.md)。
>
> 战略定位：聚焦官方做不到 / 做不好的差异化（cookie + protobuf 用户身份路径 + 文档生态 + 实时事件 SSOT + 多 profile 自动切换 + MCP 协议原生）。明确**不再扩展**与官方重叠的业务系统域（mail / approval / attendance / hr / minutes 等）。详见 [docs/COMPARISON.md](./docs/COMPARISON.md)。

## v1.3.12 待办

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

### 工程质量

- [ ] **CHANGELOG 回填 v1.3.0 - v1.3.2**：CHANGELOG 当前最早 entry 是 v1.3.3，缺 v1.3.0/v1.3.1/v1.3.2。从 `git log v1.3.0...v1.3.2 --oneline` + 对应 commit message 重写每版 entry，参考 v1.3.6+ 已有的 `### Added / Changed / Fixed` 风格。原 issue #61（v1.3.3-v1.3.5 已 substantial，不需补）。
- [ ] **客户端兼容性测试**：在 Cursor / Windsurf / OpenClaw 各跑 `/send` `/status` 两条 prompt，写测试报告。原 issue #64。
- [ ] **gitleaks 防 cookie 误提交**：仓根加 `.gitleaks.toml`（学 [larksuite/cli](https://github.com/larksuite/cli) 的配置），接进 `.husky/pre-commit` + `.github/workflows/validate.yml`。防意外把 `LARK_COOKIE` / `LARK_APP_SECRET` / UAT 提交进 git

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
- ~~md ↔ 飞书 wiki 双向无损同步~~（v1.3.4 起多次推迟，v1.3.12 决定不做）
- ~~Mermaid / PlantUML → 飞书画板~~（依赖 md ↔ wiki 主线，主线删后一并删）
