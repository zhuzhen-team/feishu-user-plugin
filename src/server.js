// src/server.js — MCP bootstrap, tool registration, request dispatch.
//
// What this owns:
//   - Loading every src/tools/<domain>.js module and flattening its schemas.
//   - Building the ctx object that handlers receive (factory closures + profile state).
//   - The MCP Server instance and its ListTools / CallTool request handlers.
//   - Startup diagnostics (auth status, APP_ID validation).
//
// What it does NOT own:
//   - Tool definitions: those live in src/tools/<domain>.js.
//   - Feishu API calls: those live in src/clients/{user,official}.
//   - Auth lifecycle (cookie heartbeat, UAT refresh, file lock): src/auth/*.
//   - Config discovery / persistence: src/config/*.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// Local dev fallback: MCP clients inject env vars from config's env block at
// spawn time. This dotenv line only matters when running locally with a .env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { LarkUserClient } = require('./clients/user');
const { LarkOfficialClient } = require('./clients/official');
const { resolveToken } = require('./resolver');
const { listPrompts, getPrompt } = require('./prompts');
const credentials = require('./auth/credentials');
const profileRouter = require('./auth/profile-router');
const { createCredentialsMonitor } = require('./auth/credentials-monitor');
const identityState = require('./auth/identity-state');

// --- Tool modules ---
// Adding a new domain: create src/tools/<x>.js exporting { schemas, handlers }
// and append it here. The schemas are concatenated into the MCP tools/list
// response; the handlers are looked up by name when tools/call comes in.
const TOOL_MODULES = [
  require('./tools/bitable'),
  require('./tools/calendar'),
  require('./tools/contacts'),
  require('./tools/diagnostics'),
  require('./tools/docs'),
  require('./tools/drive'),
  require('./tools/events'),
  require('./tools/groups'),
  require('./tools/im-read'),
  require('./tools/messaging-bot'),
  require('./tools/messaging-user'),
  require('./tools/okr'),
  require('./tools/profile'),
  require('./tools/tasks'),
  require('./tools/uploads'),
  require('./tools/wiki'),
];

const TOOLS = TOOL_MODULES.flatMap((m) => m.schemas);
const HANDLERS = Object.fromEntries(TOOL_MODULES.flatMap((m) => Object.entries(m.handlers)));

// --- Profile system + client singletons ---
// Profile resolution order (see src/auth/credentials.js):
//   1. ~/.feishu-user-plugin/credentials.json — single source of truth (v1.3.7+)
//   2. process.env.LARK_* — legacy default profile (v1.3.6 behaviour)
//   3. process.env.LARK_PROFILES_JSON — legacy named profiles
//
// switch_profile (handler in tools/profile.js) calls ctx.setActiveProfile(n)
// which resets the cached client singletons; the next tool call rebuilds them.
// When credentials.json exists, switching also persists the active field so
// cross-process MCP servers see the same active profile after restart.

const events = require('./events');

const FEISHU_HOME = path.join(os.homedir(), '.feishu-user-plugin');
const EVENTS_LOG_PATH = path.join(FEISHU_HOME, 'events.jsonl');

let userClient = null;
let officialClient = null;
let wsServer = null;
let ownerHandle = null;       // returned by tryClaim when isOwner
let ownerHeartbeatTimer = null;
let nonOwnerPollTimer = null;
let _ownerStartCallbacks = [];

// Lark Desktop reactor state (v1.3.11 §A) — owned by the heartbeat callback.
// v1.3.14 — `_lastSwitchAt = 0` was previously misinterpreted as "no recent
// switch" by the lark-desktop reactor's debounce, so a cold-start owner that
// hadn't observed any switch would still fire-on-first-tick if the snapshot
// looked stale. We rebaseline `_lastSwitchAt` to the owner-claim wallclock on
// first reactor invocation so the cold start window has the same debounce
// budget as a long-running owner. See `_runLarkDesktopReactor` below.
let _lastHashMtimes = {};
let _lastSwitchAt = 0;
let _reactorFirstTickDone = false;
const _seenUnboundHashes = new Set();

function _onBecomeOwner(cb) { _ownerStartCallbacks.push(cb); }

function _stopHeartbeat() {
  if (ownerHeartbeatTimer) { clearInterval(ownerHeartbeatTimer); ownerHeartbeatTimer = null; }
}
function _stopNonOwnerPoll() {
  if (nonOwnerPollTimer) { clearInterval(nonOwnerPollTimer); nonOwnerPollTimer = null; }
}

