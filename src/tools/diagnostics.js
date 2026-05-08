// src/tools/diagnostics.js — health checks + media downloads.
//
// v1.3.7 (C2.4) consolidates download_image / download_file into:
//   download_message_resource(message_id, key, kind=image|file, save_path?)
//   download_doc_image(image_token, doc_token?, save_path?)
// Inline-base64 responses are capped at MAX_INLINE_BYTES (2 MiB) to leave
// headroom under Anthropic's 5 MB API limit; over the cap, save_path is
// required and the response only includes a short summary.

const fs = require('fs');
const { text } = require('./_registry');

const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2 MiB; Anthropic API cap is 5 MB

function inlineTooBig(bytes) {
  return bytes > MAX_INLINE_BYTES;
}

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

const schemas = [
  {
    name: 'get_login_status',
    description: 'Check cookie session validity and app credentials status. Also refreshes session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'download_message_resource',
    description: '[User Identity / Official API] Download an image or file attached to a message so the model can see / store it. v1.3.7 (C2.4) consolidates the v1.3.6 download_image (mode 1) + download_file. UAT-first, falls back to app.\n\nFor images, the response includes an inline `image` content block so the model sees pixels. For files, the response includes the bytes as base64 (truncated for display) plus an optional save_path write.\n\n**Size cap:** payloads > 2 MiB MUST pass `save_path`. The Anthropic API rejects responses > 5 MB; we cap at 2 MiB so multipart wrapping has headroom.\n\n**merge_forward children:** Feishu keys media by the parent merge_forward id, not the child id. Use the child\'s `parentMessageId` field (returned by read_messages with expand_merge_forward) — not the child id.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx). For merge_forward children, use the child\'s `parentMessageId`.' },
        key: { type: 'string', description: 'image_key (img_xxx) for kind=image, file_key for kind=file. From read_messages content.' },
        kind: { type: 'string', enum: ['image', 'file'], description: 'image or file' },
        save_path: { type: 'string', description: 'Absolute local path. Required when downloaded bytes > 2 MiB (else the response would exceed the Anthropic API 5 MB inline limit).' },
      },
      required: ['message_id', 'key', 'kind'],
    },
  },
  {
    name: 'download_doc_image',
    description: '[User Identity / Official API] Download an image embedded in a docx document so the model can see it. Pass the `image_token` from `get_doc_blocks` (block.image.token), and optionally the doc/wiki/URL token to scope the lookup. UAT-first.\n\n**Size cap:** payloads > 2 MiB MUST pass `save_path`.',
    inputSchema: {
      type: 'object',
      properties: {
        image_token: { type: 'string', description: 'Image token (from get_doc_blocks image block)' },
        doc_token: { type: 'string', description: 'Document ID, wiki node token, or Feishu URL (optional but recommended for permission scoping).' },
        save_path: { type: 'string', description: 'Absolute local path. Required when image bytes > 2 MiB.' },
      },
      required: ['image_token'],
    },
  },
];

function maybeSave(savePath, base64) {
  if (!savePath) return null;
  try {
    fs.writeFileSync(savePath, Buffer.from(base64, 'base64'));
    return { ok: true, path: savePath };
  } catch (e) {
    return { ok: false, path: savePath, error: e.message };
  }
}

