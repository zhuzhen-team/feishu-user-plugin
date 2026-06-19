// src/tools/messaging-user.js — User-identity (cookie-based) messaging plus
// batch_send fan-out. send_card_as_user lives here (historical naming) but
// always routes through bot — user-identity card sending is server-side
// disabled in Feishu at the cookie auth tier.
//
// All send_*_as_user handlers route through ctx.getUserClient() (cookie identity)
// EXCEPT send_card_as_user which delegates to bot via ctx.getOfficialClient().
// The "as_user" suffix on the card tool is historical — v1.3.9 confirmed the
// cookie protobuf path for CARD is server-side disabled, brute-force exhausted.

const { text, sendResult, json } = require('./_registry');

// v1.3.7 C1.4: send_*_as_user (cookie protobuf) requires NUMERIC chat_id.
// When callers pass `oc_xxx` (Open API format), resolve it via
//   getChatInfo(oc_xxx) → name → cookie search(name) → numeric id
// and cache the mapping for the session. Without resolution, the cookie
// gateway accepts the call but the message goes nowhere (server treats
// the chatId field as unknown and returns an empty packet).
const _ocCache = new Map();

async function _resolveCookieChatId(chatId, ctx) {
  if (!chatId || typeof chatId !== 'string') return chatId;
  if (!chatId.startsWith('oc_')) return chatId;
  // Numeric chat ids are identity/tenant-scoped, so the oc_→numeric mapping is
  // only valid under the profile (cookie identity) that resolved it. Key the
  // cache by active profile, else a switch_profile silently reuses the previous
  // profile's numeric id and sends to the wrong/nonexistent chat.
  const profile = (ctx.getActiveProfile && ctx.getActiveProfile()) || 'default';
  const cacheKey = `${profile}:${chatId}`;
  if (_ocCache.has(cacheKey)) return _ocCache.get(cacheKey);
  let name;
  try {
    const info = await ctx.getOfficialClient().getChatInfo(chatId);
    name = info?.name;
  } catch (e) {
    throw new Error(`Cannot resolve ${chatId} to a numeric chat_id (cookie protobuf needs numeric): getChatInfo failed (${e.message}). Pass a numeric chat_id directly — get one via search_contacts + create_p2p_chat (P2P) or list_user_chats (group).`);
  }
  if (!name) {
    throw new Error(`Cannot resolve ${chatId}: getChatInfo returned no name. Pass a numeric chat_id directly.`);
  }
  const c = await ctx.getUserClient();
  const results = await c.search(name);
  // Require a UNIQUE exact-name match — never silently pick the first fuzzy hit.
  // Cookie search is substring/fuzzy, so picking "the first group" for a common
  // or ambiguous name could resolve oc_xxx to an unrelated chat and send the
  // message there (a confidentiality bug, not just a missed send).
  const exactGroups = results.filter((r) => r.title === name && r.type === 'group');
  let resolved;
  if (exactGroups.length === 1) {
    resolved = exactGroups[0];
  } else if (exactGroups.length > 1) {
    throw new Error(`Cannot safely resolve ${chatId}: cookie search returned ${exactGroups.length} groups exactly named "${name}" — ambiguous. Pass a numeric chat_id directly (list_user_chats / search_contacts).`);
  } else {
    const exactAny = results.filter((r) => r.title === name);
    if (exactAny.length === 1) {
      resolved = exactAny[0];
    } else {
      throw new Error(`Cannot resolve ${chatId} (chat "${name}") to a unique chat: cookie search returned ${exactAny.length} exact-name candidate(s). Pass a numeric chat_id directly — get one via create_p2p_chat (P2P) or list_user_chats (group).`);
    }
  }
  const numeric = String(resolved.id);
  _ocCache.set(cacheKey, numeric);
  return numeric;
}

