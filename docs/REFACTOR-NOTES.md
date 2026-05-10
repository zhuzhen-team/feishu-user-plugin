# v1.3.7 重构笔记 —— 新代码该放哪

> **谁该读**：贡献代码的开发者、在 src/ 内做改动的 AI agent。  
> **何时读**：加新工具 / 新 API 调用前、不确定某段代码归属哪个域、想要改 client 或 tool 边界。

本文是 v1.3.7 phase A 重构后的"边界契约"。下一个加 feature 的人不至于不小心又写出一个 god 文件。如果不确定某段代码该放哪，先读本文 —— 如果规则不适用，先提议改本文再写代码。

## 目标

- **一个文件 = 一个域**。软目标 ≤600 行，>900 行就是味道
- **`index.js` 保持 5 行入口**。永远别再加逻辑
- **`server.js` 保持瘦 bootstrap + dispatcher**。永远别加工具特有逻辑
- **新增一个工具不应触碰多于 2 个文件**（一个 client 域 + 一个 tool 域）。如果改动跨更多文件，说明边界划错了

## 布局（post v1.3.7 phase A）

```
src/
├── index.js                     # ~6 行 —— shebang + logger + server.main()
├── server.js                    # MCP bootstrap、ctx 装配、请求 dispatch
├── logger.js                    # 全局 stdout guard + Lark SDK stderr logger
├── utils.js                     # fetchWithTimeout、request-id helper
├── resolver.js                  # wiki node / 飞书 URL → native token
├── error-codes.js               # classifyError（fallback 路由用）
├── doc-blocks.js                # docx block 构造器
├── oauth.js / oauth-auto.js     # OAuth CLI 流程 + Playwright helper
├── cli.js                       # `npx feishu-user-plugin <cmd>` 入口
├── setup.js                     # setup CLI 向导
├── config.js                    # MCP-config discovery + atomic 持久化
│                                #   （延迟拆分到 config/ → Phase B）
├── auth/
│   └── credentials.js           # 单一可信源凭证 API。
│                                #   读 ~/.feishu-user-plugin/credentials.json
│                                #   （atomic、0600）。v1.3.6 用户在跑
│                                #   `migrate` 之前 fallback 到 legacy
│                                #   process.env / mcpServers discovery。
├── clients/
│   ├── user.js                  # Cookie + protobuf 用户身份 client
│   └── official/
│       ├── base.js              # 构造函数、UAT lifecycle、_safeSDKCall、
│       │                        #   _asUserOrApp、_uatREST、_populateSenderNames、
│       │                        #   _formatMessage、_normalizeTimestamp、
│       │                        #   verifyApp、_getAppToken
│       ├── index.js             # 把 base + 域 mixin 合到 prototype
│       ├── im.js                # 20 个 IM 方法含 readMessagesWithFallback
│       ├── docs.js              # 12 个 docx + block-edit 方法
│       ├── bitable.js           # 22 个 bitable 方法
│       ├── drive.js             # listFiles / createFolder / copy / move / delete
│       ├── wiki.js              # listSpaces / search / nodes / attachToWiki
│       ├── uploads.js           # uploadImage/File/Media/DocMedia/DriveFile + downloadDocImage
│       ├── calendar.js          # 3 个 calendar read 方法
│       ├── okr.js               # 3 个 OKR read 方法
│       ├── contacts.js          # findUserByIdentity、getUserById
│       └── groups.js            # createChat/updateChat + 成员操作
└── tools/
    ├── _registry.js             # text/json/sendResult 响应构造器 + ctx 契约
    ├── bitable.js               # 19 个 bitable handler
    ├── messaging-user.js        # 10 个 send_*_as_user + batch_send + send_card_as_user
    ├── messaging-bot.js         # 8 个 bot 端 send/edit/reaction/pin
    ├── docs.js                  # 7 个 docs + block-edit handler
    ├── drive.js                 # 6 个 drive + upload_drive_file handler
    ├── im-read.js               # 5 个 IM read handler + ChatIdMapper 单例
    ├── wiki.js                  # 4 个 wiki read handler
    ├── contacts.js              # 4 个 contact lookup handler
    ├── groups.js                # 4 个 group 管理 handler
    ├── diagnostics.js           # 3 个 health-check + media-download handler
    ├── calendar.js              # 3 个 calendar handler
    ├── okr.js                   # 3 个 OKR handler
    ├── uploads.js               # 3 个 upload handler
    └── profile.js               # 2 个 profile 管理 handler
```

## "新代码放哪" 决策树

### 加新 MCP 工具（handler + schema）

1. 看它属于哪个**域**（按现有工具分类映射）
2. 把 schema 加到 `src/tools/<domain>.js::schemas`
3. 把 handler 加到 `src/tools/<domain>.js::handlers`，写法 `async name(args, ctx) { ... }`
4. 如果 handler 需要的飞书 API 调用还不存在，把方法加到 `src/clients/official/<domain>.js`（或 cookie 身份用 `clients/user.js`）
5. 仅当增加 ≥3 个相关工具且不属于现有域时才创建新的 `src/tools/<x>.js`。否则附加到最近的域

