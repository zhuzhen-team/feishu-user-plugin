// Targeted regression test: UAT-first write paths must surface bot fallback.
// No network calls; _asUserOrApp is stubbed to emulate UAT failure -> app path.

const assert = require('assert');

const bitable = require('./clients/official/bitable');
const docs = require('./clients/official/docs');
const tasks = require('./clients/official/tasks');
const okr = require('./clients/official/okr');
const wiki = require('./clients/official/wiki');

const bitableTools = require('./tools/bitable').handlers;
const docsTools = require('./tools/docs').handlers;
const tasksTools = require('./tools/tasks').handlers;
const okrTools = require('./tools/okr').handlers;

const WARNING = 'FALLBACK_WARNING';

function makeClient(responses = {}) {
  return {
    client: {},
    uploadMedia: async () => ({ fileToken: 'uploaded_token', viaUser: true }),
    _asUserOrApp: async (opts) => {
      const r = responses[opts.label] || {};
      return {
        code: r.code ?? 0,
        data: r.data || {},
        _viaUser: r.viaUser ?? false,
        _fallbackWarning: r.warning === undefined ? WARNING : r.warning,
      };
    },
  };
}

function textOf(response) {
  return response.content?.[0]?.text || '';
}

async function check(name, fn, failures) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.stack || e.message}`);
    console.error(`not ok - ${name}: ${e.message}`);
  }
}

function expectWarning(out, label) {
  assert.strictEqual(out.fallbackWarning, WARNING, `${label} must include fallbackWarning`);
  assert.strictEqual(out.viaUser, false, `${label} must expose viaUser=false`);
}

(async () => {
  const failures = [];

  await check('bitable write clients propagate fallbackWarning', async () => {
    const client = makeClient({
      updateField: { data: { field: { field_id: 'fld' } } },
      deleteField: { data: { field_id: 'fld', deleted: true } },
      updateRecord: { data: { record: { record_id: 'rec' } } },
      deleteRecord: { data: { deleted: true } },
      batchUpdateRecords: { data: { records: [{ record_id: 'rec' }] } },
      batchDeleteRecords: { data: { records: ['rec'] } },
      updateTable: { data: { name: 'New table' } },
      deleteTable: { data: {} },
      deleteView: { data: {} },
    });

    expectWarning(await bitable.updateBitableField.call(client, 'app', 'tbl', 'fld', { type: 1 }), 'updateBitableField');
    expectWarning(await bitable.deleteBitableField.call(client, 'app', 'tbl', 'fld'), 'deleteBitableField');
    expectWarning(await bitable.updateBitableRecord.call(client, 'app', 'tbl', 'rec', { Name: 'A' }), 'updateBitableRecord');
    expectWarning(await bitable.deleteBitableRecord.call(client, 'app', 'tbl', 'rec'), 'deleteBitableRecord');
    expectWarning(await bitable.batchUpdateBitableRecords.call(client, 'app', 'tbl', [{ record_id: 'rec', fields: {} }]), 'batchUpdateBitableRecords');
    expectWarning(await bitable.batchDeleteBitableRecords.call(client, 'app', 'tbl', ['rec']), 'batchDeleteBitableRecords');
    expectWarning(await bitable.updateBitableTable.call(client, 'app', 'tbl', 'New table'), 'updateBitableTable');
    expectWarning(await bitable.deleteBitableTable.call(client, 'app', 'tbl'), 'deleteBitableTable');
    expectWarning(await bitable.deleteBitableView.call(client, 'app', 'tbl', 'view'), 'deleteBitableView');
  }, failures);

  await check('doc write clients propagate fallbackWarning from every write step', async () => {
    const client = makeClient({
      updateDocBlock: { data: { block: { block_id: 'blk' } } },
      deleteDocBlocks: { data: {} },
      updateDocBlockImage: { data: {} },
      updateDocBlockFile: { data: {} },
      'createDocBlockWithImage.placeholder': { data: { children: [{ block_id: 'img_blk' }] }, viaUser: true, warning: null },
      'createDocBlockWithImage.replaceImage': { data: {} },
      'createDocBlockWithFile.placeholder': { data: { children: [{ block_id: 'file_blk', block_type: 23 }] }, viaUser: true, warning: null },
      'createDocBlockWithFile.replaceFile': { data: {} },
    });

    expectWarning(await docs.updateDocBlock.call(client, 'doc', 'blk', { update_text_elements: { elements: [] } }), 'updateDocBlock');
    expectWarning(await docs.deleteDocBlocks.call(client, 'doc', 'parent', 0, 1), 'deleteDocBlocks');
    expectWarning(await docs.updateDocBlockImage.call(client, 'doc', 'blk', 'img_token'), 'updateDocBlockImage');
    expectWarning(await docs.updateDocBlockFile.call(client, 'doc', 'blk', 'file_token'), 'updateDocBlockFile');
    expectWarning(await docs.createDocBlockWithImage.call(client, 'doc', 'parent', { imageToken: 'img_token', retryDelaysMs: [] }), 'createDocBlockWithImage');
    expectWarning(await docs.createDocBlockWithFile.call(client, 'doc', 'parent', { fileToken: 'file_token', retryDelaysMs: [] }), 'createDocBlockWithFile');
  }, failures);

  await check('composed doc/bitable/wiki writes merge child-step fallbackWarning', async () => {
    const attachWarning = await wiki.attachToWiki.call(makeClient({
      attachToWiki: { data: { wiki_token: 'wiki_node', applied: true } },
    }), 'space', 'docx', 'doc');
    expectWarning(attachWarning, 'attachToWiki');

    const docCreateClient = makeClient({
      createDoc: { data: { document: { document_id: 'doc' } }, viaUser: true, warning: null },
    });
    docCreateClient.attachToWiki = async () => ({ node_token: 'wiki_node', viaUser: false, fallbackWarning: WARNING });
    const createdDoc = await docs.createDoc.call(docCreateClient, 'Title', null, { wikiSpaceId: 'space' });
    assert.strictEqual(createdDoc.fallbackWarning, WARNING, 'createDoc must merge attachToWiki fallbackWarning');

    const bitableCreateClient = makeClient({
      createBitable: { data: { app: { app_token: 'app', name: 'Base', url: 'url' } }, viaUser: true, warning: null },
    });
    bitableCreateClient.attachToWiki = async () => ({ node_token: 'wiki_node', viaUser: false, fallbackWarning: WARNING });
    const createdBase = await bitable.createBitable.call(bitableCreateClient, 'Base', null, { wikiSpaceId: 'space' });
    assert.strictEqual(createdBase.fallbackWarning, WARNING, 'createBitable must merge attachToWiki fallbackWarning');

    const imageUploadClient = makeClient({
      'createDocBlockWithImage.placeholder': { data: { children: [{ block_id: 'img_blk' }] }, viaUser: true, warning: null },
      'createDocBlockWithImage.replaceImage': { data: {}, viaUser: true, warning: null },
    });
    imageUploadClient.uploadMedia = async () => ({ fileToken: 'uploaded_img', viaUser: false, fallbackWarning: WARNING });
    expectWarning(await docs.createDocBlockWithImage.call(imageUploadClient, 'doc', 'parent', { imagePath: '/tmp/image.png', retryDelaysMs: [] }), 'createDocBlockWithImage upload step');

    const fileUploadClient = makeClient({
      'createDocBlockWithFile.placeholder': { data: { children: [{ block_id: 'file_blk', block_type: 23 }] }, viaUser: true, warning: null },
      'createDocBlockWithFile.replaceFile': { data: {}, viaUser: true, warning: null },
    });
    fileUploadClient.uploadMedia = async () => ({ fileToken: 'uploaded_file', viaUser: false, fallbackWarning: WARNING });
    expectWarning(await docs.createDocBlockWithFile.call(fileUploadClient, 'doc', 'parent', { filePath: '/tmp/file.pdf', retryDelaysMs: [] }), 'createDocBlockWithFile upload step');
  }, failures);

  await check('task and okr write clients propagate fallbackWarning', async () => {
    const client = makeClient({
      deleteTask: { data: {} },
      addTaskMembers: { data: { task: { guid: 'task' } } },
      removeTaskMembers: { data: { task: { guid: 'task' } } },
      deleteOkrProgressRecord: { data: {} },
    });
    expectWarning(await tasks.deleteTask.call(client, 'task'), 'deleteTask');
    expectWarning(await tasks.addTaskMembers.call(client, 'task', [{ id: 'ou_x', role: 'follower' }]), 'addTaskMembers');
    expectWarning(await tasks.removeTaskMembers.call(client, 'task', [{ id: 'ou_x', role: 'follower' }]), 'removeTaskMembers');
    expectWarning(await okr.deleteOkrProgressRecord.call(client, 'progress'), 'deleteOkrProgressRecord');
  }, failures);

  await check('text tool handlers include fallbackWarning in write responses', async () => {
    const ctx = {
      resolveDocId: async (x) => x,
      getOfficialClient: () => ({
        updateBitableTable: async () => ({ name: 'New table', viaUser: false, fallbackWarning: WARNING }),
        deleteBitableTable: async () => ({ deleted: true, viaUser: false, fallbackWarning: WARNING }),
        deleteBitableField: async () => ({ fieldId: 'fld', deleted: true, viaUser: false, fallbackWarning: WARNING }),
        deleteBitableView: async () => ({ deleted: true, viaUser: false, fallbackWarning: WARNING }),
        deleteDocBlocks: async () => ({ deleted: true, viaUser: false, fallbackWarning: WARNING }),
        completeTask: async () => ({ task: { guid: 'task' }, viaUser: false, fallbackWarning: WARNING }),
        deleteTask: async () => ({ deleted: true, viaUser: false, fallbackWarning: WARNING }),
        addTaskMembers: async () => ({ task: { members: [] }, viaUser: false, fallbackWarning: WARNING }),
        removeTaskMembers: async () => ({ task: { members: [] }, viaUser: false, fallbackWarning: WARNING }),
        deleteOkrProgressRecord: async () => ({ deleted: true, viaUser: false, fallbackWarning: WARNING }),
      }),
    };

    const cases = [
      ['bitable table update', () => bitableTools.manage_bitable_table({ action: 'update', app_token: 'app', table_id: 'tbl', name: 'New' }, ctx)],
      ['bitable table delete', () => bitableTools.manage_bitable_table({ action: 'delete', app_token: 'app', table_id: 'tbl' }, ctx)],
      ['bitable field delete', () => bitableTools.manage_bitable_field({ action: 'delete', app_token: 'app', table_id: 'tbl', field_id: 'fld' }, ctx)],
      ['bitable view delete', () => bitableTools.manage_bitable_view({ action: 'delete', app_token: 'app', table_id: 'tbl', view_id: 'view' }, ctx)],
      ['doc blocks delete', () => docsTools.manage_doc_block({ action: 'delete', document_id: 'doc', parent_block_id: 'parent', start_index: 0, end_index: 1 }, ctx)],
      ['complete task', () => tasksTools.complete_task({ task_guid: 'task', completed: true }, ctx)],
      ['delete task', () => tasksTools.delete_task({ task_guid: 'task' }, ctx)],
      ['add task members', () => tasksTools.manage_task_members({ action: 'add', task_guid: 'task', members: [{ id: 'ou_x', role: 'follower' }] }, ctx)],
      ['remove task members', () => tasksTools.manage_task_members({ action: 'remove', task_guid: 'task', members: [{ id: 'ou_x', role: 'follower' }] }, ctx)],
      ['delete okr progress', () => okrTools.delete_okr_progress_record({ progress_id: 'progress' }, ctx)],
    ];

    for (const [label, run] of cases) {
      assert.match(textOf(await run()), new RegExp(WARNING), `${label} must include fallback warning`);
    }
  }, failures);

  if (failures.length) {
    console.error(`\n${failures.length} fallback-warning regression(s):`);
    for (const f of failures) console.error(`\n${f}`);
    process.exit(1);
  }
})();