const schemas = [
  {
    name: 'send_as_user',
    description: '[User Identity] Send a text message as the logged-in Feishu user. Supports reply threading and real @-mentions (triggers push notifications).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID. Numeric (from create_p2p_chat / search) preferred; oc_xxx is auto-resolved via getChatInfo + cookie search since v1.3.7 (C1.4).' },
        text: { type: 'string', description: 'Message text. If `ats` is provided, include the display marker for each @ in this text (default marker is `@<name>`).' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions. Each entry: {userId: "ou_xxx", name: "DisplayName"}. The text must contain each @<name> marker in order — it gets spliced into a real AT element so the mentioned user receives a notification.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
        root_id: { type: 'string', description: 'Thread root message ID (for reply, optional)' },
        parent_id: { type: 'string', description: 'Parent message ID (for nested reply, optional)' },
      },
      required: ['chat_id', 'text'],
    },
  },
  {
    name: 'send_to_user',
    description: '[User Identity] Search user by name → create P2P chat → send text message. All in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        user_name: { type: 'string', description: 'Recipient name (Chinese or English)' },
        text: { type: 'string', description: 'Message text' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions. Same format as send_as_user.ats: [{userId, name}]. Text must contain the `@<name>` marker for each entry.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
      },
      required: ['user_name', 'text'],
    },
  },
  {
    name: 'send_to_group',
    description: '[User Identity] Search group by name → send text message. All in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        group_name: { type: 'string', description: 'Group chat name' },
        text: { type: 'string', description: 'Message text' },
        ats: {
          type: 'array',
          description: 'Optional @-mentions that trigger real notifications. Each entry: {userId, name}. Text must contain `@<name>` marker for each entry.',
          items: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' }, marker: { type: 'string' } } },
        },
      },
      required: ['group_name', 'text'],
    },
  },
  {
    name: 'batch_send',
    description: '[User Identity / Official API] Send the same or different content to multiple targets in one call. Each target dispatches sequentially with a small delay (anti-rate-limit) and reports per-target success/error. Identity is the cookie user (user-identity sends) unless target.via=bot. Use for broadcast / fan-out scenarios.',
    inputSchema: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          description: 'Array of targets. Each entry: { type: "user"|"group"|"chat", id: <user_name | group_name | chat_id>, content: { kind: "text"|"image"|"file"|"post", ... } }. For kind="text": { text }. For "image": { image_key }. For "file": { file_key, file_name }. For "post": { title, paragraphs }. Optional per-target: via="bot" routes through send_message_as_bot (chat_id required).',
          items: { type: 'object' },
        },
        delay_ms: { type: 'number', description: 'Delay between sends in milliseconds (default 200, increase for risky volumes).' },
      },
      required: ['targets'],
    },
  },
  {
    name: 'send_image_as_user',
    description: '[User Identity, v1.3.9] Send an image as the logged-in user (NOT bot). Requires image_key from a prior upload_image call. Cookie-protobuf wire format requires both imageKey + thumbnailKey — when no separate thumbnail is provided, plugin defaults thumbnailKey to imageKey (Feishu accepts this for messenger-uploaded images). Width/height/mime/size are optional metadata; Feishu auto-derives display sizing on its side.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID. Numeric preferred; oc_xxx is auto-resolved (v1.3.7 C1.4).' },
        image_key: { type: 'string', description: 'Image key from upload (img_v2_xxx or img_v3_xxx)' },
        thumbnail_key: { type: 'string', description: 'Optional separate thumbnail image key. Defaults to image_key when omitted.' },
        width: { type: 'number', description: 'Optional image width in pixels.' },
        height: { type: 'number', description: 'Optional image height in pixels.' },
        mime: { type: 'string', description: 'Optional MIME type (e.g. "image/png").' },
        size: { type: 'number', description: 'Optional file size in bytes.' },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'image_key'],
    },
  },
  {
    name: 'send_file_as_user',
    description: '[User Identity] Send a file as the logged-in user. Requires file_key (upload via Official API first).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID. Numeric preferred; oc_xxx is auto-resolved (v1.3.7 C1.4).' },
        file_key: { type: 'string', description: 'File key from upload' },
        file_name: { type: 'string', description: 'Display file name' },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'file_key', 'file_name'],
    },
  },
  {
    name: 'send_post_as_user',
    description: '[User Identity] Send a rich text (POST) message with title and formatted paragraphs. Supports real @-mentions that trigger notifications.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat ID. Numeric preferred; oc_xxx is auto-resolved (v1.3.7 C1.4).' },
        title: { type: 'string', description: 'Post title (optional)' },
        paragraphs: {
          type: 'array',
          description: 'Array of paragraphs. Each paragraph is an array of elements:\n• {tag:"text",text:"..."} — plain text\n• {tag:"a",href:"https://...",text:"display"} — hyperlink\n• {tag:"at",userId:"ou_xxx",name:"Display Name"} — real @-mention (triggers notification)',
          items: { type: 'array', items: { type: 'object' } },
        },
        root_id: { type: 'string', description: 'Thread root message ID (optional)' },
      },
      required: ['chat_id', 'paragraphs'],
    },
  },
  {
    name: 'send_card_as_user',
    description: '[v1.3.9+: bot-only] Send an interactive Feishu card to a chat via bot identity (Official API). User-identity cookie protobuf path is server-side disabled at the auth tier — confirmed by exhaustive brute-force in v1.3.9, see scripts/explore-card-protobuf.js. The "as_user" suffix is historical naming kept for backward compat; the tool always routes through bot. Pass `card` as a JSON object (Feishu card schema, see https://open.feishu.cn/cardkit).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat_id (oc_xxx) or open_id' },
        card: { description: 'Feishu card JSON. See https://open.feishu.cn/cardkit for the schema; build cards visually then paste the resulting JSON here.' },
      },
      required: ['chat_id', 'card'],
    },
  },
];

