# 鉴权与安装

> **谁该读**：第一次安装本插件的开发者、要诊断鉴权故障的用户、需要扩 OAuth scope 的维护者。  
> **何时读**：安装时、Cookie 过期、UAT refresh 失败、新加 OAuth scope、配多 profile。

覆盖三层鉴权 / 安装流程 / Cookie Setup / OAuth Scopes。终端用户简化安装见 [README](https://github.com/EthanQC/feishu-user-plugin#readme)。

## 必需环境变量

5 个 LARK_* env 都要配齐，缺其一对应工具不可用：

| 变量 | 用途 |
|------|------|
| `LARK_COOKIE` | 用户身份发消息 |
| `LARK_APP_ID` | Official API 访问 |
| `LARK_APP_SECRET` | Official API 访问 |
| `LARK_USER_ACCESS_TOKEN` | P2P 读取 |
| `LARK_USER_REFRESH_TOKEN` | UAT 自动刷新 |

没配 UAT 的话，`read_p2p_messages` 与 `list_user_chats` 不可用。

## Auth & Session

- **LARK_COOKIE**：用户身份工具的前提。session 由 4 小时心跳自动刷新并持久化到凭证库
- **LARK_APP_ID + LARK_APP_SECRET**：Official API 工具的前提
- **LARK_USER_ACCESS_TOKEN + LARK_USER_REFRESH_TOKEN**：P2P 读取的前提。过期时（错误码 99991668 / 99991663 / 99991677）自动刷新。Token 在刷新时自动写回凭证库
- Cookie 有效期：sl_session 12 小时，4 小时心跳自动刷新
- UAT 有效期：2 小时，通过 refresh_token 自动刷新
- Refresh token 有效期：7 天。用 `keepalive` cron 防过期
- `~/.feishu-user-plugin/ws-owner.lock`：拥有 WS 连接的那个 MCP 进程持有的锁文件（O_CREAT|O_EXCL，30 秒 stale）
- `~/.feishu-user-plugin/events.jsonl`：WS owner 写入的 append-only 事件日志；10 MB 软 / 20 MB 硬上限触发轮转到 `events.jsonl.old`
- `~/.feishu-user-plugin/events.cursor.json`：所有 MCP 进程共享的 drain cursor —— 推进它意味着事件被本机所有 harness 消费过
- **Lark Desktop 多账号 auto-switch（v1.3.11）**：当 `credentials.json::profiles[*].larkHash` 绑定后，owner heartbeat（15 秒）watch `~/Library/.../sdk_storage/<hash>/cookie_store.db` mtime；切换 Lark Desktop 活跃账号自动 flip `credentials.json::active` 到对应 profile。仅 macOS。绑定通过 `setup --bind-hash <hash>` 或 `setup` 时自动检测（单账号静默绑定；多账号交互模式 prompt / 非交互模式选最近活跃）。Cookie 仍按 profile 留在 `LARK_COOKIE` —— 加密的 `cookie_store.db` 永远不读

## 凭证库（v1.3.7+）

单一可信源 `~/.feishu-user-plugin/credentials.json`（mode 0600）。Schema 见 [docs/CREDENTIALS-FORMAT.md](https://github.com/EthanQC/feishu-user-plugin/blob/main/docs/CREDENTIALS-FORMAT.md)。MCP server 在该文件存在时优先读它；cookie 心跳和 UAT 刷新原子写回。多个 harness（Claude Code、Codex）共享一份 —— 不再有"Codex 仍持旧 UAT"漂移。

可选迁移：

```bash
npx feishu-user-plugin migrate              # dry-run（默认）—— 打印将写入什么
npx feishu-user-plugin migrate --confirm    # 真写 credentials.json
```

迁移后 harness env 块作为向后兼容 fallback 保留。删 `~/.feishu-user-plugin/credentials.json` 即回退到 legacy 行为。

向后兼容：v1.3.6 用户没 credentials.json 行为零变化。该文件只在存在时被优先选。MCP server stderr 启动行 `Auth:` 现在显示来源（`credentials.json profile=default` vs `env vars (legacy)`），一眼能看出当前走哪条路径。

## 安装

### 配置位置

凭证存在 `~/.claude.json` 顶层 `mcpServers`（全局 —— 在所有目录可用）。

**不要把凭证放进项目级配置**（`projects[*].mcpServers` 或 `.mcp.json`）—— 会引发 scope 问题。

### 非交互安装（给 Claude Code agent 用）

```bash
npx feishu-user-plugin setup --app-id <APP_ID> --app-secret <APP_SECRET>
```

写到 `~/.claude.json` 顶层 `mcpServers`，无任何交互式提示。也支持 `--cookie` 标志。

### 交互式安装

```bash
npx feishu-user-plugin setup     # 交互式安装向导
npx feishu-user-plugin oauth     # 拿 OAuth UAT tokens
npx feishu-user-plugin status    # 检查鉴权状态
npx feishu-user-plugin keepalive # 刷新 cookie + UAT（cron 用）
```

### Token 自动续期 cron（可选）

让 token 在 Claude Code 关闭时也保持活跃：

```bash
crontab -e
# 加：0 */4 * * * npx feishu-user-plugin keepalive >> /tmp/feishu-keepalive.log 2>&1
```

## Playwright 自动获取 Cookie

前提：Playwright MCP 已装（`npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/mcp-server-playwright` 然后重启）。

流程（三个易踩点必须避开）：

1. **先清 cookies**。Playwright MCP 用 Edge 持久化 profile，可能缓存了别的账号登录。先 `browser_run_code: await context.clearCookies();` 再 `browser_navigate: https://www.feishu.cn/messenger/`
2. **等扫码**。`browser_take_screenshot` 给用户看二维码；告诉用户用飞书 mobile 扫（提醒确认是哪个账号）。轮询 `browser_snapshot` 直到 URL 离开 `/accounts/`
3. **两步法提取 cookie**。`browser_run_code` 输出含 markdown 前缀 + console 日志会污染 cookie 字符串。先 `page.evaluate(s => { window.__COOKIE__ = s; }, str)` 暂存，再 `browser_evaluate: window.__COOKIE__` 拿干净值
4. **写前验证**。Cookie 必须纯 ASCII（无中文、无 `###`），同时含 `session=` 和 `sl_session=`，长度 500–5000 字符。> 10000 是被污染了 —— **STOP，不要写**
5. **写到 config**。用 `persistToConfig` 或更新 `~/.claude.json` → `mcpServers.feishu-user-plugin.env.LARK_COOKIE`
6. **OAuth 拿 UAT**。`npx feishu-user-plugin oauth`（浏览器 consent 流程，自动保存 token）
7. **`browser_close` + 让用户重启**。一次重启即可

## OAuth Scopes（重跑 `npx feishu-user-plugin oauth` 时）

v1.3.4+ 工具需要的额外 scope：

| 功能 | 启用的 scope（应用 + OAuth） |
|------|------------------------------|
| OKR 读 | `okr:okr:readonly`、`okr:period:read` |
| OKR 进度写（v1.3.7：create / delete_okr_progress_record） | `okr:okr.content:write` |
| 日历读 | `calendar:calendar:readonly`、`calendar:calendar.event:read` |
| 日历写（v1.3.7：create / update / delete / respond_calendar_event） | `calendar:calendar.event:write` |
| Tasks v2（v1.3.7：list / get / create / update / complete / delete_task、manage_task_members） | `task:task` |
| Docx / Bitable / Drive 媒体上传（`uploadMedia`、`upload_drive_file`、`upload_bitable_attachment`、`manage_doc_block(action=create, image_path|file_path|...)`） | `drive:drive`、`drive:file:upload`、`docs:document.media:upload`、`sheets:spreadsheet`（仅 sheet 上传需要） |
| Wiki 挂载（`move_docs_to_wiki`） | `wiki:wiki`（edit scope，readonly 不够） |

工具返回 `access_denied` 或错误码 `99991672`（scope 未授权）—— scope 在应用或 UAT 上缺失。重跑 `npx feishu-user-plugin oauth` 让 UAT 拿到最新 scope 列表（在 `src/oauth.js` 定义）。
