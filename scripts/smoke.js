#!/usr/bin/env node
// scripts/smoke.js — MCP smoke test for refactor before/after diff.
// Spawns src/index.js as a child via stdio, sends:
//   1. tools/list                   → dumps sorted (name, description, inputSchema) to stdout
//   2. tools/call get_login_status  → dumps recursive Object.keys (not values) to stdout
//   3. prompts/list                 → dumps sorted (name, description, arguments) to stdout
// Exits 0 on success, 1 on protocol error. Diff output against tests/baseline/*.json.
//
// Cred sourcing: src/index.js only reads process.env.LARK_*; this script injects
// creds from ~/.claude.json via readCredentials() so the spawned MCP server has
// the same auth it would have when launched by Claude Code. Without this the
// baseline captures the not-configured login_status shape.
//
// Usage:
//   node scripts/smoke.js dump            # print normalized current snapshot to stdout
//   node scripts/smoke.js diff            # compare against tests/baseline/* and exit non-zero on mismatch
//   node scripts/smoke.js write-baseline  # overwrite tests/baseline/*.json with current snapshot

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { readCredentials } = require('../src/config');

const SERVER_PATH = path.join(__dirname, '..', 'src', 'index.js');
const BASELINE_DIR = path.join(__dirname, '..', 'tests', 'baseline');
const TOOLS_BASELINE = path.join(BASELINE_DIR, 'tools-list.json');
const LOGIN_BASELINE = path.join(BASELINE_DIR, 'login-status-shape.json');
const PROMPTS_BASELINE = path.join(BASELINE_DIR, 'prompts-list.json');

function jsonrpc(id, method, params) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

function normalizeSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(normalizeSchema);
  const out = {};
  for (const k of Object.keys(s).sort()) {
    out[k] = k === 'required' && Array.isArray(s[k]) ? [...s[k]].sort() : normalizeSchema(s[k]);
  }
  return out;
}

function shapeOnly(v) {
  if (v === null || v === undefined) return v === null ? 'null' : 'undefined';
  if (Array.isArray(v)) return v.length === 0 ? '[]' : ['<' + (typeof v[0] === 'object' ? 'object' : typeof v[0]) + '>'];
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shapeOnly(v[k]);
    return out;
  }
  return typeof v;
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