// Called when our owner heartbeat fails (the lock was force-stolen or vanished).
// Stop the WS writer + heartbeat, then re-run election. We do NOT release() the
// lock here: we no longer own it, and release() unlinks the lock path — which
// would delete the NEW owner's lock and trigger a thundering re-election.
function _relinquishOwnership() {
  _stopHeartbeat();
  const ws = wsServer;
  wsServer = null;
  ownerHandle = null;
  if (ws) { try { ws.stop().catch(() => {}); } catch (_) {} }
  _claimAndStart().catch((e) => console.error(`[feishu-user-plugin] re-election after lost lock failed: ${e.message}`));
}

function getEventBuffer() {
  return wsServer ? wsServer.buffer : null;
}
// The "current" profile this in-memory MCP server is pinned to. Initialised
// from the persisted active profile (credentials.json) at boot, but in-process
// switches may diverge from the persisted active until the next server restart.
//
// Profile selection precedence (v1.3.9 A.2 — SSOT):
//   1. credentials.json::active — single-file persisted active (canonical SSOT)
//   2. process.env.FEISHU_PLUGIN_PROFILE — harness pointer (bootstrap-only, when
//      credentials.json does not exist)
//   3. 'default' — legacy zero-config path
// Note: FEISHU_PLUGIN_PROFILE in the harness env is now a bootstrap pointer only.
// Once credentials.json exists, its `active` field is authoritative; cross-process
// sync propagates active-profile changes without a server restart.
let currentProfile = credentials.getActiveProfileName();
if (!credentials.readCanonical() && process.env.FEISHU_PLUGIN_PROFILE) {
  // Bootstrap-only: legacy env users without canonical credentials file.
  currentProfile = process.env.FEISHU_PLUGIN_PROFILE;
}

function profileEnv(name) {
  return credentials.getActiveProfileEnv(name);
}

async function getUserClient() {
  if (userClient) return userClient;
  const env = profileEnv(currentProfile);
  const cookie = env.LARK_COOKIE;
  if (!cookie) throw new Error(
    `LARK_COOKIE not set for profile "${currentProfile}". To fix:\n` +
    '1. Open https://www.feishu.cn/messenger/ and log in\n' +
    '2. DevTools → Network tab → Disable cache → Reload → Click first request → Request Headers → Cookie → Copy value\n' +
    '   (Do NOT use document.cookie or Application→Cookies — they miss HttpOnly cookies like session/sl_session)\n' +
    '3. Paste the cookie string into your .mcp.json env LARK_COOKIE field, then restart Claude Code\n' +
    'If Playwright MCP is available: navigate to feishu.cn/messenger/, let user log in, then use context.cookies() to get the full cookie string including HttpOnly cookies.'
  );
  userClient = new LarkUserClient(cookie);
  await userClient.init();
  return userClient;
}

function getOfficialClient() {
  if (officialClient) return officialClient;
  const env = profileEnv(currentProfile);
  const appId = env.LARK_APP_ID;
  const appSecret = env.LARK_APP_SECRET;
  if (!appId || !appSecret) throw new Error(
    `LARK_APP_ID and LARK_APP_SECRET not set for profile "${currentProfile}".\n` +
    'For team members: these should be pre-filled in your .mcp.json. Check that the config was copied correctly from the team-skills README.\n' +
    'For external users: create a Custom App at https://open.feishu.cn/app, get the App ID and App Secret, add them to your .mcp.json env.'
  );
  officialClient = new LarkOfficialClient(appId, appSecret);
  // Load UAT directly from the active profile env. With credentials.json the
  // env may differ from process.env (whose LARK_USER_* may be missing if the
  // user moved creds out of harness configs); using profileEnv() here keeps
  // the source of truth consistent with what get*Client() reads above.
  loadUATFromEnv(officialClient, env);
  return officialClient;
}

