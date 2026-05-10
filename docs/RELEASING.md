# 发版流程

> **谁该读**：仓库 maintainer、要修发版流程的开发者、看公告卡格式约定的人。  
> **何时读**：bump 版本前、修 publish workflow、改 CHANGELOG 格式、调整 release 公告规则。

覆盖 npm publish + team-skills 同步 + 发布公告全流程。**关键：用户确认每个 release 恰好两次** —— 一次确认目标版本，一次确认公告卡片。

## 关键约束（"必读"，不要跳过）

**用户确认每个 release 恰好两次** —— 一次确认目标版本（任何 publish 操作之前），一次确认公告卡片（发送之前）。中间步骤不要问。

三层版本安全：

1. **Claude 规则**（本文档）：与用户确认一次版本号，然后跑全流程不再问。仅在（a）失败 或（b）公告预览闸停下
2. **本地闸**（`prepublishOnly`）：本地 `npm publish` 时交互式确认（CI 跳过）
3. **CI 闸**（`.github/workflows/publish.yml`）：tag 必须与 `package.json` version 一致，否则 publish 失败

## 发版步骤

1. 与用户确认目标版本（一次）
2. Bump `version` 字段：`package.json` + `.claude-plugin/plugin.json` + `skills/feishu-user-plugin/SKILL.md` + `.cursor-plugin/plugin.json`（4 个 —— 单 commit；`scripts/check-version.js` 强制 4 源等价；`mcp-registry.json` 与 `.mcpb/manifest.json` 由各自的 check 脚本单独校验）
3. 开 release PR，等 CI 绿（仓启用 auto-merge —— `gh pr merge --auto --squash`）
4. PR merge 后，`git tag vX.Y.Z && git push origin vX.Y.Z` 触发 GitHub Actions `Publish to npm` workflow
5. 验证：`npm view feishu-user-plugin version` 返回新版本
6. post-merge hook 跑 `scripts/sync-team-skills.sh` 自动同步 team-skills（skills + plugin.json + 子 README changelog + 根 README catalog 行 + catalog.yaml regen + sync PR `gh pr merge --admin --squash`）。team-skills 端零手工
7. 跑 `node scripts/generate-release-artifacts.js` 产出 `/tmp/feishu-release/v$VERSION/feishu-card.json`
8. 把 card preview 给用户看。等 "发"
9. `send_card_as_user(chat_id="oc_0fab8e155f500f28bd437e8686921870", card=<JSON>)` —— 仅在用户明确批准之后

## 发布 npm

```bash
# 1. 在 package.json bump version
# 2. commit + tag
git add -A && git commit -m "chore: release v1.x.y"
git tag v1.x.y
git push && git push --tags
# 3. GitHub Actions 自动 publish 到 npm
```

GitHub Actions workflow `.github/workflows/publish.yml` 在 `v*` tag push 时自动 publish。`NPM_TOKEN` 在 GitHub repo secrets 里。

## 同步到 team-skills

**重要：team-skills 仓禁止直接 push main。所有变更必须走 PR。**

自动部分（Phase B3 hooks）：

- **pre-commit（本仓）**：`CLAUDE.md` 任何改动自动 sync 到 `AGENTS.md`（脚本：`scripts/sync-claude-md.sh`）
- **post-merge（本仓，main）**：把 `skills/` + `.claude-plugin/plugin.json` 拷到 `team-skills/plugins/feishu-user-plugin/`，建 `sync/feishu-v<version>` 分支，开 PR 加 `--auto --merge`（脚本：`scripts/sync-team-skills.sh`）

仍需手动的部分：

- `README.md` —— team-skills 有自己的 README（含团队共用 APP_ID/SECRET）。工具数 / changelog / 安装提示都需要手编
- `skills/feishu-user-plugin/SKILL.md` —— version + `allowed-tools` 列表

team-skills PR 流程：

1. 建分支：`git checkout -b sync/feishu-v1.x.x` 或 `fix/feishu-xxx`
2. push 分支 + `gh pr create` + `gh pr merge <number> --auto --merge`
3. CI（`validate.yml`）检查三角等价（`plugin.json` / `SKILL.md` / README 第一个 `### vX.Y.Z`）—— 必须一致否则 CI 失败
4. CI 失败：修 + push 同分支，CI 重跑，auto-merge 继续

