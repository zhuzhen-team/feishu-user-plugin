#!/usr/bin/env node
// Unit test for logger.inspectError — the bounded, total serialiser used by the
// process-level uncaughtException / unhandledRejection handlers (server.js).
// It must (a) render an Error's identifying fields, (b) handle non-Error throws
// and circular objects without throwing, (c) bound its output, and (d) NEVER
// throw even when the value's own accessors throw. Lands the reviewer-approved
// part of PR #110. Pure unit — no IO, no network.
'use strict';

const assert = require('assert');
const { inspectError } = require('./logger');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  OK  ', name); pass++; }
  catch (e) { console.log('  FAIL', name, '—', e.message); fail++; }
}

function run() {
  console.log('=== test-inspect-error ===');

  ok('Error → string containing name + message, does not throw', () => {
    const s = inspectError(new TypeError('boom-msg'));
    assert.strictEqual(typeof s, 'string');
    assert.ok(s.includes('TypeError'), `should include name: ${s}`);
    assert.ok(s.includes('boom-msg'), `should include message: ${s}`);
  });

  ok('non-Error string throw → returns a string, does not throw', () => {
    const s = inspectError('just a string');
    assert.strictEqual(typeof s, 'string');
    assert.ok(s.includes('just a string'));
  });

  ok('non-Error object → does not throw', () => {
    const s = inspectError({ some: 'object', n: 1 });
    assert.strictEqual(typeof s, 'string');
    assert.ok(s.includes('some'));
  });

  ok('circular object → does not throw (util.inspect handles the cycle)', () => {
    const o = { a: 1 }; o.self = o;
    const s = inspectError(o);
    assert.strictEqual(typeof s, 'string');
    assert.ok(/Circular/i.test(s) || s.includes('self'), `should render the cycle safely: ${s}`);
  });

  ok('huge string is bounded (maxStringLength), not echoed in full', () => {
    const s = inspectError('x'.repeat(200000));
    assert.strictEqual(typeof s, 'string');
    assert.ok(s.length < 20000, `output must be capped well below the input size, got ${s.length}`);
  });

  ok('value whose stack getter throws → caught, returns placeholder, never throws', () => {
    class Nasty extends Error { get stack() { throw new Error('stack blew up'); } }
    let threw = false, s = '';
    try { s = inspectError(new Nasty('x')); } catch (_) { threw = true; }
    assert.ok(!threw, 'inspectError must never propagate a throw');
    assert.strictEqual(typeof s, 'string');
    assert.ok(s.length > 0, 'must still return something loggable');
  });

  ok('null / undefined → does not throw', () => {
    assert.strictEqual(typeof inspectError(null), 'string');
    assert.strictEqual(typeof inspectError(undefined), 'string');
  });

  console.log(`\n=== test-inspect-error: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

if (require.main === module) run();

module.exports = { run };