// UAT loader sourced from a specific env block (credentials.json profile or
// harness env). Used both at startup and as the hot-reload entry point from
// credMonitor.onUatChange. When `env` has no UAT (user nuked the token via
// `oauth` --revoke or manual edit), clears the in-memory copy instead of
// silently leaving the stale token in place.
//
// v1.3.14 — replaced the dead `LarkOfficialClient.loadUAT()` helper that
// read from process.env. All UAT loading now goes through this function.
function loadUATFromEnv(client, env) {
  const token = env?.LARK_USER_ACCESS_TOKEN || null;
  const refresh = env?.LARK_USER_REFRESH_TOKEN || null;
  const expires = parseInt(env?.LARK_UAT_EXPIRES || '0') || 0;
  if (!token) {
    client._uat = null;
    client._uatRefresh = null;
    client._uatExpires = 0;
    return;
  }
  client._uat = token;
  client._uatRefresh = refresh;
  client._uatExpires = expires || client._decodeTokenExpiry(token);
}

// --- Owner control loop (v1.3.9 A.1) ---

async function _claimAndStart() {
  const claim = events.owner.tryClaim(FEISHU_HOME, { info: { role: 'ws_owner' } });
  if (!claim.isOwner) {
    // Become non-owner: poll lock health every 30s, attempt takeover when stale.
    if (!nonOwnerPollTimer) {
      nonOwnerPollTimer = setInterval(() => {
        const info = events.owner.readOwnerInfo(FEISHU_HOME);
        if (!info.exists || !info.alive) {
          _claimAndStart().catch((e) => console.error(`[feishu-user-plugin] takeover attempt failed: ${e.message}`));
        }
      }, events.owner.TAKEOVER_POLL_INTERVAL_MS);
      nonOwnerPollTimer.unref?.();
    }
    return;
  }

  ownerHandle = claim;
  _stopNonOwnerPoll();
  // Repair tail before WS starts pushing events
  try { events.log.repairTail(EVENTS_LOG_PATH); } catch (_) {}

  // Start WS with current active profile and its events list.
  const profileName = currentProfile;
  let activeEnv;
  try { activeEnv = profileEnv(profileName); } catch (_) { return; }
  if (!activeEnv.LARK_APP_ID || !activeEnv.LARK_APP_SECRET) return;

  const eventsList = _getProfileEventsList(profileName);
  wsServer = events.createWSServer({
    appId: activeEnv.LARK_APP_ID,
    appSecret: activeEnv.LARK_APP_SECRET,
    registrations: eventsList,
    logPath: EVENTS_LOG_PATH,
    initialProfile: profileName,
  });
  wsServer.start().catch((e) => console.error(`[feishu-user-plugin] WS start error: ${e.message}`));

  // Heartbeat + check active changes every 15s.
  let lastCredMtime = _credMtime();
  // Bootstrap baseline so the very first heartbeat doesn't trigger a switch.
  _lastHashMtimes = require('./auth/lark-desktop').listAccountHashes()
    .reduce((acc, h) => { acc[h.hash] = h.mtimeMs; return acc; }, {});
  ownerHeartbeatTimer = setInterval(() => {
    if (ownerHandle && !ownerHandle.heartbeat()) {
      // Lost the owner lock (a peer force-stole it, or the lock file vanished).
      // Stop writing immediately and re-run election so we don't double-write
      // events.jsonl alongside the new owner — a phantom second writer would
      // interleave/corrupt the single-writer log.
      console.error('[feishu-user-plugin] owner heartbeat failed — lost the WS owner lock; relinquishing to avoid a phantom second writer');
      _relinquishOwnership();
      return;
    }
    const m = _credMtime();
    if (m !== null && m !== lastCredMtime) {
      lastCredMtime = m;
      _maybeReconfigure().catch((e) => console.error(`[feishu-user-plugin] reconfigure failed: ${e.message}`));
    }
    // Lark Desktop reactor (v1.3.11 §A)
    try {
      _runLarkDesktopReactor();
    } catch (e) {
      console.error(`[feishu-user-plugin] Lark reactor error: ${e.message}`);
    }
    // Defer-rotate check — rename + cursor reset run under the cursor mutex so
    // they are atomic with respect to a concurrent drain on a peer process.
    try {
      events.cursor.rotateUnderLock(FEISHU_HOME, ({ cursorOffset, fileSize }) => {
        const SOFT_CAP = 10 * 1024 * 1024;
        const HARD_CAP = 20 * 1024 * 1024;
        const rot = events.log.maybeRotate(EVENTS_LOG_PATH, cursorOffset, SOFT_CAP);
        if (rot.rotated) return { resetCursor: true };
        if (fileSize > HARD_CAP) {
          events.log.forceRotate(EVENTS_LOG_PATH, fileSize);
          return { resetCursor: true };
        }
        return { resetCursor: false };
      });
      // Clean up old .dropped files daily-ish (cheap; outside the cursor lock).
      events.log.cleanupDropped(EVENTS_LOG_PATH, 7);
    } catch (e) {
      console.error(`[feishu-user-plugin] rotation check failed: ${e.message}`);
    }
  }, events.owner.HEARTBEAT_INTERVAL_MS);
  ownerHeartbeatTimer.unref?.();

  for (const cb of _ownerStartCallbacks) {
    try { cb(); } catch (_) {}
  }
}

