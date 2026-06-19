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

  // --- 6. getWikiNode is UAT-first and surfaces viaUser ---
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
    assert.equal(node.viaUser, true, 'getWikiNode must surface viaUser like its 3 sibling reads');
  }

  // --- 6b. getWikiNode bot fallback must NOT swallow the fallbackWarning ---
  // The warning lives on the top-level data object from withIdentityFallback,
  // not on data.node — without explicit copying, a UAT-revoked → bot fallback
  // silently drops it (caught by multi-agent review of the original commit).
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { node: { node_token: 'wikcnZ', obj_type: 'docx' } }, _viaUser: false, _fallbackWarning: '⚠️ g' },
    });
    const node = await wikiMixin.getWikiNode.call(c, 'wikcnZ');
    assert.equal(node.viaUser, false);
    assert.equal(node.fallbackWarning, '⚠️ g', 'fallbackWarning must survive onto the node so json() hoists it');
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

  // --- 7b. synthesis also survives the LIVE error shape (131005, not 95300x) ---
  // Real Feishu instances return code=131005 "not found" for non-wiki tokens
  // (observed in E2E 2026-06-06); only the `node.*not.*found` regex branch
  // catches it. Pin that branch so a regex edit can't silently regress it.
  {
    const { handlers } = require('./tools/wiki');
    const err = new Error('getNode failed on both identities. as user: code=131005 msg=not found. as app: getNode failed (HTTP 400, code=131005): not found');
    const ctx = {
      getOfficialClient: () => ({
        getWikiNode: async () => { throw err; },
      }),
    };
    const resp = await handlers.get_wiki_node({ node_token: 'bascnabcdef' }, ctx);
    const body = JSON.parse(resp.content[0].text);
    assert.equal(body.obj_type, 'bitable', 'live 131005 error shape must still trigger obj_token synthesis');
    assert.equal(body.obj_token, 'bascnabcdef');
  }

  // --- 10. search pagination: nextOffset cursor surfaces; params pass through ---
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [{ t: 1 }, { t: 2 }], has_more: true }, _viaUser: true },
    });
    const res = await docsMixin.searchDocs.call(c, 'q', { pageSize: 2, pageToken: '4' });
    assert.equal(c.calls.asUserOrApp[0].body.offset, 4, 'searchDocs offset passthrough');
    assert.equal(c.calls.asUserOrApp[0].body.count, 2, 'searchDocs page size passthrough');
    assert.equal(res.nextOffset, 6, 'searchDocs nextOffset = offset + items returned');
  }
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [{ t: 1 }], has_more: true }, _viaUser: true },
    });
    const res = await wikiMixin.searchWiki.call(c, 'q', { pageSize: 1, offset: 3 });
    assert.equal(c.calls.asUserOrApp[0].body.offset, 3, 'searchWiki offset passthrough');
    assert.equal(c.calls.asUserOrApp[0].body.count, 1, 'searchWiki page size passthrough');
    assert.equal(res.nextOffset, 4, 'searchWiki nextOffset cursor');
    assert.equal(res.hasMore, true, 'searchWiki must surface hasMore');
  }
  // schema: pagination params exposed on both search tools
  {
    const sd = require('./tools/docs').schemas.find(s => s.name === 'search_docs');
    const sw = require('./tools/wiki').schemas.find(s => s.name === 'search_wiki');
    assert.ok(sd.inputSchema.properties.page_size && sd.inputSchema.properties.offset, 'search_docs schema pagination');
    assert.ok(sw.inputSchema.properties.page_size && sw.inputSchema.properties.offset, 'search_wiki schema pagination');
  }

  // --- 11. unvalidated args are clamped, never reach Feishu as NaN/negative ---
  // Tool args have no schema validation layer; a bad offset/page_size must be
  // normalized to sane non-negative integers (Copilot review, PR #115).
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [{ t: 1 }], has_more: true }, _viaUser: true },
    });
    const res = await docsMixin.searchDocs.call(c, 'q', { pageSize: 'abc', pageToken: '-5' });
    const body = c.calls.asUserOrApp[0].body;
    assert.equal(body.offset, 0, 'searchDocs negative offset clamps to 0');
    assert.equal(body.count, 10, 'searchDocs non-numeric page size falls back to default');
    assert.equal(res.nextOffset, 1, 'nextOffset math stays sane after clamping');
  }
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [], has_more: false }, _viaUser: true },
    });
    await wikiMixin.searchWiki.call(c, 'q', { pageSize: NaN, offset: 'xyz' });
    const body = c.calls.asUserOrApp[0].body;
    assert.equal(body.offset, 0, 'searchWiki non-numeric offset clamps to 0');
    assert.equal(body.count, 20, 'searchWiki NaN page size falls back to default');
  }

  // --- 11b. abnormal has_more:true + empty page emits an ADVANCING cursor ---
  // hasMore:true must always carry a resumable cursor (v1.4.0 invariant). On an
  // abnormal empty page nextOffset advances by page_size (never === offset, so a
  // paging caller can't stall) and a cursorWarning is attached — superseding the
  // old behaviour of withholding the cursor, which left hasMore:true with no way
  // to page forward.
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [], has_more: true }, _viaUser: true },
    });
    const res = await docsMixin.searchDocs.call(c, 'q', { pageToken: '5' });
    assert.equal(res.hasMore, true);
    assert.equal(res.nextOffset, 15, 'searchDocs empty page advances by page_size (5+10), not stalled at offset');
    assert.ok(res.cursorWarning, 'searchDocs flags the abnormal empty page');
  }
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { docs_entities: [], has_more: true }, _viaUser: true },
    });
    const res = await wikiMixin.searchWiki.call(c, 'q', { offset: 5 });
    assert.equal(res.nextOffset, 25, 'searchWiki empty page advances by page_size (5+20), not stalled at offset');
    assert.ok(res.cursorWarning, 'searchWiki flags the abnormal empty page');
  }

  // --- 11c. explicit offset:0 is honored by the handlers (not dropped as falsy) ---
  {
    const docsHandlers = require('./tools/docs').handlers;
    let got;
    const ctx = { getOfficialClient: () => ({ searchDocs: async (q, opts) => { got = opts; return { items: [] }; } }) };
    await docsHandlers.search_docs({ query: 'q', offset: 0 }, ctx);
    assert.equal(got.pageToken, '0', 'search_docs handler must pass explicit offset:0 through');
  }
  {
    const wikiHandlers = require('./tools/wiki').handlers;
    let got;
    const ctx = { getOfficialClient: () => ({ searchWiki: async (q, opts) => { got = opts; return { items: [] }; } }) };
    await wikiHandlers.search_wiki({ query: 'q', offset: 0 }, ctx);
    assert.equal(got.offset, 0, 'search_wiki handler must pass explicit offset:0 through');
  }

  // --- 12. scopeHint fires ONLY for empty root listing via bot ---
  // A bot-visible folder that is genuinely empty must stay a bare [] — the
  // blind-spot hint is about the bot's OWN root vs the user's 我的空间
  // (Copilot review, PR #115). 403-on-personal-folder throws and never gets here.
  {
    const c = fakeClient({
      uatResult: { code: 0, data: { files: [], has_more: false }, _viaUser: false },
    });
    const res = await driveMixin.listFiles.call(c, 'fldcnSharedEmpty');
    assert.equal(res.scopeHint, undefined, 'empty bot-visible folder must NOT carry the root blind-spot hint');
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
