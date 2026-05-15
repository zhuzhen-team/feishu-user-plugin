# docs/

feishu-user-plugin 的内部文档目录。给 GitHub 浏览者 + 仓内开发者 + AI agent 用。

新人请先看 README：

- 中文：[../README.md](../README.md)
- English：[../README.en.md](../README.en.md)

GitHub Pages 用户向 landing：

- 中文：[https://ethanqc.github.io/feishu-user-plugin/](https://ethanqc.github.io/feishu-user-plugin/)
- English：[https://ethanqc.github.io/feishu-user-plugin/en](https://ethanqc.github.io/feishu-user-plugin/en)

---

## 文档分类

### 用户向

| 文档 | 说明 |
|------|------|
| [AUTH-SETUP.md](./AUTH-SETUP.md) | 三层鉴权 / 安装 / Cookie 抓取 / OAuth Scopes |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | 常见错误码与解决方法 |

### 开发者向

| 文档 | 说明 |
|------|------|
| [TOOLS.md](./TOOLS.md) | 85 tools 详细 + 跨域 caveat + 用法 patterns |
| [REFACTOR-NOTES.md](./REFACTOR-NOTES.md) | post-v1.3.7 文件职责矩阵 + 决策树（"新代码放哪"） |
| [CREDENTIALS-FORMAT.md](./CREDENTIALS-FORMAT.md) | `~/.feishu-user-plugin/credentials.json` schema |
| [TESTING-METHODOLOGY.md](./TESTING-METHODOLOGY.md) | sandbox 约定 / smoke baseline / 回归 playbook |
| [COOKIE-PROTOBUF-CAPTURES.md](./COOKIE-PROTOBUF-CAPTURES.md) | cookie protobuf 抓包流程（少数 reverse engineering 场景） |

### 维护者向

| 文档 | 说明 |
|------|------|
| [RELEASING.md](./RELEASING.md) | 发版步骤 / team-skills 同步 / 公告卡规则 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程（dev 环境 / 新增工具 / PR 流程） |

### 治理 / 法律

| 文档 | 说明 |
|------|------|
| [../PRIVACY.md](../PRIVACY.md) | 隐私政策（中英） |
| [../SECURITY.md](../SECURITY.md) | 安全政策 + 漏洞报告流程 |
| [../LICENSE](../LICENSE) | MIT |

### 历史 / 路线图

| 文档 | 说明 |
|------|------|
| [../CHANGELOG.md](../CHANGELOG.md) | 历史版本变更 |
| [../ROADMAP.md](../ROADMAP.md) | 未来计划（forward-only） |

### 给 AI agent

| 文档 | 说明 |
|------|------|
| [../CLAUDE.md](../CLAUDE.md) | Claude Code 在本仓内干活的核心指令（source of truth） |
| [../AGENTS.md](../AGENTS.md) | Codex 镜像（pre-commit hook 自动派生） |

---

## launch material

[`launch/`](./launch/) 目录下是发布 / 推广草稿（掘金 / 知乎 / V2EX / Anthropic Connectors / Cursor Marketplace 等），**未经显式批准前不外发**。

## Pages 不渲染的文件

`_config.yml::exclude` 把以下文件排除在 GitHub Pages 之外（避免 SEO 污染、首次访客被 dev doc 困惑）：

- COOKIE-PROTOBUF-CAPTURES.md
- CREDENTIALS-FORMAT.md
- REFACTOR-NOTES.md
- TESTING-METHODOLOGY.md
- superpowers/

只有 `index.md` + `en.md` 被渲染为 Pages。
