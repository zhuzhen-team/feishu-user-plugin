# Cookie Protobuf Wire Format Captures

Living document — appended as each message type is captured & decoded.

## Capture Session Methodology

The Feishu Web client encodes outgoing messages as protobuf inside a `Packet`
wrapper, then POSTs them to `https://internal-api-lark-api.feishu.cn/im/gateway/`.
The wire format is documented in `proto/lark.proto`, but multiple message types
have hidden metadata fields not yet captured. To extend the proto:

1. **Run a capture session** with Playwright MCP (this is what an agent driving
   `mcp__plugin_playwright_playwright__*` tools does):
   - `browser_navigate('https://www.feishu.cn/messenger/')`
   - Verify session via `browser_evaluate("document.cookie.includes('session=')")`
   - Inject all cookies from `LARK_COOKIE` env if missing (browser_run_code with
     `context.addCookies()`)
   - `browser_click` on the self-chat ("我自己") in the chat list
   - For IMAGE: `browser_file_upload` with a small test PNG
   - For AUDIO: click record button (require browser to grant microphone permission;
     headless Playwright often denies — manual capture may be needed)
   - For STICKER: open emoji panel, click a sticker, click send
   - For CARD: web UI may not expose card composition; capture from a
     prebuilt card sent by another route (e.g. via `send_message_as_bot` and
     then forward to self-chat to capture wire format)
   - **Critical: monkey-patch fetch BEFORE sending** to capture the protobuf
     payload:
     ```javascript
     // browser_run_code: install the patcher first
     const origFetch = window.fetch;
     window.__CAPTURED_GATEWAY_BODY__ = null;
     window.fetch = async (url, opts) => {
       if (typeof url === 'string' && url.includes('/im/gateway/') && opts?.method === 'POST') {
         let bytes;
         const body = opts.body;
         if (body instanceof Uint8Array) bytes = body;
         else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
         else if (body instanceof Blob) bytes = new Uint8Array(await body.arrayBuffer());
         if (bytes) window.__CAPTURED_GATEWAY_BODY__ = btoa(String.fromCharCode(...bytes));
       }
       return origFetch(url, opts);
     };
     ```
   - Then send via the UI, then `browser_evaluate('window.__CAPTURED_GATEWAY_BODY__')`
2. **Save the raw bytes** to `/tmp/feishu-captures/<type>-N.b64`.
3. **Decode** with `node scripts/decode-feishu-protobuf.js Packet --b64 "$(cat /tmp/feishu-captures/<type>-N.b64)"`.
   The decoder shows decoded fields PLUS unknown tags it found in the wire that
   aren't yet in the proto. Add those fields to `proto/lark.proto`.
4. **Iterate**: re-decode, identify deeper unknown fields (the bytes we
   identified as unknown may themselves be nested messages with their own
   unknown fields). Repeat until decoder reports `--- All fields known ---`.

## IMAGE (cmd=5, type=5)

Status: **attempted in v1.3.9 session 2026-05-08, blocked on UI navigation** — set aside per user directive
("先放一下"). Capture pipeline proven; image upload trigger needs deeper investigation.

### Progress made

- Cookie injection from LARK_COOKIE env via `context.addCookies()` works (29 cookies parsed from
  `~/.claude.json` mcpServers env block, all 29 inject cleanly).
- `page.addInitScript()` to register fetch / XHR / WebSocket capture patches BEFORE page load is the
  right pattern (the prior attempt installed patches AFTER page load and missed the bootstrap WS
  connection).
- After init-script + reload, **2 `/im/gateway/` POSTs were captured at boot** confirming Feishu web
  client sends via HTTP POST (not WebSocket) to the same `internal-api-lark-api.feishu.cn/im/gateway/`
  endpoint our plugin hits.

### Blocker

When clicked, `飞书plugin测试群` chat opens the **Lark Editor "Pin" panel** as the right pane
(infinite contenteditable wrapped in `editor-kit-container` and `code-block-zone-container`), NOT a
standard chat input box with bottom toolbar. Possible causes:

1. The `/next/messenger/` URL routes to a docs-first interface; the chat input may be rendered in a
   different layout selectable via a UI tab.
2. The chat input contenteditable may live in a shadow DOM root that
   `document.querySelectorAll('[contenteditable="true"]')` doesn't pierce.
3. Feishu's image upload may use Electron-style native file dialog via private API
   (`window.electronAPI` / `feishuBridge`) that bypasses standard `<input type="file">` entirely.

Toolbar buttons (14 found in the input row at y≈794) when clicked do NOT create file inputs —
clicking them either opens emoji/sticker panels or has no observable DOM effect.

Synthesized `paste` and `drop` events with `DataTransfer` containing a File object DID NOT trigger
upload — Feishu's paste handler likely requires the user-trusted event flag, which Playwright's
synthetic events don't carry.

### Recommended next steps

1. **Use Chrome DevTools Protocol (CDP) directly** — `page.context()._connection.send('Network.enable')`
   plus subscribing to `Network.requestWillBeSentExtraInfo` would capture the POST bodies independent
   of UI navigation. Combine with manual user-driven send (script the Playwright session to PAUSE,
   user manually navigates the actual Feishu Desktop app or another browser tab, capture happens
   in the Playwright tab via shared cookies — won't work cross-process).
2. **Find the actual chat input** — try `page.locator('textarea, [role="textbox"]').all()` instead of
   `[contenteditable]`; or sample the rendered DOM after pressing Tab from the page top to find
   focusable input candidates; or pierce shadow DOM with `el.shadowRoot` traversal.
3. **Skip web client; capture from Feishu Desktop client** — start mitmproxy or Charles, configure
   the Feishu desktop app to use it, capture HTTPS traffic to `internal-api-lark-api.feishu.cn/im/gateway/`
   directly. Cleaner because the desktop client is the same process that originated our existing
   working text/file/post wire format.
4. **Brute-force the protobuf** — given v1.3.7 already encodes IMAGE with `Content.imageKey` only and
   gets HTTP 400, write a small harness that tries adding individual fields one at a time
   (`imageKey` + `width`, then `+ height`, then `+ mimeType`, etc.) and observes 200 vs 400 response
   to converge on the required field set. Slower but works without web client capture.

### Capture pipeline artifacts

The capture init-script template is in
[`.playwright-mcp/init-script.js`](../.playwright-mcp/init-script.js)
(or regenerate from this doc). Three test PNGs are pre-generated at
`.playwright-mcp/captures/test-{small,medium,large}.png` (50×50 / 200×150 / 1200×800).

## AUDIO (cmd=5, type=7)

Status: pending. Deleted from v1.3.9 scope per Spec 2 (low usage).

## STICKER (cmd=5, type=10)

Status: pending. Deleted from v1.3.9 scope per Spec 2 (low value).

## CARD (cmd=5, type=14)

Status: **attempted in v1.3.9 session 2026-05-08; not started**. Same blocker as IMAGE — UI
navigation to the card editor fails because the right pane is occupied by Lark Editor / Pin
framework. Spec 2 §2.4 documented three fallback paths (forward existing bot card / web SDK
embed / direct protocol injection). Path iii (brute-force protocol) is most likely to succeed
without web UI.

## search_messages

Status: pending. UAT-first attempt before reverse-engineering — see Phase 6 (deferred to v1.3.10).
