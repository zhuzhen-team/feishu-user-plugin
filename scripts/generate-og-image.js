#!/usr/bin/env node
// Render docs/og.svg → docs/og.png at 1200x630.
//
// Idempotent. Run `node scripts/generate-og-image.js` after editing
// docs/og.svg. Commit both the SVG (source) and the PNG (asset used
// by social-media unfurls and `<meta property="og:image">`).
//
// Why PNG: Twitter / WeChat / 飞书 unfurls don't render SVG `og:image`.

'use strict';

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const svgPath = path.join(__dirname, '..', 'docs', 'og.svg');
const pngPath = path.join(__dirname, '..', 'docs', 'og.png');

const svg = fs.readFileSync(svgPath, 'utf8');

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  // Try to use system fonts so Chinese characters render. resvg-js loads
  // fonts from `font.fontDirs` and `font.defaultFontFamily`. On macOS
  // /System/Library/Fonts has PingFang SC; on Linux CI, jekyll-seo-tag
  // doesn't run this script anyway — only humans do, locally.
  font: {
    fontDirs: ['/System/Library/Fonts', '/Library/Fonts', '/usr/share/fonts'],
    loadSystemFonts: true,
    defaultFontFamily: 'PingFang SC',
  },
  background: '#0d1117',
});

const pngBuffer = resvg.render().asPng();
fs.writeFileSync(pngPath, pngBuffer);

const sizeKb = (pngBuffer.length / 1024).toFixed(1);
console.log(`OK: wrote ${pngPath} (${pngBuffer.length} bytes / ${sizeKb} KiB)`);
