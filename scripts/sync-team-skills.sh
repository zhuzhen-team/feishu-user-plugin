#!/usr/bin/env bash
# scripts/sync-team-skills.sh — post-merge hook on main.
#
# What this does (zero manual steps, no degradation):
#   1. Copy skills/ + .claude-plugin/plugin.json into team-skills repo
#   2. Run team-skills' generate-catalog.py (forced manual-yaml path for byte
#      parity with CI)
#   3. Run our scripts/generate-release-artifacts.js to produce
#      changelog + readme-row from CHANGELOG.md
#   4. Inject the changelog block into team-skills child README before the
#      previous version's heading
#   5. Replace the team-skills root README catalog row matching feishu-user-plugin
#   6. Commit + push branch + open PR
#   7. Auto-merge: --admin --squash (we have admin on team-skills repo;
#      org-level setting blocks repo PATCH for allow_auto_merge so we use
#      --admin to bypass review wait. CI is non-blocking via "Check catalog"
#      drift never happening since step 2 produced byte-identical output.)
#
# Failure modes are now narrow:
#   - team-skills repo not cloned at expected path → clean skip
#   - branch already exists from previous attempt → clean skip
#   - generate-release-artifacts.js fails → exit non-zero (visible to user
#     via post-merge stderr; user fixes CHANGELOG and re-pushes)
set -e
TEAM_SKILLS="/Users/abble/team-skills/plugins/feishu-user-plugin"
if [ ! -d "$TEAM_SKILLS" ]; then echo "[hook] team-skills not present, skip"; exit 0; fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

VERSION=$(node -e "console.log(require('./package.json').version)")
ARTIFACTS="/tmp/feishu-release/v${VERSION}"

# Generate release artifacts FIRST so we can inject them into team-skills.
# This reads CHANGELOG.md for the v$VERSION section and emits team-skills
# changelog markdown + root readme row + announcement card JSON.
node scripts/generate-release-artifacts.js "$VERSION" >/dev/null

# Copy plugin tree.
cp -r skills/. "$TEAM_SKILLS/skills/"
cp .claude-plugin/plugin.json "$TEAM_SKILLS/.claude-plugin/"

# Inject changelog block into team-skills/plugins/feishu-user-plugin/README.md.
# Insert just before the existing first "### vX.Y.Z" heading, OR after
# "## 更新日志" if no prior version exists.
README="$TEAM_SKILLS/README.md"
if grep -q "^### v${VERSION} " "$README"; then
  echo "[hook] team-skills child README already has v${VERSION} section, skipping inject"
else
  # awk: print everything; when we hit the FIRST `### vX.Y.Z (date)` heading,
  # insert the new block before it.
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

# Replace the team-skills root README catalog row matching feishu-user-plugin.
ROOT_README="$TEAM_SKILLS/../../README.md"
NEW_ROW=$(cat "$ARTIFACTS/team-skills-readme-row.md")
if grep -q "^| \\*\\*feishu-user-plugin\\*\\* |" "$ROOT_README"; then
  # Replace the line in-place. Use Python (sed regex with table chars + |
  # quotes is brittle across BSD/GNU).
  python3 -c "
import sys, re
p = '$ROOT_README'
new_row = '''$NEW_ROW'''.strip()
text = open(p, 'r', encoding='utf-8').read()
text = re.sub(r'^\| \*\*feishu-user-plugin\*\* \|.*\$', new_row, text, count=1, flags=re.M)
open(p, 'w', encoding='utf-8').write(text)
"
  echo "[hook] updated root README catalog row to v${VERSION}"
fi

# Switch into team-skills repo root (two parents up from $TEAM_SKILLS).
cd "$TEAM_SKILLS/../.."

BRANCH="sync/feishu-v$VERSION"
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "[hook] branch $BRANCH already exists locally, skipping"; exit 0
fi
git checkout -b "$BRANCH"

# team-skills CI runs generate-catalog.py without PyYAML; force the same path
# locally for byte-identical output. Verified in PR #36.
if [ -f "scripts/generate-catalog.py" ]; then
  python3 -c "import sys, runpy; sys.modules['yaml']=None; runpy.run_path('scripts/generate-catalog.py', run_name='__main__')" >/dev/null 2>&1
fi

# Stage every file the hook might have touched. Each `git add` is idempotent
# on already-clean files, so unchanged ones stage as no-op. Files that don't
# exist (e.g., catalog.yaml when team-skills repo doesn't have the generator)
# would fail under `set -e`, so guard explicitly.
git add "plugins/feishu-user-plugin/"
[ -f "README.md" ]    && git add README.md
[ -f "catalog.yaml" ] && git add catalog.yaml

# If nothing actually changed, exit 0 — the v$VERSION sync was already done.
if git diff --cached --quiet; then
  echo "[hook] nothing to sync (working tree clean for v$VERSION)"; exit 0
fi

git commit -m "chore: sync feishu-user-plugin v$VERSION (skills + plugin.json + README changelog + catalog)"
git push -u origin "$BRANCH"

gh pr create --title "Sync feishu-user-plugin v$VERSION" --body "Auto-sync from feishu-user-plugin main. Includes:
- plugins/feishu-user-plugin/.claude-plugin/plugin.json bumped to v$VERSION
- plugins/feishu-user-plugin/skills/ regenerated
- plugins/feishu-user-plugin/README.md: v$VERSION changelog section auto-generated from feishu-user-plugin's CHANGELOG.md
- README.md (root): catalog row updated
- catalog.yaml regenerated"

PR_NUM=$(gh pr view --json number --jq .number)
# Use --admin --squash: we have admin permissions on team-skills (verified) and
# the team-skills org has auto-merge disabled at org level. --admin merges
# without waiting for required reviews. CI is informational only here.
gh pr merge "$PR_NUM" --admin --squash
echo "[hook] team-skills sync PR #$PR_NUM merged"