const handlers = {
  async send_as_user(args, ctx) {
    const c = await ctx.getUserClient();
    const chatId = await _resolveCookieChatId(args.chat_id, ctx);
    const r = await c.sendMessage(chatId, args.text, { rootId: args.root_id, parentId: args.parent_id, ats: args.ats });
    return sendResult(r, `Text sent as user to ${args.chat_id}`);
  },
  async send_to_user(args, ctx) {
    const c = await ctx.getUserClient();
    const results = await c.search(args.user_name);
    const users = results.filter(r => r.type === 'user');
    if (users.length === 0) return text(`User "${args.user_name}" not found. Results: ${JSON.stringify(results)}`);
    if (users.length > 1) {
      const candidates = users.slice(0, 5).map(u => `  - ${u.title} (ID: ${u.id})`).join('\n');
      return text(`Multiple users match "${args.user_name}":\n${candidates}\nUse search_contacts to find the exact user, then create_p2p_chat + send_as_user.`);
    }
    const user = users[0];
    const chatId = await c.createChat(user.id);
    if (!chatId) return text(`Failed to create chat with ${user.title}`);
    const r = await c.sendMessage(chatId, args.text, { ats: args.ats });
    return sendResult(r, `Text sent to ${user.title} (chat: ${chatId})`);
  },
  async send_to_group(args, ctx) {
    const c = await ctx.getUserClient();
    const results = await c.search(args.group_name);
    const groups = results.filter(r => r.type === 'group');
    if (groups.length === 0) return text(`Group "${args.group_name}" not found. Results: ${JSON.stringify(results)}`);
    if (groups.length > 1) {
      const candidates = groups.slice(0, 5).map(g => `  - ${g.title} (ID: ${g.id})`).join('\n');
      return text(`Multiple groups match "${args.group_name}":\n${candidates}\nUse search_contacts to find the exact group, then send_as_user with the ID.`);
    }
    const group = groups[0];
    const r = await c.sendMessage(group.id, args.text, { ats: args.ats });
    return sendResult(r, `Text sent to group "${group.title}" (${group.id})`);
  },
  async batch_send(args, ctx) {
    if (!Array.isArray(args.targets) || args.targets.length === 0) return text('batch_send: targets must be a non-empty array');
    const delay = typeof args.delay_ms === 'number' ? args.delay_ms : 200;
    const userClient = await ctx.getUserClient();
    const officialClient = ctx.getOfficialClient();
    const results = [];
    for (let i = 0; i < args.targets.length; i++) {
      const t = args.targets[i];
      try {
        if (!t.content || !t.content.kind) throw new Error('content.kind is required');
        // Resolve chat id from name when applicable
        let chatId = t.id;
        if (t.type === 'user' || t.type === 'group') {
          const matches = await userClient.search(t.id);
          const want = matches.filter(m => m.type === t.type);
          if (want.length === 0) throw new Error(`No ${t.type} matches "${t.id}"`);
          if (want.length > 1) throw new Error(`Ambiguous ${t.type} "${t.id}" (${want.length} matches). Use type="chat" with explicit chat_id.`);
          const picked = want[0];
          chatId = t.type === 'user' ? await userClient.createChat(picked.id) : picked.id;
          if (!chatId) throw new Error(`Could not resolve chat for ${t.type} ${picked.title}`);
        } else if (t.via !== 'bot') {
          // type=chat with cookie identity — resolve oc_xxx → numeric (v1.3.7 C1.4).
          chatId = await _resolveCookieChatId(chatId, ctx);
        }
        let r;
        if (t.via === 'bot') {
          const c = t.content;
          const payload = c.kind === 'text' ? { text: c.text }
            : c.kind === 'post' ? { post: { zh_cn: { title: c.title || '', content: c.paragraphs || [] } } }
            : c.kind === 'image' ? { image_key: c.image_key }
            : c.kind === 'interactive' ? c.card
            : null;
          if (!payload) throw new Error(`bot path does not support content.kind=${c.kind}`);
          const msgType = c.kind === 'interactive' ? 'interactive' : c.kind;
          r = await officialClient.sendMessageAsBot(chatId, msgType, payload);
          results.push({ ok: true, target: t, messageId: r.messageId, via: 'bot' });
        } else {
          const c = t.content;
          if (c.kind === 'text') r = await userClient.sendMessage(chatId, c.text, { ats: c.ats });
          else if (c.kind === 'image') r = await userClient.sendImage(chatId, c.image_key);
          else if (c.kind === 'file') r = await userClient.sendFile(chatId, c.file_key, c.file_name);
          else if (c.kind === 'post') r = await userClient.sendPost(chatId, c.title, c.paragraphs);
          else throw new Error(`unknown content.kind=${c.kind}`);
          results.push({ ok: true, target: t, messageId: r.messageId, via: 'user' });
        }
      } catch (e) {
        results.push({ ok: false, target: t, error: e.message });
      }
      if (i < args.targets.length - 1 && delay > 0) await new Promise(r => setTimeout(r, delay));
    }
    const okCount = results.filter(r => r.ok).length;
    return json({ summary: `${okCount}/${results.length} sent`, results });
  },
  async send_image_as_user(args, ctx) {
    const c = await ctx.getUserClient();
    const chatId = await _resolveCookieChatId(args.chat_id, ctx);
    const r = await c.sendImage(chatId, args.image_key, {
      rootId: args.root_id,
      thumbnailKey: args.thumbnail_key,
      width: args.width,
      height: args.height,
      mime: args.mime,
      size: args.size,
    });
    return sendResult(r, `Image sent to ${args.chat_id}`);
  },
  async send_file_as_user(args, ctx) {
    const c = await ctx.getUserClient();
    const chatId = await _resolveCookieChatId(args.chat_id, ctx);
    const r = await c.sendFile(chatId, args.file_key, args.file_name, { rootId: args.root_id });
    return sendResult(r, `File "${args.file_name}" sent to ${args.chat_id}`);
  },
  async send_post_as_user(args, ctx) {
    const c = await ctx.getUserClient();
    const chatId = await _resolveCookieChatId(args.chat_id, ctx);
    const r = await c.sendPost(chatId, args.title || '', args.paragraphs, { rootId: args.root_id });
    return sendResult(r, `Post sent to ${args.chat_id}`);
  },
  async send_card_as_user(args, ctx) {
    const r = await ctx.getOfficialClient().sendMessageAsBot(args.chat_id, 'interactive', args.card);
    return sendResult(r, { desc: 'Card sent via bot (cookie channel rejects interactive)', viaUser: false });
  },
};

module.exports = { schemas, handlers, _resolveCookieChatId, _ocCache };
