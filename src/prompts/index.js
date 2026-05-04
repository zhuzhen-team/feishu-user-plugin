// src/prompts/index.js — MCP prompt registry: listPrompts + getPrompt.
//
// Loaded once at module load; cached for the lifetime of the server process.
// listPrompts() → MCP prompts/list shaped array (no body exposed in listing).
// getPrompt(name, args) → MCP prompts/get shaped result with $ARGUMENTS substituted.

'use strict';

const { loadAllSkills } = require('./_registry');

// Cache all skills once at module load.
const _skills = loadAllSkills();
const _byName = new Map(_skills.map((s) => [s.name, s]));

/**
 * Returns the spec-shaped prompts array for prompts/list.
 * Omits the body field; omits arguments if empty.
 */
function listPrompts() {
  return _skills.map((s) => {
    const p = { name: s.name, description: s.description };
    if (s.arguments && s.arguments.length > 0) {
      p.arguments = s.arguments;
    }
    return p;
  });
}

/**
 * Returns the prompts/get result for a given prompt name.
 * Substitutes $ARGUMENTS in the body with args.arguments (or empty string).
 * @param {string} name
 * @param {object} args - e.g. { arguments: "Alice: hi" }
 * @returns {{ description: string, messages: [{role: 'user', content: {type: 'text', text: string}}] }}
 */
function getPrompt(name, args = {}) {
  const skill = _byName.get(name);
  if (!skill) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  const argValue = args.arguments != null ? String(args.arguments) : '';
  const text = skill.body.replace(/\$ARGUMENTS/g, argValue);
  return {
    description: skill.description,
    messages: [
      {
        role: 'user',
        content: { type: 'text', text },
      },
    ],
  };
}

module.exports = { listPrompts, getPrompt };
