// src/prompts/_registry.js — Load the 9 sub-skill markdown files as MCP prompt definitions.
//
// Reads from skills/feishu-user-plugin/references/ (whitelisted set).
// For each file:
//   - name: filename without .md
//   - description: first non-empty line
//   - arguments: [{name:'arguments', description, required:false}] if body contains $ARGUMENTS
//   - body: full file content (used for substitution in getPrompt)

'use strict';

const fs = require('fs');
const path = require('path');

const WHITELIST = new Set(['send', 'reply', 'digest', 'search', 'doc', 'table', 'wiki', 'drive', 'status']);
const REFS_DIR = path.join(__dirname, '..', '..', 'skills', 'feishu-user-plugin', 'references');

/**
 * Parse $ARGUMENTS description from the ## 参数 section.
 * Looks for a line matching "- $ARGUMENTS：<desc>" or "- $ARGUMENTS: <desc>".
 * Returns the description text, or a generic fallback.
 */
function parseArgumentsDescription(body) {
  const match = body.match(/\$ARGUMENTS[：:]\s*(.+)/);
  if (match) {
    return match[1].trim();
  }
  return 'Skill arguments';
}

/**
 * Load all whitelisted sub-skill files and return prompt definitions.
 * @returns {Array<{name: string, description: string, arguments?: Array, body: string}>}
 */
function loadAllSkills() {
  const prompts = [];
  for (const name of WHITELIST) {
    const filePath = path.join(REFS_DIR, `${name}.md`);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      console.error(`[feishu-user-plugin] prompts: could not read ${filePath}: ${e.message}`);
      continue;
    }

    // description = first non-empty line
    const lines = content.split('\n');
    const firstNonEmpty = lines.find((l) => l.trim() !== '');
    const description = firstNonEmpty ? firstNonEmpty.trim() : name;

    const hasArguments = content.includes('$ARGUMENTS');
    const prompt = {
      name,
      description,
      body: content,
    };
    if (hasArguments) {
      const argDesc = parseArgumentsDescription(content);
      prompt.arguments = [{ name: 'arguments', description: argDesc, required: false }];
    }
    prompts.push(prompt);
  }
  // Sort deterministically by name
  prompts.sort((a, b) => a.name.localeCompare(b.name));
  return prompts;
}

module.exports = { loadAllSkills };
