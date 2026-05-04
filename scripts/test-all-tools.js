#!/usr/bin/env node
// scripts/test-all-tools.js — semi-automated tool regression.
//
// Spawns the MCP server (src/index.js) as a stdio child, sends `initialize` +
// `tools/list`, then calls a curated set of READ tools to verify each domain
// is wired up. Writes a per-tool pass/fail summary to stdout.
//
// Read-only by design: this script does NOT create / modify / delete any
// Feishu resources. For write-tool regression, see docs/TESTING-METHODOLOGY.md
// "Live regression checklist".
//
// Usage:
//   node scripts/test-all-tools.js
//   node scripts/test-all-tools.js --user-id <open_id>   # to also test list_user_okrs
//   node scripts/test-all-tools.js --json                # machine-readable output
//
// Exit code: 0 if all calls succeed, 1 if any failed.

const { spawn } = require('child_process');
const path = require('path');
const { readCredentials } = require('../src/config');

const SERVER_PATH = path.join(__dirname, '..', 'src', 'index.js');

function jsonrpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

function waitFor(fn, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout after ${timeoutMs}ms`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function runRegression() {
  const cliArgs = process.argv.slice(2);
  const wantJson = cliArgs.includes('--json');
  const userIdIdx = cliArgs.indexOf('--user-id');
  const userId = userIdIdx >= 0 ? cliArgs[userIdIdx + 1] : null;

  const creds = readCredentials() || {};
  const childEnv = { ...process.env };
  for (const k of ['LARK_COOKIE', 'LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_USER_ACCESS_TOKEN', 'LARK_USER_REFRESH_TOKEN', 'LARK_PROFILES_JSON']) {
    if (creds[k] && !childEnv[k]) childEnv[k] = creds[k];
  }

  const child = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv,
  });
  let buf = '';
  const responses = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null) responses.set(msg.id, msg);
      } catch {}
    }
  });
  child.stderr.on('data', () => {});

  let nextId = 1;
  function call(method, params, timeoutMs = 15000) {
    const id = nextId++;
    child.stdin.write(jsonrpc(id, method, params));
    return waitFor(() => responses.has(id), timeoutMs).then(() => responses.get(id));
  }

  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-all-tools', version: '0' },
  });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);

  const toolsResp = await call('tools/list', {});
  const allTools = (toolsResp.result?.tools || []).map((t) => t.name).sort();

  // Curated read-only suite. Each entry: [name, args, optional notes].
  const SUITE = [
    ['get_login_status', {}],
    ['list_profiles', {}],
    ['list_chats', { page_size: 5 }],
    ['search_contacts', { query: 'feishu' }],
    ['list_calendars', { page_size: 50 }],
    ['list_okr_periods', {}],
    ['list_wiki_spaces', {}],
    ['search_docs', { query: 'README' }],
    ['list_files', {}],
  ];
  if (userId) SUITE.push(['list_user_okrs', { user_id: userId, limit: 1 }]);
  // list_tasks (v1.3.7) is safe but only meaningful if Tasks scope is granted.
  if (allTools.includes('list_tasks')) SUITE.push(['list_tasks', { page_size: 1 }]);

  const results = [];
  for (const [name, args] of SUITE) {
    if (!allTools.includes(name)) {
      results.push({ tool: name, ok: false, skipped: true, reason: 'tool not registered' });
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await call('tools/call', { name, arguments: args }, 30000);
      const ms = Date.now() - t0;
      if (r.error) {
        results.push({ tool: name, ok: false, ms, error: r.error.message });
      } else {
        const isError = r.result?.isError === true;
        results.push({ tool: name, ok: !isError, ms, summary: summarize(r.result) });
      }
    } catch (e) {
      results.push({ tool: name, ok: false, ms: Date.now() - t0, error: e.message });
    }
  }

  child.kill('SIGTERM');

  if (wantJson) {
    process.stdout.write(JSON.stringify({ allTools: allTools.length, results }, null, 2) + '\n');
  } else {
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.filter((r) => !r.ok && !r.skipped).length;
    const skipCount = results.filter((r) => r.skipped).length;
    console.log(`Tool registry size: ${allTools.length}`);
    console.log(`Suite: ${okCount} ok, ${failCount} fail, ${skipCount} skipped (out of ${results.length} planned)\n`);
    for (const r of results) {
      const status = r.skipped ? 'SKIP' : (r.ok ? ' OK ' : 'FAIL');
      const ms = r.ms !== undefined ? ` ${r.ms}ms` : '';
      const tail = r.error ? ` — ${r.error}` : (r.reason ? ` — ${r.reason}` : (r.summary ? ` — ${r.summary}` : ''));
      console.log(`  [${status}]${ms.padStart(8)} ${r.tool}${tail}`);
    }
    if (failCount > 0) process.exit(1);
  }
}

function summarize(result) {
  const txt = result?.content?.[0]?.text;
  if (!txt) return '';
  // Crop multi-line summaries to the first line + length.
  const firstLine = txt.split('\n', 1)[0];
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
}

runRegression().catch((e) => {
  console.error('Regression failed:', e.message);
  process.exit(2);
});
