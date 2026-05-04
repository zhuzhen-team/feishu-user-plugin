#!/usr/bin/env bash
set -e
TEAM_SKILLS="/Users/abble/team-skills/plugins/feishu-user-plugin"
if [ ! -d "$TEAM_SKILLS" ]; then echo "[hook] team-skills not present, skip"; exit 0; fi
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
cp -r skills/. "$TEAM_SKILLS/skills/"
cp .claude-plugin/plugin.json "$TEAM_SKILLS/.claude-plugin/"
cd "$TEAM_SKILLS/.."
VERSION=$(node -e "console.log(require('$TEAM_SKILLS/.claude-plugin/plugin.json').version)")
BRANCH="sync/feishu-v$VERSION"
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "[hook] branch $BRANCH already exists, skipping"; exit 0
fi
git checkout -b "$BRANCH"
git add "plugins/feishu-user-plugin/"
git commit -m "chore: sync feishu-user-plugin v$VERSION skills + plugin.json" || { echo "[hook] nothing to sync"; exit 0; }
git push -u origin "$BRANCH"
gh pr create --title "Sync feishu-user-plugin v$VERSION" --body "Auto-sync from feishu-user-plugin main."
PR_NUM=$(gh pr view --json number --jq .number)
gh pr merge "$PR_NUM" --auto --merge
echo "[hook] team-skills sync PR #$PR_NUM created with auto-merge"
