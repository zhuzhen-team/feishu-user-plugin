// src/tools/diagnostics.js — health checks + media download for messages and docx images.

const { text } = require('./_registry');

const schemas = [
  {
    name: 'get_login_status',
    description: 'Check cookie session validity and app credentials status. Also refreshes session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'download_image',
    description: '[User Identity / Official API] Download an image so the model can actually see it. Two modes: (1) message image — pass message_id + image_key from read_messages / read_p2p_messages. (2) docx image — pass doc_token + image_token (the block.image.token from get_doc_blocks). doc_token accepts native document_id, wiki node token, or Feishu URL. Tries user identity first, falls back to app. NOTE: for merge_forward children, pass the child\'s `parentMessageId` (NOT the child message id) — Feishu keys media by the parent merge_forward id.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx) — for mode 1 only. For merge_forward children use the parent merge_forward message id.' },
        image_key: { type: 'string', description: 'Image key (img_xxx) from message content — for mode 1 only' },
        doc_token: { type: 'string', description: 'Document ID, wiki node token, or Feishu URL — for mode 2 only' },
        image_token: { type: 'string', description: 'Image token from a docx image block (block.image.token via get_doc_blocks) — for mode 2 only' },
      },
    },
  },
  {
    name: 'download_file',
    description: '[User Identity / Official API] Download a file attached to a message (msg_type=file). Returns base64 bytes + mimeType + filename. Tries user identity first, falls back to app. For merge_forward children, pass the child\'s `parentMessageId` (NOT the child message id) — Feishu keys media by the parent merge_forward id.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx). For merge_forward children use the parent merge_forward message id.' },
        file_key: { type: 'string', description: 'File key from message content (content.file_key for msg_type=file)' },
        save_path: { type: 'string', description: 'Optional absolute local path to save the file to. If omitted, file is only returned as inline base64 in the response.' },
      },
      required: ['message_id', 'file_key'],
    },
  },
];

const handlers = {
  async get_login_status(_args, ctx) {
    const parts = [];
    try {
      const c = await ctx.getUserClient();
      const status = await c.checkSession();
      parts.push(`Cookie: ${status.valid ? 'Active' : 'Expired'} (${status.userName || status.userId || 'unknown'})`);
      parts.push(`  ${status.message}`);
    } catch (e) { parts.push(`Cookie: ${e.message}`); }
    const hasApp = !!(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);
    if (!hasApp) {
      parts.push(`App credentials: Not set`);
    } else {
      const official = ctx.getOfficialClient();
      const probe = await official.verifyApp();
      if (probe.valid) {
        const nameBit = probe.appName ? ` "${probe.appName}"` : '';
        parts.push(`App credentials: Valid — app_id=${probe.appId}${nameBit}`);
      } else {
        parts.push(`App credentials: INVALID — app_id=${probe.appId} rejected by Feishu (${probe.error})`);
        parts.push(`  → Likely wrong/stale APP_ID. Re-run the install prompt from team-skills/plugins/feishu-user-plugin/README.md to get the correct credentials.`);
      }
      if (official.hasUAT) {
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

  async download_image(args, ctx) {
    const official = ctx.getOfficialClient();
    let r;
    let source;
    if (args.image_token) {
      const docToken = args.doc_token ? await ctx.resolveDocId(args.doc_token) : undefined;
      r = await official.downloadDocImage(args.image_token, docToken);
      source = docToken ? `docx ${docToken}` : 'drive media';
    } else if (args.message_id && args.image_key) {
      r = await official.downloadMessageResource(args.message_id, args.image_key, 'image');
      source = `message ${args.message_id}`;
    } else {
      return text('download_image requires either (message_id + image_key) for chat images, or (image_token, optionally with doc_token) for docx images.');
    }
    return {
      content: [
        { type: 'text', text: `Image downloaded from ${source} (${r.viaUser ? 'as user' : 'as app'}, ${r.bytes} bytes, ${r.mimeType}):` },
        { type: 'image', data: r.base64, mimeType: r.mimeType },
      ],
    };
  },

  async download_file(args, ctx) {
    if (!args.message_id || !args.file_key) {
      return text('download_file requires message_id + file_key. For merge_forward children pass the PARENT merge_forward message id, not the child id.');
    }
    const r = await ctx.getOfficialClient().downloadMessageResource(args.message_id, args.file_key, 'file');
    let saveNote = '';
    if (args.save_path) {
      try {
        const fs = require('fs');
        fs.writeFileSync(args.save_path, Buffer.from(r.base64, 'base64'));
        saveNote = `\nSaved to: ${args.save_path}`;
      } catch (e) {
        saveNote = `\nSave to ${args.save_path} failed: ${e.message}`;
      }
    }
    const summary = `File downloaded from message ${args.message_id} (${r.viaUser ? 'as user' : 'as app'}, ${r.bytes} bytes, ${r.mimeType})${saveNote}`;
    return {
      content: [
        { type: 'text', text: summary },
        { type: 'text', text: `base64 (${r.bytes} bytes, truncated display):\n${r.base64.slice(0, 400)}${r.base64.length > 400 ? '…' : ''}` },
      ],
    };
  },
};

module.exports = { schemas, handlers };
