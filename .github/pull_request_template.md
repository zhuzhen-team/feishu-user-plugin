## Summary

<!-- 简短说明这个 PR 干了什么 / Brief description -->

## Changes

-

## Pre-commit / CI gates

- [ ] `npm run smoke` passes — no regression in 85 tools / 9 prompts / login_status shape
- [ ] If schema delta intentional: regenerated baseline with `npm run smoke:baseline`
- [ ] Version quad (`package.json` / `.claude-plugin/plugin.json` / `skills/feishu-user-plugin/SKILL.md` / `.cursor-plugin/plugin.json`) consistent if any of these touched
- [ ] CLAUDE.md auto-synced to AGENTS.md + skill ref (hook handles this; just `git add -p` if it stages something)
- [ ] No new dependencies added (or justified if added)

## Testing notes

<!-- What you actually verified, beyond CI: real Feishu calls, browser checks, edge cases, etc. -->

## Related Issues

<!-- Closes #123 -->
