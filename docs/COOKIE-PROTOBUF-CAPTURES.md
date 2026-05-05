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

Status: pending (Phase 2 of v1.3.8 implementation plan).
Captures saved to: `/tmp/feishu-captures/image-*.b64`.
Findings: TBD.

## AUDIO (cmd=5, type=7)

Status: pending.

## STICKER (cmd=5, type=10)

Status: pending.

## CARD (cmd=5, type=14)

Status: pending.

## search_messages

Status: pending. UAT-first attempt before reverse-engineering — see Phase 6.
