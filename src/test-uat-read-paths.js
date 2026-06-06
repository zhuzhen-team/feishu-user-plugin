// src/test-uat-read-paths.js — verify discovery-read paths are UAT-first.
//
// Background (2026-06-06 user report): upload_drive_file goes UAT (file owned
// by the user), but list_files went app-token-only → bot gets 403 on personal
// space folders ("我的空间"), so uploaded files were undiscoverable and thus
// undeletable (manage_drive_file needs a file_token the user can't obtain).
// search_docs had the same blind spot (personal-space files not indexed for
// the bot identity). searchWiki / getWikiNode shared the app-only pattern.
//
// Fix: route listFiles / searchDocs / searchWiki / getWikiNode through
// _asUserOrApp (UAT-first, bot fallback + fallbackWarning), matching
// listWikiSpaces / listWikiNodes which were already UAT-first.
//
// Tests stub `this._asUserOrApp` at the mixin level (methods are mixed into
// LarkOfficialClient.prototype; binding them to a fake `this` is the
// supported seam — same approach as test-via-user.js's fakeCtx).

'use strict';

const assert = require('node:assert/strict');

const driveMixin = require('./clients/official/drive');
const docsMixin = require('./clients/official/docs');
const wikiMixin = require('./clients/official/wiki');

// fake `this` for mixin methods. Records _asUserOrApp / _safeSDKCall calls.
// uatResult is what _asUserOrApp resolves to (shape: legacy asUserOrApp
// contract — data object with _viaUser + optional _fallbackWarning).
function fakeClient({ uatResult, sdkResult }) {
  const calls = { asUserOrApp: [], safeSDKCall: [] };
  return {
    calls,
    async _asUserOrApp(opts) {
      calls.asUserOrApp.push(opts);
      return uatResult;
    },
    async _safeSDKCall(fn, label) {
      calls.safeSDKCall.push(label);
      // Default shape covers all four legacy call sites so pre-fix code fails
      // on the routing assertions (clean RED) instead of a TypeError here.
      return sdkResult || { code: 0, data: { files: [], has_more: false, docs_entities: [], node: {} } };
    },
    // SDK surface — only reached via the sdkFn closures, which these tests
    // never execute (the _asUserOrApp stub doesn't call sdkFn).
    client: {
      drive: { file: { list: async () => { throw new Error('sdkFn should not run in these tests'); } } },
      wiki: { space: { getNode: async () => { throw new Error('sdkFn should not run in these tests'); } } },
      request: async () => { throw new Error('sdkFn should not run in these tests'); },
    },
  };
}

