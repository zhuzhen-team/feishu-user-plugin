// src/test-profile-router-hint.js
//
// Regression test for the auto-switch hint/banner findings (v1.3.17):
//   - [autoSwitched] must annotate ONLY a real failover (an earlier profile
//     failed), not the case where a stored hint was simply honoured on the
//     first attempt (which is the intended primary path).
//   - A stale hint that was tried-first-and-failed must be CLEARED when the
//     active profile wins, so the next call stops re-trying the bad profile.
//
// Deterministic unit test: mock ctx + monkeypatch the credentials hint API.

const assert = require('assert');
const router = require('./auth/profile-router');
const credentials = require('./auth/credentials');

const ARGS = { document_id: 'DOC1' };
const RK = router.extractResourceKey(ARGS);

async function run() {
  let pass = 0;
  let fail = 0;
  const check = async (n, fn) => {
    try { await fn(); pass++; console.log('  PASS', n); }
    catch (e) { fail++; console.error('  FAIL', n, '—', e.message); }
  };

  assert.ok(RK, `test setup: expected document_id to yield a resource key, got ${RK}`);

  const orig = {
    getProfileHints: credentials.getProfileHints,
    setProfileHint: credentials.setProfileHint,
    clearProfileHint: credentials.clearProfileHint,
  };
  let hintCalls;
  const installCreds = (hints) => {
    hintCalls = { set: [], clear: [] };
    credentials.getProfileHints = () => hints || {};
    credentials.setProfileHint = (rk, p) => hintCalls.set.push([rk, p]);
    credentials.clearProfileHint = (rk) => hintCalls.clear.push(rk);
  };
  const mkCtx = () => {
    let active = 'default';
    return { listProfiles: () => ['default', 'work'], getActiveProfile: () => active, setActiveProfile: (p) => { active = p; } };
  };
  const switchErr = 'getChatInfo failed (code=91403): cross tenant';   // 91403 is a documented switch code
  const ok = (tag) => ({ content: [{ type: 'text', text: `OK ${tag}` }] });

  try {
    await check('A: real failover → [autoSwitched] banner + setProfileHint(work)', async () => {
      installCreds({});
      const ctx = mkCtx();
      const handler = async () => (ctx.getActiveProfile() === 'default'
        ? { content: [{ type: 'text', text: switchErr }], isError: true } : ok('work'));
      const res = await router.withProfileRouting(ctx, 'read_doc_markdown', ARGS, handler);
      assert.match(res.content[0].text, /autoSwitched: default → work/, res.content[0].text);
      assert.deepEqual(hintCalls.set, [[RK, 'work']]);
      assert.equal(hintCalls.clear.length, 0);
    });

    await check('B: clean active success → NO banner, NO hint write', async () => {
      installCreds({});
      const ctx = mkCtx();
      const res = await router.withProfileRouting(ctx, 'read_doc_markdown', ARGS, async () => ok('default'));
      assert.doesNotMatch(res.content[0].text, /autoSwitched/);
      assert.equal(hintCalls.set.length, 0);
      assert.equal(hintCalls.clear.length, 0);
    });

    await check('C: stale hint tried-first fails, active wins → clearProfileHint', async () => {
      installCreds({ [RK]: 'work' });
      const ctx = mkCtx();
      const handler = async () => (ctx.getActiveProfile() === 'work'
        ? { content: [{ type: 'text', text: switchErr }], isError: true } : ok('default'));
      const res = await router.withProfileRouting(ctx, 'read_doc_markdown', ARGS, handler);
      assert.deepEqual(hintCalls.clear, [RK], 'should clear the stale hint');
      assert.equal(hintCalls.set.length, 0);
      assert.match(res.content[0].text, /autoSwitched: work → default/);
    });

    await check('D: hinted-first SUCCESS → NO banner (not a failover), NO redundant hint write', async () => {
      installCreds({ [RK]: 'work' });
      const ctx = mkCtx();
      const res = await router.withProfileRouting(ctx, 'read_doc_markdown', ARGS, async () => ok(ctx.getActiveProfile()));
      assert.doesNotMatch(res.content[0].text, /autoSwitched/, 'honouring a hint first try is not an autoSwitch');
      assert.equal(hintCalls.set.length, 0);
      assert.equal(hintCalls.clear.length, 0);
    });

    await check('E: routing uses EPHEMERAL switch (never durable persist) + restores in finally on throw', async () => {
      installCreds({});
      const eph = [];
      const dur = [];
      let active = 'default';
      const ctx = {
        listProfiles: () => ['default', 'work'],
        getActiveProfile: () => active,
        setActiveProfileEphemeral: (p) => { eph.push(p); active = p; },
        setActiveProfile: (p) => { dur.push(p); active = p; },
      };
      // 'default' returns a switch-code error → router moves to 'work'; 'work'
      // throws a non-switch error → router rethrows. The finally MUST restore.
      await assert.rejects(() => router.withProfileRouting(ctx, 'read_doc_markdown', ARGS, async () => {
        if (active === 'default') return { content: [{ type: 'text', text: switchErr }], isError: true };
        throw new Error('boom on work (non-switch)');
      }));
      assert.deepEqual(eph, ['work', 'default'], 'switched to work then restored to default — all ephemeral');
      assert.equal(dur.length, 0, 'auto-switch must NEVER call the durable setActiveProfile (no SSOT churn)');
      assert.equal(active, 'default', 'finally restored the original active profile');
    });
  } finally {
    Object.assign(credentials, orig);
  }

  console.log(`\nprofile-router-hint: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`profile-router-hint: ${fail} check(s) failed`);
  console.log('profile-router-hint.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
