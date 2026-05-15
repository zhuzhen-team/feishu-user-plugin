// src/test-cli-tool.js — verify the v1.3.12 \`tool\` CLI subcommand.
//
// Spawns \`node src/cli.js tool <args>\` as child_process and asserts:
//   - tool list prints 85 names, exit 0
//   - tool help <known-name> prints the schema, exit 0
//   - tool help <missing-name> prints error to stderr, exit 2
//   - tool <unknown-name> '{}' fails with exit 2
//   - tool help (no args) prints help to stderr, exit 2
//
// We don't actually invoke a tool here because handlers need credentials
// — that's covered by the integration scripts. This test just covers the
// CLI argv-parsing + dispatcher correctness.

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');

const CLI = path.join(__dirname, 'cli.js');

function runCli(args) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

function run() {
  // --- 1. tool list — exit 0, 85 lines, all known tool names ---
  {
    const r = runCli(['tool', 'list']);
    assert.equal(r.status, 0, 'tool list should exit 0');
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines.length, 85, `tool list should print 85 names, got ${lines.length}`);
    assert.ok(lines.includes('get_login_status'));
    assert.ok(lines.includes('search_messages'));
    assert.ok(lines.includes('send_as_user'));
  }

  // --- 2. tool help <known> — exit 0, contains schema ---
  {
    const r = runCli(['tool', 'help', 'get_login_status']);
    assert.equal(r.status, 0, 'tool help <known> should exit 0');
    assert.ok(r.stdout.includes('# get_login_status'));
    assert.ok(r.stdout.includes('## inputSchema'));
    assert.ok(r.stdout.includes('"type": "object"'));
  }

  // --- 3. tool help <unknown> — exit 2, stderr complains ---
  {
    const r = runCli(['tool', 'help', 'nonexistent_tool_xyz']);
    assert.equal(r.status, 2, 'tool help <unknown> should exit 2');
    assert.ok(r.stderr.includes('Unknown tool'));
  }

  // --- 4. tool <unknown-name> '{}' — exit 2 ---
  {
    const r = runCli(['tool', 'nonexistent_xyz', '{}']);
    assert.equal(r.status, 2, 'tool <unknown> should exit 2');
    assert.ok(r.stderr.includes('Unknown tool'));
  }

  // --- 5. tool <name> with malformed JSON args — exit 2 ---
  {
    const r = runCli(['tool', 'get_login_status', 'not a json']);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes('failed to parse JSON'));
  }

  // --- 6. tool (no subcommand) — exit 2 with usage on stdout ---
  {
    const r = runCli(['tool']);
    assert.equal(r.status, 2);
    assert.ok(r.stdout.includes('npx feishu-user-plugin tool'));
  }

  // --- 7. tool --help — exit 0 ---
  {
    const r = runCli(['tool', '--help']);
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('tool list'));
    assert.ok(r.stdout.includes('tool help'));
  }

  console.log('cli-tool.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
