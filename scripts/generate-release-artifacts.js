#!/usr/bin/env node
'use strict';
// scripts/generate-release-artifacts.js
//
// Reads CHANGELOG.md for the latest version section + package.json + server.json,
// emits three deterministic artifacts for the release pipeline:
//
//   /tmp/feishu-release/<version>/team-skills-changelog.md
//      Markdown block ready to inject into team-skills child README's
//      "## 更新日志" section, just before the previous "### vX.Y.Z" entry.
//      Style mirrors the existing team-skills format (• bullets, no emoji,
//      sections: 新增 / 调整 / 修复 / 下版本计划 / 升级方式).
//
//   /tmp/feishu-release/<version>/team-skills-readme-row.md
//      Single-line replacement for the root team-skills/README.md catalog
//      row matching `| **feishu-user-plugin** | ...`.
//
//   /tmp/feishu-release/<version>/feishu-card.json
//      Feishu interactive card payload for `send_card_as_user`. Header
//      template "blue", body sections separated by <hr>, each section
//      uses lark_md for markdown rendering.
//
// Determinism contract — given the same CHANGELOG.md version section, this
// script emits the same artifacts byte-for-byte. No timestamps, no random IDs,
// no LLM passes. CHANGELOG must follow Keep a Changelog conventions:
//
//   ## [X.Y.Z] - YYYY-MM-DD
//
//   <one-paragraph summary>      ← optional but recommended
//
//   ### Added              (translated to 新增)
//   - **Title**: rest of bullet.
//   - ...
//
//   ### Changed            (调整)
//   ### Fixed              (修复)
//   ### Deferred to vN.M.P (下版本计划 (vN.M.P))
//   ### Test scenarios     (used in 升级方式 复测建议; optional)
//   - bullet line, can be markdown
//
// Usage:
//   node scripts/generate-release-artifacts.js               (latest version)
//   node scripts/generate-release-artifacts.js 1.3.8         (explicit)
//
// Exit codes:
//   0 success
//   1 missing inputs / parsing failure
//   2 invalid section structure

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SECTION_TRANSLATE = {
  added: '新增',
  changed: '调整',
  fixed: '修复',
  removed: '移除',
  deprecated: '废弃',
  security: '安全',
};

