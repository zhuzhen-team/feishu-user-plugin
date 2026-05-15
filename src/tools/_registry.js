// src/tools/_registry.js — shared infrastructure for tool modules.
//
// Every src/tools/<domain>.js exports:
//   { schemas: [<MCP tool schema objects>], handlers: { [name]: async (args, ctx) => MCPResponse } }
//
// The ctx object that handlers receive is built in src/server.js (or, during
// the v1.3.7 phase A migration, temporarily in src/index.js) and provides:
//   - getUserClient():   Promise<LarkUserClient>
//   - getOfficialClient(): LarkOfficialClient
//   - getEventBuffer():  EventBuffer | null  — null when WS isn't running
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

// sendResult — unified shape for send_*_as_user tools (v1.3.12).
// Returns JSON inside an MCP text block:
//   { ok, viaUser, description?, status?, messageId?, fallbackWarning? }
//
// `r` is the raw response from a Lark client:
//   - LarkUserClient.send*  → { success: bool, status: number }
//   - LarkOfficialClient.sendMessageAsBot → { messageId: string }
//
// Back-compat signature: `sendResult(r, desc)` still works (desc treated as
// description). New callers can pass `sendResult(r, { desc, viaUser: false,
// fallbackWarning })`.
const sendResult = (r, descOrOpts) => {
  const opts = typeof descOrOpts === 'string' ? { desc: descOrOpts } : (descOrOpts || {});
  const { desc, viaUser = true, fallbackWarning } = opts;
  const out = {
    ok: !!(r && (r.success || r.messageId)),
    viaUser,
  };
  if (desc) out.description = desc;
  if (r?.messageId) out.messageId = r.messageId;
  if (r && typeof r.status !== 'undefined') out.status = r.status;
  if (fallbackWarning) out.fallbackWarning = fallbackWarning;
  return json(out);
};

module.exports = { text, json, sendResult };
