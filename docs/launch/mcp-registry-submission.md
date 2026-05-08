# Official MCP Registry 提交（`registry.modelcontextprotocol.io`）

## 背景

`modelcontextprotocol/servers` 已**不接受**第三方提交（README 明确声明只收 reference servers）。官方在 2025-10 启用了新 registry：`registry.modelcontextprotocol.io`，由 Anthropic + PulseMCP + GitHub + Stacklok 共同维护，2025-10-24 进入 v0.1 API freeze（生产稳定）。

下游 registry（Smithery / MCPServers.com / mcp.run / LobeHub 部分）会自动从 official registry 同步，所以一次提交多处可见。

## 前置改动（PR）

需要在 `package.json` 加 `mcpName` 字段。命名空间必须与 GitHub 登录名匹配（registry 用 GitHub OAuth 验证归属）。

```json
{
  "mcpName": "io.github.EthanQC/feishu-user-plugin",
  ...
}
```

把这一行加到 `package.json` 顶部（紧跟 `"name"` 之后），单独一个 PR，merge 到 main。

## 用户操作（~30 min）

1. **安装 mcp-publisher CLI**
   ```bash
   brew install mcp-publisher                    # macOS
   # 或下载二进制：https://github.com/modelcontextprotocol/registry/releases/latest
   ```

2. **在仓库根目录初始化 server.json**（registry 专用，不是这个仓库已有的那个）
   ```bash
   cd ~/feishu-user-plugin
   mcp-publisher init
   ```
   会扫描 `package.json::mcpName`，生成 `server.json` 草稿。

3. **填充 server.json**（参照下方模板替换 / 校验生成的草稿）

   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
     "name": "io.github.EthanQC/feishu-user-plugin",
     "description": "All-in-one Feishu MCP server for Claude Code & Codex — 84 tools across 3 auth layers (cookie / app / OAuth). Send as you, read groups, manage docs / bitable / wiki / drive / calendar / tasks / OKR.",
     "version": "1.3.9",
     "repository": {
       "url": "https://github.com/EthanQC/feishu-user-plugin",
       "source": "github"
     },
     "packages": [
       {
         "registryType": "npm",
         "identifier": "feishu-user-plugin",
         "version": "1.3.9",
         "transport": {
           "type": "stdio"
         },
         "environmentVariables": [
           {
             "name": "LARK_COOKIE",
             "description": "Feishu web session cookie. Required for user-identity messaging tools.",
             "isRequired": false,
             "isSecret": true
           },
           {
             "name": "LARK_APP_ID",
             "description": "Feishu Open Platform self-built app App ID (cli_xxxxxxxxxxxx). Required for Official API tools.",
             "isRequired": false,
             "isSecret": false
           },
           {
             "name": "LARK_APP_SECRET",
             "description": "Feishu Open Platform self-built app App Secret. Required for Official API tools.",
             "isRequired": false,
             "isSecret": true
           },
           {
             "name": "LARK_USER_ACCESS_TOKEN",
             "description": "User OAuth UAT for P2P chat reading. Obtained via `npx feishu-user-plugin oauth`.",
             "isRequired": false,
             "isSecret": true
           },
           {
             "name": "LARK_USER_REFRESH_TOKEN",
             "description": "Refresh token for UAT auto-renewal.",
             "isRequired": false,
             "isSecret": true
           }
         ]
       }
     ]
   }
   ```

   **重要**：`name` 必须等于 `package.json::mcpName`，否则 publish 失败。

4. **GitHub OAuth 设备流登录**
   ```bash
   mcp-publisher login github
   ```
   终端显示一串验证码 + 浏览器 URL，浏览器里粘验证码，点 authorize。

5. **发布**
   ```bash
   mcp-publisher publish
   ```
   即时生效（无人工审核）。

6. **验证**
   ```bash
   curl https://registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin
   ```
   应返回上面的 JSON。

## 后续维护

- 每次发版（v1.3.10、v1.4 等）：bump `server.json::version` + `packages[].version` 到与 npm 一致 → `mcp-publisher publish` 重新发即可（同一 mcpName 自动覆盖前一版）
- `server.json` 进 git，与版本一起提交，便于复现

## 是否需要把这个 server.json commit 进仓库？

**建议提交**。原因：
1. 复现性 —— 任何 maintainer 都能 publish，不依赖个人本地 state
2. 透明 —— 用户可以在仓库里直接看到 registry 上的元数据
3. CI 自动化潜力 —— v1.4 可以加 publish workflow 把 registry publish 接进 GitHub Actions

文件路径建议：`mcp-registry.json`（避免和现有的 `server.json`——OpenClaw catalog 格式——冲突）。

## 已知冲突

仓库已有的 `server.json`（v1.3.9 commit `729606c` 自动生成）是 **OpenClaw catalog 格式**（包含 84 tools 的 name + description 列表）。MCP Registry 要求的 `server.json` 是**包元数据 + 环境变量**格式。两者**不兼容**。

解决方案：
- 把 MCP Registry 那份命名为 `mcp-registry.json`（推荐）
- 或重命名当前的为 `openclaw-catalog.json`

我们采用前者：单独 commit `mcp-registry.json`，`server.json` 保持 OpenClaw 用途。
