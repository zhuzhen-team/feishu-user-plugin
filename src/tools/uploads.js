// src/tools/uploads.js — upload helpers (image, file, bitable attachment).

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'upload_image',
    description: '[Official API] Upload an image file to Feishu. Returns image_key for use with send_image_as_user.',
    inputSchema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Absolute path to the image file on disk' },
        image_type: { type: 'string', enum: ['message', 'avatar'], description: 'Image usage type (default: message)' },
      },
      required: ['image_path'],
    },
  },
  {
    name: 'upload_file',
    description: '[Official API] Upload a file to Feishu. Returns file_key for use with send_file_as_user.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file on disk' },
        file_type: { type: 'string', enum: ['opus', 'mp4', 'pdf', 'doc', 'xls', 'ppt', 'stream'], description: 'File type (default: stream for generic files)' },
        file_name: { type: 'string', description: 'Display file name (optional, defaults to basename)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'upload_bitable_attachment',
    description: '[Official API] Upload a file as a Bitable attachment (drive/v1/medias/upload_all with parent_type=bitable_image or bitable_file). Returns file_token suitable for writing into a Bitable Attachment-type field via batch_create/update_bitable_records (the field value should be [{file_token}]).',
    inputSchema: {
      type: 'object',
      properties: {
        app_token: { type: 'string', description: 'Bitable app token (the bascn... or basc... id)' },
        file_path: { type: 'string', description: 'Absolute path to the file on disk' },
        kind: { type: 'string', enum: ['image', 'file'], description: 'Whether the attachment is an image (bitable_image) or a generic file (bitable_file). Default: file.' },
      },
      required: ['app_token', 'file_path'],
    },
  },
];

const handlers = {
  async upload_image(args, ctx) {
    const r = await ctx.getOfficialClient().uploadImage(args.image_path, args.image_type);
    return text(`Image uploaded: ${r.imageKey}\nUse this image_key with send_image_as_user to send it.`);
  },
  async upload_file(args, ctx) {
    const r = await ctx.getOfficialClient().uploadFile(args.file_path, args.file_type, args.file_name);
    return text(`File uploaded: ${r.fileKey}\nUse this file_key with send_file_as_user to send it.`);
  },
  async upload_bitable_attachment(args, ctx) {
    const kind = args.kind === 'image' ? 'bitable_image' : 'bitable_file';
    const appToken = await ctx.resolveDocId(args.app_token);
    const up = await ctx.getOfficialClient().uploadMedia(args.file_path, appToken, kind);
    return json({ fileToken: up.fileToken, viaUser: up.viaUser, fallbackWarning: up.fallbackWarning, parentType: kind, hint: `Pass [{ file_token: "${up.fileToken}" }] as the value of an Attachment-type Bitable field.` });
  },
};

module.exports = { schemas, handlers };
