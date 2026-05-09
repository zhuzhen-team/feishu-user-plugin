# 隐私政策 / Privacy Policy

`feishu-user-plugin` 是一个本地运行的 MCP 服务器。本文档说明插件如何处理用户提供的飞书 / Lark 凭证以及通过 MCP 工具调用流转的数据。

---

## 中文

### 1. 收集的数据

插件本身不收集任何数据。运行需要用户主动配置以下凭证，全部来自用户自己的飞书 / Lark 账号：

- `LARK_COOKIE` —— 用户浏览器登录 feishu.cn 后从请求头复制的 cookie 串
- `LARK_APP_ID` + `LARK_APP_SECRET` —— 用户在飞书开放平台自建应用的 ID 与密钥
- `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` —— 用户通过 `npx feishu-user-plugin oauth` 在自己浏览器中授权后由插件本地保存的 OAuth 令牌

以上凭证保存在用户本地，不会发送给插件作者或除飞书自身以外的任何第三方。

### 2. 处理的数据

插件只处理用户通过 MCP 工具调用主动请求的数据：消息、文档、多维表格、知识库、云空间、日历、任务、OKR、联系人。插件是用户与飞书开放平台之间的薄代理，不在数据通过时做额外的留存、备份、上传或分析。

### 3. 数据存储位置

- 凭证文件：`~/.feishu-user-plugin/credentials.json`，文件权限 0600（仅当前用户可读写），由用户的操作系统强制访问控制
- 实时事件日志（启用时）：`~/.feishu-user-plugin/events.jsonl`，append-only，10 MB 软上限 / 20 MB 硬上限自动轮转
- 不上报遥测，不发送埋点，不联网调用统计接口，不与插件作者维护的任何后台通信

唯一的数据驻留点是用户本机。

### 4. 第三方共享

插件运行时与两类外部方通信：

- **飞书开放平台 API**（`open.feishu.cn` / `feishu.cn`）—— 用户自己的飞书租户。所有读写都直接打到这里，等价于用户自己用飞书客户端的操作
- **用户运行的 AI 客户端**（Claude Code / Codex / Cursor / Windsurf / OpenClaw / Claude Desktop 等）—— 这是 MCP 协议的另一端，由用户自行选择安装

插件不引入任何额外的第三方依赖（无 CDN、无分析服务、无错误上报）。

### 5. 数据保留

完全由用户控制。插件不主动删除、归档或复制用户数据。要彻底移除：

```bash
rm -rf ~/.feishu-user-plugin
npm uninstall -g feishu-user-plugin
```

撤销飞书侧的 OAuth 授权可在飞书开放平台的应用管理页操作。

### 6. 联系方式

- 一般问题：[GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues)
- 安全披露：在 GitHub Issue 标题前加 `[security]` 前缀

---

## English

### 1. Data Collected

The plugin itself collects no data. Operation requires the user to provide the following credentials, all from the user's own Feishu / Lark account:

- `LARK_COOKIE` — cookie string the user copies from their own browser session on feishu.cn
- `LARK_APP_ID` + `LARK_APP_SECRET` — credentials of a self-built app the user registers on the Feishu Open Platform
- `LARK_USER_ACCESS_TOKEN` + `LARK_USER_REFRESH_TOKEN` — OAuth tokens issued after the user grants consent via `npx feishu-user-plugin oauth` and saved locally by the plugin

These credentials remain on the user's machine and are not transmitted to the plugin author or any third party other than Feishu itself.

### 2. Data Processed

The plugin only processes data the user explicitly requests through MCP tool calls: messages, documents, bitable, wiki, drive, calendar, tasks, OKR, contacts. The plugin is a thin proxy between the user and the Feishu Open Platform; it does not retain, archive, replicate, upload, or analyse data in transit.

### 3. Where Data Is Stored

- Credential file: `~/.feishu-user-plugin/credentials.json`, mode 0600 (readable / writable only by the file owner), enforced by OS-level access control
- Realtime event log (when enabled): `~/.feishu-user-plugin/events.jsonl`, append-only, 10 MB soft / 20 MB hard rotation cap
- No telemetry, no analytics, no phone-home, no communication with any backend maintained by the plugin author

The user's machine is the only retention point.

### 4. Third-Party Sharing

At runtime the plugin communicates with two external parties:

- **Feishu Open Platform API** (`open.feishu.cn` / `feishu.cn`) — the user's own Feishu tenant. All reads and writes go directly there, equivalent to actions the user could take in the official Feishu client
- **The AI client the user runs** (Claude Code / Codex / Cursor / Windsurf / OpenClaw / Claude Desktop, etc.) — the other end of the MCP protocol, chosen and installed by the user

The plugin introduces no additional third party (no CDN, no analytics service, no error-reporting endpoint).

### 5. Data Retention

Entirely user-controlled. The plugin does not delete, archive, or replicate user data on its own. To remove everything:

```bash
rm -rf ~/.feishu-user-plugin
npm uninstall -g feishu-user-plugin
```

OAuth authorization on the Feishu side can be revoked from the application management page of the Feishu Open Platform.

### 6. Contact

- General issues: [GitHub Issues](https://github.com/EthanQC/feishu-user-plugin/issues)
- Security disclosures: prefix the issue title with `[security]`