function _credMtime() {
  try {
    const p = path.join(FEISHU_HOME, 'credentials.json');
    return fs.statSync(p).mtimeMs;
  } catch (_) { return null; }
}

// Lark Desktop reactor (v1.3.11 §A).
// Called from the owner heartbeat. When the most-recently-active hash differs
// from the active profile's bound hash AND its mtime advanced since the last
// snapshot, flip credentials.json::active to the matching profile (the existing
// _credMtime delta on the next tick triggers _maybeReconfigure which restarts
// the WS client with the new profile's events list).
function _runLarkDesktopReactor() {
  const ld = require('./auth/lark-desktop');
  // v1.3.14 — cold-start debounce: prevent the first reactor tick from
  // treating a long-pre-existing snapshot as a "recent switch". By stamping
  // _lastSwitchAt at first tick we give the debounce the same baseline as a
  // long-running owner that just hot-took-over.
  if (!_reactorFirstTickDone) {
    _reactorFirstTickDone = true;
    if (_lastSwitchAt === 0) _lastSwitchAt = Date.now();
  }
  const out = ld.detectSwitch({
    prevSnapshot: _lastHashMtimes,
    lastSwitchAt: _lastSwitchAt,
    seenUnboundHashes: _seenUnboundHashes,
  });
  if (out.switchTo) {
    _lastSwitchAt = Date.now();
    console.error(
      `[feishu-user-plugin] Lark Desktop account changed; switching profile to ` +
      `"${out.switchTo.profile}" (hash ${out.switchTo.hash})`
    );
    try { credentials.setActiveProfile(out.switchTo.profile); }
    catch (e) { console.error(`[feishu-user-plugin] setActiveProfile failed: ${e.message}`); }
  }
  // Refresh snapshot regardless of switch outcome — keeps debounce + advance
  // detection consistent on subsequent ticks.
  _lastHashMtimes = ld.listAccountHashes()
    .reduce((acc, h) => { acc[h.hash] = h.mtimeMs; return acc; }, {});
}

// Cross-process credentials sync (v1.3.12 — CredentialsMonitor).
// One poller, multiple hooks. Each tool call entry runs `credMonitor.sync()`
// which:
//   - active profile changed → flips in-memory currentProfile + clears caches
//   - UAT field changed     → reloads officialClient._uat without restart
//   - cookie field changed  → (no-op for now — userClient already re-inits
//                              on next getUserClient call when nulled)
//   - any change            → invalidates the identity-state cache so the
//                              next call re-probes
//
// This replaces v1.3.9's _syncActiveProfileFromDisk (active-only) + the
// "restart Claude Code to pick up new UAT" hand-off pattern.
const credMonitor = createCredentialsMonitor();

credMonitor.onProfileSwitch(({ to }) => {
  if (!to || to === currentProfile) return;
  try {
    credentials.getActiveProfileEnv(to); // validate profile exists
    console.error(`[feishu-user-plugin] active profile changed on disk: ${currentProfile} → ${to}`);
    currentProfile = to;
    userClient = null;
    officialClient = null;
    require('./resolver').clearCache();
  } catch (e) {
    console.error(`[feishu-user-plugin] sync to "${to}" failed: ${e.message}; staying on "${currentProfile}"`);
  }
});

credMonitor.onUatChange((env) => {
  // Hot-reload UAT into the running officialClient. No restart needed.
  // Routing through loadUATFromEnv keeps the field-write logic in one
  // place — same helper used at getOfficialClient() startup.
  if (!officialClient) return; // next getOfficialClient() reads env directly
  loadUATFromEnv(officialClient, env);
  identityState.invalidateIdentity(officialClient);
  console.error('[feishu-user-plugin] UAT reloaded from credentials.json (no restart needed)');
});

