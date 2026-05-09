# `punkpeye/awesome-mcp-servers` 收录 PR

## Target

- Repo: https://github.com/punkpeye/awesome-mcp-servers (86k+ ⭐ as of 2026-05)
- Default branch: `main`
- File to edit: `README.md`
- Section: `### 💬 <a name="communication"></a>Communication`
- Insertion alphabetic order: between `elie222/inbox-zero` and `ExpertVagabond/solmail-mcp`
- **Current PR**: https://github.com/punkpeye/awesome-mcp-servers/pull/6090 (draft)

## Glama bot requirements (from PR #6090 comment)

The repository's auto-bot (github-actions Bot) labelled our PR with `missing-glama` and posted listing requirements. To pass and become mergeable:

1. **Submit server to Glama**: visit https://glama.ai/mcp/servers and submit the project. Glama runs introspection checks against a Dockerfile that you provide during submission. Checks pass when the server starts and responds to introspection requests (it will — our MCP server boots without env vars, just refuses to dispatch tools that need them).
2. **Add a Glama score badge** to the entry line in the PR.

We have a `Dockerfile` in repo root (separate PR). The Glama submission can use the same Dockerfile content.

## Final entry line (with Glama badge)

```markdown
- [EthanQC/feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) [![EthanQC/feishu-user-plugin MCP server](https://glama.ai/mcp/servers/EthanQC/feishu-user-plugin/badges/score.svg)](https://glama.ai/mcp/servers/EthanQC/feishu-user-plugin) 📇 ☁️ 🏠 🍎 🪟 🐧 - All-in-one Feishu/Lark MCP server (84 tools). Send messages as the actual user (not bot), plus full official-API coverage of docs, bitable, wiki, drive, calendar, tasks, OKR. Cookie + OAuth UAT + app-credential auth.
```

Legend:
- 📇 = TypeScript / JavaScript
- ☁️ = Cloud (Feishu APIs)
- 🏠 = Local install (npm / npx)
- 🍎 🪟 🐧 = macOS / Windows / Linux

## PR title

```
Add EthanQC/feishu-user-plugin to Communication
```

## PR body

```markdown
Adds an entry for [feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) under the Communication category.

### What it is
All-in-one MCP server for Feishu / Lark. 84 tools across 3 auth layers (cookie + OAuth UAT + app credentials). The differentiator vs other Feishu MCPs in the wild: **send messages as the actual user identity, not as a bot** — uses the cookie + protobuf protocol path to address the gap in Feishu's official API (no `send_as_user` scope). Plus full official-API coverage of docs, bitable, wiki, drive, calendar, tasks, OKR.

### Maintained
- npm: https://www.npmjs.com/package/feishu-user-plugin (stable v1.3.9)
- License: MIT
- Active development; pre-commit + CI gates on tool count, schema regressions, version triangle equality

### Glama listing
Submitted at https://glama.ai/mcp/servers/EthanQC/feishu-user-plugin (Dockerfile in repo root). Glama score badge added to the entry above.

### Checklist
- [x] Alphabetical order within Communication section preserved
- [x] One server per line
- [x] Concise description (within line-length conventions)
- [x] Accurate repo + project links
- [x] Glama listing + score badge added
```

## Steps for the user (~15 min total once Glama is in place)

1. **Pre-step (Dockerfile)**: a Dockerfile is committed to repo root in [PR #67] (separate PR for the Glama submission to use).
2. **Glama submission**: visit https://glama.ai/mcp/servers, click submit, point at the GitHub repo. Glama crawls the Dockerfile and runs introspection. Wait for "passes all checks" (~minutes).
3. **Update PR #6090** entry with the badge: edit the entry line in the fork branch to match the "Final entry line (with Glama badge)" above (the badge URL needs Glama listing in place to render a real score).
4. **Flip PR #6090 from Draft → Ready for review** (button in the PR right rail).
5. Maintainer review by `punkpeye` proceeds. Merges happen continuously, no fixed SLA.

## Side action: also fill `wong2`'s form

`wong2/awesome-mcp-servers` (4k ⭐) doesn't accept PRs — submissions go through https://mcpservers.org/submit. 5-field form:

| Field | Value |
|---|---|
| Server Name | feishu-user-plugin |
| Short Description | All-in-one Feishu/Lark MCP server. 84 tools, 3 auth layers, send messages as the actual user (not bot). |
| Link | https://github.com/EthanQC/feishu-user-plugin |
| Category | Communication |
| Contact Email | (your email) |

Optional $39 fast-track skip. Default queue is unbounded — could be days to weeks.
