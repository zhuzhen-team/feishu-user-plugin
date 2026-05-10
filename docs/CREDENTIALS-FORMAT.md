# 凭证文件格式

> **谁该读**：要手编 `~/.feishu-user-plugin/credentials.json` 的高级用户、加 multi-profile 的开发者、给 schema 加新字段的维护者。  
> **何时读**：手动迁移凭证、debug profile 切换、扩 events / larkHash 等可选字段、做向后兼容设计。

feishu-user-plugin 所有凭证的单一可信源，v1.3.7 引入。

## 路径

```
~/.feishu-user-plugin/credentials.json
```

Mode `0600`（仅 owner 读写）。目录 `~/.feishu-user-plugin/` 创建时 mode `0700`。

## Schema

```json
{
  "version": 1,
  "active": "default",
  "profiles": {
    "default": {
      "LARK_COOKIE": "session=...; sl_session=...",
      "LARK_APP_ID": "cli_xxxxxxxxxxxxxxxx",
      "LARK_APP_SECRET": "yyyyyyyyyyyyyyyy",
      "LARK_USER_ACCESS_TOKEN": "u-xxxxxxxx",
      "LARK_USER_REFRESH_TOKEN": "r-xxxxxxxx",
      "LARK_UAT_EXPIRES": 1735689600
    },
    "alt": {
      "LARK_COOKIE": "...",
      "LARK_APP_ID": "...",
      "LARK_APP_SECRET": "...",
      "LARK_USER_ACCESS_TOKEN": "...",
      "LARK_USER_REFRESH_TOKEN": "...",
      "LARK_UAT_EXPIRES": 1735693200
    }
  },
  "profileHints": {}
}
```

### 字段

| 字段 | 类型 | 用途 |
|------|------|------|
| `version` | integer | Schema 版本。当前 `1` |
| `active` | string | 没有 override 时使用的 profile 名。必须是 `profiles` 的一个 key |
| `profiles` | object | `<profileName> → profileBlock` 映射。每个 profile block 持有 MCP server 从 `process.env` 读的同样的 `LARK_*` keys，加上可选的 `events` 数组 |
| `profileHints` | object | 多 profile auto-switch 缓存。`<resourceKey> → <profileName>` 映射。由 auto-switch 中间件自动填充 |

### Profile block 字段

#### `LARK_*` env 字段

| Key | 用途 | 备注 |
|-----|------|------|
| `LARK_COOKIE` | 用户身份发消息 | 完整 cookie 字符串含 HttpOnly cookies（`session`、`sl_session`） |
| `LARK_APP_ID` | Official API + UAT 刷新 | App 凭证 |
| `LARK_APP_SECRET` | Official API + UAT 刷新 | App 凭证 |
| `LARK_USER_ACCESS_TOKEN` | P2P 读取 + UAT-first 写入 | OAuth access token |
| `LARK_USER_REFRESH_TOKEN` | UAT 自动刷新 | OAuth refresh token |
| `LARK_UAT_EXPIRES` | UAT 生命周期 | Unix epoch（秒）。可选 —— 没有时从 token 解码 |

#### `events` 数组（可选，v1.3.9）

```json
"events": ["im.message.receive_v1", "approval.instance.created_v4"]
```

本 profile WebSocket 客户端订阅的飞书实时事件类型列表。

- **默认**（缺失或空时）：`["im.message.receive_v1"]`
- 由 `src/auth/credentials.js` 中的 `getProfileEvents(name)` / `setProfileEvents(name, list)` 管理
- Owner MCP 进程在 WS 启动和 `_maybeReconfigure()` 时读这个列表，决定是否重启 WebSocket client
- 支持的事件类型是飞书 WS SDK 暴露的那些。加不支持的类型对 SDK 是 no-op，但浪费一个订阅槽位

例 —— 给 default profile 加审批事件：

```bash
node -e '
const c = require("./src/auth/credentials");
c.setProfileEvents("default", ["im.message.receive_v1", "approval.instance.created_v4"]);
console.log(c.getProfileEvents("default"));
'
```

编辑后，要么重启 MCP server，要么调 `manage_ws_status(action=reconfig)` 应用。

#### `larkHash`（可选，v1.3.11）

```json
"larkHash": "cdf3423ce6e643cdf21af46f1f263347"
```

