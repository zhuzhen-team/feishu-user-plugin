# 贡献 / Contributing

[**中文**](#贡献) · [English](#english)

---

## 贡献

感谢你对 `feishu-user-plugin` 的关注！这份指南覆盖 **dev 环境搭建 / 代码风格 / PR checklist / 新增工具的标准流程 / 怎么报 bug**，按你的关注点跳转：

- [开发环境搭建](#开发环境搭建)
- [仓库结构](#仓库结构)
- [pre-commit / CI 闸门](#pre-commit--ci-闸门)
- [新增工具的标准流程](#新增工具的标准流程)
- [PR 流程](#pr-流程)
- [Commit message 约定](#commit-message-约定)
- [Bug / 协议变化报告](#bug--协议变化报告)
- [good-first-issues](#good-first-issues)
- [License](#license)

### 开发环境搭建

```bash
# 1. fork 然后 clone
git clone https://github.com/<your-username>/feishu-user-plugin.git
cd feishu-user-plugin

# 2. 安装依赖（Node ≥18）
npm install

# 3. 配置凭证 —— 推荐用项目本身的 setup CLI 写到 ~/.claude.json，比 .env 更安全
npx . setup --app-id <YOUR_APP_ID> --app-secret <YOUR_APP_SECRET>
npx . oauth     # 拿用户 OAuth UAT

# 4. 验证
npm run smoke   # 快速 schema 校验
node src/test-send.js   # 实跑发一条文本（需先填 LARK_COOKIE）
```

> ⚠️ **不要提交凭证文件**。`.env` / `~/.feishu-user-plugin/credentials.json` / `~/.claude.json` 都不应进 commit。仓库 `.gitignore` 已覆盖。secret-scanning 也启用了双保险。

### 仓库结构

post-v1.3.7 layout（参考 [docs/REFACTOR-NOTES.md](docs/REFACTOR-NOTES.md) 的完整 boundary contract）：

```
feishu-user-plugin/
├── src/
│   ├── index.js                       # MCP server entry (84 tools)
│   ├── server.js                      # Tool registry + dispatch
│   ├── tools/                         # 各域 MCP 工具 schema + handler
│   │   ├── _registry.js               # ctx 契约（factories / profile / resolveDocId）
│   │   ├── messaging.js               # 用户身份发送
│   │   ├── im.js                      # 官方 API IM
│   │   ├── docs.js, bitable.js, wiki.js, drive.js, calendar.js, tasks.js, okr.js
│   │   ├── events.js                  # 实时事件 (v1.3.9)
│   │   └── plugin.js                  # 诊断 / multi-profile
│   ├── clients/
│   │   ├── user.js                    # cookie protobuf 用户身份
│   │   └── official/                  # 官方 API 客户端按域拆分
│   │       ├── base.js                # 跨域 helpers
│   │       ├── im.js, docs.js, bitable.js, wiki.js, drive.js, calendar.js, okr.js, contacts.js, ...
│   ├── auth/                          # cookie / UAT 鉴权 + 多 profile 路由
│   ├── events/                        # 机器级 SSOT WS owner 锁 / events.jsonl
│   └── cli.js                         # `npx feishu-user-plugin <subcommand>`
├── proto/                             # protobuf .proto 定义 + JSON schemas
├── scripts/
│   ├── smoke.js                       # MCP server schema diff vs baseline
│   ├── check-tool-count.js            # README badge + SKILL.md allowed-tools 必须等于 src/server.js TOOLS
│   ├── check-version.js               # package.json + plugin.json + SKILL.md 三角等价
│   ├── check-docs-sync.js             # CLAUDE.md ↔ AGENTS.md ↔ skill ref CLAUDE.md
│   ├── sync-claude-md.sh              # pre-commit 自动同步 hook
│   ├── sync-team-skills.sh            # post-merge 自动 sync 到 team-skills repo
│   └── ...
├── skills/feishu-user-plugin/         # 9 Claude Code MCP prompts
├── docs/                              # 公开文档 + GitHub Pages 源 + launch materials
├── .claude-plugin/plugin.json         # Plugin metadata (version 与 package.json + SKILL.md 必须一致)
├── CLAUDE.md                          # 项目指令（人 + Claude 都读这份）
├── AGENTS.md                          # Codex instructions（自动从 CLAUDE.md 派生）
└── package.json
```

### pre-commit / CI 闸门

仓库用 husky 在 `git commit` 时跑以下 gate（CI 在 PR 上跑同一套）：

| 触发条件 | 检查 | 失败时怎么办 |
|---|---|---|
| `CLAUDE.md` staged | 自动同步到 `AGENTS.md` + `skills/.../references/CLAUDE.md`（hook 自己处理，不需要手动） | 看 `bash scripts/sync-claude-md.sh` 是否报错 |
| `package.json` / `plugin.json` / `SKILL.md` staged | 三个文件的 `version` 字段必须一致 | bump 三个一起 |
| `src/server.js` / `src/tools/*` staged | `npm run smoke` —— 84 工具 schema diff；README "84 tools" 徽章 + SKILL.md `allowed-tools` 列表必须 = `src/server.js TOOLS` | `npm run smoke:baseline` 重写 baseline（**仅当工具增删改是有意的**），然后再 `npm run smoke` |
| `src/*` staged | smoke test | 同上 |

**别 `--no-verify`**。CI 会再跑一遍，本地跳过没意义。如果 hook 失败，**根因修了再 commit**——不要 `--amend` 上一次的 commit，hook 失败时 commit 没成功，amend 会改写**前一个**已成功的 commit。

### 新增工具的标准流程

post-v1.3.7 layout 后流程：

1. **API 方法** —— 加到对应域文件：
   - 官方 API → `src/clients/official/<domain>.js`（im / docs / bitable / drive / wiki / calendar / okr / uploads / contacts）
   - cookie 用户身份 → `src/clients/user.js`
   - 跨域 helper → `src/clients/official/base.js`
2. **MCP 工具 schema + handler** —— 加到 `src/tools/<domain>.js`。导出 `{ schemas: [...], handlers: { [name]: async (args, ctx) => MCPResponse } }`。`ctx` 字段见 `src/tools/_registry.js`。
3. **如果是全新域**（很少）—— 把新文件 append 到 `src/server.js` 的 `TOOL_MODULES` 列表
4. **Baseline 更新** —— `npm run smoke:baseline` 写 baseline（**仅当增删改是有意的**），然后 `npm run smoke` 验证
5. **Lint** —— `node -c <touched-files>`
6. **更新 CLAUDE.md** —— 工具数 / 工具列表 / 用法说明（CLAUDE.md 是 source of truth；AGENTS.md + 技能引用 CLAUDE.md 由 pre-commit hook 自动派生）
7. **更新 README.md** —— "84 tools" 徽章 + 工具索引表
8. **更新 ROADMAP.md** —— 完成的 line 直接删除（forward-only，不打勾）
9. **更新 SKILL.md `allowed-tools` 列表**

详细矩阵见 [docs/REFACTOR-NOTES.md](docs/REFACTOR-NOTES.md)。

### PR 流程

1. `git checkout -b feat/my-change` —— 单 PR 一个 logical chunk，不要混打
2. 改完 → `npm run smoke` → commit → push
3. `gh pr create --title "..." --body "..."` 开 PR
4. PR 模板已配置，按提示填 Summary / Test plan
5. CI 跑 validate.yml（version triangle + smoke + check-docs-sync）
6. 自动审批 / 我审过 = `gh pr merge <num> --auto --squash`
7. post-merge hook 自动同步到 team-skills repo（如果你是 maintainer）

### Commit message 约定

| 前缀 | 用途 | 例子 |
|---|---|---|
| `feat:` | 新工具 / 新能力 | `feat(events): machine-level SSOT — single-owner WS` |
| `fix:` | bug 修复 | `fix(profile): make CLI + diagnostics profile-aware` |
| `docs:` | CLAUDE.md / README / ROADMAP 更新 | `docs(skill): multi-account workflow` |
| `chore:` | 依赖 / CI / config 改动 | `chore: regen server.json for v1.3.9` |
| `refactor:` | 不改行为的代码重构 | `refactor(clients): split official.js by domain` |
| `test:` | 测试相关 | `test(profile): switch_profile multi-profile e2e` |

### Bug / 协议变化报告

飞书改了 web 客户端协议时（cookie 层有可能挂掉），开 issue 带上：
- 操作：哪个工具调用 / 什么参数
- 错误：完整堆栈、错误码、错误描述
- 环境：Node.js 版本、OS、安装方式（npx / 本地 clone）
- 验证：feishu.cn/messenger web 客户端**还能用吗**？（如果 web 都挂了可能是飞书在维护）
- 如果可能：把 `cmd` number 和 proto message name 也带上

模板：[bug_report.md](.github/ISSUE_TEMPLATE/bug_report.md)

### good-first-issues

新贡献者推荐先做这些（标了 `good-first-issue` label）：

- ROADMAP.md 列的 v1.4 候选项中"明确边界 + 文档级"的任务
- 新工具的单元测试补全（`scripts/test-all-tools.js` 框架已有）
- 文档完善（CHANGELOG.md 早期版本的 missing entries / 中英文翻译）
- 客户端兼容性测试（在 Cursor / Windsurf / OpenClaw 上跑一遍 9 个 prompt）

具体 issue 列表见 [GitHub Issues with `good-first-issue` label](https://github.com/EthanQC/feishu-user-plugin/labels/good-first-issue)。

### License

提交 PR 即表示你同意你的贡献以 MIT 协议开源。

---

## English

For developers more comfortable in English. Mirrors the structure above:

### Quick reference

- **Setup**: `npm install && npx . setup --app-id <X> --app-secret <Y> && npx . oauth`
- **Smoke gate**: `npm run smoke` after any schema-affecting change. Regen baseline only if the delta is intentional: `npm run smoke:baseline`
- **Pre-commit gates** (husky): version triangle (`package.json` / `plugin.json` / `SKILL.md` versions must match), tool-count badge (`README.md` "N tools" must equal `src/server.js TOOLS.length`), CLAUDE.md sync, smoke for `src/*` changes
- **Layout** (post-v1.3.7): `src/clients/official/<domain>.js` for Official API, `src/clients/user.js` for cookie identity, `src/tools/<domain>.js` for MCP tool schema + handler. Each tool module exports `{ schemas, handlers }`. See `src/tools/_registry.js` for the `ctx` contract and [docs/REFACTOR-NOTES.md](docs/REFACTOR-NOTES.md) for the full boundary matrix.
- **Adding a tool**: see "新增工具的标准流程" above (steps map 1:1)
- **Commit prefixes**: `feat: / fix: / docs: / chore: / refactor: / test:`
- **Bug reports**: open an issue at [bug_report.md template](.github/ISSUE_TEMPLATE/bug_report.md). Include Node version, OS, error stack, parameters that triggered it.
- **Good first issues**: filter by `good-first-issue` label on the [Issues page](https://github.com/EthanQC/feishu-user-plugin/labels/good-first-issue)
- **License**: by submitting a PR you agree to MIT licensing of your contribution

### Why this contributing guide is bilingual

The project's primary audience is Chinese-speaking (95%+ of Feishu users), but the open-source ecosystem is international. Both languages are first-class. Don't translate one when you change the other — keep them parallel.
