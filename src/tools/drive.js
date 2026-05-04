// src/tools/drive.js — Drive file operations + drive-targeted upload.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'list_files',
    description: '[Official API] List files in a Drive folder.',
    inputSchema: {
      type: 'object',
      properties: { folder_token: { type: 'string', description: 'Folder token (empty for root)' } },
    },
  },
  {
    name: 'create_folder',
    description: '[Official API] Create a new folder in Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parent_token: { type: 'string', description: 'Parent folder token (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'upload_drive_file',
    description: '[Official API] Upload a file from disk to a Feishu Drive folder (drive/v1/files/upload_all, parent_type=explorer). Returns file_token + url. If wiki_space_id is provided, the uploaded file is then attached to that Wiki space via move_docs_to_wiki (obj_type=file). UAT-first with app fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file on disk' },
        folder_token: { type: 'string', description: 'Destination folder token. Use list_files to find one, or pass the user "我的空间" root token.' },
        wiki_space_id: { type: 'string', description: 'Optional. If set, also attach the uploaded file to this Wiki space.' },
        wiki_parent_node_token: { type: 'string', description: 'Optional. Parent node under which to attach in the Wiki space.' },
      },
      required: ['file_path', 'folder_token'],
    },
  },
  {
    name: 'copy_file',
    description: '[Official API] Copy a file/doc in Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File token to copy' },
        name: { type: 'string', description: 'New file name' },
        folder_token: { type: 'string', description: 'Destination folder token (optional)' },
        type: { type: 'string', description: 'File type: file, doc, sheet, bitable, docx, mindnote, slides (optional)' },
      },
      required: ['file_token', 'name'],
    },
  },
  {
    name: 'move_file',
    description: '[Official API] Move a file/doc/folder to another folder in Drive. `type` is required (Feishu rejects with 1061002 otherwise) — pass `file`, `folder`, `doc`, `sheet`, `bitable`, `docx`, `mindnote`, or `slides` to match the resource being moved.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File/folder token to move' },
        folder_token: { type: 'string', description: 'Destination folder token' },
        type: { type: 'string', enum: ['file', 'folder', 'doc', 'sheet', 'bitable', 'docx', 'mindnote', 'slides'], description: 'Resource type — Feishu requires this to know which API table to look up.' },
      },
      required: ['file_token', 'folder_token', 'type'],
    },
  },
  {
    name: 'delete_file',
    description: '[Official API] Delete a file/folder from Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        file_token: { type: 'string', description: 'File token to delete' },
        type: { type: 'string', description: 'Type: file, folder, doc, sheet, bitable, docx, mindnote, slides' },
      },
      required: ['file_token'],
    },
  },
];

const handlers = {
  async list_files(args, ctx) {
    return json(await ctx.getOfficialClient().listFiles(args.folder_token));
  },
  async create_folder(args, ctx) {
    const r = await ctx.getOfficialClient().createFolder(args.name, args.parent_token);
    const ownership = r.viaUser ? ' (as user)' : ' (as app — UAT unavailable or failed; folder owned by the app, not you)';
    const warn = r.fallbackWarning ? `\n\n${r.fallbackWarning}` : '';
    return text(`Folder created${ownership}: ${r.token}${warn}`);
  },
  async upload_drive_file(args, ctx) {
    const official = ctx.getOfficialClient();
    const up = await official.uploadDriveFile(args.file_path, args.folder_token);
    const out = { fileToken: up.fileToken, viaUser: up.viaUser, url: `https://feishu.cn/file/${up.fileToken}` };
    if (args.wiki_space_id) {
      try {
        const node = await official.attachToWiki(args.wiki_space_id, 'file', up.fileToken, args.wiki_parent_node_token);
        out.wikiNodeToken = node.node_token || null;
        out.wikiAttachTaskId = node.task_id || null;
      } catch (e) {
        out.wikiAttachError = e.message;
      }
    }
    return json(out);
  },
  async copy_file(args, ctx) {
    return json(await ctx.getOfficialClient().copyFile(args.file_token, args.name, args.folder_token, args.type));
  },
  async move_file(args, ctx) {
    return text(`File moved: task=${(await ctx.getOfficialClient().moveFile(args.file_token, args.folder_token, args.type)).taskId}`);
  },
  async delete_file(args, ctx) {
    return text(`File deleted: task=${(await ctx.getOfficialClient().deleteFile(args.file_token, args.type)).taskId}`);
  },
};

module.exports = { schemas, handlers };