const handlers = {
  async get_login_status(_args, ctx) {
    const parts = [];
    parts.push(`Active profile: ${ctx.getActiveProfile()}  (available: ${ctx.listProfiles().join(', ')})`);
    try {
      const c = await ctx.getUserClient();
      const status = await c.checkSession();
      parts.push(`Cookie: ${status.valid ? 'Active' : 'Expired'} (${status.userName || status.userId || 'unknown'})`);
      parts.push(`  ${status.message}`);
    } catch (e) { parts.push(`Cookie: ${e.message}`); }
    // v1.3.9: read APP creds via ctx (profile-aware), not process.env directly,
    // so SSOT users (env pointer-only) don't see false "Not set" reports.
    let official, hasApp = false;
    try {
      official = ctx.getOfficialClient();
      hasApp = !!(official.appId && official.appSecret);
    } catch (_) {}
    if (!hasApp) {
      parts.push(`App credentials: Not set`);
    } else {
      const probe = await official.verifyApp();
      if (probe.valid) {
        const nameBit = probe.appName ? ` "${probe.appName}"` : '';
        parts.push(`App credentials: Valid — app_id=${probe.appId}${nameBit}`);
      } else {
        parts.push(`App credentials: INVALID — app_id=${probe.appId} rejected by Feishu (${probe.error})`);
        parts.push(`  → Likely wrong/stale APP_ID. Re-run the install prompt from team-skills/plugins/feishu-user-plugin/README.md to get the correct credentials.`);
      }
      // official.hasUAT (when available)
      if (official && official.hasUAT) {
        try {
          await official.listChatsAsUser({ pageSize: 1 });
          parts.push('User access token: Valid (P2P/group UAT reading enabled)');
        } catch (e) {
          parts.push(`User access token: INVALID — ${e.message}`);
          parts.push('  → Re-run OAuth: npx feishu-user-plugin oauth, then restart Claude Code / Codex so running MCP servers load the new token.');
        }
      } else {
        parts.push('User access token: Not set (optional — needed for P2P chat reading. Run OAuth flow to obtain, see README for details)');
      }
    }
    return text(parts.join('\n'));
  },

  async download_message_resource(args, ctx) {
    if (!args.message_id || !args.key) {
      return text('download_message_resource requires message_id and key. For merge_forward children, use the child\'s parentMessageId (not the child id).');
    }
    const kind = args.kind;
    if (kind !== 'image' && kind !== 'file') {
      return text('download_message_resource: kind must be "image" or "file".');
    }
    const r = await ctx.getOfficialClient().downloadMessageResource(args.message_id, args.key, kind);
    const sizeNote = `${r.bytes} bytes (${fmtMB(r.bytes)}, ${r.mimeType})`;
    const tooBig = inlineTooBig(r.bytes);
    if (tooBig && !args.save_path) {
      return text(`Resource is ${sizeNote} — exceeds the 2 MiB inline cap. Re-run download_message_resource with save_path=<absolute path> so the bytes are written to disk and only a small summary is returned.`);
    }
    const saved = maybeSave(args.save_path, r.base64);
    const saveNote = saved
      ? (saved.ok ? `\nSaved to: ${saved.path}` : `\nSave to ${saved.path} failed: ${saved.error}`)
      : '';
    const ident = r.viaUser ? 'as user' : 'as app';
    if (kind === 'image' && !tooBig) {
      return {
        content: [
          { type: 'text', text: `Image from message ${args.message_id} (${ident}, ${sizeNote})${saveNote}` },
          { type: 'image', data: r.base64, mimeType: r.mimeType },
        ],
      };
    }
    if (tooBig) {
      return text(`Resource from message ${args.message_id} downloaded (${ident}, ${sizeNote})${saveNote}\nInline content omitted because the payload exceeds the 2 MiB cap.`);
    }
    return {
      content: [
        { type: 'text', text: `File from message ${args.message_id} (${ident}, ${sizeNote})${saveNote}` },
        { type: 'text', text: `base64 (${r.bytes} bytes, truncated display):\n${r.base64.slice(0, 400)}${r.base64.length > 400 ? '…' : ''}` },
      ],
    };
  },

  async download_doc_image(args, ctx) {
    if (!args.image_token) {
      return text('download_doc_image requires image_token (from get_doc_blocks image block). Optionally pass doc_token (native id / wiki node / Feishu URL).');
    }
    const docToken = args.doc_token ? await ctx.resolveDocId(args.doc_token) : undefined;
    const r = await ctx.getOfficialClient().downloadDocImage(args.image_token, docToken);
    const sizeNote = `${r.bytes} bytes (${fmtMB(r.bytes)}, ${r.mimeType})`;
    const tooBig = inlineTooBig(r.bytes);
    if (tooBig && !args.save_path) {
      return text(`Image is ${sizeNote} — exceeds the 2 MiB inline cap. Re-run download_doc_image with save_path=<absolute path>.`);
    }
    const saved = maybeSave(args.save_path, r.base64);
    const saveNote = saved
      ? (saved.ok ? `\nSaved to: ${saved.path}` : `\nSave to ${saved.path} failed: ${saved.error}`)
      : '';
    const source = docToken ? `docx ${docToken}` : 'drive media';
    const ident = r.viaUser ? 'as user' : 'as app';
    if (tooBig) {
      return text(`Image from ${source} downloaded (${ident}, ${sizeNote})${saveNote}\nInline content omitted because the payload exceeds the 2 MiB cap.`);
    }
    return {
      content: [
        { type: 'text', text: `Image from ${source} (${ident}, ${sizeNote})${saveNote}` },
        { type: 'image', data: r.base64, mimeType: r.mimeType },
      ],
    };
  },
};

module.exports = { schemas, handlers };