来自 `~/Library/Containers/com.bytedance.macos.feishu/Data/Library/Application Support/LarkShell/sdk_storage/<hash>/` 的 32 字符 hex Lark Desktop 账号 hash。设置该字段后，MCP owner heartbeat（15 秒）watch 对应 `cookie_store.db` 的 mtime，用户在 Lark Desktop 切到该账号时自动 flip `credentials.json::active` 到这个 profile。v1.3.11 仅 macOS。

- **默认**（缺失时）：本 profile 无 auto-switch wiring —— 只能手动调 `switch_profile` MCP 工具
- 由 `src/auth/credentials.js` 中的 `getProfileLarkHash(name)` / `setProfileLarkHash(name, hash)` / `findProfileByHash(hash)` 管理
- 通过 `setup`（`fresh` / `update` 时自动检测）或 `setup --bind-hash <hash> --profile <name>` 显式绑定
- Cookie 仍按 profile 来自 `LARK_COOKIE` —— Lark 加密的 `cookie_store.db` 永不读、永不解密

例 —— 把两个 profile 绑定到两个 Lark Desktop 账号：

```bash
node -e '
const c = require("./src/auth/credentials");
c.setProfileLarkHash("default", "cdf3423ce6e643cdf21af46f1f263347");
c.setProfileLarkHash("work",    "abaf65b9880cf7e612abb5a54c512a51");
console.log(c.findProfileByHash("cdf3423ce6e643cdf21af46f1f263347"));  // → "default"
'
```

绑定后 MCP owner heartbeat 接管：在 Lark Desktop 切活跃账号 ~15 秒内 flip `credentials.json::active`。跨进程同步（v1.3.9 §A.2）随后把新的 active 传播到所有 MCP 进程。

## 不变量

1. **原子写入**。每次写都通过 `tmp file + rename`，防止并发访问下的部分读（多个 MCP 进程、Claude Code 同时读 config、UAT 刷新锁持有者）
2. **唯一活跃 profile**。任何时候 `profiles.*` 有且仅有一个活跃，由 `active` 命名。`switch_profile` 是唯一切换方式
3. **0600 权限**。每次写都强制执行（`fs.chmodSync` after rename）
4. **Schema 版本化**。未来 schema 变更 bump `version`。读取方必须检查并拒绝加载未知主版本

## 向后兼容

MCP server 按以下顺序读凭证：

1. `~/.feishu-user-plugin/credentials.json` 存在 → 用活跃 profile 的 env block
2. 否则：fallback 到 `process.env.LARK_*`（默认 profile）和 `process.env.LARK_PROFILES_JSON`（命名 profile）。这是 v1.3.6 行为，对未迁移的用户保持不变

`persistToConfig({ ... })`（cookie 心跳和 UAT 刷新用）写入：

- `credentials.json` 存在时（活跃 profile 的 keys 原子更新）
- 否则写到 discovered MCP config（`~/.claude.json` 等）（v1.3.6 行为）

## 迁移

```bash
npx feishu-user-plugin migrate              # dry-run；打印将写入什么
npx feishu-user-plugin migrate --confirm    # 真写 credentials.json
```

迁移器：

1. 调 `findMcpConfig()` 定位现有 harness config
2. 读 env block
3. 解析 `LARK_PROFILES_JSON`（若设置）—— 注册每个命名 profile
4. 用 `active="default"` + 所有发现的 profile 构建 credentials.json
5. 原子写入 `~/.feishu-user-plugin/credentials.json` 带 `0600`

迁移后 harness config 不动。MCP server 现在优先 `credentials.json`；如果 later 删除，harness env block 仍作为 fallback。想完全从 harness config 剥离凭证的用户可以手动 —— v1.3.7 没有自动 rewrite 步骤，保留迁移可逆。

## 为什么存在

v1.3.7 之前每个 harness（Claude Code、Codex）在自己 config 里复制凭证（`~/.claude.json` mcpServers env block、`~/.codex/config.toml` mcp_servers.env）。Cookie 心跳和 UAT 刷新会自动持久化到 `findMcpConfig()` 第一个发现的 config。另一个 harness 的副本在下次 OAuth 重跑前一直 stale。

合并到单一文件让 rotation-on-refresh 模型在 harness 间一致：每个 MCP 进程从同一个文件读，每次 refresh 写回同一个文件。
