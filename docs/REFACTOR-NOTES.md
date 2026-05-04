# v1.3.7 Refactor Notes — Where New Code Goes

This document is the boundary contract from the v1.3.7 phase A refactor. It exists so the next person who adds a feature doesn't accidentally rebuild a god file. If you're confused about where something belongs, read this — and if the rules don't fit your case, propose an update before adding the code.

## Goals

- **One file = one domain.** Soft target ≤600 lines, smell at >900.
- **`index.js` stays a 5-line entry point.** Never add logic there again.
- **`server.js` stays a thin bootstrap + dispatcher.** Never add tool-specific logic there.
- **Adding a tool should not touch more than 2 files** (one client domain + one tool domain). If your change cuts across more files than that, the boundaries are wrong.

## Layout (post v1.3.7 phase A)

```
src/
├── index.js                     # ~6 lines — shebang + logger + server.main()
├── server.js                    # MCP bootstrap, ctx assembly, request dispatch
├── logger.js                    # global stdout guard + Lark SDK stderr logger
├── utils.js                     # fetchWithTimeout, request-id helpers
├── resolver.js                  # wiki node / Feishu URL → native token
├── error-codes.js               # classifyError for fallback routing
├── doc-blocks.js                # docx block constructors
├── oauth.js / oauth-auto.js     # OAuth CLI flow + Playwright helper
├── cli.js                       # `npx feishu-user-plugin <cmd>` entry
├── setup.js                     # setup CLI wizard
├── config.js                    # MCP-config discovery + atomic persistence
│                                #   (deferred split into config/ → Phase B)
├── auth/
│   └── credentials.js           # Single-source-of-truth credentials API.
│                                #   Reads ~/.feishu-user-plugin/credentials.json
│                                #   (atomic, 0600). Falls back to legacy
│                                #   process.env / mcpServers discovery for
│                                #   v1.3.6 users until they run `migrate`.
├── clients/
│   ├── user.js                  # Cookie + protobuf user-identity client
│   └── official/
│       ├── base.js              # constructor, UAT lifecycle, _safeSDKCall,
│       │                        #   _asUserOrApp, _uatREST, _populateSenderNames,
│       │                        #   _formatMessage, _normalizeTimestamp,
│       │                        #   verifyApp, _getAppToken
│       ├── index.js             # composes base + domain mixins onto prototype
│       ├── im.js                # 20 IM methods incl. readMessagesWithFallback
│       ├── docs.js              # 12 docx + block-edit methods
│       ├── bitable.js           # 22 bitable methods
│       ├── drive.js             # listFiles / createFolder / copy / move / delete
│       ├── wiki.js              # listSpaces / search / nodes / attachToWiki
│       ├── uploads.js           # uploadImage/File/Media/DocMedia/DriveFile + downloadDocImage
│       ├── calendar.js          # 3 calendar read methods
│       ├── okr.js               # 3 OKR read methods
│       ├── contacts.js          # findUserByIdentity, getUserById
│       └── groups.js            # createChat/updateChat + member ops
└── tools/
    ├── _registry.js             # text/json/sendResult response builders + ctx contract
    ├── bitable.js               # 19 bitable handlers
    ├── messaging-user.js        # 10 send_*_as_user + batch_send + send_card_as_user
    ├── messaging-bot.js         # 8 bot-side send/edit/reaction/pin
    ├── docs.js                  # 7 docs + block-edit handlers
    ├── drive.js                 # 6 drive + upload_drive_file handlers
    ├── im-read.js               # 5 IM read handlers + ChatIdMapper singleton
    ├── wiki.js                  # 4 wiki read handlers
    ├── contacts.js              # 4 contact lookup handlers
    ├── groups.js                # 4 group management handlers
    ├── diagnostics.js           # 3 health-check + media-download handlers
    ├── calendar.js              # 3 calendar handlers
    ├── okr.js                   # 3 OKR handlers
    ├── uploads.js               # 3 upload handlers
    └── profile.js               # 2 profile management handlers
```

## Decision Tree for "Where does my new code go?"

### Adding a new MCP tool (handler + schema)

1. Determine its **domain** by mapping to existing tool categories.
2. Add the schema to `src/tools/<domain>.js::schemas`.
3. Add the handler to `src/tools/<domain>.js::handlers` as `async name(args, ctx) { ... }`.
4. If the handler needs a Feishu API call that doesn't exist yet, add a method to `src/clients/official/<domain>.js` (or `clients/user.js` for cookie identity).
5. Only create a new `src/tools/<x>.js` if you're adding ≥3 related tools that don't fit existing domains. Otherwise piggyback on the closest match.

### Adding a new Feishu Official API call

