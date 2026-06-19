// src/tools/im-read.js — IM read paths (chat list, message history, P2P).

const { text, json } = require('./_registry');

// ChatIdMapper — fuzzy chat-id resolver shared across im-read handlers.
// Moved from src/index.js in v1.3.7 phase A. Only read_messages uses it,
// so it lives here as a module-level singleton.
class ChatIdMapper {
  constructor() {
    this.nameCache = new Map(); // oc_id → chat name
    this.lastRefresh = 0;
    this.TTL = 5 * 60 * 1000; // 5 min cache
  }

  async _refresh(official) {
    if (Date.now() - this.lastRefresh < this.TTL) return;
    try {
      const chats = await official.listAllChats();
      this.nameCache.clear();
      for (const chat of chats) {
        this.nameCache.set(chat.chat_id, chat.name || '');
      }
      this.lastRefresh = Date.now();
    } catch (e) {
      console.error('[feishu-user-plugin] ChatIdMapper refresh failed:', e.message);
    }
  }

  // Case-insensitive name matching helper
  static _nameMatch(haystack, needle, exact = false) {
    if (!haystack || !needle) return false;
    const h = haystack.toLowerCase(), n = needle.toLowerCase();
    return exact ? h === n : h.includes(n);
  }

  async findByName(name, official) {
    await this._refresh(official);
    // Exact match first (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name, true)) return ocId;
    }
    // Partial match (case-insensitive)
    for (const [ocId, chatName] of this.nameCache) {
      if (ChatIdMapper._nameMatch(chatName, name)) return ocId;
    }
    return null;
  }

  async resolveToOcId(chatIdOrName, official) {
    if (!chatIdOrName) return null;
    if (chatIdOrName.startsWith('oc_')) return chatIdOrName;
    // Also accept raw numeric IDs (from search_contacts)
    if (/^\d+$/.test(chatIdOrName)) return chatIdOrName;
    // Strategy 1: Search in bot's group list cache
    const cached = await this.findByName(chatIdOrName, official);
    if (cached) return cached;
    // Strategy 2: Use im.v1.chat.search API (finds groups even if not in cache)
    try {
      const results = await official.chatSearch(chatIdOrName);
      for (const chat of results) {
        this.nameCache.set(chat.chat_id, chat.name || '');
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName, true)) return chat.chat_id;
      }
      // Partial match on search results (case-insensitive)
      for (const chat of results) {
        if (ChatIdMapper._nameMatch(chat.name, chatIdOrName)) return chat.chat_id;
      }
    } catch (e) {
      console.error('[feishu-user-plugin] chatSearch fallback failed:', e.message);
    }
    return null;
  }

  // Strategy 3: Use search_contacts (cookie-based) to find external groups by name
  // Returns numeric chat_id that works with UAT readMessagesAsUser
  async resolveViaContacts(chatName, userClient) {
    if (!userClient) return null;
    try {
      const results = await userClient.search(chatName);
      const groups = results.filter(r => r.type === 'group');
      // Exact match first (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName, true)) return String(g.id);
      }
      // Partial match (case-insensitive)
      for (const g of groups) {
        if (ChatIdMapper._nameMatch(g.title, chatName)) return String(g.id);
      }
    } catch (e) {
      console.error('[feishu-user-plugin] search_contacts fallback failed:', e.message);
    }
    return null;
  }
}

const chatIdMapper = new ChatIdMapper();

