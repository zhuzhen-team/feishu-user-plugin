# Official MCP Registry 提交（`registry.modelcontextprotocol.io`）

## 背景

`modelcontextprotocol/servers` 已**不接受**第三方提交（README 明确声明只收 reference servers）。官方在 2025-10 启用了新 registry：`registry.modelcontextprotocol.io`，由 Anthropic + PulseMCP + GitHub + Stacklok 共同维护，2025-10-24 进入 v0.1 API freeze（生产稳定）。

下游 registry（Smithery / MCPServers.com / mcp.run / LobeHub 部分）会自动从 official registry 同步，所以一次提交多处可见。

## 当前状态

| 步骤 | 状态 |
|---|---|
| `package.json::mcpName` field | ✅ Added in PR #60 |
| `mcp-registry.json` (registry-format metadata) | ✅ Added in PR #69 |
| `mcp-publisher` CLI installed | ✅ via Homebrew (1.7.8) |
| `mcp-publisher login github` | ⏳ device flow — pending user one-click Authorize |
| `mcp-publisher publish mcp-registry.json` | ⏸ Will run automatically after login completes |

## File layout

仓库里两个并行的 metadata 文件，schema 不同，不冲突：

| 文件 | Schema | 谁消费它 | 怎么维护 |
|---|---|---|---|
| `server.json` | OpenClaw catalog 格式 | OpenClaw 等同类 catalog | `scripts/sync-server-json.js` 自动重生（CI gated） |
| `mcp-registry.json` | https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json | Official MCP Registry (`mcp-publisher`) | 手动维护；版本字段每次 ship 时同步 |

## 复发布命令（每次 v1.3.x → v1.3.(x+1) 时跑）

```bash
# 改 mcp-registry.json::version + packages[].version 到与 npm 一致
mcp-publisher publish mcp-registry.json
# 即时生效，覆盖 registry 上同一 mcpName 的前一版
```

CLI 凭证缓存在 `~/.config/mcp-publisher/credentials.json`（具体路径看 mcp-publisher 文档）—— 首次 login 之后，后续 publish 不再需要交互。

## 验证发布

```bash
curl https://registry.modelcontextprotocol.io/v0/servers/io.github.EthanQC/feishu-user-plugin
```

应返回 mcp-registry.json 内容 + 一些 metadata（publishedAt 等）。

## CI 自动化（v1.4 候选）

可以把 `mcp-publisher publish mcp-registry.json` 接进 GitHub Actions release workflow，发版时自动同步到 registry：

```yaml
- name: Publish to MCP Registry
  run: |
    brew install mcp-publisher
    mcp-publisher login github-oidc   # GitHub Actions OIDC，无需交互
    mcp-publisher publish mcp-registry.json
```

`github-oidc` 模式不需要 device flow，靠 Actions runner 的 OIDC token 鉴权。等 v1.4 想自动化时再开。