手动 sync fallback（hook 失败 / dry-run / 第一次）：

```bash
# CLAUDE.md → AGENTS.md + skill ref 由 pre-commit hook 处理
cp -r skills/. /Users/abble/team-skills/plugins/feishu-user-plugin/skills/
cp .claude-plugin/plugin.json /Users/abble/team-skills/plugins/feishu-user-plugin/.claude-plugin/
# 不要拷 .mcp.json —— team-skills plugin 不应有
```

## 发布公告规则（每次发版）

成功 publish 后，发公告到 "AI技术解决（内部）" 群（chat_id `oc_0fab8e155f500f28bd437e8686921870`）。**没用户明确批准不发** —— 先 preview，等 "发"。

**传输（v1.3.9+）**：`send_card_as_user`（飞书互动卡片）。无 @、无 emoji、无营销腔。

**真实数据源**：`CHANGELOG.md` v$VERSION 段。**永远不手写公告** —— generator 脚本确定地从 CHANGELOG 抽：

```bash
node scripts/generate-release-artifacts.js [version]
# 输出到 /tmp/feishu-release/v<version>/：
#   feishu-card.json          ← 完整 Feishu card payload，给 send_card_as_user 用
#   team-skills-changelog.md  ← markdown 块，post-merge hook 注入到 team-skills 子 README
#   team-skills-readme-row.md ← 根 README catalog 行替换内容
```

### CHANGELOG 约定（generator 解析格式 —— 偏离则输出失真）

```markdown
## [X.Y.Z] - YYYY-MM-DD

<一到两句陈述式开篇，可空，generator 用作 card 第一段；不宣传不夸大>

### Added              （翻译为"新增"）
- **简短标题 (代号)**：用户可见现象。底层机制 / 错误码 / 接口名 / 文件路径。
- ...

### Changed            （"调整"）
### Fixed              （"修复"）
### Removed | Deprecated | Security  （"移除" / "废弃" / "安全"）
### Deferred to vN.M.P （"下版本计划 (vN.M.P)"，从上版本拷过来 - 本版完成的条目）

### Test scenarios     （可选；用作"升级方式"段的"建议复测"行）
- 调用 X 时观察 Y 出现 Z
- ...
```

### 写作规范（直接流入 card）

- 每条 bullet：先用户可见现象，再底层机制。引用具体错误码（91403 / 1254301）、接口名（`manage_bitable_record`）、参数名（`via_profile`）、文件路径（`src/auth/profile-router.js`）
- 代号语：`(B)` / `(D.1)` 等可保留，对应 ROADMAP / plan 编号
- 禁用：emoji / `@` 任何人 / "强大"等营销词 / 夸张修辞
- 长度：单屏，整段 400-800 汉字。每条 bullet 1-3 行

### "升级方式" 由脚本自动生成

- "重启 Claude Code / Codex 自动拉取 X.Y.Z" —— 永远
- "推荐运行 npx feishu-user-plugin migrate --confirm ..." —— bullet 提到 migrate / credentials.json / FEISHU_PLUGIN_PROFILE 时
- "启动看 stderr 带 WS connected ..." —— bullet 提到 WS / WebSocket / get_new_events 时
- "建议复测 N 个场景：..." —— 用 `### Test scenarios` 的 bullet（如有），否则用 Added 的前 3 个 bullet 标题

### Release 时的 step-by-step

1. Bump version → tag → push → 等 `Publish to npm` workflow 成功 → 确认 `npm view feishu-user-plugin version`
2. 本仓 post-merge hook 跑 `scripts/sync-team-skills.sh`，调用 `scripts/generate-release-artifacts.js` 自动注入 v$VERSION 到 team-skills 子 README + 更新根 README catalog 行 + 开 & `--admin --squash` merge sync PR。team-skills 端零手工
3. 在本仓跑 `node scripts/generate-release-artifacts.js`（幂等）（重新）产出 `feishu-card.json`
4. **把渲染后的 card preview 给用户** —— 把 summary 贴出来或 `cat /tmp/feishu-release/v$VERSION/feishu-card.json | jq` 让用户看。**不要发**
5. 用户说 "发" → `send_card_as_user(chat_id=oc_0fab8e155f500f28bd437e8686921870, card=<JSON content>)`
