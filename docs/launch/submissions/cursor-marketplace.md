# Cursor Marketplace Submission —— Deferred to v1.4

**Status**: ⏸ Blocked
**Reason**: Submission requires `.cursor-plugin/plugin.json` manifest at repo root + auxiliary files. Manual review by Cursor team — must also be open source (we are, MIT).

## Submission entry

- Form: https://cursor.com/marketplace/publish (form takes a public Git repo URL, Cursor team manually reviews)
- Schema: https://github.com/cursor/plugins/blob/main/schemas/plugin.schema.json
- Plugin docs: https://cursor.com/docs/reference/plugins

## What's missing

We need to add a `.cursor-plugin/plugin.json` manifest to the repo root. Required fields:

| Field | Value |
|---|---|
| `name` | `feishu-user-plugin` (kebab-case, lowercase alphanumeric) |
| `displayName` | `Feishu MCP for Claude Code & Codex` (or similar) |
| `description` | Same as `package.json::description` |
| `version` | Sync with `package.json::version` (require version-triangle equality check addition) |
| `author` | `{ name: "EthanQC", email: "<provided>" }` |
| `homepage` | `https://ethanqc.github.io/feishu-user-plugin/` |
| `repository` | `https://github.com/EthanQC/feishu-user-plugin` |
| `license` | `MIT` |
| `category` | `Communication` |
| `keywords` | `["feishu", "lark", "mcp", "claude-code", "codex"]` |
| `mcpServers` | Pointer to `mcp.json` or inline config (matches existing `~/.claude.json` JSON snippet from README) |
| `logo` | `docs/og.png` after P2 #11 lands (or favicon-style separate asset) |

## v1.4 plan

1. **Add `.cursor-plugin/plugin.json`**:
   - Single JSON file at repo root
   - Add `cursor-plugin` to `package.json::files` so npm tarball ships it
   - Update version triangle check to include this file's version field

2. **Decide on shared vs duplicated `mcpServers` config**:
   - Option A: inline in `plugin.json` (simpler, but config duplicated with `~/.claude.json` example)
   - Option B: separate `mcp.json` referenced from `plugin.json` (DRY, but extra file)
   - Recommended: A for first submission, refactor to B if needed later

3. **Existing `skills/` directory**:
   - Cursor reads `skills/` SKILL.md format same as Claude Code (verified per agent recon)
   - 9 existing skills will be auto-available — no porting needed

4. **Submit**:
   - Form at `cursor.com/marketplace/publish`
   - Provide: GitHub repo URL, contact email
   - Cursor team manually reviews — turnaround not documented

5. **Note**: Marketplace is **not** auto-discovered from npm. Must explicitly submit. Community-side `cursor.directory/plugins` is unrelated to the official marketplace.

## Why deferred

- We need to make Cursor Marketplace work without breaking the existing Claude Code / Codex / OpenClaw layouts
- `.cursor-plugin/plugin.json` is a one-time addition — fine to bundle into v1.4 alongside the Anthropic Connectors `.mcpb` work
- The new file impacts the version-triangle pre-commit gate; need test coverage for it before relying on it

## Tracking

Filed as ROADMAP.md item under v1.4 candidates. Re-evaluate priority when:
- We have ≥ 200 GitHub stars or a confirmed Cursor user requesting native marketplace install
- v1.4 ships its `.mcpb` work (we can do both manifests in one PR)