credMonitor.onCookieChange(() => {
  // Cookie rotation: null the LarkUserClient singleton so the next
  // getUserClient() call rebuilds it with the fresh cookie from env.
  // Without this, cookie-based tools (send_to_user / search_contacts /
  // get_login_status / send_as_user / batch_send) keep using the stale
  // cookie until restart. PR #103 Codex P2 followup.
  if (!userClient) return;
  userClient = null;
  console.error('[feishu-user-plugin] cookie rotation detected — userClient nulled, rebuilds on next tool call');
});

credMonitor.onCacheInvalidate(() => {
  if (officialClient) identityState.invalidateIdentity(officialClient);
});

async function _maybeReconfigure() {
  if (!ownerHandle || !wsServer) return;
  const newActive = credentials.getActiveProfileName();
  const newEvents = _getProfileEventsList(newActive);
  const status = wsServer.getStatus();
  const sameProfile = status.wsProfile === newActive;
  const sameEvents = JSON.stringify(status.subscribed_events) === JSON.stringify(newEvents);
  if (sameProfile && sameEvents) return;

  console.error(`[feishu-user-plugin] WS reconfigure: profile ${status.wsProfile}→${newActive}, events ${status.subscribed_events.length}→${newEvents.length}`);

  // Tear down + rebuild because registrations are fixed at construction.
  await wsServer.stop();
  let activeEnv;
  try { activeEnv = profileEnv(newActive); } catch (_) { return; }
  if (!activeEnv.LARK_APP_ID || !activeEnv.LARK_APP_SECRET) return;
  wsServer = events.createWSServer({
    appId: activeEnv.LARK_APP_ID,
    appSecret: activeEnv.LARK_APP_SECRET,
    registrations: newEvents,
    logPath: EVENTS_LOG_PATH,
    initialProfile: newActive,
  });
  await wsServer.start();
}

function _getProfileEventsList(profileName) {
  const canonical = credentials.readCanonical();
  if (canonical && canonical.profiles[profileName]?.events) {
    return canonical.profiles[profileName].events.slice();
  }
  // Bootstrap: env override
  const env = process.env.FEISHU_PLUGIN_EXTRA_EVENTS;
  if (env) {
    const list = env.split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) return ['im.message.receive_v1', ...list];
  }
  return ['im.message.receive_v1'];
}

// Resolver helper: turn document_id / app_token / wiki node / Feishu URL into
// a native token. No-op for already-native inputs. See src/resolver.js.
async function resolveDocId(input) {
  if (!input) return input;
  return resolveToken(input, getOfficialClient());
}

// --- ctx ---
// What handlers receive in their second argument. Kept stable so tools/* don't
// reach back into server.js for state. Adding a new ctx field: also document
// it in src/tools/_registry.js docstring.
function buildCtx() {
  return {
    getUserClient,
    getOfficialClient,
    getEventBuffer,
    listProfiles: () => credentials.listProfileNames(),
    getActiveProfile: () => currentProfile,
    // Per-call, in-memory-only switch for auto-switch read trials and explicit
    // via_profile pins: flip currentProfile + invalidate cached clients WITHOUT
    // writing credentials.json::active or running credMonitor.sync(). A transient
    // routing trial must not mutate the durable single-source-of-truth that peer
    // MCP processes read (which corrupted their active identity, and churned the
    // file + ran an fsync-grade write + SHA + hook fan-out on every hot-path read).
    setActiveProfileEphemeral: (n) => {
      credentials.getActiveProfileEnv(n);  // validate exists (throws if unknown)
      currentProfile = n;
      userClient = null;
      officialClient = null;
      require('./resolver').clearCache();
    },
    setActiveProfile: (n) => {
      // Validate the profile exists (throws if unknown) before nuking client cache.
      credentials.getActiveProfileEnv(n);
      currentProfile = n;
      userClient = null;
      officialClient = null;
      // Clear resolver cache so wiki-node lookups don't carry over from the old profile.
      require('./resolver').clearCache();
      // Persist the active-field flip when credentials.json exists so peer MCP
      // servers see the new active profile on next read. The credentials module
      // throws if credentials.json doesn't exist OR if `n` isn't in profiles[];
      // the first is benign (legacy mode), the second is a real bug — log it
      // either way at warn level instead of swallowing silently.
      try { credentials.setActiveProfile(n); }
      catch (e) {
        const cred = credentials.readCanonical();
        if (cred) {
          console.error(`[feishu-user-plugin] WARN: setActiveProfile("${n}") failed to persist to credentials.json: ${e.message}. In-memory currentProfile updated anyway, but other MCP processes won't see the switch.`);
        }
      }
      // Run a sync so credMonitor adopts the just-written file as its
      // baseline. The onProfileSwitch hook will see `to === currentProfile`
      // and short-circuit; UAT/cookie hooks fire only if those fields
      // actually differ from the prior active profile, which is harmless.
      credMonitor.sync();
    },
    resolveDocId,
    getWsServer: () => wsServer,
    requestClaim: async ({ force = false } = {}) => {
      const claim = events.owner.tryClaim(FEISHU_HOME, { info: { role: 'ws_owner' }, force });
      if (claim.isOwner) {
        ownerHandle = claim;
        await _claimAndStart();
        return { ok: true, became_owner: true };
      }
      return { ok: false, reason: 'lock_active_no_force', owner_pid: claim.ownerInfo?.pid };
    },
    requestReconfigure: async () => {
      const before = wsServer?.getStatus() || {};
      await _maybeReconfigure();
      const after = wsServer?.getStatus() || {};
      return {
        prev_subscriptions: before.subscribed_events || [],
        next_subscriptions: after.subscribed_events || [],
        no_change: JSON.stringify(before.subscribed_events) === JSON.stringify(after.subscribed_events) && before.wsProfile === after.wsProfile,
      };
    },
  };
}

