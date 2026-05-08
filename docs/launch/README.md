# Launch Materials — feishu-user-plugin v1.3.9 Growth Track

This directory contains drafts and submission templates for the v1.3.9 → v1.3.10 Growth lever (see [`ROADMAP.md`](../../ROADMAP.md) "v1.3.9 ⇢ v1.3.10 过渡专项 — Growth / 推广 / 影响力").

## Status legend

- 📄 **Draft ready** — content written, awaiting user `发` to publish externally
- 🚀 **Submission-ready** — PR / form fields prepared, awaiting user push
- ⏸ **Blocked** — needs additional repo work first (e.g. `.mcpb` packaging, Privacy Policy)

## Index

### MCP discovery channels (Tier 1 — official ecosystems)

| File | Channel | Status | Mechanism |
|---|---|---|---|
| [`awesome-mcp-servers-pr.md`](awesome-mcp-servers-pr.md) | `punkpeye/awesome-mcp-servers` (86k★ curated list) | 🚀 PR-ready | Fork + GitHub PR |
| [`mcp-registry-submission.md`](mcp-registry-submission.md) | Official MCP Registry (`registry.modelcontextprotocol.io`) | 🚀 Materials ready, user runs CLI | `mcp-publisher` CLI + GitHub OAuth device flow |
| [`anthropic-directory-prep.md`](anthropic-directory-prep.md) | Anthropic Connectors Directory (`claude.com/docs/connectors`) | ⏸ Blocked on `.mcpb` + Privacy Policy | Web form, planned for v1.4 |
| [`cursor-marketplace-prep.md`](cursor-marketplace-prep.md) | Cursor Marketplace | ⏸ Blocked on `.cursor-plugin/plugin.json` manifest | Form + repo manifest, planned for v1.4 |

### Chinese dev community (Tier 2 — content-driven)

| File | Platform | Status | Format |
|---|---|---|---|
| [`juejin-article.md`](juejin-article.md) | 掘金 (juejin.cn) | 📄 Draft | 3500-5000 字技术文章, 实战流程角度 |
| [`zhihu-article.md`](zhihu-article.md) | 知乎 (zhihu.com) | 📄 Draft | 2500+ 字专栏文章, 30%+ rewrite vs 掘金 to avoid duplicate-content penalty |
| [`zhihu-questions-to-answer.md`](zhihu-questions-to-answer.md) | 知乎 高赞问题答题 | 📋 Target list | 6+ 已存量高赞问题清单 + 答题大纲 |
| [`v2ex-post.md`](v2ex-post.md) | V2EX `/go/create` + `/go/share` | 📄 Draft | ~600 字短帖, 周五上午发 |
| [`feishu-community-post.md`](feishu-community-post.md) | 飞书开放平台开发者社区 | 📄 Draft | 软帖 / 求技术反馈姿态 |
| [`hellogithub-submission.md`](hellogithub-submission.md) | HelloGitHub 月刊 | 📄 Draft | 自荐入口 https://hellogithub.com/periodical |
| [`ruanyifeng-weekly-issue.md`](ruanyifeng-weekly-issue.md) | 阮一峰科技爱好者周刊 | 📄 Draft | 在 `ruanyf/weekly` 仓库提 issue 自荐 |

### International dev community (Tier 3)

| File | Platform | Status | Format |
|---|---|---|---|
| [`x-thread.md`](x-thread.md) | X (Twitter) | 📄 Draft | 4 推 long thread, tag `@alexalbert__` + `@AI_Jasonyu` |

---

## Recommended posting order (per agent recon)

| Day | Action |
|---|---|
| Day 0 | Submit awesome-mcp-servers PR + Official MCP Registry publish |
| Day 1 | V2EX `/go/create`（周五上午 9-11 点）+ 知乎想法发版公告 |
| Day 1-2 | 掘金长文（3500-5000 字）发布 |
| Day 2 | X thread（主帖 → 5 分钟后 reply tag @alexalbert__ / @AI_Jasonyu） |
| Day 3-7 | 知乎专栏建立 + 知乎主稿（30%+ rewrite）+ 高赞问题答题 |
| Day 7+ | 飞书开放平台社区软帖、HelloGitHub 月刊自荐、阮一峰 weekly issue |
| 持续 | LobeHub 上的描述需要联系他们更新（33 → 84 tools） |

## Wedge

Every channel leads with the same differentiation hammer: **以你本人身份发飞书消息（cookie protobuf 反向工程），不是机器人**. None of the top-ranked competing repos do this — they all rely on bot/webhook push. This is our cheapest, sharpest hook.

Competitors to be aware of (do **not** name them as targets in posts — leads to negative engagement; just know what you're up against):

- `larksuite/lark-openapi-mcp` (官方, 难撼动)
- `cso1z/Feishu-MCP` (文档专精, 掘金引流强)
- `ztxtxwd/feishu-mcp-server` (V2EX 引流强)
- `qingpingwang/remote-claude-code` + `chenhg5/cc-connect` (飞书 ↔ Claude Code Bridge)
- 飞书官方 CLI (`larksuite/cli`，2026-03 开源)
