# Anthropic Connectors Directory（claude.com/docs/connectors）—— Deferred to v1.4

**Status**: ⏸ Blocked
**Reason**: Submission requires `.mcpb` packaging + `manifest.json::privacy_policies` + a README "Privacy Policy" section. Missing privacy policy = automatic rejection.

## Submission entry

- Local stdio servers (us): https://clau.de/desktop-extention-submission (Anthropic typo, real URL)
- Form criteria & checklist: https://claude.com/docs/connectors/building/review-criteria
- Pre-submission docs: https://claude.com/docs/connectors/building/submission

## What's missing

| Requirement | Status | Effort to fix |
|---|---|---|
| `.mcpb` packaging build | ❌ Not implemented | 1-2 days |
| `manifest.json` with `privacy_policies` array | ❌ No manifest yet | 0.5 day |
| README "Privacy Policy" section | ❌ Missing | 0.5 day, but needs careful drafting (data collection/usage/storage/third-party sharing/retention/contact) |
| Test account credentials with setup instructions | ❌ Not prepared | Need a Feishu test tenant with all 5 envs configured |
| Logo, favicon, screenshots, branding assets | ❌ Partial — have docs/og.png pending | Will be done in P2 OG image PR |
| Tool/resource/prompt inventory | ✅ 84 tools + 9 prompts already documented in CLAUDE.md / SKILL.md | — |
| Documentation + support URLs | ✅ ethanqc.github.io + GitHub issues + Discussions | — |
| License | ✅ MIT | — |

## v1.4 plan

When the user wants to revisit this channel:

1. **Privacy Policy section in README + dedicated `PRIVACY.md`**:
   - What data the plugin collects (cookie / app token / UAT — all from the user's machine, never leaves)
   - What data it processes (messages / docs / etc — only what the user asks via tool call)
   - What data is stored (`~/.feishu-user-plugin/credentials.json` mode 0600, no telemetry)
   - Third-party sharing (Feishu open API + Anthropic Claude API — declare these dependencies)
   - Retention (no server-side retention; user's local machine only)
   - Contact (issues@github.com/EthanQC/feishu-user-plugin/issues)

2. **`.mcpb` packaging**:
   - Anthropic's `.mcpb` format is for desktop extensions (Claude Desktop)
   - Spec: https://claude.com/docs/connectors/building/desktop-extension
   - We need: `manifest.json` (with `privacy_policies` array, name, description, transport, command), packaged ZIP with .mcpb extension

3. **Test tenant setup instructions**:
   - Create a fresh Feishu tenant, configure a test app with all required scopes
   - Document the exact env var values to pass to reviewers (or temp credentials with 2-week expiry)

4. **Submit form**: https://clau.de/desktop-extention-submission

5. **Email fallback**: `mcp-directory-support@anthropic.com` if firewalled out of the form

## Why this is worth doing eventually

Anthropic's directory is **the** entry point for Claude Code users discovering MCP servers. Once approved, we'd be visible to the entire Claude Code user base via the official directory UI. Highest ROI single channel for the international audience.

## Tracking

Filed as ROADMAP.md item under v1.4 candidates. Re-evaluate priority when:
- We have ≥ 100 GitHub stars (signal of maintained, used project)
- We have a stable v1.4 release with the `.mcpb` build pipeline
- Privacy Policy is reviewed by a friend with legal background
