// src/auth/profile-router.js — multi-profile auto-switch middleware (v1.3.8).
//
// Wraps the MCP CallToolRequestSchema dispatcher. For READ-ONLY tools that
// fail with a permission-denied / forbidden error, we transparently retry the
// call with another profile (if more than one is configured) and remember the
// winner via credentials.profileHints.
//
// Intentionally DOES NOT touch write paths. A user wanting auto-switch on a
// write must opt in explicitly: pass `via_profile: "auto"` in the tool args.
//
// What this owns:
//   - READ_ONLY_TOOLS whitelist (name prefix + manage_bitable_* read-action override)
//   - SWITCH_TRIGGERING_PATTERNS (error code / message regex set)
//   - extractResourceKey(name, args) — resourceKey for hinting
//   - profileOrder(name, args, hints, ctx) — ordered list of profiles to try
//   - withProfileRouting(ctx, name, args, callHandler) — the main wrapper
//
// What it does NOT own:
//   - The actual setActiveProfile / cache-invalidate (delegated to ctx).
//   - Persistence of hints (delegates to auth/credentials).

const credentials = require('./credentials');

// --- Whitelist ---

const READ_ONLY_PREFIXES = ['read_', 'list_', 'get_', 'search_', 'download_'];

// Explicit allowlist for manage_*/check_* tools whose action arg is read-only.
// Each entry: tool name → predicate(args) returns true if THIS call is read-only.
const READ_ONLY_OVERRIDES = {
  manage_bitable_app:    (a) => a?.action === 'get_meta',
  manage_bitable_table:  (a) => a?.action === 'list',
  manage_bitable_field:  (a) => a?.action === 'list',
  manage_bitable_view:   (a) => a?.action === 'list',
  manage_bitable_record: (a) => a?.action === 'search',
};

function isReadOnlyCall(name, args) {
  if (READ_ONLY_PREFIXES.some(p => name.startsWith(p))) return true;
  const override = READ_ONLY_OVERRIDES[name];
  if (override && override(args)) return true;
  return false;
}

// --- Error classification ---

const SWITCH_CODES = new Set([
  91403,    // wiki / docx no permission
  1254301,  // bitable no permission
  1254000,  // bitable access denied
  99991672, // OAuth scope not granted (user-side)
  403,      // generic HTTP forbidden
]);

const SWITCH_PATTERNS = [
  /access[_ ]?denied/i,
  /permission[_ ]?denied/i,
  /docx_no_permission/i,
  /no permission/i,
  /not authorized/i,
  /forbidden/i,
  /HTTP 403/i,
];

function shouldSwitchOnError(err) {
  const msg = (err?.message || String(err) || '').toLowerCase();
  // Code-form: "(91403)", "code=1254301", "(HTTP 403, ...)"
  const codeMatch = msg.match(/\b(?:code[=(]|http\s+)(\d+)/i) || msg.match(/\((\d{3,7})(?:,|\))/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1], 10);
    if (SWITCH_CODES.has(code)) return { yes: true, reason: `code=${code}` };
  }
  for (const re of SWITCH_PATTERNS) {
    if (re.test(msg)) return { yes: true, reason: re.source };
  }
  return { yes: false, reason: null };
}

// --- Resource key extraction ---

// Mapping: arg field name → resourceKey kind. Order matters — first match wins.
const RESOURCE_FIELDS = [
  { field: 'document_id', kind: 'doc' },
  { field: 'doc_token',   kind: 'doc' },
  { field: 'app_token',   kind: 'app' },
  { field: 'space_id',    kind: 'wiki' },
  { field: 'node_token',  kind: 'wiki' },
  { field: 'wiki_token',  kind: 'wiki' },
  { field: 'chat_id',     kind: 'chat' },
  { field: 'user_id',     kind: 'user' },
  { field: 'open_id',     kind: 'user' },
  { field: 'file_token',  kind: 'file' },
  { field: 'image_token', kind: 'file' },
  { field: 'message_id',  kind: 'msg' },
];

function extractResourceKey(args) {
  if (!args || typeof args !== 'object') return null;
  for (const { field, kind } of RESOURCE_FIELDS) {
    const v = args[field];
    if (typeof v === 'string' && v) return `${kind}:${v}`;
  }
  return null;
}

// --- Profile order ---

function profileOrder(name, args, ctx) {
  const all = ctx.listProfiles();
  if (all.length <= 1) return all;
  const active = ctx.getActiveProfile();
  const resourceKey = extractResourceKey(args);
  const hints = credentials.getProfileHints();
  const hinted = resourceKey ? hints[resourceKey] : null;

  // Order: [hinted (if !active && exists), active, ...rest]
  // We always try active first when there's no hint or the hint matches active —
  // this preserves "your current profile is the default attempt" UX. When the
  // hint differs from active, we skip active for the FIRST attempt because the
  // hint is empirically known to work (or used to).
  const order = [];
  const seen = new Set();
  const push = (p) => { if (p && all.includes(p) && !seen.has(p)) { order.push(p); seen.add(p); } };

  if (hinted && hinted !== active) push(hinted);
  push(active);
  for (const p of [...all].sort()) push(p);
  return order;
}

