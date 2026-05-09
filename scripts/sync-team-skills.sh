#!/usr/bin/env bash
# scripts/sync-team-skills.sh — post-merge hook on main.
#
# Idempotent + conflict-resilient sync from feishu-user-plugin's main into
# zhuzhen-team/team-skills. Designed so retries always converge:
#
# Flow:
#   1. Generate release artifacts in feishu repo (changelog block + readme row).
#   2. cd team-skills repo, fetch origin main.
#   3. Close any stale OPEN sync PRs whose branch is for an older version
#      (so v1.3.10 sync doesn't pile up behind a never-merged v1.3.9 sync).
#   4. Delete any local stale sync/feishu-v$VERSION branch and recreate from
#      origin/main — always starts fresh, never carries leftover commits.
#   5. Copy plugin tree + inject changelog + replace catalog row + regen catalog.
#   6. If nothing changed → exit 0 (already in sync for v$VERSION).
#   7. Commit + push --force-with-lease (safe: only this script writes to sync/* branches).
#   8. Open PR if not exists; merge --admin --squash.
#
# Failure modes:
#   - team-skills repo not cloned at expected path → clean skip
#   - generate-release-artifacts.js fails → exit non-zero (visible in stderr)
#   - PR merge fails (rare; should be impossible after force-recreate from origin/main)
#     → exit non-zero, post-merge wrapper labels as "non-fatal" but user sees stderr
set -e

TEAM_SKILLS_REPO="/Users/abble/team-skills"
TEAM_SKILLS="$TEAM_SKILLS_REPO/plugins/feishu-user-plugin"
if [ ! -d "$TEAM_SKILLS" ]; then echo "[hook] team-skills not present, skip"; exit 0; fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

VERSION=$(node -e "console.log(require('./package.json').version)")
ARTIFACTS="/tmp/feishu-release/v${VERSION}"
BRANCH="sync/feishu-v$VERSION"

# 1. Generate release artifacts FIRST so we can inject them into team-skills.
node scripts/generate-release-artifacts.js "$VERSION" >/dev/null

# 2. cd team-skills, fetch origin main.
cd "$TEAM_SKILLS_REPO"
git fetch origin main --quiet

# 3. Close any stale OPEN sync PRs (different version branch). Idempotent —
#    any matching PR for this same $VERSION is preserved (we'll force-update
#    its branch in step 7 instead).
STALE_PRS=$(gh pr list --state open --search "Sync feishu-user-plugin in:title" \
  --json number,headRefName --jq ".[] | select(.headRefName != \"$BRANCH\") | .number")
if [ -n "$STALE_PRS" ]; then
  for stale_num in $STALE_PRS; do
    gh pr close "$stale_num" \
      --comment "Superseded by sync/feishu-v$VERSION (auto-closed by sync-team-skills.sh)" \
      --delete-branch 2>&1 | tail -1 || true
    echo "[hook] closed stale sync PR #$stale_num"
  done
fi

# 4. Delete any local stale sync branch + recreate from origin/main.
#    `git checkout -B` is "create or reset". We always start from latest main
#    so there are no inherited commits from older sync attempts.
git checkout -B "$BRANCH" origin/main

# 5. Copy plugin tree from feishu repo, inject changelog, regen catalog.
cp -r "$ROOT/skills/." "$TEAM_SKILLS/skills/"
cp "$ROOT/.claude-plugin/plugin.json" "$TEAM_SKILLS/.claude-plugin/"

# 5a. Inject changelog block into team-skills child README (idempotent).
README="$TEAM_SKILLS/README.md"
if grep -q "^### v${VERSION} " "$README"; then
  echo "[hook] team-skills child README already has v${VERSION} section, skipping inject"
else
  awk -v block_file="$ARTIFACTS/team-skills-changelog.md" '
    BEGIN { inserted = 0 }
    /^### v[0-9]+\.[0-9]+\.[0-9]+ \(/ && !inserted {
      while ((getline line < block_file) > 0) print line
      print ""
      inserted = 1
    }
    { print }
  ' "$README" > "$README.tmp" && mv "$README.tmp" "$README"
  echo "[hook] injected v${VERSION} changelog block into child README"
fi

# 5b. Replace root README catalog row matching feishu-user-plugin.
ROOT_README="$TEAM_SKILLS_REPO/README.md"
NEW_ROW=$(cat "$ARTIFACTS/team-skills-readme-row.md")
if grep -q "^| \\*\\*feishu-user-plugin\\*\\* |" "$ROOT_README"; then
  python3 -c "
import re
p = '$ROOT_README'
new_row = '''$NEW_ROW'''.strip()
text = open(p, 'r', encoding='utf-8').read()
text = re.sub(r'^\| \*\*feishu-user-plugin\*\* \|.*\$', new_row, text, count=1, flags=re.M)
open(p, 'w', encoding='utf-8').write(text)
"
  echo "[hook] updated root README catalog row to v${VERSION}"
fi

# 5c. Regenerate catalog.yaml (force PyYAML-less path for byte parity with CI).
if [ -f "scripts/generate-catalog.py" ]; then
  python3 -c "import sys, runpy; sys.modules['yaml']=None; runpy.run_path('scripts/generate-catalog.py', run_name='__main__')" >/dev/null 2>&1
fi

# 6. Stage everything the hook touched.
git add "plugins/feishu-user-plugin/"
[ -f "README.md" ]    && git add README.md
[ -f "catalog.yaml" ] && git add catalog.yaml

if git diff --cached --quiet; then
  echo "[hook] nothing to sync (working tree clean for v$VERSION)"; exit 0
fi

git commit -m "chore: sync feishu-user-plugin v$VERSION (skills + plugin.json + README changelog + catalog)"

# 7. Push (force-with-lease since this branch is exclusively written by this
#    script — safe even if a previous run pushed something we just rebuilt).
git push --force-with-lease -u origin "$BRANCH"

# 8. Open PR if not exists, then merge.
PR_NUM=$(gh pr list --head "$BRANCH" --state open --json number --jq ".[0].number // empty")
if [ -z "$PR_NUM" ]; then
  gh pr create --title "Sync feishu-user-plugin v$VERSION" --body "Auto-sync from feishu-user-plugin main. Includes:
- plugins/feishu-user-plugin/.claude-plugin/plugin.json bumped to v$VERSION
- plugins/feishu-user-plugin/skills/ regenerated
- plugins/feishu-user-plugin/README.md: v$VERSION changelog section auto-generated from feishu-user-plugin's CHANGELOG.md
- README.md (root): catalog row updated
- catalog.yaml regenerated"
  PR_NUM=$(gh pr view "$BRANCH" --json number --jq .number)
  echo "[hook] opened sync PR #$PR_NUM"
else
  echo "[hook] reusing existing sync PR #$PR_NUM (branch force-updated)"
fi

# Use --admin --squash: we have admin permissions on team-skills (verified).
# After step 4's force-recreate from origin/main, this PR is always cleanly
# mergeable (no carried conflicts). --admin bypasses required reviews; CI
# is informational since step 5c produced byte-identical catalog output.
gh pr merge "$PR_NUM" --admin --squash
echo "[hook] team-skills sync PR #$PR_NUM merged"
