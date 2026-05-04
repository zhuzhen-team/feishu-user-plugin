// Global stdout guard. MCP stdio uses stdout for JSON-RPC; ANY accidental write
// from this process or its dependencies corrupts the transport and disconnects
// the client. Defense-in-depth: redirect every console.log / console.info to
// stderr at module load. REQUIRE THIS BEFORE ANY OTHER MODULE so even early
// log calls during dependency init are captured.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);

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

module.exports = { stderrLogger };
