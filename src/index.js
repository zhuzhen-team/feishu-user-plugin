#!/usr/bin/env node
require('./logger').installStdoutGuard(); // redirect any stray console.log → stderr — MUST be first (MCP stdio uses stdout)

// Grace period: catch exception loops before the server's own handlers are
// installed (server.js registers its uncaughtException handler inside main()).
// Without this, a parse-time error in a required module could spin.
let _preInitExceptions = 0;
const _onPreInitException = (err) => {
  _preInitExceptions++;
  if (_preInitExceptions >= 3) {
    process.stderr.write(`[feishu-user-plugin] FATAL: ${_preInitExceptions} startup exceptions, exiting\n`);
    process.exit(70);
  }
  process.stderr.write(`[feishu-user-plugin] startup error: ${String(err && err.message)}\n`);
};
process.on('uncaughtException', _onPreInitException);

require('./server').main().then(() => {
  // main() installed its own uncaughtException handler — remove this bootstrap guard
  process.removeListener('uncaughtException', _onPreInitException);
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
