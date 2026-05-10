# 故障排查

> **谁该读**：所有遇到工具失败 / 看到错误码 / 需要诊断的用户与开发者。  
> **何时读**：工具调用失败、`get_login_status` 报警、出现 invalid_grant / 91403 / 1254301 等错误码。

覆盖常见错误与解决方法。错误信息一般都含飞书原始 code，可在本文搜索定位。

## Official API 持续 401 / "token invalid"

`LARK_APP_ID` 错或失效（最常见：agent 安装时猜了或拷错了 APP_ID）。`get_login_status` 报 `App credentials: INVALID — app_id=<x> rejected by Feishu`；MCP stderr 打 `LARK_APP_ID=<x> was REJECTED`。

**修**：重跑 `team-skills/plugins/feishu-user-plugin/README.md` 里的标准安装提示（正确的 APP_ID + SECRET），重启。

## MCP 工具不可用

1. 配置必须在 `~/.claude.json` **顶层** `mcpServers`，不能在 `projects[*]` 下。Codex 是 `~/.codex/config.toml` 里的 `[mcp_servers.feishu-user-plugin]`
2. 改完配置要重启；首次调用偶尔短暂报 "No such tool"（工具还在注册）—— 重试一次

## Cookie 鉴权失败

- 浏览器 console `document.cookie` 拿不到 HttpOnly cookies（`session`、`sl_session`）。用 DevTools Network → 第一个请求 → Request Headers → Cookie。或者用 Playwright 两步提取（见 [AUTH-SETUP.md](./AUTH-SETUP.md)）
- Playwright 登错账号：navigate 之前**永远** `context.clearCookies()`

## `read_messages` 报错

错误信息含飞书的具体码 + 描述。外部群自动 fallback 到 UAT。Chat 名解析顺序：bot 群列表 → `im.chat.search` → cookie `search_contacts`。三种都失败的话，直接传 `oc_xxx` 或 numeric ID。

## UAT refresh 失败 `invalid_grant`

Refresh token 过期或被撤销 —— 自动刷新无法恢复。

**修**：`npx feishu-user-plugin oauth`，然后重启 Claude Code / Codex 让运行中的 MCP 进程重新加载新 token。

v1.3.5+ 已硬化"6 个 MCP 进程同时刷 UAT 把 refresh_token 烧光"这种 case：

- 跨进程文件锁 `~/.claude/feishu-uat-refresh.lock`（`O_CREAT|O_EXCL`，30 秒 stale）
- 锁持有者在 critical section 里重读持久化 config，如果 peer 已经 rotate 过 token 就采用新的
- `get_login_status` 实跑一次 UAT health check（`listChatsAsUser({pageSize:1})`）—— 不再有"配置上有但实际 401"的隐蔽 case

## 多个 / 重复 MCP server 进程

Codex + Claude Code 都可能不清理旧进程就 respawn server；6 个并发 MCP 进程很常见。v1.3.5 用文件锁削减伤害，但 stale 进程仍占内存。

**手动清理**：`pkill -f 'feishu-user-plugin/src/index.js'`。

另：team-skills plugin **绝不能**带 `.mcp.json` —— `~/.claude.json` 与 team-skills 同时注册同一个 MCP 会出重复，删掉 team-skills plugin 目录里的 `.mcp.json`。

v1.3.9：事件已经是机器级 SSOT，每条事件全机精确投递一次。老的 per-process 重复问题已修复。

## `create_*` 工具报 "UAT failed, created as BOT"

UAT 失败（过期 / scope 缺 / race），插件 fallback 到 bot。资源现在 owned by 共享 bot，全租户可读。

**修**：`npx feishu-user-plugin oauth`，重启，删掉 bot owned 的副本，重建。

## OAuth CLI 报 "Missing LARK_APP_ID"

`oauth.js` 从 `~/.claude.json` MCP config 读，不读 `.env`。先跑 `npx feishu-user-plugin setup`。

## `list_user_chats` 不返回 P2P chat

预期行为 —— 飞书 API 只返回群聊。P2P 流程：`search_contacts` → `create_p2p_chat` → `read_p2p_messages`。

## 实时事件返回空 / "Realtime events are not available"

- **APP_ID / SECRET 没配**：`get_login_status` 会显示。修：重跑 setup
- **飞书 WS 握手失败**：检查 server stderr 是否有 `WS start failed`：
  - Lark 国际版（lark.com）—— 飞书的 WSClient 不支持。无解；用轮询工具（`read_messages`）替代
  - 网络限制 —— 公司代理挡 outbound WSS
- **Bot 不在群里**：`im.message.receive_v1` 只对 bot 在的群触发。把 bot 加进群
- **多个 MCP 进程**：v1.3.9：事件机器级 SSOT，每条事件全机精确投递一次。老的 per-process 重复问题已修复
