// src/tools/_registry.js — shared infrastructure for tool modules.
//
// Every src/tools/<domain>.js exports:
//   { schemas: [<MCP tool schema objects>], handlers: { [name]: async (args, ctx) => MCPResponse } }
//
// The ctx object that handlers receive is built in src/server.js (or, during
// the v1.3.7 phase A migration, temporarily in src/index.js) and provides:
//   - getUserClient():   Promise<LarkUserClient>
//   - getOfficialClient(): LarkOfficialClient
//   - chatIdMapper:      ChatIdMapper instance (fuzzy chat ID memo)
//   - resolveDocId(x):   Promise<string>  — wiki-node / URL → native token
//   - listProfiles():    string[]         — names from LARK_PROFILES_JSON + 'default'
//   - getActiveProfile():string
//   - setActiveProfile(name): void        — invalidates cached clients
//
// Response builders below are imported directly by each tool module — they're
// not on ctx because they're pure functions with no state.

const text = (s) => ({ content: [{ type: 'text', text: s }] });

// `json` will lift any `fallbackWarning` field to the top of the rendered
// response so users see the warning before the structured payload. Preserved
// from index.js v1.3.5 behaviour.
const json = (o) => {
  const warn = o && typeof o === 'object' && o.fallbackWarning ? `${o.fallbackWarning}\n\n` : '';
  return text(warn + JSON.stringify(o, null, 2));
};

const sendResult = (r, desc) => text(r.success ? desc : `Send failed (status: ${r.status})`);

module.exports = { text, json, sendResult };
