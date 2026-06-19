// Targeted regression test: credentials writes must go through the credentials
// module's locked canonical writer, not direct ad-hoc file writes.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const setupSource = fs.readFileSync(path.join(repoRoot, 'src/setup.js'), 'utf8');
assert.ok(
  !/fs\.writeFileSync\(credsPath/.test(setupSource),
  'setup.js must not write credentials.json directly; use credentials.writeCanonical/updateCanonical',
);

const originalHome = os.homedir;
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-creds-contract-'));
os.homedir = () => tempHome;

try {
  delete require.cache[require.resolve('./auth/credentials')];
  const credentials = require('./auth/credentials');

  assert.strictEqual(typeof credentials.writeCanonical, 'function', 'credentials.writeCanonical must be exported');
  assert.strictEqual(typeof credentials.updateCanonical, 'function', 'credentials.updateCanonical must be exported');

  credentials.writeCanonical({
    version: credentials.SCHEMA_VERSION,
    active: 'default',
    profiles: { default: { LARK_APP_ID: 'app' } },
    profileHints: {},
  });

  credentials.updateCanonical((file) => {
    file.profiles.default.LARK_APP_SECRET = 'secret';
  });
  credentials.setProfileHint('doc:doc_token', 'default');
  credentials.persistProfileUpdate('default', { LARK_UAT_EXPIRES: '123' });

  const out = credentials.readCanonical();
  assert.strictEqual(out.profiles.default.LARK_APP_ID, 'app');
  assert.strictEqual(out.profiles.default.LARK_APP_SECRET, 'secret');
  assert.strictEqual(out.profiles.default.LARK_UAT_EXPIRES, 123);
  assert.strictEqual(out.profileHints['doc:doc_token'], 'default');

  const stat = fs.statSync(path.join(tempHome, '.feishu-user-plugin', 'credentials.json'));
  assert.strictEqual(stat.mode & 0o777, 0o600, 'credentials.json must be mode 0600');
  console.log('ok - credentials write contract');
} finally {
  os.homedir = originalHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
}
