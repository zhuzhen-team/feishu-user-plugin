#!/usr/bin/env node
'use strict';
// Scans tracked .md files for broken intra-repo file links.
//
// Checks only whether the target FILE exists on disk. Does NOT verify
// section anchors (GitHub's anchor-slug algorithm has CJK / em-dash
// edge cases that produce too many false positives to be worth the
// gate's signal). If you rename a heading and a link's #anchor stops
// working, GitHub renders the link clickable but lands at the page
// top — annoying but not broken in the structural sense.
//
// Checks:
//   - [text](path/to/file.md) — relative or absolute path within the repo
//   - [text](./file.md) / [text](../file.md) — relative paths
//
// Skips:
//   - http:// / https:// links (external URLs not verified)
//   - mailto: / # (pure page-internal anchors)
//   - Image links ![...](...)
//   - Targets that don't end in a file extension (e.g. "知乎专栏链接",
//     "wikcnXXX", "args, ctx") — these are placeholder text inside
//     markdown link syntax, not real file paths
//   - Files under docs/launch/ + docs/superpowers/ (staging / historical
//     plan docs — placeholder text + draft links are intentional there)
//
// Why this gate exists: PR-H series consolidated cross-link style
// (relative paths in docs/* and README, GitHub URLs in CLAUDE.md /
// AGENTS.md). Without this gate, future PRs can silently break links
// when files are renamed.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Tracked .md files
const allFiles = execSync('git ls-files "*.md"', { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

// Skip staging / historical-plan directories — links there are often
// intentional placeholders for content yet to be written.
const SKIP_DIRS = ['docs/launch/', 'docs/superpowers/'];
const files = allFiles.filter(f => !SKIP_DIRS.some(d => f.startsWith(d)));

const failures = [];

// Pattern: [link text](target) — but not preceded by `!` (image)
const LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;

// Heuristic: real file paths have a file extension (.md, .png, .json, ...) or
// they're a directory reference. Anything else is treated as placeholder text.
const FILE_EXT_RE = /\.[a-zA-Z0-9]{1,8}(#|$)/;

// Skip .html targets — Jekyll Pages cross-page links (`./en.html`) point at
// HTML produced by jekyll-build, not source files in the repo. The .html
// equivalent doesn't exist on disk but works at runtime on the rendered site.
const JEKYLL_HTML_RE = /\.html(#|$)/;

// Strip code blocks (``` ... ``` and `inline`) so we don't false-positive
// on markdown link syntax that appears inside code examples.
function stripCode(content) {
  return content
    .replace(/```[\s\S]*?```/g, '')   // fenced
    .replace(/`[^`\n]+`/g, '');       // inline
}

for (const file of files) {
  const content = stripCode(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const dir = path.dirname(file);

  for (const m of content.matchAll(LINK_RE)) {
    const linkTarget = m[2].trim();

    // Skip external URLs and mailto/etc
    if (/^[a-z]+:\/\//i.test(linkTarget) || linkTarget.startsWith('mailto:')) continue;
    // Skip pure page-internal anchors
    if (linkTarget.startsWith('#')) continue;
    // Skip targets that don't look like file paths (placeholder text)
    if (!FILE_EXT_RE.test(linkTarget) && !linkTarget.endsWith('/')) continue;
    // Skip Jekyll-rendered .html links (cross-page in docs/index.md / en.md)
    if (JEKYLL_HTML_RE.test(linkTarget)) continue;

    // Strip anchor portion if present
    const pathPart = linkTarget.split('#')[0];
    if (!pathPart) continue;

    // Resolve target: leading `/` means repo-absolute (rare but valid in
    // markdown); otherwise resolve relative to the source file's directory.
    // path.resolve handles `..` and normalizes; the boundary check below
    // rejects targets that escape ROOT.
    const absoluteResolved = pathPart.startsWith('/')
      ? path.resolve(ROOT, pathPart.replace(/^\/+/, ''))
      : path.resolve(ROOT, dir, pathPart);

    if (absoluteResolved !== ROOT && !absoluteResolved.startsWith(ROOT + path.sep)) {
      failures.push(`${file}: broken link "${linkTarget}" — target escapes repo root`);
      continue;
    }

    if (!fs.existsSync(absoluteResolved)) {
      const rel = path.relative(ROOT, absoluteResolved);
      failures.push(`${file}: broken link "${linkTarget}" — file "${rel}" does not exist`);
    }
  }
}

if (failures.length) {
  console.error(`Broken markdown file links detected (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('\nFix: update the path in the source .md, or rename / restore the referenced file.');
  process.exit(1);
}

console.log(`OK: scanned ${files.length} .md files (excluding ${SKIP_DIRS.join(' / ')}), no broken intra-repo file links`);
