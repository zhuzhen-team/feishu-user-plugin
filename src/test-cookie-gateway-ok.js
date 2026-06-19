// src/test-cookie-gateway-ok.js
//
// Regression test: the cookie-protobuf read methods (search / createChat /
// getGroupInfo) must distinguish a gateway failure (non-2xx, e.g. expired
// cookie / rate limit) from a genuine empty result. They previously discarded
// the `ok` flag and returned []/null on failure, so a transient error was
// permanently misreported as "no results" (v1.3.17 health-check finding 簇 B).
//
// Pure unit test — calls the prototype methods with a stubbed `_gateway`, no net.

const assert = require('assert');
const { LarkUserClient } = require('./clients/user');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log('  PASS', name); }
    catch (e) { fail++; console.error('  FAIL', name, '—', e.message); }
  };

  const failGw = { _gateway: async () => ({ ok: false, packet: {} }), _decode: () => ({}), _nameCache: new Map() };
  const okEmpty = { _gateway: async () => ({ ok: true, packet: {} }), _decode: () => ({ results: [] }), _nameCache: new Map() };

  await check('search THROWS on gateway !ok (not a silent empty array)', async () => {
    await assert.rejects(() => LarkUserClient.prototype.search.call(failGw, 'q'), /non-2xx/);
  });
  await check('search returns [] when gateway ok but no payload', async () => {
    const r = await LarkUserClient.prototype.search.call(okEmpty, 'q');
    assert.deepEqual(r, []);
  });
  await check('createChat THROWS on gateway !ok (not silent null)', async () => {
    await assert.rejects(() => LarkUserClient.prototype.createChat.call(failGw, 'ou_x'), /non-2xx/);
  });
  await check('createChat returns null when gateway ok but no payload', async () => {
    const r = await LarkUserClient.prototype.createChat.call(okEmpty, 'ou_x');
    assert.equal(r, null);
  });
  await check('getGroupInfo THROWS on gateway !ok (not silent null)', async () => {
    await assert.rejects(() => LarkUserClient.prototype.getGroupInfo.call(failGw, 'oc_x'), /non-2xx/);
  });
  await check('getGroupInfo returns null when gateway ok but no payload', async () => {
    const r = await LarkUserClient.prototype.getGroupInfo.call(okEmpty, 'oc_x');
    assert.equal(r, null);
  });

  console.log(`\ncookie-gateway-ok: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`cookie-gateway-ok: ${fail} check(s) failed`);
  console.log('cookie-gateway-ok.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