// --- Main wrapper ---

async function withProfileRouting(ctx, name, args, callHandler) {
  // Bail out early when there's nothing to switch to or this is a write.
  const all = ctx.listProfiles();
  const isMultiProfile = all.length > 1;

  // Explicit override: via_profile arg pins (or unlocks auto-switch on writes).
  let viaProfileArg = null;
  if (args && typeof args === 'object' && typeof args.via_profile === 'string') {
    viaProfileArg = args.via_profile;
  }

  const allowAuto = isMultiProfile && (
    isReadOnlyCall(name, args) || viaProfileArg === 'auto'
  );

  if (!allowAuto) {
    // Single-profile or write: just call once.
    if (viaProfileArg && viaProfileArg !== 'auto') {
      // Explicit pin
      if (!all.includes(viaProfileArg)) {
        return { content: [{ type: 'text', text: `via_profile: "${viaProfileArg}" not found. Available: ${all.join(', ')}.` }], isError: true };
      }
      const wasActive = ctx.getActiveProfile();
      if (viaProfileArg !== wasActive) ctx.setActiveProfile(viaProfileArg);
      try {
        return await callHandler();
      } finally {
        // Restore active for subsequent calls in same session — explicit pin
        // is per-call, not a session toggle.
        if (viaProfileArg !== wasActive) ctx.setActiveProfile(wasActive);
      }
    }
    return callHandler();
  }

  // Auto-switch loop.
  const order = profileOrder(name, args, ctx);
  const wasActive = ctx.getActiveProfile();
  const failures = [];
  let switchedFrom = null;
  let switchedReason = null;

  for (let i = 0; i < order.length; i++) {
    const profile = order[i];
    if (i > 0) {
      // Switching away from previous profile.
      if (!switchedFrom) switchedFrom = wasActive;
      ctx.setActiveProfile(profile);
      console.error(`[feishu-user-plugin] profile-router: ${order[i - 1]} → ${profile} on ${name} (${switchedReason || 'first attempt failed'})`);
    } else if (profile !== wasActive) {
      // Hinted profile differs from active — switch on first attempt too.
      switchedFrom = wasActive;
      ctx.setActiveProfile(profile);
      console.error(`[feishu-user-plugin] profile-router: ${wasActive} → ${profile} on ${name} (hint match)`);
    }

    try {
      const res = await callHandler();
      // Detect handler-level isError responses (not all errors throw).
      if (res?.isError && res.content?.[0]?.text) {
        const decision = shouldSwitchOnError({ message: res.content[0].text });
        if (decision.yes && i + 1 < order.length) {
          failures.push({ profile, error: res.content[0].text.slice(0, 200) });
          switchedReason = decision.reason;
          continue;
        }
      }
      // Success — cache hint if we switched, then return.
      if (switchedFrom && profile !== switchedFrom) {
        const rk = extractResourceKey(args);
        if (rk) {
          try { credentials.setProfileHint(rk, profile); }
          catch (e) { console.error(`[feishu-user-plugin] profile-router: hint persist failed (${e.message})`); }
        }
        // Annotate response.
        if (res?.content?.[0]?.type === 'text' && typeof res.content[0].text === 'string') {
          res.content[0].text = `[autoSwitched: ${switchedFrom} → ${profile} on ${rk || 'no-key'}]\n` + res.content[0].text;
        }
      }
      // Restore active to whatever the user had — auto-switch is per-call.
      if (switchedFrom) ctx.setActiveProfile(wasActive);
      return res;
    } catch (err) {
      const decision = shouldSwitchOnError(err);
      failures.push({ profile, error: err.message });
      if (!decision.yes || i + 1 >= order.length) {
        if (switchedFrom) ctx.setActiveProfile(wasActive);
        // Compose a comprehensive error if all profiles failed.
        if (failures.length > 1) {
          const lines = failures.map(f => `  ${f.profile}: ${f.error}`).join('\n');
          throw new Error(`All ${failures.length} profiles failed on ${name}:\n${lines}`);
        }
        throw err;
      }
      switchedReason = decision.reason;
      // Loop to next profile.
    }
  }

  if (switchedFrom) ctx.setActiveProfile(wasActive);
  // Should not reach: loop returns on success or throws.
  throw new Error(`profile-router: exhausted ${order.length} profiles on ${name}`);
}

module.exports = {
  withProfileRouting,
  isReadOnlyCall,
  shouldSwitchOnError,
  extractResourceKey,
  profileOrder,
  // Constants exposed for tests.
  READ_ONLY_PREFIXES,
  READ_ONLY_OVERRIDES,
  SWITCH_CODES,
  SWITCH_PATTERNS,
};