// --- MCP server ---

const server = new Server(
  { name: 'feishu-user-plugin', version: require('../package.json').version },
  { capabilities: { tools: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Credentials hot-reload (v1.3.12): poll credentials.json for changes and
  // fire registered hooks (profile / UAT / cookie / invalidate).
  credMonitor.sync();
  const { name, arguments: args } = request.params;
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  // Strip via_profile from args before passing to the handler — it's a
  // routing-layer concern, not a tool argument. Keep a copy for routing.
  const cleanArgs = (args && typeof args === 'object') ? { ...args } : {};
  delete cleanArgs.via_profile;

  try {
    // Build ctx once: the router's ctx and the handler's ctx must be the same
    // object so the auto-switch restore reasons over one shared currentProfile,
    // not two independently-built closures.
    const ctx = buildCtx();
    return await profileRouter.withProfileRouting(ctx, name, args || {}, async () => {
      return handler(cleanArgs, ctx);
    });
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  return getPrompt(name, args || {});
});

// --- Process-level error handlers ---
// Prevent stray promise rejections or uncaught exceptions from killing the MCP server.
//
// v1.3.14-patch: re-entrancy guard on uncaughtException. Accessing err.stack
// triggers V8's CaptureAndSetErrorStack → FormatStackTrace chain, which can
// itself throw (e.g. in CallSitePrototypeToString / SerializeCallSiteInfo),
// creating an infinite exception→handler→stack→exception loop that pegs the CPU.
// We track depth and bail out with process.exit when a loop is detected.
let _exceptionHandling = false;
let _consecutiveExceptions = 0;
let _exceptionResetTimer = null;
const _EXCEPTION_LOOP_LIMIT = 5;

process.on('uncaughtException', (err) => {
  // Re-entrancy guard: if we are already inside this handler, another
  // exception was thrown during error logging (likely from stack trace
  // formatting). Track the count and emergency-exit when it loops.
  if (_exceptionHandling) {
    _consecutiveExceptions++;
    if (_consecutiveExceptions >= _EXCEPTION_LOOP_LIMIT) {
      process.stderr.write(
        `[feishu-user-plugin] FATAL: uncaughtException loop detected ` +
        `(${_consecutiveExceptions} consecutive re-entrant exceptions). ` +
        `Exiting to prevent CPU spin.\n`
      );
      try { wsServer?.stop(); } catch (_) {}
      try { ownerHandle?.release(); } catch (_) {}
      process.exit(70); // EX_SOFTWARE — internal software error
    }
    return;
  }

  _exceptionHandling = true;
  try {
    // Use util.inspect with depth limit instead of accessing err.stack
    // directly, to avoid triggering V8's stack-trace formatting side effects
    // that can throw inside our handler.
    const util = require('util');
    const safe = util.inspect(
      { message: err?.message, code: err?.code, name: err?.name },
      { depth: 2, breakLength: Infinity }
    );
    console.error('[feishu-user-plugin] Uncaught exception:', safe);
  } catch (logErr) {
    // Absolute last resort — raw fd write, no formatting at all.
    try {
      process.stderr.write(
        `[feishu-user-plugin] Uncaught exception: ${String(err && err.message)}\n`
      );
    } catch (_) { /* we tried */ }
  } finally {
    _exceptionHandling = false;
  }

  // Reset the consecutive counter after a quiet period so transient
  // errors don't accumulate toward the bailout limit.
  if (_exceptionResetTimer) clearTimeout(_exceptionResetTimer);
  _exceptionResetTimer = setTimeout(() => {
    _consecutiveExceptions = 0;
  }, 60000);
});

process.on('unhandledRejection', (reason) => {
  try {
    const util = require('util');
    console.error('[feishu-user-plugin] Unhandled rejection:',
      util.inspect(reason, { depth: 2, breakLength: Infinity }));
  } catch (_) {
    console.error('[feishu-user-plugin] Unhandled rejection:', String(reason));
  }
});
process.on('SIGTERM', () => {
  _stopHeartbeat(); _stopNonOwnerPoll();
  try { wsServer?.stop(); } catch {}
  try { ownerHandle?.release(); } catch {}
  process.exit(0);
});
process.on('SIGINT', () => {
  _stopHeartbeat(); _stopNonOwnerPoll();
  try { wsServer?.stop(); } catch {}
  try { ownerHandle?.release(); } catch {}
  process.exit(0);
});

// --- Zombie sibling cleanup ---
// At startup, scan for other feishu-user-plugin node processes that are
// burning excessive CPU (likely stuck in exception loops like the
// uncaughtException→stack→exception cycle fixed above). Kill them to
// prevent CPU / thermal runaway across multiple MCP restarts.
function _cleanupStaleSiblings() {
  try {
    const { execSync } = require('child_process');
    const currentPid = process.pid;
    const output = execSync(
      `ps axo pid,time,comm | grep "feishu-user-plugin" | grep -v grep || true`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    if (!output) return;

    const lines = output.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0], 10);
      const timeStr = parts[1];

      if (pid === currentPid || isNaN(pid)) continue;

      // Parse accumulated CPU time: MM:SS or HH:MM:SS
      const timeParts = timeStr.split(':').map(Number);
      let totalSec;
      if (timeParts.length === 3) {
        totalSec = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
      } else {
        totalSec = timeParts[0] * 60 + timeParts[1];
      }

      // Threshold: > 3 min accumulated CPU in a short-lived MCP server
      // is pathological (normal startup + tool calls use < 10s total).
      const STUCK_CPU_SEC = 180;
      if (totalSec > STUCK_CPU_SEC) {
        try {
          process.kill(pid, 'SIGKILL');
          console.error(
            `[feishu-user-plugin] cleaned up stuck sibling PID ${pid} ` +
            `(CPU time: ${timeStr}, threshold: ${STUCK_CPU_SEC}s)`
          );
        } catch (e) {
          // Process may have already exited — ignore.
        }
      }
    }
  } catch (_) {
    // Best-effort: never block startup on cleanup failure.
  }
}

