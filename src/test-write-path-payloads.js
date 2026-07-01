#!/usr/bin/env node
// Fixture tests for the write-path payload contracts of the calendar / tasks /
// okr / drive / uploads domains. Before this, those create/update methods were
// exercised only by cross-cutting invariant tests (cursor + fallbackWarning) and
// by credential-gated live runs that never execute in CI — so the actual request
// body sent to Feishu (e.g. update_task's update_fields patch semantics, which
// silently drops any field not listed) had no regression net.
//
// Strategy mirrors test-doc-table.js: the client methods are mixins invoked with
// a stubbed `this` that (a) stubs `_asUserOrApp` / `_safeSDKCall` to record the
// high-level body/query and still invoke sdkFn, and (b) stubs `this.client.*` to
// capture the exact { path, data, params } handed to the Lark SDK. Pure unit —
// the only IO is a tiny temp file for the upload streams.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const calendar = require('./clients/official/calendar');
const tasks = require('./clients/official/tasks');
const okr = require('./clients/official/okr');
const drive = require('./clients/official/drive');
const uploads = require('./clients/official/uploads');

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); console.log('  OK  ', name); pass++; }
  catch (e) { console.log('  FAIL', name, '—', e.message); fail++; }
}
async function throws(fn, re, msg) {
  let threw = false, m = '';
  try { await fn(); } catch (e) { threw = true; m = e.message; }
  assert.ok(threw, msg || 'expected throw');
  if (re) assert.ok(re.test(m), `error should match ${re}: ${m}`);
}

// Neutralise an unread fs.ReadStream so its racing async open (against a temp
// file we delete right after) can never surface as an unhandled 'error'.
function _killStream(s) {
  if (s && typeof s.on === 'function') {
    try { s.on('error', () => {}); s.destroy(); } catch (_) {}
  }
}

// Stubbed `this` shared by every domain. Records both the _asUserOrApp/_safeSDKCall
// options and the raw SDK-level arguments.
function stub() {
  const calls = { hl: [], sdk: [] };
  const rec = (m, ret) => (arg) => { calls.sdk.push({ m, arg }); return ret; };
  const client = {
    calendar: { calendarEvent: {
      create: rec('calendar.create', { data: { event: { event_id: 'ev1' } } }),
      patch:  rec('calendar.patch',  { data: { event: { event_id: 'ev1' } } }),
    } },
    task: { v2: { task: {
      create: rec('task.create', { data: { task: { guid: 'g1' } } }),
      patch:  rec('task.patch',  { data: { task: { guid: 'g1' } } }),
    } } },
    okr: { progressRecord: {
      create: rec('okr.create', { data: { progress_id: 'p1', modify_time: '1', content: {}, progress_rate: {} } }),
    } },
    drive: { file: {
      createFolder: rec('drive.createFolder', { data: { token: 'fld1' } }),
    } },
    // Upload stubs neutralise the incoming stream: attach a no-op 'error'
    // listener (so the unread fs.createReadStream's async open/ENOENT after we
    // delete the temp files is handled, not thrown as an uncaughtException) and
    // destroy it. The stream is never read in these tests.
    im: {
      image: { create: (arg) => { _killStream(arg?.data?.image); calls.sdk.push({ m: 'im.image.create', arg }); return { data: { image_key: 'img1' } }; } },
      file:  { create: (arg) => { _killStream(arg?.data?.file); calls.sdk.push({ m: 'im.file.create', arg }); return { data: { file_key: 'file1' } }; } },
    },
  };
  const self = {
    client,
    async _asUserOrApp(opts) {
      const sdkRes = await opts.sdkFn();
      calls.hl.push({ label: opts.label, method: opts.method, body: opts.body, query: opts.query, uatPath: opts.uatPath });
      return { ...sdkRes, _viaUser: true, _fallbackWarning: null };
    },
    async _safeSDKCall(fn, label) {
      const res = await fn();
      calls.hl.push({ label });
      return res;
    },
  };
  return { self, calls };
}

