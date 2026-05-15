#!/usr/bin/env node
require('./logger').installStdoutGuard(); // redirect any stray console.log → stderr — MUST be first (MCP stdio uses stdout)
require('./server').main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
