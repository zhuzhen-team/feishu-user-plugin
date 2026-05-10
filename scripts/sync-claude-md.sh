#!/usr/bin/env bash
set -e
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if git diff --cached --name-only | grep -qx "CLAUDE.md"; then
  tail -n +2 CLAUDE.md > /tmp/feishu-claude-body.$$
  { echo "# feishu-user-plugin — Codex 指令"; cat /tmp/feishu-claude-body.$$; } > AGENTS.md
  rm -f /tmp/feishu-claude-body.$$
  git add AGENTS.md
  echo "[hook] CLAUDE.md → AGENTS.md synced"
fi
