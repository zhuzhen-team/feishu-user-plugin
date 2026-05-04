#!/usr/bin/env node
require('./logger'); // installs global stdout guard — MUST be first
require('./server').main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