const schemas = [
  {
    name: 'get_chat_info',
    description: '[Official API + User Identity fallback] Get chat details: name, description, member count, owner. Supports both oc_xxx and numeric chat_id.',
    inputSchema: {
      type: 'object',
      properties: { chat_id: { type: 'string', description: 'Chat ID (oc_xxx or numeric)' } },
      required: ['chat_id'],
    },
  },
  {
    name: 'read_p2p_messages',
    description: '[User UAT] Read P2P (direct message) chat history using user_access_token. Works for chats the bot cannot access. Returns newest messages first by default. Auto-expands merge_forward messages into their child messages by default — disable with expand_merge_forward=false. Requires OAuth setup.\n\n**Sender semantics (v1.3.12)**: each message has a `displayLabel` (e.g. `周宇`, `[Bot] Claude聊天助手`, `[匿名]`, `[系统]`, `[已撤回] 怪兽`) — prefer it over raw `senderId` when narrating who-said-what. Also surfaced: `senderType` (user|app|anonymous), `senderIdType` (open_id|union_id|user_id), `senderTenantKey`, `isExternal` (cross-tenant), `isRecalled`, `isThreadReply` (parent_id present).',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (numeric from create_p2p_chat, or oc_xxx from list_user_chats). Both formats work.' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
        expand_merge_forward: { type: 'boolean', description: 'Auto-expand merge_forward placeholders into their child messages (default true). Children carry parentMessageId; use that id (not the child id) with download_message_resource (kind=image or file).' },
        page_token: { type: 'string', description: 'Pagination cursor — pass the pageToken from a previous response to fetch the next (older) page when hasMore is true.' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'list_user_chats',
    description: '[User UAT] List group chats the user is in. Note: only returns groups, not P2P. For P2P chats, use search_contacts → create_p2p_chat → read_p2p_messages. Requires OAuth setup.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
  {
    name: 'list_chats',
    description: '[Official API] List all chats the bot has joined. Returns chat_id, name, type.',
    inputSchema: {
      type: 'object',
      properties: {
        page_size: { type: 'number', description: 'Items per page (default 20, max 100)' },
        page_token: { type: 'string', description: 'Pagination token' },
      },
    },
  },
  {
    name: 'read_messages',
    description: '[Official API + UAT fallback] Read message history from any group. Accepts oc_xxx ID, numeric ID, or chat name (auto-searched). Auto-falls back to UAT for external groups the bot cannot access. Returns newest messages first by default, with sender names resolved. Auto-expands merge_forward messages into their child messages (with original sender / time / content preserved) by default — disable with expand_merge_forward=false. Text messages have URLs extracted into `urls`; Feishu doc links are additionally surfaced as `feishuDocs` so agents can feed them straight into read_doc / get_doc_blocks.\n\n**Sender semantics (v1.3.12)**: each message has a `displayLabel` (e.g. `周宇`, `[Bot] Claude聊天助手`, `[匿名]`, `[系统]`, `[已撤回] 怪兽`) — prefer it over raw `senderId` when narrating who-said-what. Also surfaced: `senderType` (user|app|anonymous), `senderIdType` (open_id|union_id|user_id), `senderTenantKey`, `isExternal` (cross-tenant), `isRecalled`, `isThreadReply` (parent_id present). **merge_forward children** carry `originChatId` (the chat the conversation came from, NOT the chat you queried) and best-effort `forwardedFromChatName` — do NOT treat children as native messages of the current group.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Chat ID (oc_xxx), numeric ID, or chat name (auto-searched via bot groups, im.chat.search, and user contacts)' },
        page_size: { type: 'number', description: 'Messages to fetch (default 20, max 50)' },
        start_time: { type: 'string', description: 'Start timestamp in seconds (optional)' },
        end_time: { type: 'string', description: 'End timestamp in seconds (optional)' },
        sort_type: { type: 'string', enum: ['ByCreateTimeDesc', 'ByCreateTimeAsc'], description: 'Sort order (default: ByCreateTimeDesc = newest first)' },
        expand_merge_forward: { type: 'boolean', description: 'Auto-expand merge_forward placeholders into their child messages (default true). Children carry parentMessageId; use that id (not the child id) with download_message_resource (kind=image or file).' },
        page_token: { type: 'string', description: 'Pagination cursor — pass the pageToken from a previous response to fetch the next (older) page when hasMore is true.' },
        via_user: { type: 'boolean', description: 'v1.3.12 — explicit identity override. `true` skips the bot path and reads directly via UAT (use when the chat is yours / external and you know bot has no access). `false` skips UAT fallback and surfaces the bot error instead of cross-identity hop (use when you specifically want the bot view). Omit for default auto-fallback (bot first, UAT on failure).' },
      },
      required: ['chat_id'],
    },
  },
  {
    name: 'search_messages',
    description: '[User UAT, v1.3.12] Search the user\'s IM history by keyword. Wraps Feishu `POST /open-apis/search/v2/message`. Requires UAT with the `search:message` scope (re-run `npx feishu-user-plugin oauth` after v1.3.12 SCOPES update). Feishu does NOT expose a bot-path search; if you only have app credentials this tool will error.\n\nReturns `{items, pageToken, hasMore}` where each item is a `{message_id, chat_id, ...}` pointer — call `read_messages(chat_id)` or `read_p2p_messages(chat_id)` to fetch the full message bodies if needed. The pointer-only return keeps the response token-light when searching across many chats.\n\nFilter knobs (all optional):\n- `chat_ids`: only search inside these chats (oc_xxx)\n- `from_ids`: messages sent by these users (ou_xxx / union_id)\n- `at_user_ids`: messages that @-mention these users\n- `message_types`: e.g. `["text", "post"]`\n- `from_types`: e.g. `["user", "anonymous"]`',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword. Plain text; Feishu handles tokenization.' },
        page_size: { type: 'number', description: 'Items per page (default 20, max 100)' },
        page_token: { type: 'string', description: 'Pagination cursor from a previous page' },
        chat_ids: { type: 'array', items: { type: 'string' }, description: 'Restrict to these oc_xxx chats' },
        from_ids: { type: 'array', items: { type: 'string' }, description: 'Restrict to messages from these user ids (ou_xxx / union_id)' },
        at_user_ids: { type: 'array', items: { type: 'string' }, description: 'Restrict to messages that @-mention these user ids' },
        message_types: { type: 'array', items: { type: 'string' }, description: 'Filter by message types (e.g. ["text","post","image","file","interactive"])' },
        from_types: { type: 'array', items: { type: 'string' }, description: 'Filter by sender types (e.g. ["user","anonymous"])' },
      },
      required: ['query'],
    },
  },
];

