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

// Bounded, total error serialiser for the process-level uncaughtException /
// unhandledRejection handlers (see server.js). A thrown or rejected value may
// not be an Error (message/stack undefined), and formatting a huge or circular
// value unbounded can itself throw inside the handler — turning a single fault
// into a handler→format→throw→handler loop that pegs the CPU. This projects
// Errors to plain fields, caps output length, and NEVER throws: if even the
// projection fails (e.g. a getter that throws) it returns a placeholder.
// Lands the self-contained, reviewer-approved part of PR #110 (util.inspect
// hardening) without its disputed re-entrancy/SIGKILL/ps-cleanup changes.
const util = require('util');
function inspectError(val) {
  try {
    const projection = (val instanceof Error)
      ? { name: val.name, message: val.message, code: val.code, stack: val.stack }
      : val;
    return util.inspect(projection, { depth: 3, breakLength: Infinity, maxStringLength: 4000 });
  } catch (_) {
    try { return `<unserializable ${Object.prototype.toString.call(val)}>`; }
    catch (_) { return '<unserializable>'; }
  }
}

module.exports = { stderrLogger, installStdoutGuard, inspectError };
