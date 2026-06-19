// Targeted regression test: hasMore:true must always include a usable cursor.
// For upstream stalled/missing cursors, report truncation without hasMore:true.

const assert = require('assert');

const bitable = require('./clients/official/bitable');
const calendar = require('./clients/official/calendar');
const docs = require('./clients/official/docs');
const drive = require('./clients/official/drive');
const groups = require('./clients/official/groups');
const im = require('./clients/official/im');
const okr = require('./clients/official/okr');
const tasks = require('./clients/official/tasks');
const wiki = require('./clients/official/wiki');

function makeClient(responses) {
  let index = 0;
  return {
    client: {},
    _asUserOrApp: async () => {
      const r = responses[index++] || responses[responses.length - 1] || {};
      return {
        code: 0,
        data: r.data || {},
        _viaUser: r.viaUser ?? true,
        _fallbackWarning: r.warning || null,
      };
    },
  };
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

function expectCursorUnavailable(out, label) {
  assert.strictEqual(out.hasMore, false, `${label} must not return hasMore:true without a cursor`);
  assert.strictEqual(out.truncated, true, `${label} must still disclose truncation`);
  assert.strictEqual(out.cursorUnavailable, true, `${label} must explain that paging cannot continue`);
}

(async () => {
  const failures = [];

  await check('getDocBlocks missing next cursor does not strand callers', async () => {
    const out = await docs.getDocBlocks.call(makeClient([
      { data: { items: [{ block_id: 'b1' }], has_more: true } },
    ]), 'doc');
    expectCursorUnavailable(out, 'getDocBlocks');
    assert.strictEqual(out.nextPageToken, undefined);
  }, failures);

  await check('getDocBlocks repeated next cursor does not strand callers', async () => {
    const out = await docs.getDocBlocks.call(makeClient([
      { data: { items: [{ block_id: 'b1' }], has_more: true, page_token: 'same' } },
    ]), 'doc', { pageToken: 'same' });
    expectCursorUnavailable(out, 'getDocBlocks repeat');
  }, failures);

  await check('getDocBlocks capped response keeps hasMore only with nextPageToken', async () => {
    const out = await docs.getDocBlocks.call(makeClient([
      { data: { items: [{ block_id: 'b1' }, { block_id: 'b2' }], has_more: true, page_token: 'next' } },
    ]), 'doc', { maxBlocks: 1 });
    assert.strictEqual(out.hasMore, true);
    assert.strictEqual(out.truncated, true);
    assert.strictEqual(out.nextPageToken, 'next');
  }, failures);

  await check('listWikiSpaces stalled cursor reports partial result without hasMore:true', async () => {
    const out = await wiki.listWikiSpaces.call(makeClient([
      { data: { items: [{ space_id: 'spc' }], has_more: true } },
    ]));
    expectCursorUnavailable(out, 'listWikiSpaces');
  }, failures);

  await check('listWikiNodes missing cursor reports partial result without hasMore:true', async () => {
    const out = await wiki.listWikiNodes.call(makeClient([
      { data: { items: [{ node_token: 'node' }], has_more: true } },
    ]), 'space');
    expectCursorUnavailable(out, 'listWikiNodes');
  }, failures);

  await check('searchDocs empty has_more page still returns nextOffset cursor', async () => {
    const out = await docs.searchDocs.call(makeClient([
      { data: { docs_entities: [], has_more: true } },
    ]), 'needle', { pageSize: 10, pageToken: '20' });
    assert.strictEqual(out.hasMore, true);
    assert.strictEqual(out.nextOffset, 30);
  }, failures);

  await check('searchWiki empty has_more page still returns nextOffset cursor', async () => {
    const out = await wiki.searchWiki.call(makeClient([
      { data: { docs_entities: [], has_more: true } },
    ]), 'needle', { pageSize: 10, offset: 20 });
    assert.strictEqual(out.hasMore, true);
    assert.strictEqual(out.nextOffset, 30);
  }, failures);

  await check('searchBitableRecords missing page token reports partial result without hasMore:true', async () => {
    const out = await bitable.searchBitableRecords.call(makeClient([
      { data: { items: [{ record_id: 'rec' }], total: 2, has_more: true } },
    ]), 'app', 'tbl');
    expectCursorUnavailable(out, 'searchBitableRecords');
  }, failures);

  await check('other paginated official clients do not emit hasMore without cursors', async () => {
    expectCursorUnavailable(await calendar.listCalendars.call(makeClient([
      { data: { calendar_list: [{ calendar_id: 'cal' }], has_more: true } },
    ])), 'listCalendars');

    expectCursorUnavailable(await calendar.listCalendarEvents.call(makeClient([
      { data: { items: [{ event_id: 'evt' }], has_more: true } },
    ]), 'cal'), 'listCalendarEvents');

    expectCursorUnavailable(await drive.listFiles.call(makeClient([
      { data: { files: [{ token: 'file' }], has_more: true } },
    ]), ''), 'listFiles');

    expectCursorUnavailable(await okr.listOkrPeriods.call(makeClient([
      { data: { items: [{ period_id: 'p' }], has_more: true } },
    ])), 'listOkrPeriods');

    expectCursorUnavailable(await tasks.listTasks.call(makeClient([
      { data: { items: [{ guid: 'task' }], has_more: true } },
    ])), 'listTasks');

    const sdkSelf = {
      _safeSDKCall: async () => ({ data: { items: [{ id: 'x' }], has_more: true } }),
      _formatMessage: (m) => m,
      _populateSenderNames: async () => {},
      _expandMergeForwardItems: async () => {},
    };
    expectCursorUnavailable(await groups.listChatMembers.call(sdkSelf, 'chat'), 'listChatMembers');
    expectCursorUnavailable(await im.listChats.call(sdkSelf), 'listChats');
    expectCursorUnavailable(await im.readMessages.call(sdkSelf, 'chat'), 'readMessages');

    const uatSelf = {
      hasUAT: true,
      _withUAT: async () => ({ code: 0, data: { items: [{ id: 'x' }], has_more: true } }),
      _uatREST: async () => ({ code: 0, data: { items: [{ message_id: 'msg' }], has_more: true } }),
      _formatMessage: (m) => m,
      _populateSenderNames: async () => {},
      _expandMergeForwardItems: async () => {},
    };
    expectCursorUnavailable(await im.listChatsAsUser.call(uatSelf), 'listChatsAsUser');
    expectCursorUnavailable(await im.readMessagesAsUser.call(uatSelf, 'chat'), 'readMessagesAsUser');
    expectCursorUnavailable(await im.searchMessages.call(uatSelf, { query: 'needle' }), 'searchMessages');
  }, failures);

  if (failures.length) {
    console.error(`\n${failures.length} pagination regression(s):`);
    for (const f of failures) console.error(`\n${f}`);
    process.exit(1);
  }
})();
