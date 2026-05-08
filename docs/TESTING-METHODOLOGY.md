# feishu-user-plugin testing methodology

How we test this plugin against real Feishu APIs without setting fire to the
shared sandbox. Read this before adding tests, before running a release-cycle
regression, or after seeing a flaky failure.

The plugin straddles three identities (cookie / app / UAT) and four content
domains (messaging / docx / bitable / drive). Each test should be deliberate
about which identity it exercises and what state it leaves behind.

## Prerequisites

- Working credentials in `~/.feishu-user-plugin/credentials.json` for at
  least the default profile, with all five envs filled (cookie + app + UAT).
  Run `npx feishu-user-plugin status` to confirm.
- Test sandbox group: **飞书plugin测试群** (`oc_6ae081b457d07e9651d615493b7f1096`).
  Don't post test traffic in real working groups.
- The bot is in the sandbox group. If you can't read messages there, the
  bot was uninvited at some point — re-add via `manage_members(action=add,
  chat_id, member_ids=[<bot open_id>])`.

## Sandbox naming convention

All test resources MUST be prefixed with `test-YYYY-MM-DD-` so cleanup grep
catches them. Example:

```
test-2026-05-04-bitable-attachments
test-2026-05-04-doc-blocks
```

Cleanup at the end of each test session (or at release time):

```js
// Search by date prefix and delete the underlying drive resources
await manage_drive_file({ action: 'delete', file_token: 'XYZ', type: 'bitable' });
```

The `manage_drive_file(action=delete)` tool is idempotent — if the resource
was already removed it returns Feishu code 1061007 ("file has been delete")
which we treat as success.

## Inline-vs-disk size cap (download tools)

Anthropic's API rejects responses larger than 5 MB. Two of our tools return
binary content inline (base64 image / file bytes); they enforce a **2 MiB
cap** to leave headroom for multipart wrapping:

| Tool | What it returns inline |
|---|---|
| `download_message_resource` | image (MCP `image` content block) or file (base64, truncated for display) |
| `download_doc_image` | image content block |

When a payload would exceed 2 MiB, both tools require `save_path` and the
response only contains a short summary. **Always pass `save_path` for any
production resource you're not 100% sure stays under 2 MiB** — easier than
debugging the cap-failure path mid-task.

```js
// Right
await download_message_resource({
  message_id: 'om_xxx', key: 'file_xxx', kind: 'file',
  save_path: '/tmp/test-2026-05-04/sample.pdf',
});

// Wrong (will fail if file > 2 MiB)
await download_message_resource({ message_id: 'om_xxx', key: 'file_xxx', kind: 'file' });
```

## Playwright screenshot policy

Some flows (cookie setup) drive Playwright. The `browser_take_screenshot`
tool returns a base64 PNG inline. Full-page screenshots on a chatty Feishu
page easily exceed 5 MB and get rejected by Anthropic.

Rules:
- Prefer `browser_snapshot` (DOM accessibility tree, text-only) over
  `browser_take_screenshot` whenever possible — it gives the model the same
  semantic info without the bytes.
- When you do need pixels, **resize to a small viewport first**:
  `browser_resize({ width: 1280, height: 800 })`.
- Use the viewport-only screenshot mode (default), not `fullPage: true`.
- Save to disk if you need the artefact: `browser_take_screenshot({ filename:
  '/tmp/feishu-qr.png' })`. Inline-only mode should be the exception.

## Identity assertions

Every write tool routes through `_asUserOrApp` which tries UAT first and
falls back to bot. The response carries `viaUser: true|false`. After a write
test, verify which identity actually executed the call:

```js
const r = await create_calendar_event({ ... });
// r contains "(as user)" or "(as app — UAT unavailable...)"
```

If a test for "user-owned resource" lands on the bot path, the resource is
owned by the shared bot, not you — your follow-up reads from a different
profile will see different ownership. That's a real bug: either the UAT
expired or its scope is missing.

## Test-resource manifest