### 加新飞书 Official API 调用

- 把方法加到 `src/clients/official/<domain>.js`
- 如果调用跨 ≥2 个域共享，放到 `clients/official/base.js`
- `_safeSDKCall` / `_asUserOrApp` / `_uatREST` / `_populateSenderNames` 这种跨域方法在 base.js

### 加新 Cookie 身份 API 调用

- 加到 `src/clients/user.js`
- protobuf 编码 helper 同位置

### 加新凭证 / 鉴权概念

- 凭证 API：`src/auth/credentials.js`。向后兼容面用 `readCredentials()` / `persistToConfig()`，规范访问用 `readCanonical()` / `getActiveProfileEnv()` / `setActiveProfile()`。Schema 见 [docs/CREDENTIALS-FORMAT.md](./CREDENTIALS-FORMAT.md)
- Cookie 心跳目前仍在 `clients/user.js` 里 inline，调 auth/credentials 的 `persistToConfig`。UAT 刷新 + 跨进程文件锁仍在 `clients/official/base.js`，调 auth/credentials 的 `readCredentials` + `persistToConfig`。等新持久化形态稳定一两个 release 后会拆出 `src/auth/{cookie,uat}.js`

### 加新 config / setup 行为

- `src/config.js` 拥有 legacy MCP-config discovery（`findMcpConfig` / `writeNewConfig` / `_atomicWrite`，覆盖 ~/.claude.json / ~/.codex/config.toml / .mcp.json）—— 这里管 harness 特定的 JSON/TOML 知识
- `src/auth/credentials.js` 是规范凭证面；仅在 legacy fallback（`~/.feishu-user-plugin/credentials.json` 不存在时）委托给 `config.js`
- `src/setup.js` 是 CLI 向导。加新 setup 行为：扩展 setup.js + writeNewConfig（config.js）走 harness-write 路径；如果新行为还需要往 credentials.json round-trip，教 auth/credentials.js

### 加跨切面 helper

- 被 ≥2 个模块用：`src/utils.js`
- 只被一个工具用：留在该工具文件里

### 响应构造（text vs JSON vs sendResult）

- 总是从 `src/tools/_registry.js` import。别重复造
- `text(s)` —— 纯文本 MCP 响应
- `json(o)` —— JSON-pretty 响应，`o.fallbackWarning` 自动提到顶
- `sendResult(r, desc)` —— 给 send 风格响应用，`r.success` 决定文本

## 不要做

- ❌ **不要**给 `src/official.js` 加新方法 —— 它是向后兼容 barrel，v1.3.8 已删
- ❌ **不要**给 `src/index.js` 加新方法 —— 它是 6 行入口，仅此
- ❌ **不要**给 `src/server.js` 加工具特有逻辑 —— 它仅是 dispatcher
- ❌ **不要**为单个工具创建 `src/tools/<x>.js`。聚合相关工具
- ❌ **不要**绕过 `src/server.js` 注册工具。每个 handler 必须通过 `TOOL_MODULES.flatMap(m => m.schemas)` 可达
- ❌ **不要**绕过 `src/clients/official/index.js` 构造 client。永远 `require('./clients/official')`
- ❌ **不要**从 tool 模块反向去 `server.js` 抓状态。把字段加到 `ctx` 对象上，并在 `_registry.js` 的 docstring 里记录
- ❌ **不要**恢复 legacy `switch (name) { case 'tool_name': ... }` dispatch 模式。工具 dispatch 现在是 `HANDLERS` 里 O(1) 查找

## 当规则不适用时

如果功能确实不属于任何域（如 v1.3.8 的 WebSocket event subscription），创建一个新的顶层子目录并明确 scope（`src/events/`、`src/realtime/`），同 PR 更新本文件。新顶层目录在同 PR 必须更新本文。

## Smoke 测试契约

`scripts/smoke.js` 是回归闸门。它冻结：

- 工具数量（当前 84）
- 每个 schema（排序、规范化）
- `get_login_status` 响应的 shape

每次 refactor commit 必须跑 `npm run smoke` 并 exit 0。如果 commit 有意添加 / 删除 / 重命名工具或改 schema，同 commit 跑 `npm run smoke:baseline` 更新 `tests/baseline/*.json`，commit subject 注明 "schema delta"。

## Phase B 延迟项（已在 v1.3.8 解决）

Phase B 延迟项（UAT + cookie helper 抽取）已在 v1.3.8 ship：

- `src/auth/uat.js` —— UAT lifecycle（refresh、lock、persist）从 `clients/official/base.js` 抽出。client 上的方法现在是 1 行 delegate
- `src/auth/cookie.js` —— heartbeat 调度器从 `clients/user.js` 抽出。同样的 delegate 模式

可选的 `src/config/{discovery,persistence,setup}.js` 拆分没做，因为 `config.js` 现在主要是 legacy fallback 目标 —— 拆分低流量 legacy 代码增加 churn 不带来 payoff。如果 config.js 长大再回头看。
