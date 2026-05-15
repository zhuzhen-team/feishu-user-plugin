# feishu-user-plugin — Codex 指令

> 本文件是 AI agent 与开发者在本仓内的核心指令。详细信息按需要查阅 [docs/](https://github.com/EthanQC/feishu-user-plugin/tree/main/docs)。

## 仓库是什么

All-in-one 飞书 plugin for Claude Code，覆盖三层鉴权：

- **用户身份**（cookie 鉴权）：以你身份发送消息（text / image / file / post）
- **官方 API**（应用凭证）：读群消息、操作 docs / tables / wiki / drive / contacts，上传文件
- **用户 OAuth UAT**（user_access_token）：读 P2P 私聊历史，列用户所有 chat

84 个工具 + 9 个 MCP prompts。

## MCP Prompts（v1.3.7+）

9 个 Claude Code skill 同时通过 `prompts/list` + `prompts/get` 暴露给 Codex / Cursor / OpenClaw / Windsurf。Prompt body 在 server 启动时从 `skills/feishu-user-plugin/references/` 读。

| Prompt | 描述 |
|--------|------|
| `/send` | 以用户身份（非 bot）发消息 |
| `/reply` | 读最近消息然后回复 |
| `/digest` | 总结群或 P2P 最近消息 |
| `/search` | 搜飞书联系人或群 |
| `/doc` | 搜 / 读 / 创建飞书文档 |
| `/table` | 操作飞书 Bitable（多维表格） |
| `/wiki` | 搜 / 浏览飞书 Wiki 空间 |
| `/drive` | 列文件 / 创建文件夹（飞书云空间） |
| `/status` | 检查三层鉴权（cookie / app / UAT） |

每个 prompt 接受单一 `arguments` 自由文本（与 Claude Code skill 的 `$ARGUMENTS` 约定一致）。`status` 无参数。

## 工具大类（84 tools）

每个工具的具体参数说明在 MCP `inputSchema.description`（运行时可见）。工具列表 + 跨域 caveat + 用法 patterns 见 **[docs/TOOLS.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TOOLS.md)**。

13 个工具大类的快速 sketch：

- 用户身份消息（cookie protobuf，8）：`send_to_user` / `send_to_group` / `send_as_user` / `send_image_as_user` / `send_file_as_user` / `send_post_as_user` / `send_card_as_user` / `batch_send`
- 用户身份联系人（cookie，5）：`search_contacts` / `create_p2p_chat` / `get_chat_info` / `get_user_info` / `get_login_status`
- UAT P2P 读取（2）：`read_p2p_messages` / `list_user_chats`
- 官方 API IM（15）、Docs（7）、Bitable（5）、Wiki（9）、Drive（5）、OKR（6）、Calendar（8）、Tasks v2（7）
- 插件层 诊断 / 多 profile（4）+ 实时事件（2）

## 必需环境变量

| 变量 | 用途 |
|------|------|
| `LARK_COOKIE` | 用户身份发消息 |
| `LARK_APP_ID` | 官方 API 访问 |
| `LARK_APP_SECRET` | 官方 API 访问 |
| `LARK_USER_ACCESS_TOKEN` | P2P 读取 |
| `LARK_USER_REFRESH_TOKEN` | UAT 自动刷新 |

5 个全配齐。没配 UAT 的话 `read_p2p_messages` / `list_user_chats` 不可用。鉴权细节、安装流程、Cookie 抓取见 **[docs/AUTH-SETUP.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/AUTH-SETUP.md)**。

## 架构概览

### 两个发布渠道

- **npm 包**（`npx feishu-user-plugin`）：MCP server 代码 + skills + CLAUDE.md。给外部用户
- **team-skills plugin**：仅 skills + CLAUDE.md（无 .mcp.json）。给内部团队成员

### 多客户端支持

- **Claude Code**：JSON 配置在 `~/.claude.json` mcpServers
- **Codex**：TOML 配置在 `~/.codex/config.toml` mcp_servers
- 安装：`npx feishu-user-plugin setup --client codex` 或 `--client both`
- MCP server 代码完全相同 —— 只配置格式不同
- Codex 不支持 Claude Code slash command（skill）—— 仅 MCP 工具可用

### 文件职责矩阵

post-v1.3.7 phase A 重构后的文件职责矩阵在 **[docs/REFACTOR-NOTES.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/REFACTOR-NOTES.md)**。修改 `src/` 之前必读。

凭证存储 schema 在 **[docs/CREDENTIALS-FORMAT.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/CREDENTIALS-FORMAT.md)**。

## 关键 Caveats（高频踩点）

- **写默认 UAT-first**：每个 docx / bitable / drive / wiki / OKR / calendar / tasks 的 `create` / `edit` 走 `_asUserOrApp` —— UAT 优先，bot 仅 fallback。被迫走 bot 时返回 ⚠ warning（指向 `npx feishu-user-plugin oauth`），让 ownership 漂移立即显现
- **下载 2 MiB 上限**：`download_message_resource` / `download_doc_image` 返回 inline base64 时，> 2 MiB 必须传 `save_path`（Anthropic 5 MB inline 上限留 headroom）
- **`oc_xxx` 自动解析**：所有 cookie 发送自 v1.3.7 起自动把 `oc_xxx` 解析为 numeric chat ID
- **`merge_forward` 自动展开**：`read_messages` 默认把合并转发展开为子消息；子消息附件下载用 `parentMessageId`，不是子消息 id
- **`update_message` 仅 text / interactive**：飞书限制
- **`update_task` 必传 `update_fields`**：飞书只 patch 列出的字段
- **`manage_bitable_field(action=update)` 必传 `type`**：即使只改 field name
- **多 profile auto-switch**（v1.3.8）：读路径遇 `91403 / 1254301 / 1254000 / 99991672 / HTTP 403` 自动跨 profile retry。写路径**绝不**自动切。`via_profile: "auto"` 给写路径手动开
- **CARD 路径**：`send_card_as_user` 仅走 bot。Cookie 通道发卡片在 v1.3.9 通过 brute-force 确认服务端禁用

更多 caveat 与 known limitation 见 [docs/TOOLS.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TOOLS.md) + [docs/TROUBLESHOOTING.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TROUBLESHOOTING.md)。

## Doc 同步规则

`CLAUDE.md` 是 source of truth。pre-commit hook 自动把它派生为 `AGENTS.md`（Codex 用）：标题替换为 `# feishu-user-plugin — Codex 指令`，正文与 CLAUDE.md 相同。

**不要手编 AGENTS.md** —— hook 会覆盖。

CI（`validate.yml`）每个 PR 跑 diff 校验两文件同步。

## Commit conventions

| 前缀 | 用途 |
|------|------|
| `feat:` | 新工具或新能力 |
| `fix:` | bug 修复 |
| `docs:` | CLAUDE.md / README / ROADMAP 更新 |
| `chore:` | 依赖 / CI / config 改动 |
| `refactor:` | 不改行为的代码重构 |
| `test:` | 测试 |

## 修 bug 时

1. 写一个独立测试脚本（`node -e "..."`）先复现 bug，再修
2. 修完用同一脚本验证
3. 影响 MCP 工具行为的 bug，重启 server 后通过 MCP 工具调用再测一次

## 关键已知限制

- **Cookie 寿命**：12-24 小时无心跳过期，需重新登录 feishu.cn 拿 cookie
- **协议变化**：cookie + protobuf 层依赖飞书 web 客户端协议，飞书更新可能失效（机器人能力不受影响）
- **卡片**：cookie 通道发卡片服务端不可用，机器人通道可发
- **Lark 国际版**：实时事件 WS 不支持
- **未实现**：`search_messages`、md → wiki 同步（详见 [ROADMAP.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/ROADMAP.md)）

更详尽的故障排查与每域工具限制见 [docs/TROUBLESHOOTING.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TROUBLESHOOTING.md)。

## 在哪里查更多

| 主题 | 文件 |
|------|------|
| 工具详细 + 用法 patterns | [docs/TOOLS.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TOOLS.md) |
| 安装与凭证 + Cookie 抓取 + OAuth Scopes | [docs/AUTH-SETUP.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/AUTH-SETUP.md) |
| 错误诊断 / 故障排查 | [docs/TROUBLESHOOTING.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TROUBLESHOOTING.md) |
| 发版流程 + team-skills 同步 + 公告规则 | [docs/RELEASING.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/RELEASING.md) |
| 文件职责矩阵 / 新增工具放哪 | [docs/REFACTOR-NOTES.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/REFACTOR-NOTES.md) |
| MCP 客户端兼容矩阵 + 测试方法 | [docs/CLIENT-COMPAT.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/CLIENT-COMPAT.md) |
| 凭证文件 schema | [docs/CREDENTIALS-FORMAT.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/CREDENTIALS-FORMAT.md) |
| 测试方法论 | [docs/TESTING-METHODOLOGY.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/TESTING-METHODOLOGY.md) |
| Cookie protobuf 抓包记录 | [docs/COOKIE-PROTOBUF-CAPTURES.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/COOKIE-PROTOBUF-CAPTURES.md) |
| 贡献流程（dev 环境 + 新增工具流程 + PR 流程） | [CONTRIBUTING.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/CONTRIBUTING.md)（中英双语） |
| 路线图 | [ROADMAP.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/ROADMAP.md) |
| 历史 changelog | [CHANGELOG.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/CHANGELOG.md) |