const handlers = {
  async get_chat_info(args, ctx) {
    // Strategy 1: Official API im.chat.get (supports oc_xxx format)
    if (args.chat_id.startsWith('oc_')) {
      try {
        const info = await ctx.getOfficialClient().getChatInfo(args.chat_id);
        return info ? json(info) : text(`No info for chat ${args.chat_id}`);
      } catch (e) {
        console.error(`[feishu-user-plugin] Official getChatInfo failed: ${e.message}`);
      }
    }
    // Strategy 2: Protobuf gateway (supports numeric chat_id)
    try {
      const c = await ctx.getUserClient();
      const info = await c.getGroupInfo(args.chat_id);
      if (info) return json(info);
    } catch (e) {
      console.error(`[feishu-user-plugin] Protobuf getChatInfo failed: ${e.message}`);
    }
    return text(`No info for chat ${args.chat_id}`);
  },

  async read_p2p_messages(args, ctx) {
    const official = ctx.getOfficialClient();
    let chatId = args.chat_id;
    let uc = null;
    let ucError = null;
    try { uc = await ctx.getUserClient(); } catch (e) { ucError = e; }
    // If chat_id is not numeric or oc_, try to resolve as user name → P2P chat
    if (!/^\d+$/.test(chatId) && !chatId.startsWith('oc_')) {
      if (uc) {
        let results;
        try {
          results = await uc.search(chatId);
        } catch (e) {
          // Cookie search now throws on a non-2xx gateway (expired cookie / rate
          // limit) instead of returning []. Fall through to the friendly hint
          // the surrounding code already provides for unresolvable names.
          return text(`Cannot resolve "${args.chat_id}" via cookie search (${e.message}). Use search_contacts to find the chat/user ID, then pass it directly.`);
        }
        const user = results.find(r => r.type === 'user');
        if (user) {
          const pChatId = await uc.createChat(String(user.id));
          if (pChatId) chatId = String(pChatId);
          else return text(`Found user "${user.title}" but failed to create P2P chat.`);
        } else {
          // Maybe it's a group name
          const group = results.find(r => r.type === 'group');
          if (group) chatId = String(group.id);
          else return text(`Cannot resolve "${args.chat_id}" to a chat. Use search_contacts to find the ID first.`);
        }
      } else {
        const hint = ucError ? `Cookie auth failed: ${ucError.message}. Fix LARK_COOKIE first, or p` : 'P';
        return text(`"${args.chat_id}" is not a valid chat ID. ${hint}rovide a numeric ID or oc_xxx format. Use search_contacts + create_p2p_chat to get the ID.`);
      }
    }
    return json(await official.readMessagesAsUser(chatId, {
      pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
      sortType: args.sort_type, pageToken: args.page_token,
      expandMergeForward: args.expand_merge_forward !== false,
    }, uc));
  },

  async list_user_chats(args, ctx) {
    return json(await ctx.getOfficialClient().listChatsAsUser({ pageSize: args.page_size, pageToken: args.page_token }));
  },

  async list_chats(args, ctx) {
    return json(await ctx.getOfficialClient().listChats({ pageSize: args.page_size, pageToken: args.page_token }));
  },

  async read_messages(args, ctx) {
    const official = ctx.getOfficialClient();
    const msgOpts = {
      pageSize: args.page_size, startTime: args.start_time, endTime: args.end_time,
      sortType: args.sort_type, pageToken: args.page_token,
      expandMergeForward: args.expand_merge_forward !== false,
    };
    // v1.3.12: via_user opt-in routing override. true=skip bot (UAT only),
    // false=skip UAT (bot only / no fallback), undefined=default auto-fallback.
    // Set `via: 'user'` explicitly so readMessagesWithFallback labels the
    // response data.via = 'user' (distinguishing intentional UAT route from
    // the auto-fallback case where 'bot' is the default label).
    const routingOpts = {};
    if (args.via_user === true) { routingOpts.skipBot = true; routingOpts.via = 'user'; }
    else if (args.via_user === false) routingOpts.skipUat = true;

    // Get userClient for name resolution fallback (best-effort)
    let uc = null;
    try { uc = await ctx.getUserClient(); } catch (_) {}

    // Path A — chat_id that resolves inside bot's / official search scope.
    const resolvedChatId = await chatIdMapper.resolveToOcId(args.chat_id, official);
    if (resolvedChatId) {
      return json(await official.readMessagesWithFallback(resolvedChatId, msgOpts, uc, routingOpts));
    }

    // Path B — external group discovered only via cookie search_contacts.
    // When we got here the bot definitely can't see it, so skip bot entirely
    // and go straight to UAT with a `contacts` via label. If user explicitly
    // set via_user=false (bot-only), short-circuit with a clear error rather
    // than silently routing through UAT anyway.
    if (args.via_user === false) {
      return text(`Cannot find "${args.chat_id}" via bot, and via_user=false explicitly opts out of UAT fallback. Either omit via_user or set via_user=true.`);
    }
    if (official.hasUAT) {
      if (!uc) try { uc = await ctx.getUserClient(); } catch (_) {}
      const contactChatId = await chatIdMapper.resolveViaContacts(args.chat_id, uc);
      if (contactChatId) {
        return json(await official.readMessagesWithFallback(contactChatId, msgOpts, uc, { skipBot: true, via: 'contacts' }));
      }
    }

    return text(`Cannot resolve "${args.chat_id}" to a chat ID.\nSearched: bot's group list, im.chat.search API, and user contacts (search_contacts).\nTry: provide the oc_xxx or numeric chat ID directly.`);
  },

  async search_messages(args, ctx) {
    const official = ctx.getOfficialClient();
    const result = await official.searchMessages({
      query: args.query,
      pageSize: args.page_size,
      pageToken: args.page_token,
      chatIds: args.chat_ids,
      fromIds: args.from_ids,
      atUserIds: args.at_user_ids,
      messageTypes: args.message_types,
      fromTypes: args.from_types,
    });
    return json(result);
  },
};

module.exports = { schemas, handlers };
