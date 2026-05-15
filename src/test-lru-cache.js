// src/test-lru-cache.js — unit test for src/utils/lru-cache.js.
//
// Replaces the v1.3.12 `new Map()` _userNameCache / _appNameCache. Pre-fix the
// caches grew unboundedly across the server's lifetime (one entry per unique
// open_id ever seen) and never expired — a 1-week-uptime MCP would carry
// stale display names from messages of users who renamed themselves days ago.
//
// LRU with TTL solves both:
//   - max=500 caps the per-process memory at O(KiB) regardless of message volume
//   - ttlMs=10min ensures rename / leave-tenant changes get re-resolved
//
// We test the basic operations + interactions between TTL and LRU.

'use strict';

const assert = require('node:assert/strict');
const { LRUCache } = require('./utils');

async function run() {
  // --- 1. set/get/has roundtrip ---
  {
    const c = new LRUCache({ max: 5, ttlMs: 1000 });
    c.set('a', 1);
    assert.equal(c.get('a'), 1);
    assert.equal(c.has('a'), true);
    assert.equal(c.get('missing'), undefined);
    assert.equal(c.has('missing'), false);
    assert.equal(c.size, 1);
  }

  // --- 2. LRU eviction: oldest dropped when over max ---
  {
    const c = new LRUCache({ max: 3, ttlMs: 60_000 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.set('d', 4); // evicts 'a'
    assert.equal(c.has('a'), false);
    assert.equal(c.get('b'), 2);
    assert.equal(c.get('c'), 3);
    assert.equal(c.get('d'), 4);
    assert.equal(c.size, 3);
  }

  // --- 3. Access promotes recency: get prevents eviction ---
  {
    const c = new LRUCache({ max: 3, ttlMs: 60_000 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.get('a'); // 'a' becomes most-recently-used; 'b' is now LRU
    c.set('d', 4); // evicts 'b'
    assert.equal(c.has('a'), true);
    assert.equal(c.has('b'), false);
    assert.equal(c.has('c'), true);
    assert.equal(c.has('d'), true);
  }

  // --- 4. TTL expiry: get returns undefined for expired ---
  {
    const c = new LRUCache({ max: 10, ttlMs: 50 });
    c.set('a', 1);
    assert.equal(c.get('a'), 1);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(c.get('a'), undefined, 'expired entries return undefined');
    assert.equal(c.has('a'), false);
    // Expired entry is purged: size drops.
    assert.equal(c.size, 0);
  }

  // --- 5. Setting an existing key refreshes TTL ---
  {
    const c = new LRUCache({ max: 10, ttlMs: 100 });
    c.set('a', 1);
    await new Promise(r => setTimeout(r, 60));
    c.set('a', 1); // refresh
    await new Promise(r => setTimeout(r, 60));
    // 120ms total since first set, only 60ms since refresh — still valid.
    assert.equal(c.get('a'), 1);
  }

  // --- 6. delete + clear ---
  {
    const c = new LRUCache({ max: 5, ttlMs: 1000 });
    c.set('a', 1);
    c.set('b', 2);
    c.delete('a');
    assert.equal(c.has('a'), false);
    assert.equal(c.size, 1);
    c.clear();
    assert.equal(c.size, 0);
    assert.equal(c.has('b'), false);
  }

  // --- 7. Map-compatible shim (we replace `new Map()` in base.js — the
  // existing call sites use .has / .get / .set / .clear, which the class
  // implements identically. Smoke-check parity here.) ---
  {
    const c = new LRUCache({ max: 5, ttlMs: 1000 });
    c.set('open_x', 'Alice');
    assert.equal(c.has('open_x'), true);
    assert.equal(c.get('open_x'), 'Alice');
  }

  // --- 8. Iteration support: the comment claims "API-compatible with the
  // old Map", so spread / for-of / entries / keys / values must all work.
  // Map is iterable via Symbol.iterator yielding [key, value] tuples.
  {
    const c = new LRUCache({ max: 5, ttlMs: 60_000 });
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    const collected = [...c];
    assert.equal(collected.length, 3);
    // Map insertion order, [key, value] tuples.
    assert.deepEqual(collected[0], ['a', 1]);
    assert.deepEqual(collected[2], ['c', 3]);

    const forOfKeys = [];
    for (const [k] of c) forOfKeys.push(k);
    assert.deepEqual(forOfKeys, ['a', 'b', 'c']);

    assert.deepEqual([...c.keys()], ['a', 'b', 'c']);
    assert.deepEqual([...c.values()], [1, 2, 3]);
    assert.deepEqual([...c.entries()], [['a', 1], ['b', 2], ['c', 3]]);
  }

  // --- 9. Iteration skips expired entries (TTL gate is consistent across
  // get/has and iteration so callers don't see stale data via spread).
  {
    const c = new LRUCache({ max: 5, ttlMs: 50 });
    c.set('a', 1);
    c.set('b', 2);
    await new Promise(r => setTimeout(r, 80));
    c.set('c', 3); // fresh after expiry of a/b
    const collected = [...c];
    assert.equal(collected.length, 1);
    assert.deepEqual(collected[0], ['c', 3]);
  }

  console.log('lru-cache.js: PASS');
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
