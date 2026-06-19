// src/test-config-toml-removal.js
//
// Regression test for _removeTomlServer (Codex config.toml rewrite path).
// The old regex `\[mcp_servers\.<name>[^\]]*\][^\[]*` corrupted the file:
//   - `[^\[]*` stopped at the `[` inside `args = ["…"]`, leaving an orphaned
//     `["…"]` fragment;
//   - when feishu was the last section it ate every following comment/blank
//     line to EOF — deleting unrelated user content.
// The line-based replacement must remove only the feishu tables and keep every
// other table, value, and user comment.
//
// Pure unit test — no IO.

const assert = require('assert');
const { _removeTomlServer } = require('./config');

async function run() {
  let pass = 0;
  let fail = 0;
  const check = (name, fn) => {
    try { fn(); pass++; console.log('  PASS', name); }
    catch (e) { fail++; console.error('  FAIL', name, '—', e.message); }
  };

  const cfg = `# top-of-file comment
[mcp_servers.memoryd]
command = "node"
args = ["/path/memoryd.js"]

[mcp_servers.memoryd.env]
FOO = "bar"

[mcp_servers.feishu-user-plugin]
command = "node"
args = ["/Users/abble/feishu-user-plugin/scripts/mcp_stdio_bridge.js"]

[mcp_servers.feishu-user-plugin.env]
LARK_COOKIE = "a=1; b=2"
LARK_APP_ID = "cli_xxx"

[mcp_servers.node_repl]
command = "node"
args = ["/path/repl.js"]
`;
  const out = _removeTomlServer(cfg, 'feishu-user-plugin');

  check('removes the feishu server table header', () => assert(!/\[mcp_servers\.feishu-user-plugin\]/.test(out), out));
  check('removes the feishu env sub-table values', () => assert(!out.includes('LARK_COOKIE') && !out.includes('LARK_APP_ID'), out));
  check('leaves NO orphaned args fragment from feishu', () => assert(!out.includes('mcp_stdio_bridge.js'), out));
  check('preserves unrelated section BEFORE (memoryd) + values', () => {
    assert(out.includes('[mcp_servers.memoryd]'), out);
    assert(out.includes('FOO = "bar"'), out);
    assert(out.includes('/path/memoryd.js'), out);
  });
  check('preserves unrelated section AFTER (node_repl) + values', () => {
    assert(out.includes('[mcp_servers.node_repl]'), out);
    assert(out.includes('/path/repl.js'), out);
  });
  check('preserves the top-of-file comment', () => assert(out.includes('# top-of-file comment'), out));

  // Original-bug shape: feishu followed by a user comment then an unrelated table.
  const cfg2 = `[mcp_servers.other]
command = "x"

[mcp_servers.feishu-user-plugin]
args = ["/repo/bridge.js"]
[mcp_servers.feishu-user-plugin.env]
K = "v"

# a user comment after feishu (the old regex ate this to EOF)
[some.other.table]
keep = "me"
`;
  const out2 = _removeTomlServer(cfg2, 'feishu-user-plugin');
  check('trailing unrelated table preserved', () => {
    assert(out2.includes('[some.other.table]'), out2);
    assert(out2.includes('keep = "me"'), out2);
  });
  check('user comment after feishu is preserved (not deleted)', () => assert(out2.includes('# a user comment after feishu'), out2));
  check('feishu fully gone in cfg2', () => assert(!out2.includes('bridge.js') && !out2.includes('K = "v"'), out2));
  check('leading [mcp_servers.other] preserved in cfg2', () => assert(out2.includes('[mcp_servers.other]') && out2.includes('command = "x"'), out2));

  console.log(`\nconfig-toml-removal: ${pass} passed, ${fail} failed`);
  if (fail) throw new Error(`config-toml-removal: ${fail} check(s) failed`);
  console.log('config-toml-removal.js: PASS');
}

if (require.main === module) run().catch((e) => { console.error(e); process.exit(1); });
module.exports = { run };