// --- main ---

async function main() {
  // Clean up stuck sibling processes before starting. This prevents
  // accumulation of CPU-spinning zombie instances across MCP restarts.
  _cleanupStaleSiblings();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Startup diagnostics — use the resolved active-profile env so users on
  // credentials.json (where process.env may not have LARK_*) get accurate flags.
  // Bootstrap-only validation: when credentials.json doesn't exist and
  // FEISHU_PLUGIN_PROFILE is set, validate the name against known legacy profiles.
  // If credentials.json exists, FEISHU_PLUGIN_PROFILE is ignored — the file's
  // `active` field is the SSOT and cross-process sync keeps it up to date.
  if (!credentials.readCanonical() && process.env.FEISHU_PLUGIN_PROFILE) {
    const known = credentials.listProfileNames();
    if (!known.includes(currentProfile)) {
      console.error(`[feishu-user-plugin] FATAL: FEISHU_PLUGIN_PROFILE="${currentProfile}" not found. Known: ${known.join(', ')}.`);
      console.error('[feishu-user-plugin] Fix: edit harness env block, or add the profile to ~/.feishu-user-plugin/credentials.json.');
      process.exit(2);
    }
  }
  let activeEnv = {};
  try { activeEnv = profileEnv(currentProfile); } catch (_) { /* unknown profile is reported below */ }
  const hasCanonical = !!credentials.readCanonical();
  const hasCookie = !!activeEnv.LARK_COOKIE;
  const hasApp = !!(activeEnv.LARK_APP_ID && activeEnv.LARK_APP_SECRET);
  const hasUAT = !!activeEnv.LARK_USER_ACCESS_TOKEN;
  const source = hasCanonical ? `credentials.json profile=${currentProfile}` : 'env vars (legacy)';
  console.error(`[feishu-user-plugin] MCP Server v${require('../package.json').version} — ${TOOLS.length} tools, ${listPrompts().length} prompts`);
  console.error(`[feishu-user-plugin] Auth: Cookie=${hasCookie ? 'YES' : 'NO'} App=${hasApp ? 'YES' : 'NO'} UAT=${hasUAT ? 'YES' : 'NO'} (source: ${source})`);
  if (!hasCookie) console.error('[feishu-user-plugin] WARNING: LARK_COOKIE not set — user identity tools (send_to_user, etc.) will fail');
  if (!hasApp) console.error('[feishu-user-plugin] WARNING: LARK_APP_ID/SECRET not set — official API tools (read_messages, docs, etc.) will fail');
  if (!hasUAT) console.error('[feishu-user-plugin] WARNING: LARK_USER_ACCESS_TOKEN not set — P2P chat reading (read_p2p_messages) will fail');
  // Warn when both credentials.json AND legacy env vars exist — they may
  // diverge silently after a UAT refresh (we always write credentials.json).
  if (hasCanonical && (process.env.LARK_COOKIE || process.env.LARK_APP_ID || process.env.LARK_USER_ACCESS_TOKEN)) {
    console.error('[feishu-user-plugin] NOTE: credentials.json AND legacy LARK_* env vars are both set. Plugin reads credentials.json; the env vars are ignored. To clean up: remove the LARK_* keys from your harness config, leaving FEISHU_PLUGIN_PROFILE only.');
  }
  // Nudge legacy env-only users to migrate.
  if (!hasCanonical && (hasCookie || hasApp || hasUAT)) {
    console.error('[feishu-user-plugin] TIP: run `npx feishu-user-plugin migrate --confirm` to consolidate credentials into ~/.feishu-user-plugin/credentials.json (single source of truth, removes UAT-refresh drift across harnesses).');
  }

  // Validate APP_ID/SECRET against Feishu before serving any tool calls.
  // Catches the "Claude filled in a wrong/stale APP_ID during install" failure
  // mode that otherwise surfaces as cryptic 401s on every Official API call
  // (looks like "MCP 掉线" to the user). Non-blocking — we warn but still serve,
  // because the user may only need user-identity (cookie) tools.
  if (hasApp) {
    try {
      const probe = await getOfficialClient().verifyApp();
      if (probe.valid) {
        const nameBit = probe.appName ? ` "${probe.appName}"` : '';
        console.error(`[feishu-user-plugin] App verified: ${probe.appId}${nameBit}`);
      } else {
        console.error(`[feishu-user-plugin] ERROR: LARK_APP_ID=${probe.appId} was REJECTED by Feishu (${probe.error}).`);
        console.error('[feishu-user-plugin] → Every Official API tool call will fail. Likely wrong/stale APP_ID.');
        console.error('[feishu-user-plugin] → Re-run the install prompt from team-skills/plugins/feishu-user-plugin/README.md to get the correct credentials.');
      }
    } catch (e) {
      console.error(`[feishu-user-plugin] WARNING: Could not verify APP_ID (${e.message}); network issue or cold start. Proceeding anyway.`);
    }
  }

  // Baseline credMonitor at startup so any credential changes between server
  // boot and the first tool call fire hooks instead of being silently absorbed
  // by the first sync()'s baselining branch. PR #103 Codex P2 followup.
  credMonitor.sync();

  // --- Real-time events (v1.3.9 — owner-arbitrated) ---
  if (hasApp) {
    _claimAndStart().catch((e) => {
      console.error(`[feishu-user-plugin] owner claim failed: ${e.message}; will retry every 30s`);
      if (!nonOwnerPollTimer) {
        nonOwnerPollTimer = setInterval(_claimAndStart, events.owner.TAKEOVER_POLL_INTERVAL_MS);
        nonOwnerPollTimer.unref?.();
      }
    });
  } else {
    console.error('[feishu-user-plugin] WS not started — APP_ID/SECRET missing. Realtime events (get_new_events) will return empty.');
  }
}

module.exports = { main, TOOLS, HANDLERS, buildCtx };

if (require.main === module) {
  main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
}