async function run() {
  // --- 1. listFiles is UAT-first via _asUserOrApp ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { files: [{ token: 'boxcnX', name: 'a.pdf' }], has_more: false }, _viaUser: true },
    });
    const res = await driveMixin.listFiles.call(c, 'fldcnROOT');
    assert.equal(c.calls.asUserOrApp.length, 1, 'listFiles must route through _asUserOrApp (UAT-first)');
    assert.equal(c.calls.safeSDKCall.length, 0, 'listFiles must not call _safeSDKCall directly (app-only blind spot)');
    const opts = c.calls.asUserOrApp[0];
    assert.equal(opts.uatPath, '/open-apis/drive/v1/files', 'listFiles UAT path');
    assert.equal(opts.query.folder_token, 'fldcnROOT');
    assert.ok(opts.sdkFn, 'bot fallback must be preserved');
    assert.equal(res.viaUser, true, 'viaUser surfaced');
    assert.equal(res.items.length, 1);
  }

  // --- 2. listFiles surfaces fallbackWarning + scopeHint on bot path ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { files: [], has_more: false }, _viaUser: false, _fallbackWarning: '⚠️ test-warning' },
    });
    const res = await driveMixin.listFiles.call(c, '');
    assert.equal(res.viaUser, false);
    assert.equal(res.fallbackWarning, '⚠️ test-warning', 'fallbackWarning must surface so ownership blind spot is visible');
    assert.ok(res.scopeHint && /403|个人|personal|my space|我的空间|scope/i.test(res.scopeHint),
      'empty bot-path result must carry a scopeHint explaining the personal-space blind spot');
  }

  // --- 3. listFiles passes pagination through ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { files: [], has_more: true, next_page_token: 'NPT' }, _viaUser: true },
    });
    const res = await driveMixin.listFiles.call(c, 'fld', { pageSize: 10, pageToken: 'PT' });
    const opts = c.calls.asUserOrApp[0];
    assert.equal(String(opts.query.page_size), '10');
    assert.equal(opts.query.page_token, 'PT');
    assert.equal(res.nextPageToken, 'NPT', 'next_page_token must surface for pagination');
  }

  // --- 4. searchDocs is UAT-first ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [{ docs_token: 'boxcnY' }], has_more: false }, _viaUser: true },
    });
    const res = await docsMixin.searchDocs.call(c, 'PDF 报告');
    assert.equal(c.calls.asUserOrApp.length, 1, 'searchDocs must route through _asUserOrApp');
    const opts = c.calls.asUserOrApp[0];
    assert.equal(opts.uatPath, '/open-apis/suite/docs-api/search/object');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.body.search_key, 'PDF 报告');
    assert.deepEqual(opts.body.docs_types, [], 'searchDocs searches all types');
    assert.equal(res.viaUser, true);
    assert.equal(res.items.length, 1);
  }

  // --- 5. searchWiki is UAT-first, scoped to wiki ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [] }, _viaUser: false, _fallbackWarning: '⚠️ w' },
    });
    const res = await wikiMixin.searchWiki.call(c, 'roadmap');
    assert.equal(c.calls.asUserOrApp.length, 1, 'searchWiki must route through _asUserOrApp');
    const opts = c.calls.asUserOrApp[0];
    assert.equal(opts.uatPath, '/open-apis/suite/docs-api/search/object');
    assert.deepEqual(opts.body.docs_types, ['wiki'], 'searchWiki restricted to wiki entities');
    assert.equal(res.viaUser, false);
    assert.equal(res.fallbackWarning, '⚠️ w');
  }

  // --- 6. getWikiNode is UAT-first ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { node: { node_token: 'wikcnZ', obj_type: 'docx' } }, _viaUser: true },
    });
    const node = await wikiMixin.getWikiNode.call(c, 'wikcnZ');
    assert.equal(c.calls.asUserOrApp.length, 1, 'getWikiNode must route through _asUserOrApp');
    const opts = c.calls.asUserOrApp[0];
    assert.equal(opts.uatPath, '/open-apis/wiki/v2/spaces/get_node');
    assert.equal(opts.query.token, 'wikcnZ');
    assert.equal(node.node_token, 'wikcnZ');
  }

  // --- 7. get_wiki_node handler still synthesizes for obj_tokens on dual failure ---
  // withIdentityFallback dual-failure error message embeds the Feishu code
  // (e.g. "as user: code=953001 ..."). The handler's /95300\d/ detection must
  // keep matching so search_wiki obj_tokens (docxXXX) still resolve.
  {
    const { handlers } = require('./tools/wiki');
    const err = new Error('getNode failed on both identities. as user: code=953001 msg=node not found. as app: getNode failed (953001): invalid token');
    const ctx = {
      getOfficialClient: () => ({
        getWikiNode: async () => { throw err; },
      }),
    };
    const resp = await handlers.get_wiki_node({ node_token: 'docxabcdef' }, ctx);
    const body = JSON.parse(resp.content[0].text);
    assert.equal(body.obj_type, 'docx', 'obj_token synthesis must survive the dual-identity error shape');
    assert.equal(body.obj_token, 'docxabcdef');
  }

  // --- 8. list_files tool schema exposes pagination + UAT-first semantics ---
  {
    const { schemas } = require('./tools/drive');
    const lf = schemas.find(s => s.name === 'list_files');
    assert.ok(lf.inputSchema.properties.page_size, 'list_files schema: page_size');
    assert.ok(lf.inputSchema.properties.page_token, 'list_files schema: page_token');
    assert.ok(/UAT/i.test(lf.description), 'list_files description must state UAT-first routing');
  }

  // --- 9. list_files handler passes pagination args through ---
  {
    const { handlers } = require('./tools/drive');
    let got;
    const ctx = {
      getOfficialClient: () => ({
        listFiles: async (folderToken, opts) => { got = { folderToken, opts }; return { items: [], viaUser: true }; },
      }),
    };
    await handlers.list_files({ folder_token: 'fldX', page_size: 25, page_token: 'PT2' }, ctx);
    assert.equal(got.folderToken, 'fldX');
    assert.equal(got.opts.pageSize, 25);
    assert.equal(got.opts.pageToken, 'PT2');
  }

  console.log('uat-read-paths.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
