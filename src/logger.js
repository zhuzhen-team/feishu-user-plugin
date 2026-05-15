// Global stdout guard. MCP stdio uses stdout for JSON-RPC; ANY accidental write
// from this process or its dependencies corrupts the transport and disconnects
// the client. Defense-in-depth: redirect every console.log / console.info to
// stderr.
//
// v1.3.12: the guard is now opt-in via installStdoutGuard() so the CLI tool
// mode (\`npx feishu-user-plugin tool ...\`) can print structured JSON to the
// real stdout. index.js (the MCP server entry) calls it on the first line;
// cli.js doesn't, except when dispatching to MCP server mode.
function installStdoutGuard() {
  console.log = (...args) => console.error(...args);
  console.info = (...args) => console.error(...args);
}

// Stderr-only logger for the Lark SDK (the SDK's defaultLogger.error() writes
// to stdout via console.log, which would also corrupt MCP stdio). Shape and
// prefixes preserved verbatim from the original definition in src/official.js.
const stderrLogger = {
  error: (...msg) => console.error('[lark-sdk][error]:', ...msg),
  warn:  (...msg) => console.error('[lark-sdk][warn]:', ...msg),
  info:  () => {},
  debug: () => {},
  trace: () => {},
};

module.exports = { stderrLogger, installStdoutGuard };
