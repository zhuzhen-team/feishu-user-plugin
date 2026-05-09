# feishu-user-plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/Tools-84-orange.svg)](#工具索引84-个)
[![npm](https://img.shields.io/npm/v/feishu-user-plugin.svg)](https://www.npmjs.com/package/feishu-user-plugin)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**中文** · [English](README.en.md) · [Docs](https://ethanqc.github.io/feishu-user-plugin/) · [CHANGELOG](CHANGELOG.md) · [npm](https://www.npmjs.com/package/feishu-user-plugin)

飞书 / Lark MCP 服务器，覆盖 IM、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、实时事件。**84 tools · 3 auth layers · 9 MCP prompts · MIT licensed · Node ≥18**。

兼容 Claude Code、Codex、Cursor、Windsurf、VS Code、Claude Desktop、OpenClaw 等 MCP 客户端。

与其他飞书 MCP 的区别：基于 cookie + protobuf 协议路径，支持以**用户本人身份**发消息——飞书官方开放 API 没有 `send_as_user` 权限点，机器人 token 发出的消息一律标 `sender_type: "app"`。

## 三层鉴权

| 鉴权层 | 凭证 | 覆盖能力 | 工具数 |
|---|---|---|---|
| 用户身份（cookie + protobuf） | `LARK_COOKIE` | 以用户身份发文本 / 图片 / 文件 / 富文本 / @ / 批量 | 8 |
| 官方 API（机器人） | `LARK_APP_ID` + `LARK_APP_SECRET` | 群消息读写、文档、多维表格、知识库、云空间、日历、任务 v2、OKR、联系人、实时事件 WS | 70+ |
| 用户 OAuth UAT | `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` | P2P 私聊读取、用户 chat 列表；写入文档 / Bitable / 日历 资源时以用户为 owner | 2 显式 + 全工具 UAT-first |

三层独立 —— 配置任意一层，对应工具可用。

## 安装

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
npx feishu-user-plugin oauth         # 拿用户 OAuth UAT
# 重启 Claude Code / Codex
```

cookie 获取：跟 Claude Code 说一句"帮我设置飞书 cookie"会自动经 Playwright 扫码登录抓取；手动方式在 feishu.cn DevTools Network 标签从请求头 Cookie 整行复制（不要用 `document.cookie` 或 Application > Cookies 标签—— HttpOnly 的 `session` / `sl_session` 拿不到）。

没有 APP_ID / SECRET 见下面 [创建飞书应用](#创建飞书应用)。

## 用法

```
你：帮我以我身份给王小明发：今天的代码 review 我看完了，有 3 个 nit
Claude：[调用 send_to_user]  Sent
```

```
你：总结"工程组"群今天 9 点之后的讨论，发个日报到 #日报频道
Claude：[read_messages → 总结 → send_to_group]  Sent
```

## 创建飞书应用

`LARK_APP_ID` / `LARK_APP_SECRET` 是用 Official API（70+ 工具）的前置条件：

1. [飞书开放平台](https://open.feishu.cn/app) 登录 → 创建**自建应用**（不能选商店应用 / 第三方应用，否则 P2P 读取会被锁）
2. 添加应用能力 → 启用机器人
3. 权限管理 → 添加 scope：
   - 消息：`im:message`、`im:message:readonly`、`im:chat:readonly`
   - 文档：`docx:document`、`bitable:record`、`wiki:wiki:readonly`、`drive:drive:readonly`
   - 联系人：`contact:user.base:readonly`
   - 按需：`okr:okr:readonly`、`calendar:calendar:readonly`、`task:task`、`drive:drive`、`docs:document.media:upload`、`wiki:wiki` 等
4. 凭证与基础信息 → 复制 App ID（`cli_xxx`）+ App Secret
5. 创建版本 → 提交审核 → 管理员审批
6. 把 bot 加到要读消息的群里

## 工具索引（84 个）

完整工具列表 + 参数 + 跨域注意事项见 [CLAUDE.md](CLAUDE.md)。

### 用户身份 —— 消息（cookie protobuf，8 个）

| 工具 | 说明 |
|---|---|
| `send_to_user` | 按名搜用户 + 发文本，一步完成 |
| `send_to_group` | 按名搜群 + 发文本，一步完成 |
| `send_as_user` | 按 chat ID 发文本，支持回复线程（`root_id` / `parent_id`） |
| `send_image_as_user` | 以用户身份发图（v1.3.9） |
| `send_file_as_user` | 以用户身份发文件（需先 `upload_file`） |
| `send_post_as_user` | 富文本：标题 + 段落 + @ + 超链 |
| `send_card_as_user` | 飞书交互卡片（机器人通道；cookie 通道服务端关闭，仅 bot 路径可用） |
| `batch_send` | 一次发多条到不同 chat（text / image / file / post） |

### 用户身份 —— 联系人 / 信息（cookie，5 个）

| 工具 | 说明 |
|---|---|
| `search_contacts` | 搜用户 / bot / 群 |
| `create_p2p_chat` | 创建或获取 P2P chat |
| `get_chat_info` | 群详情（接受 `oc_xxx` 或 numeric） |
| `get_user_info` | 用户名 / 头像查询 |
| `get_login_status` | 三层鉴权健康检查（实际跑一次 UAT 调用，不只看配置） |

### 用户 OAuth UAT —— P2P 读取（2 个）

| 工具 | 说明 |
|---|---|
| `read_p2p_messages` | 读私聊历史（外部群自动 fallback） |
| `list_user_chats` | 用户加入的所有群（仅群，不含 P2P；P2P 用 `search_contacts` → `create_p2p_chat`） |

### 官方 API —— IM（15 个）

| 工具 | 说明 |
|---|---|
| `list_chats` | 列 bot 加入的所有 chat |
| `read_messages` | 读群消息（接受 chat 名 / `oc_xxx` / numeric；外部群自动 UAT fallback；merge_forward 自动展开） |
| `send_message_as_bot` | 机器人发消息 |
| `reply_message` | 机器人回复 |
| `forward_message` | 转发到其他 chat（自动识别 receive_id_type） |
| `delete_message` | 撤回 / 删除 bot 消息 |
| `update_message` | 编辑已发消息（仅支持 text / interactive） |
| `add_reaction` / `delete_reaction` | 表情回应 |
| `pin_message` | 置顶 |
| `create_group` / `update_group` | 建群 / 改群 |
| `list_members` / `manage_members` | 群成员 list / add / remove（注意 `member_id_type` 与 ID 类型匹配） |
| `download_message_resource` | 下载消息附件（image / file，> 2 MiB 必须 `save_path`） |

### 官方 API —— 文档（7 个）

| 工具 | 说明 |
|---|---|
| `search_docs` | 关键词搜文档 |
| `read_doc` | 结构化 JSON |
| `read_doc_markdown` | v1.3.9 直接返回 markdown，~60% token 节省（适合 RAG / 总结） |
| `get_doc_blocks` | 块树 |
| `create_doc` | 创建文档（可选 `wiki_space_id` 直接落知识库） |
| `manage_doc_block` | 块 create / update / delete（image_path / file_path / image_token / file_token 快捷） |
| `download_doc_image` | 下载文档内嵌图片 |

### 官方 API —— 多维表格 Bitable（6 个，v1.3.7 整合）

| 工具 | actions | 说明 |
|---|---|---|
| `manage_bitable_app` | create / copy / get_meta | 应用级（创建可指定 `wiki_space_id` 直接落 Wiki） |
| `manage_bitable_table` | list / create / update / delete | 数据表 CRUD |
| `manage_bitable_field` | list / create / update / delete | 字段（update 必须传 `type` 即使只改名） |
| `manage_bitable_view` | list / create / delete | 视图（grid / kanban / gallery / form / gantt / calendar） |
| `manage_bitable_record` | search / get / create / update / delete | 记录 CRUD（数组：单条或最多 500） |
| `upload_bitable_attachment` | — | 上传附件，返回 `file_token` |

### 官方 API —— 知识库 Wiki（9 个）

| 工具 | 说明 |
|---|---|
| `list_wiki_spaces` | 列空间（UAT-first） |
| `search_wiki` | 搜知识库 |
| `list_wiki_nodes` | 列节点 |
| `get_wiki_node` | 节点 → obj_token 解析（接受 wiki node token 或 obj_token） |
| `create_wiki_node` | 创建节点（doc / sheet / bitable / mindnote / file / docx / slides） |
| `update_wiki_node` | 改名（内容编辑用 docx / bitable 工具） |
| `move_wiki_node` | 移动 |
| `copy_wiki_node` | 深拷贝 |
| `delete_wiki_node` | 删除 wiki 节点指针（底层 drive 资源用 `manage_drive_file(action=delete)` 删） |

### 官方 API —— 云空间 Drive（5 个）

| 工具 | 说明 |
|---|---|
| `list_files` | 列文件夹内文件 |
| `create_folder` | 建文件夹 |
| `manage_drive_file` | copy / move / delete（必须传 `type`） |
| `upload_image` / `upload_file` | 上传图片 / 文件，返回 key |
| `upload_drive_file` | 上传到 Drive 文件夹（可选 `wiki_space_id` 直接挂 Wiki 节点） |

### 官方 API —— OKR（6 个）

| 工具 | 说明 |
|---|---|
| `list_user_okrs` | 列指定用户的 OKR（必须传 user_id） |
| `get_okrs` | 批量取详情（objectives + key results + progress + alignments） |
| `list_okr_periods` | 列周期（季度 / 年度） |
| `create_okr_progress_record` | 添加进展记录（v1.3.7，需 `okr:okr.content:write`） |
| `list_okr_progress_records` | 列进展记录（从 `get_okrs` 提取 triples） |
| `delete_okr_progress_record` | 删进展记录 |

### 官方 API —— 日历（8 个，写入 v1.3.7）

| 工具 | 说明 |
|---|---|
| `list_calendars` | 列日历（primary + 共享 + 订阅） |
| `list_calendar_events` | 列事件（指定时间窗） |
| `get_calendar_event` | 事件详情（参与人 / 地点 / 会议链接 / 附件） |
| `create_calendar_event` | 建事件（需 `calendar:calendar.event:write`） |
| `update_calendar_event` | 改事件 |
| `delete_calendar_event` | 删事件（可选 `meeting_chat_id` 同时解散关联会议群） |
| `respond_calendar_event` | RSVP（accept / decline / tentative） |
| `get_freebusy` | 多人 freebusy 查询 |

### 官方 API —— 任务 v2（7 个，v1.3.7 新域）

标识符是 `task_guid`（不是 v1 的 numeric `task_id`），需 `task:task` scope。

| 工具 | 说明 |
|---|---|
| `list_tasks` | 列当前用户任务 |
| `get_task` | 详情 |
| `create_task` | 建任务（summary 必填） |
| `update_task` | 改任务（必传 `update_fields=[...]`，飞书只 patch 列出字段） |
| `complete_task` | 完成 / 取消完成 |
| `delete_task` | 删 |
| `manage_task_members` | add / remove 成员（assignee / follower） |

### 插件层 —— 诊断与多账号（4 个）

| 工具 | 说明 |
|---|---|
| `get_login_status` | 三层鉴权健康检查 |
| `list_profiles` | 列可用 profile（默认 + LARK_PROFILES_JSON / credentials.json） |
| `switch_profile` | 切 profile（缓存的 client 实例下次调用重建） |
| `manage_profile_hints` | 查 / 改 / 清 自动切换缓存（list / set / clear） |

### 插件层 —— 实时事件（2 个，v1.3.9）

| 工具 | 说明 |
|---|---|
| `get_new_events` | 拉取增量事件（peek=true 不推进 cursor；filter by event_type / chat_id / since_seconds / profile） |
| `manage_ws_status` | info / reconnect / claim / rotate / reconfig（诊断 / 重连 / 抢锁 / 强制 events.jsonl 轮转 / 不重启重新订阅） |

## 9 个 MCP prompts（slash commands）

| Prompt | 说明 |
|---|---|
| `/send` | 以用户身份发消息 |
| `/reply` | 读最近消息然后回 |
| `/digest` | 群 / P2P 最近消息总结 |
| `/search` | 搜联系人 / 群 |
| `/doc` | 搜 / 读 / 建文档 |
| `/table` | 操作多维表格 |
| `/wiki` | 搜知识库 |
| `/drive` | 列云空间 / 建文件夹 |
| `/status` | 检查三层鉴权状态 |

## 客户端配置

环境变量配置一致，配置文件路径和顶层键不同。

**统一 env 块**：

```json
{
  "command": "npx",
  "args": ["-y", "feishu-user-plugin"],
  "env": {
    "LARK_COOKIE": "your-cookie-string",
    "LARK_APP_ID": "cli_xxxxxxxxxxxx",
    "LARK_APP_SECRET": "your-app-secret",
    "LARK_USER_ACCESS_TOKEN": "your-uat",
    "LARK_USER_REFRESH_TOKEN": "your-refresh-token"
  }
}
```

**安放位置**：

| 客户端 | 配置文件 | 顶层键 |
|---|---|---|
| Claude Code | `~/.claude.json`（推荐全局） / `.mcp.json` | `mcpServers.feishu-user-plugin` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) | `mcpServers.feishu` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.feishu-user-plugin]`（TOML） |
| Cursor | `.cursor/mcp.json`（项目级） | `mcpServers.feishu` |
| VS Code (Copilot) | `.vscode/mcp.json` | `servers.feishu`（注意是 `servers`，不是 `mcpServers`） |
| OpenClaw | `~/.openclaw/openclaw.json` | `mcp.servers.feishu-user-plugin` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers.feishu` |

**自动化设置**：

```bash
npx feishu-user-plugin setup                       # 默认写 Claude Code (~/.claude.json)
npx feishu-user-plugin setup --client codex        # Codex (~/.codex/config.toml)
npx feishu-user-plugin setup --client both         # Claude Code + Codex 都写
npx feishu-user-plugin setup --activate            # 激活当前 profile
```

各客户端完整 JSON 模板见 [README.en.md `MCP Client Configuration` 段](README.en.md#mcp-client-configuration)。

## 多账号（v1.3.8 / v1.3.9）

`~/.feishu-user-plugin/credentials.json` 支持多 profile（默认 + 任意附加），单台机器一处配置覆盖多个飞书账号 / 多个企业。

```bash
npx feishu-user-plugin list-profiles
npx feishu-user-plugin switch-profile <name>
npx feishu-user-plugin keepalive --all       # 跨 profile keepalive
```

读路径工具（`read_*` / `list_*` / `get_*` / `search_*` / `download_*`）失败码 91403 / 1254301 / 1254000 / 99991672 / HTTP 403 时自动跨 profile retry。写路径不自动切（避免错号创建资源）。

单调用覆盖：传 `via_profile: "<name>"` 钉到指定 profile，传 `via_profile: "auto"` 给写路径开自动切换。

详见 [CLAUDE.md "Multi-profile auto-switch" 段](CLAUDE.md#multi-profile-auto-switch-v138)。

## 实时事件（v1.3.9 机器级 SSOT）

机器上单进程持有 WS owner 锁（`~/.feishu-user-plugin/ws-owner.lock`，`O_CREAT|O_EXCL`，30s stale），所有 MCP 进程共享 `~/.feishu-user-plugin/events.jsonl`（10 MB 软 / 20 MB 硬限自动轮转），`events.cursor.json` 是全机所有 harness 共享的 drain cursor —— 每条事件全机恰好一次。

```bash
mcp call manage_ws_status --action info        # 谁在持锁、当前订阅、events.jsonl 大小
mcp call manage_ws_status --action claim --force true   # 跨进程抢锁
```

默认订阅 `["im.message.receive_v1"]`。要订阅其他事件（审批 / 日历 / vc / etc），编辑 `credentials.json::profiles[<active>].events`，然后 `manage_ws_status(action=reconfig)` 不重启重新订阅。

仅支持 feishu.cn —— Lark 国际版（lark.com）的 WSClient 当前不支持。

## 工程细节

### Token 生命周期

| 鉴权层 | Token | 有效期 | 续期 |
|---|---|---|---|
| Cookie | `sl_session` | 12h max-age | 4h 心跳自动刷新 |
| App | `tenant_access_token` | 2h | SDK 自动管理 |
| User OAuth | `user_access_token` | ~2h | refresh_token 自动刷新，写回 credentials.json |
| Refresh Token | — | 7 天 | `keepalive` cron 防过期 |

```bash
crontab -e
# 0 */4 * * * npx feishu-user-plugin keepalive >> /tmp/feishu-keepalive.log 2>&1
```

UAT 刷新失败 `invalid_grant` —— refresh token 过期 / 被撤销，重跑 `npx feishu-user-plugin oauth` 然后重启 Claude Code / Codex。

### 凭证存储（v1.3.7+）

单一可信源 `~/.feishu-user-plugin/credentials.json`（mode 0600），多 harness 共享。schema 见 [docs/CREDENTIALS-FORMAT.md](docs/CREDENTIALS-FORMAT.md)。

```bash
npx feishu-user-plugin migrate              # dry-run
npx feishu-user-plugin migrate --confirm    # 真写
```

### 自动 sync hooks

| 阶段 | 触发文件 | 作用 |
|---|---|---|
| pre-commit | `CLAUDE.md` staged | 同步到 `AGENTS.md` + skill 引用 |
| pre-commit | `package.json` / `plugin.json` / `SKILL.md` staged | 三角等价检查（version 必须一致） |
| pre-commit | `src/server.js` / `src/tools/*` staged | 工具个数 + README 84 tools 徽章必须一致 |
| pre-commit | `src/*` staged | smoke test |
| post-merge (main) | 任意 | 自动开 team-skills sync PR |

CI（`.github/workflows/validate.yml`）每个 PR 跑同样的 gate。

## 已知限制

- **Cookie 寿命**：12-24 小时无心跳过期，需重新登录 feishu.cn 拿 cookie
- **协议变化**：cookie + protobuf 层依赖飞书 web 客户端的协议，飞书更新可能失效（机器人能力不受影响）
- **卡片**：cookie 通道发卡片服务端不可用，机器人通道可发
- **Lark 国际版**：实时事件 WS 不支持
- **未实现**：`search_messages`（v1.3.10 计划）、md → wiki 同步（v1.3.10 主线）

完整 ROADMAP 见 [ROADMAP.md](ROADMAP.md)。

## 贡献

Issues / PR 欢迎。提交前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

飞书改协议导致功能挂掉 —— 开 issue 带错误日志即可。

## 隐私 / Privacy

本地运行的 MCP 服务器，凭证留在用户本机，不上报遥测，不与插件作者后台通信。完整文本见 [PRIVACY.md](PRIVACY.md)。

- **收集**：插件本身不收集任何数据；`LARK_COOKIE` / `LARK_APP_ID` / `LARK_APP_SECRET` / `LARK_USER_ACCESS_TOKEN` / `LARK_USER_REFRESH_TOKEN` 全部由用户主动配置，来源于用户自己的飞书 / Lark 账号
- **处理**：仅处理用户通过 MCP 工具调用主动请求的消息 / 文档 / 多维表格 / 知识库 / 云空间 / 日历 / 任务 / OKR / 联系人，不留存、不分析
- **存储**：`~/.feishu-user-plugin/credentials.json`（mode 0600）；可选事件日志 `~/.feishu-user-plugin/events.jsonl`（10 MB / 20 MB 自动轮转）
- **第三方**：仅与用户自己的飞书租户和用户运行的 AI 客户端通信，无 CDN / 分析 / 错误上报
- **保留**：完全用户控制；`rm -rf ~/.feishu-user-plugin && npm uninstall -g feishu-user-plugin` 即清空
- **联系**：[GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues)，安全问题在 issue 标题前加 `[security]`

A locally-run MCP server. Credentials stay on the user's machine; no telemetry, no phone-home. Full text at [PRIVACY.md](PRIVACY.md).

- **Collected**: nothing by the plugin itself; the five `LARK_*` envs are supplied by the user from their own Feishu / Lark account
- **Processed**: only the messages / docs / bitable / wiki / drive / calendar / tasks / OKR / contacts the user explicitly requests via MCP tool calls
- **Stored**: `~/.feishu-user-plugin/credentials.json` (mode 0600); optional event log at `~/.feishu-user-plugin/events.jsonl`
- **Third-party**: only the user's own Feishu tenant and the AI client the user runs (Claude Code / Codex / Cursor / etc.)
- **Retention**: entirely user-controlled; `rm -rf ~/.feishu-user-plugin && npm uninstall -g feishu-user-plugin` removes everything
- **Contact**: [GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues); security disclosures with `[security]` prefix in the title

## License

[MIT](LICENSE)

## 致谢

- [cv-cat/LarkAgentX](https://github.com/cv-cat/LarkAgentX) —— 早期飞书 web 协议研究（Python）
- [cv-cat/OpenFeiShuApis](https://github.com/cv-cat/OpenFeiShuApis) —— 底层 API 研究
- [Model Context Protocol](https://modelcontextprotocol.io) —— MCP 标准 + Anthropic / PulseMCP / GitHub / Stacklok 共维 registry
