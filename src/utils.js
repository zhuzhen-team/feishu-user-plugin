// Random 10-char alphanumeric string
function generateRequestId() {
  return (Math.random().toString(36) + '0000000000').substring(2, 12);
}

// Random 10-char CID from alphanumeric set
function generateCid() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars[(Math.random() * chars.length) | 0];
  }
  return result;
}

// Parse cookie string to object
function parseCookie(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach((pair) => {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = rest.join('=');
  });
  return cookies;
}

// Format cookie object to string for headers
function formatCookie(cookieObj) {
  return Object.entries(cookieObj)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// Wraps global fetch with an AbortController-based timeout. A stalled network
// connection to feishu.cn can otherwise block an MCP tool handler indefinitely,
// causing the client to time out and (in some clients) tear down the stdio
// transport — observed as "MCP 中途掉线" by v1.3.2 users.
// Default 30s; pass `timeoutMs` in init to override per-call.
function fetchWithTimeout(url, init = {}) {
  const { timeoutMs = 30000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch timeout after ${timeoutMs}ms: ${url}`)), timeoutMs);
  return fetch(url, { ...rest, signal: rest.signal || controller.signal }).finally(() => clearTimeout(timer));
}

// LRU cache with TTL. Replaces unbounded `new Map()` in base.js for
// _userNameCache / _appNameCache (v1.3.12). Insertion order in a JS Map gives
// us LRU for free — re-insertion (delete + set) moves a key to "newest".
class LRUCache {
  constructor({ max = 500, ttlMs = 600_000 } = {}) {
    if (!Number.isFinite(max) || max <= 0) throw new Error('LRUCache: max must be positive');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('LRUCache: ttlMs must be positive');
    this._max = max;
    this._ttlMs = ttlMs;
    this._map = new Map(); // key → { value, expiresAt }
  }

  _isExpired(entry) {
    return entry.expiresAt <= Date.now();
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this._map.delete(key);
      return undefined;
    }
    // Bump recency: re-insert to move to tail.
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (this._isExpired(entry)) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  set(key, value) {
    // If the key exists, delete first so re-insert puts it at the tail.
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    while (this._map.size > this._max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  delete(key) { return this._map.delete(key); }

  clear() { this._map.clear(); }

  get size() { return this._map.size; }
}

module.exports = {
  generateRequestId,
  generateCid,
  parseCookie,
  formatCookie,
  fetchWithTimeout,
  LRUCache,
};