async function run() {
  console.log('=== test-write-path-payloads ===');

  // --- Calendar ---
  await ok('createCalendarEvent: passes eventData as body + calendar_id path param', async () => {
    const { self, calls } = stub();
    const eventData = { summary: 'Sync', start_time: { timestamp: '100' }, end_time: { timestamp: '200' } };
    const r = await calendar.createCalendarEvent.call(self, 'cal1', eventData);
    const sdk = calls.sdk.find(c => c.m === 'calendar.create');
    assert.ok(sdk, 'must call calendar.calendarEvent.create');
    assert.strictEqual(sdk.arg.path.calendar_id, 'cal1', 'calendar_id must be a path param');
    assert.deepStrictEqual(sdk.arg.data, eventData, 'eventData must be the request data verbatim');
    assert.deepStrictEqual(calls.hl[0].body, eventData);
    assert.strictEqual(r.event.event_id, 'ev1');
    assert.strictEqual(r.viaUser, true);
  });

  await ok('createCalendarEvent: requires calendarId + start_time + end_time', async () => {
    const { self } = stub();
    await throws(() => calendar.createCalendarEvent.call(self, '', { start_time: {}, end_time: {} }), /calendarId is required/);
    await throws(() => calendar.createCalendarEvent.call(self, 'cal1', { summary: 'x' }), /start_time and end_time are required/);
  });

  await ok('updateCalendarEvent: PATCHes updates with calendar_id + event_id path params', async () => {
    const { self, calls } = stub();
    const r = await calendar.updateCalendarEvent.call(self, 'cal1', 'ev9', { summary: 'Renamed' });
    const sdk = calls.sdk.find(c => c.m === 'calendar.patch');
    assert.strictEqual(sdk.arg.path.calendar_id, 'cal1');
    assert.strictEqual(sdk.arg.path.event_id, 'ev9');
    assert.deepStrictEqual(sdk.arg.data, { summary: 'Renamed' });
    assert.strictEqual(r.viaUser, true);
  });

  await ok('updateCalendarEvent: rejects an empty updates object', async () => {
    const { self } = stub();
    await throws(() => calendar.updateCalendarEvent.call(self, 'cal1', 'ev9', {}), /updates object is required/);
  });

  // --- Tasks (update_fields patch semantics — the highest-value contract) ---
  await ok('updateTask: body carries {task, update_fields} and task_guid path param', async () => {
    const { self, calls } = stub();
    const r = await tasks.updateTask.call(self, 'guid1', { summary: 'New title' }, ['summary']);
    assert.deepStrictEqual(calls.hl[0].body, { task: { summary: 'New title' }, update_fields: ['summary'] });
    const sdk = calls.sdk.find(c => c.m === 'task.patch');
    assert.strictEqual(sdk.arg.path.task_guid, 'guid1');
    assert.deepStrictEqual(sdk.arg.data.update_fields, ['summary'], 'update_fields must reach the SDK verbatim');
    assert.deepStrictEqual(sdk.arg.data.task, { summary: 'New title' });
    assert.strictEqual(r.viaUser, true);
  });

  await ok('updateTask: throws when update_fields is missing/empty (Feishu patches only listed fields)', async () => {
    const { self } = stub();
    await throws(() => tasks.updateTask.call(self, 'guid1', { summary: 'x' }), /update_fields array is required/);
    await throws(() => tasks.updateTask.call(self, 'guid1', { summary: 'x' }, []), /update_fields array is required/);
    await throws(() => tasks.updateTask.call(self, '', { summary: 'x' }, ['summary']), /task_guid is required/);
  });

  await ok('updateTask: defaults an omitted task object to {} (never sends undefined)', async () => {
    const { self, calls } = stub();
    await tasks.updateTask.call(self, 'guid1', undefined, ['completed_at']);
    assert.deepStrictEqual(calls.hl[0].body.task, {}, 'task must default to {} so the SDK never receives undefined');
    assert.deepStrictEqual(calls.hl[0].body.update_fields, ['completed_at']);
  });

  await ok('completeTask: delegates to updateTask; completed=true → numeric completed_at, false → "0"', async () => {
    const { self, calls } = stub();
    self.updateTask = tasks.updateTask; // completeTask calls this.updateTask (a sibling mixin on the real client)
    await tasks.completeTask.call(self, 'guid1'); // default completed=true
    const done = calls.sdk.find(c => c.m === 'task.patch');
    assert.deepStrictEqual(done.arg.data.update_fields, ['completed_at'], 'must patch only completed_at');
    assert.ok(/^\d+$/.test(done.arg.data.task.completed_at), `completed=true sets a unix-millis string: ${done.arg.data.task.completed_at}`);

    const { self: s2, calls: c2 } = stub();
    s2.updateTask = tasks.updateTask;
    await tasks.completeTask.call(s2, 'guid1', false); // un-complete
    const undone = c2.sdk.find(c => c.m === 'task.patch');
    assert.strictEqual(undone.arg.data.task.completed_at, '0', 'completed=false must set completed_at="0"');
  });

  await ok('createTask: body === taskData; requires summary', async () => {
    const { self, calls } = stub();
    await tasks.createTask.call(self, { summary: 'Do it', due: { timestamp: '5' } });
    const sdk = calls.sdk.find(c => c.m === 'task.create');
    assert.strictEqual(sdk.arg.data.summary, 'Do it');
    assert.deepStrictEqual(calls.hl[0].body, { summary: 'Do it', due: { timestamp: '5' } });
    await throws(() => tasks.createTask.call(self, { due: {} }), /summary is required/);
  });

  // --- OKR ---
  await ok('createOkrProgressRecord: builds data with defaults + user_id_type param', async () => {
    const { self, calls } = stub();
    const content = { blocks: [{ type: 'paragraph' }] };
    const r = await okr.createOkrProgressRecord.call(self, { targetId: 'kr1', targetType: 2, content });
    const sdk = calls.sdk.find(c => c.m === 'okr.create');
    assert.strictEqual(sdk.arg.data.target_id, 'kr1');
    assert.strictEqual(sdk.arg.data.target_type, 2);
    assert.deepStrictEqual(sdk.arg.data.content, content);
    assert.ok(sdk.arg.data.source_title, 'default source_title must be set');
    assert.ok(sdk.arg.data.source_url, 'default source_url must be set');
    assert.strictEqual(sdk.arg.params.user_id_type, 'open_id');
    assert.deepStrictEqual(calls.hl[0].query, { user_id_type: 'open_id' });
    assert.strictEqual(r.progressId, 'p1');
  });

  await ok('createOkrProgressRecord: includes progress_rate only when provided; validates inputs', async () => {
    const { self, calls } = stub();
    await okr.createOkrProgressRecord.call(self, { targetId: 'kr1', targetType: 2, content: { b: 1 }, progressRate: { percent: 50 } });
    const sdk = calls.sdk.find(c => c.m === 'okr.create');
    assert.deepStrictEqual(sdk.arg.data.progress_rate, { percent: 50 });
    await throws(() => okr.createOkrProgressRecord.call(self, { targetType: 2, content: { b: 1 } }), /target_id is required/);
    await throws(() => okr.createOkrProgressRecord.call(self, { targetId: 'kr1', content: { b: 1 } }), /target_type is required/);
    await throws(() => okr.createOkrProgressRecord.call(self, { targetId: 'kr1', targetType: 2 }), /content .* is required/);
  });

  // --- Drive ---
  await ok('createFolder: body {name, folder_token}; empty parent → empty token', async () => {
    const { self, calls } = stub();
    const r = await drive.createFolder.call(self, 'My Folder', 'parent1');
    const sdk = calls.sdk.find(c => c.m === 'drive.createFolder');
    assert.deepStrictEqual(sdk.arg.data, { name: 'My Folder', folder_token: 'parent1' });
    assert.strictEqual(r.token, 'fld1');
    assert.strictEqual(r.viaUser, true);

    const { self: s2, calls: c2 } = stub();
    await drive.createFolder.call(s2, 'Root child');
    const sdk2 = c2.sdk.find(c => c.m === 'drive.createFolder');
    assert.strictEqual(sdk2.arg.data.folder_token, '', 'omitted parent must send an empty folder_token');
  });

  // --- Uploads (via _safeSDKCall) ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-upl-'));
  const tmpImg = path.join(tmpDir, 'pic.png');
  const tmpFile = path.join(tmpDir, 'doc.bin');
  fs.writeFileSync(tmpImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(tmpFile, Buffer.from('hello'));
  try {
    await ok('uploadImage: sends image_type and returns imageKey', async () => {
      const { self, calls } = stub();
      const r = await uploads.uploadImage.call(self, tmpImg, 'message');
      const sdk = calls.sdk.find(c => c.m === 'im.image.create');
      assert.strictEqual(sdk.arg.data.image_type, 'message');
      assert.ok(sdk.arg.data.image, 'must attach an image stream');
      assert.strictEqual(r.imageKey, 'img1');
    });

    await ok('uploadFile: sends file_type + file_name; derives basename when name omitted', async () => {
      const { self, calls } = stub();
      const r = await uploads.uploadFile.call(self, tmpFile, 'stream', 'custom.bin');
      const sdk = calls.sdk.find(c => c.m === 'im.file.create');
      assert.strictEqual(sdk.arg.data.file_type, 'stream');
      assert.strictEqual(sdk.arg.data.file_name, 'custom.bin');
      assert.strictEqual(r.fileKey, 'file1');

      const { self: s2, calls: c2 } = stub();
      await uploads.uploadFile.call(s2, tmpFile, 'stream');
      const sdk2 = c2.sdk.find(c => c.m === 'im.file.create');
      assert.strictEqual(sdk2.arg.data.file_name, 'doc.bin', 'file_name must default to the basename');
    });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n=== test-write-path-payloads: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-write-path-payloads harness error:', e); process.exit(1); });
}

module.exports = { run };