- Add the method to `src/clients/official/<domain>.js`.
- If the call is shared across ≥2 domains, put it in `clients/official/base.js` instead.
- Cross-domain methods like `_safeSDKCall`, `_asUserOrApp`, `_uatREST`, `_populateSenderNames` live in base.js.

### Adding a new Cookie-identity API call

- Add to `src/clients/user.js`.
- Protobuf encoding helpers stay co-located there.

### Adding a new credential / auth concept

- Credentials API: `src/auth/credentials.js`. Use `readCredentials()` /
  `persistToConfig()` for the back-compat surface, or `readCanonical()` /
  `getActiveProfileEnv()` / `setActiveProfile()` for canonical access. The
  schema is documented at `docs/CREDENTIALS-FORMAT.md`.
- Cookie heartbeat still lives inline in `clients/user.js` and calls
  `persistToConfig` from auth/credentials. UAT refresh + cross-process file
  lock still lives in `clients/official/base.js` and calls
  `readCredentials` + `persistToConfig` from auth/credentials. Both will
  be extracted into `src/auth/{cookie,uat}.js` once they've been stable
  through one or two release cycles in the new persistence shape.

### Adding a new config / setup behaviour

- `src/config.js` owns legacy MCP-config discovery (`findMcpConfig`,
  `writeNewConfig`, `_atomicWrite` for ~/.claude.json / ~/.codex/config.toml /
  .mcp.json) — this is where harness-specific JSON/TOML knowledge lives.
- `src/auth/credentials.js` is the canonical credentials surface; it
  delegates to `config.js` only for legacy fallback (when no
  `~/.feishu-user-plugin/credentials.json` exists).
- `src/setup.js` is the CLI wizard. Adding a new setup behaviour: extend
  setup.js + writeNewConfig (config.js) for the harness-write path; teach
  auth/credentials.js if the new behaviour also needs to round-trip through
  credentials.json.

### Adding a cross-cutting helper

- Used by ≥2 modules: `src/utils.js`.
- Used by one tool only: keep it inside that tool file.

### Response shaping (text vs JSON vs sendResult)

- Always import from `src/tools/_registry.js`. Don't reinvent.
- `text(s)` — plain text MCP response.
- `json(o)` — JSON-pretty response, lifts any `o.fallbackWarning` to the top.
- `sendResult(r, desc)` — for send-style responses where `r.success` decides text.

## What NOT to Do

- ❌ Do **not** add new methods to `src/official.js` — it's a back-compat barrel, slated for deletion in v1.3.8.
- ❌ Do **not** add new methods to `src/index.js` — it's a 6-line entry point, nothing else.
- ❌ Do **not** add tool-specific logic to `src/server.js` — it's the dispatcher only.
- ❌ Do **not** create `src/tools/<x>.js` for a single tool. Group related tools.
- ❌ Do **not** bypass `src/server.js` to register tools. Every handler must be reachable via `TOOL_MODULES.flatMap(m => m.schemas)`.
- ❌ Do **not** bypass `src/clients/official/index.js` to construct the client. Always `require('./clients/official')`.
- ❌ Do **not** reach back into `server.js` from a tool module to grab state. Add a field to the `ctx` object instead, and document it in `_registry.js`'s docstring.
- ❌ Do **not** restore the legacy `switch (name) { case 'tool_name': ... }` dispatch pattern. Tool dispatch is now O(1) lookup in `HANDLERS`.

## When These Rules Don't Fit

If a feature genuinely doesn't fit any domain (e.g. WebSocket event subscription in v1.3.8), create a new top-level subdirectory with a clear scope (`src/events/`, `src/realtime/`) and document it here. New top-level dirs need this file updated in the same PR.

## Smoke Test Contract

`scripts/smoke.js` is the regression gate. It freezes:
- Tool count (currently 81)
- Each schema (sorted, normalized)
- The shape of `get_login_status` response

Every refactor commit must run `npm run smoke` and exit 0. If a commit intentionally adds/removes/renames tools or changes a schema, run `npm run smoke:baseline` to update `tests/baseline/*.json` in the same commit, with a clear "schema delta" subject line.

## Phase B Deferrals (residual cleanup, low priority)

The following extracts are still deferred — they are pure code-motion and
don't change behaviour, so they were postponed to keep the credentials
migration PR small:

- `src/auth/uat.js` — extracting UAT refresh + cross-process file lock from
  `clients/official/base.js`. The methods already write through
  `auth/credentials.js`, so the extract is just file motion.
- `src/auth/cookie.js` — extracting the heartbeat scheduler from
  `clients/user.js`. Same status — delegating call already in place.
- `src/config/{discovery,persistence,setup}.js` — splitting `config.js`
  by responsibility. Lower priority since `config.js` is now mostly a
  legacy fallback target rather than a primary surface.