When a test session creates resources, log them to a manifest file so the
cleanup pass knows what to delete. Example:

```js
// At start of test
const manifest = [];
function record(kind, token, type) { manifest.push({ kind, token, type }); }

// During test
const bitable = await manage_bitable_app({ action: 'create', name: 'test-2026-05-04-bitable' });
record('bitable', bitable.appToken, 'bitable');

// At end (or in afterAll hook)
for (const { token, type } of manifest.reverse()) {
  await manage_drive_file({ action: 'delete', file_token: token, type })
    .catch((e) => console.error('cleanup failed:', token, e.message));
}
```

`reverse()` matters when you have nested resources (folder containing
docs) — delete children before parents.

## Smoke baseline drift

Tool / prompt schemas are pinned in `tests/baseline/{tools-list,login-status-shape,prompts-list}.json`.
Pre-commit hook runs `scripts/smoke.js diff` whenever you stage `src/`
files; CI re-runs it on every PR.

If you intentionally add / remove / rename tools, regenerate the baseline
in the SAME commit:

```bash
npm run smoke:baseline   # writes new baseline
npm run smoke            # verifies diff is empty
git add tests/baseline/ src/...
git commit -m "..."
```

If you accidentally drift, the hook blocks the commit. Don't `--no-verify`
your way around — investigate why.

## Live regression checklist (release-time)

Run `node scripts/test-all-tools.js` for the semi-automated path; that
script covers the read tools and the harmless write tools (sandbox group,
disposable bitable). For the write tools the script doesn't cover (group
membership changes, calendar event creation on your real calendar), run
manually with the per-tool snippets it prints.

After every release tag, exercise:

1. `get_login_status` — all three identities pass.
2. `read_messages(chat=飞书plugin测试群, page_size=5)` — 5 newest messages,
   sender names resolved.
3. `send_to_user(<self>, "test")` — message arrives in self DM.
4. `manage_bitable_app(action=create, name=test-YYYY-MM-DD-bitable)` →
   `manage_bitable_table(action=create)` → `manage_bitable_record(action=create)` →
   `manage_bitable_record(action=search)` → cleanup.
5. `create_calendar_event` on a sandbox calendar (NOT primary) → `delete_calendar_event`.
6. `download_message_resource` for both image and file kinds, with save_path.
7. `download_doc_image` for one docx with an image block.

Anything failing → check `~/.feishu-user-plugin/credentials.json`, then
re-run `npx feishu-user-plugin status` to diagnose.

## switch_profile e2e (v1.3.9 F.1)

`src/test-switch-profile.js` validates that `switch_profile` correctly:

1. Atomically updates `~/.feishu-user-plugin/credentials.json::active`.
2. Invalidates the cached `userClient` / `officialClient` in the current process.
3. Rebuilds clients with the new profile's credentials on next access.

**The test temporarily modifies `~/.feishu-user-plugin/credentials.json`** — backup is
automatic (restored in `try/finally`), but if the test crashes mid-run a
`cred-backup-<ts>.json` will remain in `/tmp/`.

**Before running:** stop any running MCP processes (`pkill -f feishu-user-plugin`) to
avoid them reacting to credential mutations via the v1.3.9 A.2 cross-process sync
mechanism.

CI runs this test with no real Feishu credentials needed — uses dummy values (an `alt`
profile with `LARK_APP_ID=cli_test_alt_xxxxxxxx`) that never hit the network.

```bash
node src/test-switch-profile.js
# Expected stdout: switch-profile-e2e: PASS
# Expected stderr: backup + restore notes
# After run: ~/.feishu-user-plugin/credentials.json identical to before
```

## See also

- `docs/CREDENTIALS-FORMAT.md` — credentials.json schema.
- `docs/REFACTOR-NOTES.md` — file responsibility matrix (what lives where post-Phase-A).
- `scripts/smoke.js` — protocol-level smoke (tools/prompts/login_status snapshot).
- `scripts/test-all-tools.js` — semi-automated tool regression.