async function runSmoke() {
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
  // Keep the last few KB of server stderr so a crash reports WHY, instead of a
  // blind "server exited with code N" that forces a manual re-run to diagnose.
  let stderrTail = '';
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });

  let exitErr = null;
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      exitErr = new Error(`server exited with code ${code}${stderrTail ? `\n--- server stderr (tail) ---\n${stderrTail}` : ''}`);
    }
  });

  child.stdin.write(jsonrpc(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  }));
  await waitFor(() => responses.has(1) || exitErr, 8000);
  if (exitErr) throw exitErr;

  child.stdin.write(jsonrpc(2, 'tools/list', {}));
  await waitFor(() => responses.has(2) || exitErr, 8000);
  if (exitErr) throw exitErr;

  child.stdin.write(jsonrpc(3, 'tools/call', { name: 'get_login_status', arguments: {} }));
  await waitFor(() => responses.has(3) || exitErr, 15000);
  if (exitErr) throw exitErr;

  child.stdin.write(jsonrpc(4, 'prompts/list', {}));
  await waitFor(() => responses.has(4) || exitErr, 8000);
  if (exitErr) throw exitErr;

  child.kill('SIGTERM');

  const tools = (responses.get(2)?.result?.tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: normalizeSchema(t.inputSchema),
  })).sort((a, b) => a.name.localeCompare(b.name));

  let loginShape = null;
  const txt = responses.get(3)?.result?.content?.[0]?.text;
  if (typeof txt === 'string') {
    try {
      loginShape = shapeOnly(JSON.parse(txt));
    } catch {
      // Not JSON — capture as a plain text shape (length stays unstable so just record it's a string).
      loginShape = { _format: 'text', _length_bucket: txt.length < 100 ? '<100' : txt.length < 1000 ? '<1000' : '>=1000' };
    }
  } else {
    loginShape = { _error: 'no response', _raw: shapeOnly(responses.get(3)?.result) };
  }

  const prompts = (responses.get(4)?.result?.prompts || []).map((p) => ({
    name: p.name,
    description: p.description,
    ...(p.arguments && p.arguments.length > 0 ? { arguments: p.arguments } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { tools, loginShape, prompts };
}

(async () => {
  const cmd = process.argv[2] || 'dump';
  let snap;
  try {
    snap = await runSmoke();
  } catch (err) {
    console.error('SMOKE FAIL:', err.message);
    process.exit(1);
  }

  if (cmd === 'dump') {
    process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
    return;
  }
  if (cmd === 'write-baseline') {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(TOOLS_BASELINE, JSON.stringify(snap.tools, null, 2) + '\n');
    fs.writeFileSync(LOGIN_BASELINE, JSON.stringify(snap.loginShape, null, 2) + '\n');
    fs.writeFileSync(PROMPTS_BASELINE, JSON.stringify(snap.prompts, null, 2) + '\n');
    console.error(`Baseline written: ${snap.tools.length} tools, ${snap.prompts.length} prompts, login_status shape captured`);
    return;
  }
  if (cmd === 'diff') {
    if (!fs.existsSync(TOOLS_BASELINE) || !fs.existsSync(LOGIN_BASELINE)) {
      console.error('No baseline found. Run: node scripts/smoke.js write-baseline');
      process.exit(2);
    }
    const expectedTools = JSON.parse(fs.readFileSync(TOOLS_BASELINE, 'utf8'));
    const expectedLogin = JSON.parse(fs.readFileSync(LOGIN_BASELINE, 'utf8'));
    const expectedPrompts = fs.existsSync(PROMPTS_BASELINE)
      ? JSON.parse(fs.readFileSync(PROMPTS_BASELINE, 'utf8'))
      : null;
    const actualToolsStr = JSON.stringify(snap.tools, null, 2);
    const expectedToolsStr = JSON.stringify(expectedTools, null, 2);
    let ok = true;
    if (actualToolsStr !== expectedToolsStr) {
      ok = false;
      const expectedNames = new Set(expectedTools.map(t => t.name));
      const actualNames = new Set(snap.tools.map(t => t.name));
      const added = [...actualNames].filter(n => !expectedNames.has(n));
      const removed = [...expectedNames].filter(n => !actualNames.has(n));
      console.error('TOOLS MISMATCH');
      console.error(`expected ${expectedTools.length} tools, got ${snap.tools.length}`);
      if (added.length) console.error(`  added:   ${added.join(', ')}`);
      if (removed.length) console.error(`  removed: ${removed.join(', ')}`);
      // Find tools whose schema/description changed
      const expByName = Object.fromEntries(expectedTools.map(t => [t.name, t]));
      const changed = snap.tools.filter(t => expByName[t.name] && JSON.stringify(t) !== JSON.stringify(expByName[t.name])).map(t => t.name);
      if (changed.length) console.error(`  changed: ${changed.join(', ')}`);
    }
    if (JSON.stringify(snap.loginShape) !== JSON.stringify(expectedLogin)) {
      ok = false;
      console.error('LOGIN STATUS SHAPE MISMATCH');
      console.error('expected:', JSON.stringify(expectedLogin, null, 2));
      console.error('actual:  ', JSON.stringify(snap.loginShape, null, 2));
    }
    if (expectedPrompts !== null && JSON.stringify(snap.prompts, null, 2) !== JSON.stringify(expectedPrompts, null, 2)) {
      ok = false;
      const expectedNames = new Set(expectedPrompts.map(p => p.name));
      const actualNames = new Set(snap.prompts.map(p => p.name));
      const added = [...actualNames].filter(n => !expectedNames.has(n));
      const removed = [...expectedNames].filter(n => !actualNames.has(n));
      console.error('PROMPTS MISMATCH');
      console.error(`expected ${expectedPrompts.length} prompts, got ${snap.prompts.length}`);
      if (added.length) console.error(`  added:   ${added.join(', ')}`);
      if (removed.length) console.error(`  removed: ${removed.join(', ')}`);
      const expByName = Object.fromEntries(expectedPrompts.map(p => [p.name, p]));
      const changed = snap.prompts.filter(p => expByName[p.name] && JSON.stringify(p) !== JSON.stringify(expByName[p.name])).map(p => p.name);
      if (changed.length) console.error(`  changed: ${changed.join(', ')}`);
    }
    if (!ok) process.exit(1);
    console.error(`OK: ${snap.tools.length} tools, ${snap.prompts.length} prompts, login_status shape matches`);
    return;
  }
  console.error('usage: smoke.js [dump|diff|write-baseline]');
  process.exit(2);
})();
