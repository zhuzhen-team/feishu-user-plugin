# `punkpeye/awesome-mcp-servers` 收录 PR

## Target

- Repo: https://github.com/punkpeye/awesome-mcp-servers (86k+ ⭐ as of 2026-05)
- Default branch: `main`
- File to edit: `README.md`
- Section: `### 💬 <a name="communication"></a>Communication`
- Insertion alphabetic order: between `discourse/discourse-mcp` and `elie222/inbox-zero`

## Entry line (drop into Communication section)

```markdown
- [EthanQC/feishu-user-plugin](https://github.com/EthanQC/feishu-user-plugin) 📇 ☁️ 🏠 🍎 🪟 🐧 - All-in-one Feishu/Lark MCP server (84 tools). Send messages as the actual user (not bot), plus full official-API coverage of docs, bitable, wiki, drive, calendar, tasks, OKR. Cookie + OAuth UAT + app-credential auth.
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
All-in-one MCP server for Feishu / Lark. 84 tools across 3 auth layers (cookie + OAuth UAT + app credentials). The differentiator vs other Feishu MCPs in the wild: **send messages as the actual user identity, not as a bot** — uses a reverse-engineered protobuf cookie path because Feishu's official API has no `send_as_user` scope. Plus full official-API coverage of docs, bitable, wiki, drive, calendar, tasks, OKR.

### Maintained
- npm: https://www.npmjs.com/package/feishu-user-plugin (stable v1.3.9)
- License: MIT
- Active development; pre-commit + CI gates on tool count, schema regressions, version triangle equality

### Checklist
- [x] Alphabetical order within Communication section preserved
- [x] One server per line
- [x] Concise description (within line-length conventions)
- [x] Accurate repo + project links
```

## Steps for the user (~15 min total)

1. Fork `punkpeye/awesome-mcp-servers` to your GitHub account
2. Clone the fork:
   ```bash
   git clone https://github.com/EthanQC/awesome-mcp-servers.git
   cd awesome-mcp-servers
   git checkout -b add-feishu-user-plugin
   ```
3. Open `README.md`, find the line `### 💬 <a name="communication"></a>Communication`, scroll to the alphabetic slot (between `discourse/discourse-mcp` and `elie222/inbox-zero`)
4. Paste the entry line above
5. Commit + push:
   ```bash
   git add README.md
   git commit -m "Add EthanQC/feishu-user-plugin to Communication"
   git push -u origin add-feishu-user-plugin
   ```
6. Open PR with the title + body from above
7. Merges happen continuously via maintainer review (no fixed SLA)

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