function readChangelogSection(version) {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  // Anchor on `## [VERSION] - DATE`
  const escVer = version.replace(/\./g, '\\.');
  const start = new RegExp(`^##\\s*\\[${escVer}\\]\\s*-\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm');
  const m = start.exec(text);
  if (!m) throw new Error(`CHANGELOG.md has no section for v${version}`);
  const date = m[1];
  const after = text.slice(m.index + m[0].length);
  // Find next `## ` (next version heading)
  const next = after.match(/^##\s/m);
  const body = next ? after.slice(0, next.index) : after;
  return { date, body: body.trim() };
}

function parseSections(body) {
  // Top opening paragraph (anything before the first `### `).
  const firstSubheading = body.search(/^###\s/m);
  let opening = '';
  let rest = body;
  if (firstSubheading > 0) {
    opening = body.slice(0, firstSubheading).trim();
    rest = body.slice(firstSubheading);
  }
  // Split into ### sections
  const sections = {};
  const parts = rest.split(/^### /m).filter(s => s.trim());
  for (const part of parts) {
    const lines = part.split('\n');
    const title = lines[0].trim();
    const content = lines.slice(1).join('\n').trim();
    sections[title] = content;
  }
  return { opening, sections };
}

function bulletsFromSection(content) {
  // CHANGELOG bullets typically begin with `- `. Multi-line bullets continue
  // until the next `- ` or blank line. Continuation lines are preserved with
  // newlines so card rendering can show structured sub-paragraphs (e.g.
  // "**机制**: ...\n**CLI**: ...\n**边界**: ..."). Normalize tabs/leading-
  // space on continuation lines but keep the line break.
  const out = [];
  let cur = null;
  for (const raw of content.split('\n')) {
    if (raw.match(/^-\s+/)) {
      if (cur) out.push(cur);
      cur = raw.replace(/^-\s+/, '').trim();
    } else if (cur && raw.trim()) {
      cur += '\n' + raw.trim();
    } else if (!raw.trim()) {
      if (cur) { out.push(cur); cur = null; }
    }
  }
  if (cur) out.push(cur);
  // Trim each bullet edge but preserve internal newlines.
  return out.map(b => b.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim());
}

function stripBoldPrefix(bullet) {
  // CHANGELOG style: "**Title**: description" → keep both halves but drop **
  // For card / announcement, we want plain readable lines.
  return bullet.replace(/^\*\*(.+?)\*\*\s*[:：]?\s*/, '$1: ').replace(/^\*\*(.+?)\*\*$/, '$1');
}

function generateTeamSkillsChangelog(version, date, parsed, prevVersion) {
  const lines = [];
  lines.push(`### v${version} (${date})`);
  lines.push('');
  if (parsed.opening) {
    lines.push(parsed.opening);
    lines.push('');
  }

  for (const sectionName of ['Added', 'Changed', 'Fixed', 'Removed', 'Deprecated', 'Security']) {
    const content = parsed.sections[sectionName];
    if (!content) continue;
    const zh = SECTION_TRANSLATE[sectionName.toLowerCase()];
    lines.push(zh);
    lines.push('');
    for (const b of bulletsFromSection(content)) {
      lines.push(`• ${stripBoldPrefix(b)}`);
    }
    lines.push('');
  }

  // Deferred to vX.Y.Z → 下版本计划 (vX.Y.Z)
  for (const [title, content] of Object.entries(parsed.sections)) {
    const m = title.match(/^Deferred\s+to\s+(v[\d.]+)/i);
    if (!m) continue;
    lines.push(`下版本计划 (${m[1]})`);
    lines.push('');
    for (const b of bulletsFromSection(content)) {
      lines.push(`• ${stripBoldPrefix(b)}`);
    }
    lines.push('');
  }

  // 升级方式
  lines.push('升级方式');
  lines.push('');
  lines.push(`• 重启 Claude Code / Codex 自动拉取 ${version}`);
  // Hint: if any bullet mentions "migrate" or "credentials.json", add a tip.
  const allBullets = Object.values(parsed.sections).flatMap(c => bulletsFromSection(c)).join(' ');
  if (/migrate|credentials\.json|FEISHU_PLUGIN_PROFILE/i.test(allBullets)) {
    lines.push('• 推荐运行 npx feishu-user-plugin migrate --confirm 把凭证收敛到 ~/.feishu-user-plugin/credentials.json，然后 npx feishu-user-plugin setup --pointer-only 让 harness env 只放 FEISHU_PLUGIN_PROFILE 指针');
  }
  if (/WS|WebSocket|get_new_events/i.test(allBullets)) {
    lines.push('• 启动看 stderr 带 "WS connected" 表示实时事件可用；看到 "WS start failed" 是 Lark 国际版或网络限制');
  }
  // Test scenarios from optional section
  const ts = parsed.sections['Test scenarios'];
  if (ts) {
    const items = bulletsFromSection(ts).map(b => stripBoldPrefix(b));
    if (items.length > 0) {
      lines.push(`• 建议复测 ${items.length} 个场景：${items.join('；')}`);
    }
  } else {
    // Fallback: list top-3 Added bullet titles
    const added = parsed.sections['Added'];
    if (added) {
      const titles = bulletsFromSection(added)
        .map(b => {
          const m = b.match(/^\*\*([^*]+)\*\*/);
          return m ? m[1].replace(/\s*\([^)]+\)\s*$/, '') : null;
        })
        .filter(Boolean)
        .slice(0, 3);
      if (titles.length) lines.push(`• 建议复测核心新功能场景：${titles.join('；')}`);
    }
  }
  lines.push('');

  // Tool count line — read from server.json to be canonical.
  try {
    const tools = require(path.join(ROOT, 'server.json')).tools.length;
    if (prevVersion) {
      lines.push(`• 工具数：${prevVersion.tools} → **${tools}**`);
    } else {
      lines.push(`• 工具数：**${tools}**`);
    }
  } catch (_) {}
  lines.push('');

  return lines.join('\n');
}

function generateRootReadmeRow(version, packageDescription) {
  // Format must match team-skills/README.md catalog table:
  // | **feishu-user-plugin** | <ver> | <desc> | EthanQC | 1 | - |
  return `| **feishu-user-plugin** | ${version} | ${packageDescription} | EthanQC | 1 | - |`;
}

function generateCard(version, date, parsed) {
  const elements = [];

  // Opening paragraph
  if (parsed.opening) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: parsed.opening } });
    elements.push({ tag: 'hr' });
  }

  // Sections
  const sectionOrder = ['Added', 'Changed', 'Fixed', 'Removed'];
  for (const name of sectionOrder) {
    const content = parsed.sections[name];
    if (!content) continue;
    const zh = SECTION_TRANSLATE[name.toLowerCase()];
    const bullets = bulletsFromSection(content)
      .map(b => `- ${b}`)
      .join('\n');
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${zh}**\n${bullets}` } });
    elements.push({ tag: 'hr' });
  }

  // Deferred → 下版本计划
  for (const [title, content] of Object.entries(parsed.sections)) {
    const m = title.match(/^Deferred\s+to\s+(v[\d.]+)/i);
    if (!m) continue;
    const bullets = bulletsFromSection(content)
      .map(b => `- ${b}`)
      .join('\n');
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**下版本计划 (${m[1]})**\n${bullets}` } });
    elements.push({ tag: 'hr' });
  }

  // 升级方式 — same template as team-skills changelog
  const upgradeLines = [`- 重启 Claude Code / Codex 自动拉取 ${version}`];
  const allBullets = Object.values(parsed.sections).flatMap(c => bulletsFromSection(c)).join(' ');
  if (/migrate|credentials\.json|FEISHU_PLUGIN_PROFILE/i.test(allBullets)) {
    upgradeLines.push('- 推荐运行 `npx feishu-user-plugin migrate --confirm` 收敛凭证，再 `setup --pointer-only` 仅写 `FEISHU_PLUGIN_PROFILE` 指针');
  }
  if (/WS|WebSocket|get_new_events/i.test(allBullets)) {
    upgradeLines.push('- 启动 stderr 带 `WS connected` 表示实时事件可用；`WS start failed` 是 Lark 国际版 / 网络限制');
  }
  const ts = parsed.sections['Test scenarios'];
  if (ts) {
    const items = bulletsFromSection(ts).map(b => stripBoldPrefix(b));
    upgradeLines.push(`- 建议复测 ${items.length} 个场景：${items.join('；')}`);
  } else {
    const added = parsed.sections['Added'];
    if (added) {
      const titles = bulletsFromSection(added)
        .map(b => { const m = b.match(/^\*\*([^*]+)\*\*/); return m ? m[1].replace(/\s*\([^)]+\)\s*$/, '') : null; })
        .filter(Boolean)
        .slice(0, 3);
      if (titles.length) upgradeLines.push(`- 建议复测核心新功能场景：${titles.join('；')}`);
    }
  }
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**升级方式**\n${upgradeLines.join('\n')}` } });

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: `feishu-user-plugin v${version} 发布` },
    },
    elements,
  };
}

function main() {
  const explicit = process.argv[2];
  const pkg = require(path.join(ROOT, 'package.json'));
  const version = explicit || pkg.version;

  const { date, body } = readChangelogSection(version);
  const parsed = parseSections(body);

  // Sanity check: at least one of Added/Changed/Fixed must be present.
  const hasAny = ['Added', 'Changed', 'Fixed', 'Removed', 'Deprecated', 'Security']
    .some(n => parsed.sections[n]);
  if (!hasAny) {
    console.error(`CHANGELOG section for v${version} has no recognized subsection.`);
    process.exit(2);
  }

  const outDir = path.join('/tmp/feishu-release', `v${version}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Compute previous tool count from server.json git history? Best-effort:
  // Tool count delta is omitted unless caller passes it — we don't currently
  // have a clean way to get the previous version's tool count without git.
  const teamSkillsBlock = generateTeamSkillsChangelog(version, date, parsed, null);
  fs.writeFileSync(path.join(outDir, 'team-skills-changelog.md'), teamSkillsBlock);

  const rootRow = generateRootReadmeRow(version, pkg.description);
  fs.writeFileSync(path.join(outDir, 'team-skills-readme-row.md'), rootRow + '\n');

  const card = generateCard(version, date, parsed);
  fs.writeFileSync(path.join(outDir, 'feishu-card.json'), JSON.stringify(card, null, 2) + '\n');

  console.log(`Wrote: ${outDir}/`);
  console.log(`  team-skills-changelog.md  (${teamSkillsBlock.length} chars)`);
  console.log(`  team-skills-readme-row.md (${rootRow.length} chars)`);
  console.log(`  feishu-card.json          (${JSON.stringify(card).length} chars)`);
}

main();
