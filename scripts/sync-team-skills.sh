#!/usr/bin/env bash
set -e
TEAM_SKILLS="/Users/abble/team-skills/plugins/feishu-user-plugin"
if [ ! -d "$TEAM_SKILLS" ]; then echo "[hook] team-skills not present, skip"; exit 0; fi
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
cp -r skills/. "$TEAM_SKILLS/skills/"
cp .claude-plugin/plugin.json "$TEAM_SKILLS/.claude-plugin/"
# cwd must be team-skills repo ROOT for `git add plugins/...` to resolve.
# $TEAM_SKILLS = .../team-skills/plugins/feishu-user-plugin → root is two up.
cd "$TEAM_SKILLS/../.."
VERSION=$(node -e "console.log(require('$TEAM_SKILLS/.claude-plugin/plugin.json').version)")
BRANCH="sync/feishu-v$VERSION"
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "[hook] branch $BRANCH already exists, skipping"; exit 0
fi
git checkout -b "$BRANCH"
git add "plugins/feishu-user-plugin/"
# team-skills also has scripts/generate-catalog.py that mirrors plugin.json
# into catalog.yaml; CI fails if catalog drifted. Run it if available.
if [ -x "scripts/generate-catalog.py" ] || [ -f "scripts/generate-catalog.py" ]; then
  python3 scripts/generate-catalog.py >/dev/null 2>&1 || true
  git add catalog.yaml 2>/dev/null || true
fi
git commit -m "chore: sync feishu-user-plugin v$VERSION skills + plugin.json" || { echo "[hook] nothing to sync"; exit 0; }
git push -u origin "$BRANCH"
gh pr create --title "Sync feishu-user-plugin v$VERSION" --body "Auto-sync from feishu-user-plugin main. Manual edits still needed: plugins/feishu-user-plugin/README.md changelog section + root README.md catalog row."
PR_NUM=$(gh pr view --json number --jq .number)
# auto-merge may not be enabled; --auto is best-effort, falls through to manual.
gh pr merge "$PR_NUM" --auto --merge 2>/dev/null || gh pr merge "$PR_NUM" --merge 2>/dev/null || true
echo "[hook] team-skills sync PR #$PR_NUM created"
