#!/usr/bin/env node
// Render docs/demo-send-as-user.svg → docs/demo-send-as-user.png at 1100x540.
//
// Idempotent. Run after editing the SVG. Commit both source + asset.
//
// Embedded in README.md + README.en.md as the first-screen hero.

'use strict';

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const svgPath = path.join(__dirname, '..', 'docs', 'demo-send-as-user.svg');
const pngPath = path.join(__dirname, '..', 'docs', 'demo-send-as-user.png');

const svg = fs.readFileSync(svgPath, 'utf8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1100 },
  font: {
    fontDirs: ['/System/Library/Fonts', '/Library/Fonts', '/usr/share/fonts'],
    loadSystemFonts: true,
    defaultFontFamily: 'PingFang SC',
  },
  background: '#f0f2f5',
});

const pngBuffer = resvg.render().asPng();
fs.writeFileSync(pngPath, pngBuffer);

const sizeKb = (pngBuffer.length / 1024).toFixed(1);
console.log(`OK: wrote ${pngPath} (${pngBuffer.length} bytes / ${sizeKb} KiB)`);
