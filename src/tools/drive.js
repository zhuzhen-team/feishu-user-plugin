// src/tools/drive.js — Drive file operations + drive-targeted upload.
//
// 4 tools (was 6 in v1.3.6): list_files, create_folder, upload_drive_file,
// and the consolidated manage_drive_file (action=copy|move|delete) which
// replaces v1.3.6 copy_file / move_file / delete_file.

const { text, json } = require('./_registry');

const schemas = [
  {
    name: 'list_files',
    description: '[Official API] List files in a Drive folder. UAT-first with app fallback: with user identity (UAT), empty folder_token lists YOUR personal-space ("我的空间") root; via bot it can only see folders shared with the bot (personal-space folders return 403). Response carries viaUser so you know whose view you got. Use the returned file token with manage_drive_file to copy/move/delete.',
    inputSchema: {
      type: 'object',
      properties: {
        folder_token: { type: 'string', description: 'Folder token (empty for root — your 我的空间 root when UAT is configured)' },
        page_size: { type: 'number', description: 'Max files per page (default 50)' },
        page_token: { type: 'string', description: 'Pagination token from a previous nextPageToken' },
      },
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
    name: 'manage_drive_file',
    description: '[Official API] Manage a Drive file/doc/folder. action=copy (duplicate to a new name + folder), move (relocate, returns task_id), delete (remove, returns task_id). `type` is always required (Feishu rejects with 1061002 / 1062501 otherwise).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['copy', 'move', 'delete'], description: 'Operation to perform' },
        file_token: { type: 'string', description: 'File/folder token to operate on (required for all actions).' },
        type: { type: 'string', enum: ['file', 'folder', 'doc', 'sheet', 'bitable', 'docx', 'mindnote', 'slides'], description: 'Resource type — Feishu requires this to know which API table to look up.' },
        name: { type: 'string', description: 'New name — required for action=copy.' },
        folder_token: { type: 'string', description: 'Destination folder token — required for action=move; optional for action=copy (defaults to root).' },
      },
      required: ['action', 'file_token', 'type'],
    },
  },
];

function need(arg, name, action) {
  if (arg === undefined || arg === null || arg === '') {
    throw new Error(`manage_drive_file: ${name} required for action=${action}`);
  }
}

const handlers = {
  async list_files(args, ctx) {
    const opts = {};
    if (args.page_size) opts.pageSize = args.page_size;
    if (args.page_token) opts.pageToken = args.page_token;
    return json(await ctx.getOfficialClient().listFiles(args.folder_token, opts));
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
  async manage_drive_file(args, ctx) {
    const c = ctx.getOfficialClient();
    switch (args.action) {
      case 'copy': {
        need(args.name, 'name', 'copy');
        return json(await c.copyFile(args.file_token, args.name, args.folder_token, args.type));
      }
      case 'move': {
        need(args.folder_token, 'folder_token', 'move');
        return text(`File moved: task=${(await c.moveFile(args.file_token, args.folder_token, args.type)).taskId}`);
      }
      case 'delete': {
        const r = await c.deleteFile(args.file_token, args.type);
        return text(r.taskId ? `File deletion queued: task=${r.taskId}` : `File deleted (${args.type})`);
      }
    }
  },
};

module.exports = { schemas, handlers };
