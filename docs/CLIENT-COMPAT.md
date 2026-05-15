# MCP Client Compatibility Matrix

本表记录 `feishu-user-plugin` 在主流 MCP 客户端上的可运行 / 已验证状态。

> Last verified: v1.3.12 (2026-05-15)

## 5 客户端 × 9 prompts × 84 tools 矩阵

| Client | install path | MCP server start | Tools | Prompts (9) | Resources | Notes |
|--------|--------------|------------------|-------|-------------|-----------|-------|
| **Claude Code** | `~/.claude.json` mcpServers | ✓ | ✓ 84 | ✓ 9 (Skill + MCP Prompt 双暴露) | — | CI baseline (smoke 跑每个 PR) |
| **Codex** | `~/.codex/config.toml` mcp_servers | ✓ | ✓ 84 | ✓ 9 (MCP Prompt only — Codex 不支持 Claude Code skill) | — | CI baseline (smoke 跑每个 PR) |
| **Cursor** | `.cursor/mcp.json` (project) / `~/.cursor/mcp.json` (user) | ✓ install-verified | ✓ install-verified | ⚠ MCP prompts/get 协议支持但 Cursor UI 怎么暴露需用户实测 | — | 安装路径 v1.3.11 ship 过 `.cursor-plugin/plugin.json` manifest，Cursor Marketplace 提交材料就绪 |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` | ✓ install-verified | ✓ install-verified | ⚠ 同上（用户实测） | — | 国内访问 Codeium 需要科学上网 |
| **OpenClaw** | `~/.openclaw/openclaw.json` mcp.servers | ✓ install-verified | ✓ install-verified | ⚠ 同上（用户实测） | — | 字节亲生 AI Agent 框架；本仓和官方 `larksuite/openclaw-lark` 并行（功能不同） |
| **VS Code (Copilot)** | `.vscode/mcp.json` | ✓ install-verified | ✓ install-verified | ⚠ 同上（用户实测） | — | 注意 key 是 `servers` 不是 `mcpServers` |
| **Claude Desktop** | `.mcpb` 包安装 | ✓ install-verified | ✓ install-verified | ⚠ 同上（用户实测） | — | v1.3.11 ship 过 `.mcpb/manifest.json`，`node scripts/build-mcpb.js` 产出 `dist/feishu-user-plugin-1.3.11.mcpb` |

## 9 个 MCP Prompts 在各客户端的暴露

`prompts/list` + `prompts/get` 是 MCP 2024-11-05 spec 的标准能力。任何遵循 spec 的客户端理论上都能拉取并展示。实际暴露形式：

| Prompt | Claude Code | Codex | Cursor / Windsurf / VS Code / OpenClaw |
|--------|-------------|-------|---------------------------------------|
| `/send` | ✓ Skill UI + MCP prompt | ✓ MCP prompt | ⚠ 取决于客户端 UI 是否 surface MCP prompts |
| `/reply` | ✓ | ✓ | ⚠ |
| `/digest` | ✓ | ✓ | ⚠ |
| `/search` | ✓ | ✓ | ⚠ |
| `/doc` | ✓ | ✓ | ⚠ |
| `/table` | ✓ | ✓ | ⚠ |
| `/wiki` | ✓ | ✓ | ⚠ |
| `/drive` | ✓ | ✓ | ⚠ |
| `/status` | ✓ | ✓ | ⚠ |

Prompt body 在 server 启动时从 `skills/feishu-user-plugin/references/` 读，所有 5 个客户端拉到的是同一份 markdown 内容；客户端如何把它推给用户是 client-side 决策。

## 已知 client-specific caveat

- **Codex** 不支持 Claude Code slash command（skill）—— 仅 MCP 工具可用。9 个 prompt 通过 `prompts/list` 接口在 Codex 里**可见**但需要客户端 UI 主动 surface（Codex 当前在内测对 prompts 的 UI 暴露中，1.4 版本计划完善）
- **Cursor** 的 MCP support 是 2025 Q4 之后新功能，client-side prompt UI 尚在迭代；安装本插件后 84 工具应能在 Cursor 调用，prompt 形式建议直接给 Cursor 发自然语言 instead of `/prompt` slash
- **Windsurf** 跟 Cursor 类似，prompt UI 不一定 surface；工具调用 verified working through MCP 协议层
- **VS Code (Copilot)** 配置 key 是 `servers` 不是 `mcpServers`，常被 README copy-paste 时漏 — 见 `~/.vscode/mcp.json` 例子
- **Claude Desktop** `.mcpb` 包用 `manifest_version=0.3` schema 的 `user_config` 块；用户首次启动会被 Desktop UI 提示填 5 个 `LARK_*` 凭证（`sensitive=true`），无需手编 JSON
- **OpenClaw** 官方仓 `larksuite/openclaw-lark` 是飞书亲生插件（2.16k stars），本仓 + OpenClaw 共存是可行的（功能不冲突 — 本仓覆盖 cookie 路径 + 文档生态 + 实时事件 SSOT，官方插件覆盖企业业务系统）

## 如何复测

跑下面两条 prompt + 一组工具调用，能完成即认为客户端 OK：

```text
# A. /status
启动客户端 → 输入 prompt "/status" 或自然语言 "检查飞书 plugin 鉴权状态"
预期：客户端调 get_login_status 工具，返回 3 层鉴权（Cookie / App / UAT）的 valid 状态

# B. /send
启动客户端 → 输入 "/send <user_name> hello from <client_name>"
或自然语言 "用飞书发一条消息给 <user_name>，内容 hello"
预期：客户端先调 search_contacts 确认用户 → create_p2p_chat → send_as_user
最终：用户的飞书收到 hello 消息（user-identity，displayLabel 显示为你而不是 [Bot]）
```

```bash
# C. 工具直调 list_chats
通过客户端的"调用工具"UI（或自然语言）执行 list_chats(pageSize: 5)
预期：返回 JSON 数组，每条含 chat_id / name / chat_mode
```

通过即在 Notes 列里记 ✓ + 测试日期；失败开 issue 附 stderr 日志。

## CI 覆盖

每个 PR 跑 `node scripts/smoke.js diff`：spawn `src/index.js` 作 stdio child → 发 `initialize` / `tools/list` / `tools/call get_login_status` / `prompts/list` → 校验 84 tools / 9 prompts + login_status response shape 不变。等价于在 Claude Code / Codex 协议层做 smoke，但只 verify 服务端协议正确性，不涉及客户端 UI。

客户端 UI 兼容性需要人工实测 — 本表的 "install-verified" 来自维护者本地跑过配置 + 服务能起，未在 prompt UI 层穷尽测试。社群验证欢迎 PR 更新本表。

---

历史脉络：本文档替代 [issue #64](https://github.com/EthanQC/feishu-user-plugin/issues/64)（已 closed-COMPLETED 但搬到 v1.3.12 ROADMAP）。原 issue 要求"在 Cursor / Windsurf / OpenClaw 各跑 /send /status 两条 prompt + 写测试报告"；本表把"测试报告"延伸为通用 compat matrix，"已实测条目"待社群补完。
