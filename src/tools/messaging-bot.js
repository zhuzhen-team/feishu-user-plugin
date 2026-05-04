// src/tools/messaging-bot.js — Bot-identity messaging operations (send, reply,
// forward, delete, update, pin, reactions). send_card_as_user is intentionally
// kept inline in src/index.js until v1.3.7's user-identity card path lands; it
// will move to src/tools/messaging-user.js together with that work.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'send_message_as_bot',
    description: '[Official API] Send a message as the bot to any chat. Supports text, post, interactive, etc. This is the reliable path for @-mentions: include `<at user_id="ou_xxx">Name</at>` inline in text content and Feishu resolves it to a real @-notification.',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'Target chat_id (oc_xxx) or open_id' },
        msg_type: { type: 'string', description: 'Message type: text, post, image, interactive, etc.', enum: ['text', 'post', 'image', 'interactive', 'share_chat', 'share_user', 'audio', 'media', 'file', 'sticker'] },
        content: { description: 'Message content (string or object, auto-serialized). Plain text: {"text":"hello"}. Text with @-mention: {"text":"<at user_id=\\"ou_xxx\\">Alice</at> hi"} — the inline tag becomes a real @-notification.' },
      },
      required: ['chat_id', 'msg_type', 'content'],
    },
  },
  {
    name: 'reply_message',
    description: '[Official API] Reply to a specific message by message_id (as bot). Only works for text messages; other types return error 230054.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID to reply to (om_xxx)' },
        text: { type: 'string', description: 'Reply text' },
      },
      required: ['message_id', 'text'],
    },
  },
  {
    name: 'forward_message',
    description: '[Official API] Forward a message to another chat.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID to forward' },
        receive_id: { type: 'string', description: 'Target chat_id or open_id' },
      },
      required: ['message_id', 'receive_id'],
    },
  },
  {
    name: 'delete_message',
    description: '[Official API] Recall/delete a message (bot can only delete its own messages).',
    inputSchema: {
      type: 'object',
      properties: { message_id: { type: 'string', description: 'Message ID (om_xxx)' } },
      required: ['message_id'],
    },
  },
  {
    name: 'update_message',
    description: '[Official API] Edit a sent message (bot can only edit its own messages). Supports text and post.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx)' },
        msg_type: { type: 'string', description: 'Message type: text or post' },
        content: { description: 'New content. For text: {"text":"updated text"}' },
      },
      required: ['message_id', 'msg_type', 'content'],
    },
  },
  {
    name: 'pin_message',
    description: '[Official API] Pin or unpin a message in a chat.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID' },
        pinned: { type: 'boolean', description: 'true to pin, false to unpin', default: true },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'add_reaction',
    description: '[Official API] Add an emoji reaction to a message.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID (om_xxx)' },
        emoji_type: { type: 'string', description: 'Emoji type string, e.g. "THUMBSUP", "SMILE", "HEART"' },
      },
      required: ['message_id', 'emoji_type'],
    },
  },
  {
    name: 'delete_reaction',
    description: '[Official API] Remove an emoji reaction from a message.',
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Message ID' },
        reaction_id: { type: 'string', description: 'Reaction ID (from add_reaction response)' },
      },
      required: ['message_id', 'reaction_id'],
    },
  },
];

const handlers = {
  async send_message_as_bot(args, ctx) {
    const r = await ctx.getOfficialClient().sendMessageAsBot(args.chat_id, args.msg_type, args.content);
    return text(`Message sent (bot): ${r.messageId}`);
  },
  async reply_message(args, ctx) {
    return text(`Reply sent: ${(await ctx.getOfficialClient().replyMessage(args.message_id, args.text)).messageId}`);
  },
  async forward_message(args, ctx) {
    return text(`Forwarded: ${(await ctx.getOfficialClient().forwardMessage(args.message_id, args.receive_id)).messageId}`);
  },
  async delete_message(args, ctx) {
    return text(`Message deleted: ${(await ctx.getOfficialClient().deleteMessage(args.message_id)).deleted}`);
  },
  async update_message(args, ctx) {
    return text(`Message updated: ${(await ctx.getOfficialClient().updateMessage(args.message_id, args.msg_type, args.content)).messageId}`);
  },
  async pin_message(args, ctx) {
    return json(await ctx.getOfficialClient().pinMessage(args.message_id, args.pinned !== false));
  },
  async add_reaction(args, ctx) {
    return text(`Reaction added: ${(await ctx.getOfficialClient().addReaction(args.message_id, args.emoji_type)).reactionId}`);
  },
  async delete_reaction(args, ctx) {
    return text(`Reaction removed: ${(await ctx.getOfficialClient().deleteReaction(args.message_id, args.reaction_id)).deleted}`);
  },
};

module.exports = { schemas, handlers };
