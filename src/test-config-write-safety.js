#!/usr/bin/env node
// Regression test for the silent-overwrite data-loss path in _writeClaudeConfig
// (config.js). When setup encountered a pre-existing ~/.claude.json that failed
// to JSON.parse (e.g. a hand-edited trailing comma), the `catch {}` swallowed
// the error, left `config = {}`, and _atomicWrite then overwrote the file —
// wiping every OTHER mcpServers entry, all `projects` history and settings.
//
// The correct behaviour: ENOENT / empty file → start fresh (safe); a non-empty
// file that cannot be parsed is user data we must NOT clobber → throw and abort
// setup, leaving the file byte-for-byte intact. A valid config must still merge.
//
// Pure IO: writes to temp files under os.tmpdir(), no network.
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeNewConfig } = require('./config');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  OK  ', name); pass++; }
  catch (e) { console.log('  FAIL', name, '—', e.message); fail++; }
}

let _seq = 0;
function tmpPath() {
  return path.join(os.tmpdir(), `feishu-cfgtest-${process.pid}-${_seq++}.json`);
}
function withTmp(initial, fn) {
  const p = tmpPath();
  try { fs.rmSync(p, { force: true }); } catch (_) {}
  if (initial !== undefined) fs.writeFileSync(p, initial);
  try { return fn(p); }
  finally { try { fs.rmSync(p, { force: true }); } catch (_) {} }
}

const ENV = { LARK_COOKIE: 'a=1', LARK_APP_ID: 'cli_x' };
const CORRUPT = '{\n  "mcpServers": { "other": { "command": "keep-me" } },\n}\n'; // trailing comma → invalid JSON

async function run() {
  console.log('=== test-config-write-safety ===');

  ok('corrupt existing ~/.claude.json is NOT overwritten — setup throws, file untouched', () => {
    withTmp(CORRUPT, (p) => {
      let threw = false, msg = '';
      try { writeNewConfig(ENV, p, null, 'claude'); }
      catch (e) { threw = true; msg = e.message; }
      assert.ok(threw, 'writeNewConfig must throw rather than clobber invalid JSON');
      assert.ok(/valid JSON|not valid|parse/i.test(msg), `error should explain the parse failure: ${msg}`);
      const after = fs.readFileSync(p, 'utf8');
      assert.strictEqual(after, CORRUPT, 'the corrupt file must be left byte-for-byte intact (no data loss)');
      assert.ok(!/feishu-user-plugin/.test(after), 'must not have written the feishu entry into a clobbered file');
    });
  });

  ok('corrupt file with projectPath is also NOT overwritten', () => {
    withTmp(CORRUPT, (p) => {
      let threw = false;
      try { writeNewConfig(ENV, p, '/some/project', 'claude'); }
      catch (_) { threw = true; }
      assert.ok(threw, 'projectPath path must also refuse to clobber invalid JSON');
      assert.strictEqual(fs.readFileSync(p, 'utf8'), CORRUPT, 'file must be intact');
    });
  });

  ok('valid existing config still merges — other servers preserved, feishu added', () => {
    const valid = JSON.stringify({ mcpServers: { other: { command: 'x' } }, projects: { '/p': { foo: 1 } } }, null, 2);
    withTmp(valid, (p) => {
      writeNewConfig(ENV, p, null, 'claude');
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(cfg.mcpServers.other, 'unrelated mcpServers entry must survive');
      assert.strictEqual(cfg.mcpServers.other.command, 'x');
      assert.ok(cfg.mcpServers['feishu-user-plugin'], 'feishu entry must be added');
      assert.ok(cfg.projects['/p'], 'projects history must survive');
    });
  });

  ok('ENOENT (no file) → fresh config created with the feishu entry', () => {
    const p = tmpPath();
    try { fs.rmSync(p, { force: true }); } catch (_) {}
    try {
      writeNewConfig(ENV, p, null, 'claude');
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(cfg.mcpServers['feishu-user-plugin'], 'fresh config must contain the feishu entry');
    } finally { try { fs.rmSync(p, { force: true }); } catch (_) {} }
  });

  ok('empty file → treated as fresh (no throw), feishu entry written', () => {
    withTmp('', (p) => {
      writeNewConfig(ENV, p, null, 'claude');
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(cfg.mcpServers['feishu-user-plugin'], 'empty file should be safely initialised');
    });
  });

  ok('whitespace-only file → treated as fresh (no throw)', () => {
    withTmp('   \n\t\n', (p) => {
      writeNewConfig(ENV, p, null, 'claude');
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      assert.ok(cfg.mcpServers['feishu-user-plugin']);
    });
  });

  console.log(`\n=== test-config-write-safety: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) {
  run().catch((e) => { console.error('test-config-write-safety harness error:', e); process.exit(1); });
}

module.exports = { run };
