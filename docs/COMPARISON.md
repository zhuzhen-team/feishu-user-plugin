# 与官方对比

> **谁该读**：在评估"用 feishu-user-plugin 还是用飞书官方 MCP / CLI"的开发者；想知道本仓真实差异化在哪的潜在使用者。  
> **何时读**：决定接哪个工具进 AI 工作流之前；对比能力盘点。

诚实对比，不带 marketing 语气。基于 2026-05 各自仓的实际状态。

## 飞书官方今年发了两个 AI 友好工具

- [`@larksuiteoapi/lark-mcp`](https://github.com/larksuite/lark-openapi-mcp) —— 官方 OpenAPI MCP server。693 stars，**最后更新 2025-08（9 个月前）**，⚠ Beta，TypeScript。
- [`@larksuite/cli`](https://github.com/larksuite/cli) —— 官方 CLI + Claude Code Skills。**9900 stars**，活跃维护，Go 写，覆盖 17 业务域 200+ commands + 24 AI Agent Skills。

本仓（feishu-user-plugin）是 MCP server 形态，所以**主要对比 lark-openapi-mcp**；与 lark-cli 是不同协议形态，对比放在第三段。

## 一、vs `lark-openapi-mcp`（同 MCP 形态）

### 数量与设计哲学

| 维度 | 本仓 | lark-openapi-mcp |
|------|------|-------------------|
| 工具总数 | 85（全 production-ready） | 1271 endpoint，preset.default 默认 enable ~20 |
| 业务域 | 13 | 60 |
| 工具命名 | `manage_bitable_record(action=create\|update\|delete\|search\|get)` 高级 action-dispatcher | `bitable.v1.appTableRecord.create` × 5 个独立 tool，机械 1:1 endpoint |
| 测试覆盖 | 85/85 全有真飞书 API 测过 | 仅 preset 子集，README 注明 "Non-preset APIs ... AI may not perform optimally" |

工具命名差异对 AI agent 影响很直接：5 个独立的 `record.create` / `record.update` / `record.delete` / `record.batchUpdate` / `record.search` 让 LLM 在选工具时容易混淆；高级 dispatcher `manage_bitable_record(action=...)` 通过参数分发，选择面 1 而不是 5。

### 能力差距（lark-openapi-mcp 显式说没有的）

来自他们 README 原文：

> ⚠️ **File Upload/Download**: File upload and download operations are not yet supported
>
> ⚠️ **Document Editing**: Direct editing of Feishu cloud documents is not supported (only importing and reading are available)

我们这两块都有：

- 文件上传：`upload_image` / `upload_file` / `upload_drive_file` / `upload_bitable_attachment`
- 资源下载：`download_message_resource`（image / file，含 2 MiB inline cap）/ `download_doc_image`
- 文档编辑：`manage_doc_block(action=create|update|delete)` 全 CRUD，含 `image_path` / `file_path` 快捷上传

### 用户身份发消息：两条不同凭证路径

> **2026-05 更新**：飞书官方在 lark-cli 里加了 `+messages-send` 命令，含 `UserScopes: ["im:message.send_as_user", "im:message"]` + `AuthTypes: ["bot", "user"]`（[源码](https://github.com/larksuite/cli/blob/main/shortcuts/im/im_messages_send.go)）。也就是说飞书**已经**通过 OAuth scope `im:message.send_as_user` 官方支持用户身份发消息，**不再是物理性独家**。

本仓的 cookie + protobuf 路径 vs 官方 OAuth UAT + `send_as_user` scope：

| 维度 | 本仓 cookie + protobuf | 官方 OAuth `im:message.send_as_user` |
|------|------------------------|--------------------------------------|
| 凭证形式 | 用户 feishu.cn web 登录抓 cookie | OAuth UAT + refresh token |
| **安装门槛** | **不需要自建应用**，cookie 抓出来就跑 | 必须创建飞书自建应用 + 申请 scope + **管理员审批** |
| 失败 fallback | 协议变化 / 12h max-age → 重新登录 feishu.cn | UAT 2h 过期 → refresh token 自动；refresh token 7 天过期 → 重新 OAuth |
| 协议依赖 | 飞书 web 客户端协议（不公开，飞书可能改） | 飞书 OpenAPI（公开 SDK 支持，相对稳定） |
| 稳定性 | 中（飞书 web 改协议会挂） | 高（官方维护） |
| 使用场景 | 个人 / 没有应用管理员权限 / 想快速试 | 企业 / 自动化 / 服务器侧 / 长期稳定 |
| 工具数 | 8 个 send_*_as_user | `+messages-send --as user`（一个命令多 mode） |

| 路径 | 本仓 | lark-openapi-mcp（注 9 月没更新） | lark-cli |
|------|------|-------------------------------|---------|
| Bot 身份发消息 | ✓ | ✓ `im.v1.message.create` | ✓ `+messages-send --as bot` |
| 用户身份发消息 | ✓（cookie，零应用门槛） | 部分（理论上 OAuth UAT 走 send_as_user scope，但 Beta + 9 月 stale 可能踩 bug） | ✓（OAuth UAT，需要自建应用 + 管理员审批） |
| 读 P2P 私聊 | ✓ `read_p2p_messages`（UAT） | 部分（同上） | ✓（lark-im skill） |

**真实差异化**（不是物理性独家）：

1. **零应用门槛（仅限用户身份发消息这块）**：cookie 路径不需要"创建飞书自建应用 → 申请 OAuth scope → 等管理员审批"。对个人开发者 / 调研 / 快速试，这门槛是真实成本（企业管理员审批可能数周）。

   ⚠ **重要限定**：8 个 user-identity messaging 工具里只有部分真的零门槛：
   - **真零应用门槛（5 个）**：`send_to_user` / `send_to_group` / `send_as_user` / `send_post_as_user` / `batch_send`（text/post 模式）—— 仅 cookie
   - **仍需 LARK_APP_ID（2 个）**：`send_image_as_user` / `send_file_as_user` —— 发送本身走 cookie，但 `image_key` / `file_key` 必须先经 Official API 上传（`upload_image` / `upload_file`）
   - **服务端禁了 cookie 通道（1 个）**：`send_card_as_user` —— 始终走 bot，需要 `LARK_APP_ID` + `LARK_APP_SECRET`

   此外，本仓的其他能力（`read_messages` 读群消息、`manage_doc_block` 编辑文档、`manage_bitable_record` 操作表格、wiki / drive / calendar / tasks / OKR / 实时事件等）**仍然需要** `LARK_APP_ID` + `LARK_APP_SECRET`（也就是创建自建应用）。

2. **协议路径多样**：cookie + protobuf 不依赖 OpenAPI，飞书改 OpenAPI 时本仓不受影响（反之飞书改 web 协议时本仓挂）
3. **快速迭代的 wrapper**：本仓的 send 工具支持 `oc_xxx` 自动解析 numeric、merge_forward 自动展开、UAT-first + bot fallback ⚠ warning 等高级 wrapper

### 实践细节差距

本仓特有的高级 helper（lark-openapi-mcp 是 1:1 endpoint mapping 没有）：

- `merge_forward` 自动展开：`read_messages` 把合并转发消息自动展开为子消息列表，子消息含 `parentMessageId`、`urls[]`、`feishuDocs[]`
- `oc_xxx` 自动解析 numeric chat_id（cookie 路径必需）
- `read_doc_markdown`：直接返回 markdown 字符串（省 ~60% token vs 结构化 JSON）
- `manage_bitable_record(action=create|update|delete)` 接受单条或最多 500 条数组
- UAT-first 写入 + ⚠ fallback warning：写工具优先 UAT，失败 fallback 到 bot 时 response 里追加 warning 提醒 ownership 漂移
- 多 profile auto-switch（v1.3.8+）：91403 / 1254301 / 1254000 / 99991672 / HTTP 403 自动跨 profile retry，写路径不切
- 机器级 WS SSOT（v1.3.9+）：单进程持 WS owner 锁，所有 MCP 进程共享 events.jsonl；游标按 profile 独立（v1.4.0，`*` 看全部），同一视角下全机每事件精确一次

### 维护状态

- 本仓：最新 v1.3.12（2026-05），活跃维护，本月 10+ PR
- lark-openapi-mcp：最新提交 2025-08-14，9 个月没动；README 头标 ⚠ Beta

## 二、覆盖广度差距

本仓**没有**官方 lark-openapi-mcp / lark-cli 覆盖的这些域：

- 邮件（mail）
- 审批（approval）
- 考勤（attendance）
- 招聘（hire）
- HR（corehr）
- 会议录制 / 纪要（vc / minutes）
- 智能门禁（acs）
- 翻译（translation）
- OCR（opticalCharRecognition）
- 语音转文字（speechToText）
- 百科（baike）
- 应用市场（application）
- 等

如果你需要操作这些域，本仓不是合适选项 —— 用官方 lark-openapi-mcp（开 `preset.full` 或具体 enable 这些工具）或 lark-cli。

## 三、vs `@larksuite/cli`（CLI 形态）

`lark-cli` 是 Go 写的 CLI，通过 `npx skills add larksuite/cli -y -g` 提供 Claude Code skills。形态不同：

- 它是 CLI binary + Claude Code skill bridge
- 本仓是 MCP server，原生跑 Claude Code / Codex / Cursor / VS Code / Windsurf 等任何 MCP 兼容客户端

实质工程能力差异：

| 维度 | 本仓 | lark-cli |
|------|------|----------|
| MCP 协议原生 | ✓ | ✗ —— 通过 npx skills 桥接 |
| AI Agent 设计 | 9 MCP prompts + 85 工具 schema | 24 structured skills + 200+ commands |
| 三层架构 | 不显式（但 `manage_*` 是 shortcut 层） | 显式三层：Shortcut(`+create`) → API command → Raw API（2500+ endpoint 直通） |
| Output format | MCP 协议固定 JSON | json / pretty / table / ndjson / csv 多格式 |
| Pagination 控制 | 工具自行管 | `--page-all` / `--page-limit` / `--page-delay` 标准化 |
| Identity 切换 | `via_profile` + UAT-first/bot fallback | `--as user` / `--as bot` 命令行级 |
| 凭证存储 | `~/.feishu-user-plugin/credentials.json`（mode 0600） | OS-native keychain |
| Dry-run preview | 部分（如 migrate 子命令） | shortcut 全支持 |
| 国际版（lark.com） | 部分（WS 不支持） | 全支持 |

lark-cli 在工程成熟度、覆盖广度、AI agent 调试体验上都更强。本仓的优势仅在三处：

1. **用户身份发消息**（架构性独家）
2. **MCP 协议原生**（不需要 shell out 到 CLI）
3. **多 MCP 客户端开箱即用**（Codex / Cursor / Windsurf / VS Code / OpenClaw / Claude Desktop 等）

## 选哪个

| 你的场景 | 推荐 |
|---------|------|
| 以用户身份发消息但**不想 / 不能创建自建应用**（个人开发者 / 没管理员权限） | **本仓**（cookie 路径零应用门槛） |
| 以用户身份发消息且**已有飞书自建应用 + 管理员批了 OAuth scope** | `lark-cli` 或 `lark-openapi-mcp`（OAuth UAT 路径长期稳定） |
| 主用 Codex / Cursor / Windsurf / VS Code 等 MCP 客户端 + 不需要 mail/approval/hr 等域 | **本仓**（lark-cli 是 CLI 形态需要 shell out；lark-openapi-mcp 9 个月没更新） |
| 主用 Claude Code 且 bot 能力为主 + 重工程成熟度 | `lark-cli` |
| 用 MCP 客户端但需要 mail / approval / hr / 会议纪要等本仓没有的域 | `lark-openapi-mcp`（接受 Beta + 部分 endpoint 没测过的风险），或等本仓后续扩展（短期内不会） |
| 重国际版 lark.com 实时事件 | `lark-cli` 或 `lark-openapi-mcp`（本仓 WS 仅 feishu.cn） |
| 不用 AI、纯脚本 / cron | `lark-cli` 命令行直接调 |
| 多 MCP 客户端共存且需要"事件全机精确投递一次" | **本仓**（v1.3.9+ 机器级 WS SSOT；lark-event 等是 per-process WS） |

## 我们后续不与官方重复

为了不浪费工程精力、聚焦差异化，本仓**明确不再扩展**这些方向（官方已做得好）：

- 邮件 / 审批 / 考勤 / HR / 招聘等"业务系统"域
- 会议纪要（minutes）
- 多 output format 渲染（table / ndjson / csv）
- TUI 安装向导

**继续投入**：

- cookie + protobuf 用户身份路径（独家，且会持续随飞书协议变动维护）
- 文档生态（docx / bitable / wiki / drive）—— 我们的 caveat 文档化 + action-dispatcher 设计相对官方的 1:1 endpoint 更 AI-friendly，价值仍在
- 多 profile auto-switch + UAT-first + ⚠ fallback warning —— 这套"安全默认"是真用户痛点
- 机器级实时事件 SSOT —— 多 MCP 客户端共存时的"事件不重复"保证

详细路线见 [../ROADMAP.md](../ROADMAP.md)。
