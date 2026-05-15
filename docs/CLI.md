# CLI 工具模式

`feishu-user-plugin` 既是 MCP server 也是 CLI 工具。CLI 模式让你直接从 shell / cron / 脚本调用任何工具，不需要起 MCP 客户端。

> v1.3.12+

## 基本用法

```bash
# 列所有 85 工具
npx feishu-user-plugin tool list

# 看某个工具的 schema + description
npx feishu-user-plugin tool help send_as_user

# 调用工具：name + JSON 参数
npx feishu-user-plugin tool get_login_status '{}'
npx feishu-user-plugin tool search_messages '{"query":"周报","page_size":5}'
npx feishu-user-plugin tool send_to_user '{"user_name":"张三","text":"hello"}'
```

## 跟 MCP 路径的关系

CLI tool 模式复用 `src/server.js` 的 `HANDLERS` map —— 跟 MCP 客户端调用走的是同一份代码、同一份 ctx 装配。`tool <name>` 等价于在 Claude Code 里通过 MCP 调 `name`。区别仅在传输层：

| 传输 | 用法 | 输入 | 输出 |
|------|------|------|------|
| MCP stdio | `npx feishu-user-plugin` (default) | JSON-RPC over stdio | MCP `content[0].text` |
| CLI | `npx feishu-user-plugin tool <name> '<args>'` | 命令行 JSON 字符串 | stdout 文本（多半是 JSON） |

凭证读取顺序也一致：
1. `~/.feishu-user-plugin/credentials.json` 的 active profile（canonical）
2. process.env 里的 `LARK_*`（legacy）
3. 都没有 → 工具调用时报错并指向 `npx feishu-user-plugin setup`

CLI 模式启动时**不会**spawn WS event subscription（节省冷启时间），所以 `get_new_events` / `manage_ws_status` 在 CLI 一次性调用里看不到事件。要看实时事件请用 MCP server 模式。

## 退出码

- `0` —— 成功，stdout 是工具响应
- `1` —— 工具运行抛错（响应 isError 或 handler throw），错误信息在 stderr
- `2` —— 用法错误（无效 tool 名、JSON 参数解析失败、无 subcommand）

## 调试 tips

把响应交给 `jq`：

```bash
npx feishu-user-plugin tool list_chats '{"pageSize":10}' | jq '.data.items[] | {name, chat_id}'
```

调试 schema 错误用 `tool help`：

```bash
npx feishu-user-plugin tool help create_doc | head -30
```

干跑测试（看 schema 没真调）：

```bash
npx feishu-user-plugin tool help search_messages
```

## 适用场景

- **cron / 计划任务**：定时拉飞书数据或推消息
  ```bash
  0 9 * * 1 npx feishu-user-plugin tool send_to_user '{"user_name":"team","text":"周一晨会 10 点"}'
  ```
- **shell 脚本编排**：把飞书操作嵌进 shell pipeline
- **CI / dev 测试**：手工 verify 单个工具行为不用起 Claude Code
- **演示 / 教学**：跟非 AI 用户演示一次工具效果
- **debug**：MCP 协议出问题时绕过 stdio 直接调 handler

## 已知限制

- **实时事件不可用**：CLI 一次性进程，WS subscription 不起。`get_new_events` / `manage_ws_status` 走 CLI 会看到空 buffer 或 "WS not started"
- **profile-router 跨 profile retry 不触发**：CLI 路径不走 `withProfileRouting`，所以 91403 / 1254xxx 错码不会自动 fall back 到其他 profile。需要时显式传 `via_profile: <name>` 或 `via_profile: auto`
- **不读 MCP harness env**：如果你的凭证在 `~/.claude.json` mcpServers env 里（legacy 路径），CLI 不会自动 inherit。要么跑 `npx feishu-user-plugin migrate --confirm` 把凭证搬到 `credentials.json`，要么把 `LARK_*` 在 shell 里 export
