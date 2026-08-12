#!/usr/bin/env node
/**
 * Icon Generator for Resizo
 *
 * Renders the three browser icons from one vector source — the frame-with-a-
 * corner-handle brand mark that components/ui/Logo.js draws — so the tab, the
 * iOS home screen and the install prompt cannot drift apart:
 *
 *   app/favicon.ico    16 / 32 / 48 px, the sizes browsers actually pick from
 *   app/icon.png       512 px, the tab icon and the manifest install icon
 *   app/apple-icon.png 180 px, the iOS home-screen icon
 *
 * All three live in app/, on Next's file convention, which is the single
 * source: a second copy in public/ produced two competing <link rel="icon">
 * tags, and app/layout.js no longer declares `metadata.icons` at all.
 *
 * sharp rasterizes the SVG but has no ICO encoder, so the .ico container is
 * packed by hand below — a well-documented ~20-line binary format, not worth a
 * new dependency.
 *
 * Usage: node scripts/generate-favicon.js   (wired as `npm run generate:favicon`)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const APP = path.join(__dirname, '..', 'app');
const ICO_SIZES = [16, 32, 48];

// Mirrors the light-theme tokens in app/globals.css. The mark is drawn in
// --surface rather than pure white so it reads as the page's own ground cut
// out of the tile, which is also what keeps it off the "pure #FFF" line in
// DESIGN.md's rejection clause.
const ACCENT = '#C7431F';
const OFF_WHITE = '#F8F7F5';

/**
 * The mark on a 24-unit grid, same geometry as Logo.js: a rounded frame with a
 * bracket inside it — the resize gesture.
 *
 * Two profiles, because a stroke that looks right at 512 px disappears at 16.
 * The small profile pushes the frame wider and thickens both strokes so the
 * shape survives being 16 pixels across.
 */
const PROFILES = {
  small: { inset: 4, frameStroke: 2.1, handleStroke: 2.4, handleHalf: 2.6, frameRadius: 2.4 },
  large: { inset: 4.6, frameStroke: 1.36, handleStroke: 1.55, handleHalf: 2.34, frameRadius: 2.34 },
};

/**
 * @param {number} size      pixel size of the square
 * @param {object} profile   one of PROFILES
 * @param {boolean} rounded  false for the Apple icon: iOS applies its own
 *                           squircle mask, and a pre-rounded tile shows the
 *                           corners twice
 */
function buildSvg(size, profile, rounded) {
  const { inset, frameStroke, handleStroke, handleHalf, frameRadius } = profile;
  const tileRadius = rounded ? 24 * 0.22 : 0;
  const span = 24 - inset * 2;
  const near = 12 - handleHalf;
  const far = 12 + handleHalf;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
    <rect width="24" height="24" rx="${tileRadius}" fill="${ACCENT}"/>
    <rect x="${inset}" y="${inset}" width="${span}" height="${span}" rx="${frameRadius}"
          fill="none" stroke="${OFF_WHITE}" stroke-width="${frameStroke}"/>
    <path d="M${near} ${far}H${far}V${near}"
          fill="none" stroke="${OFF_WHITE}" stroke-width="${handleStroke}" stroke-linecap="square"/>
  </svg>`;
}

async function renderPng(size, profile, rounded) {
  return sharp(Buffer.from(buildSvg(size, profile, rounded)), { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
}

// Packs one or more PNG buffers into a single .ico file. ICO layout:
// a 6-byte header, one 16-byte directory entry per image, then the raw
// image bytes back to back — modern Windows/browsers accept PNG-encoded
// image data directly inside each entry (no BMP conversion needed).
function buildIco(images) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE = 16;
  let offset = HEADER_SIZE + ENTRY_SIZE * images.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0, 0); // reserved, must be 0
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const data = [];
  for (const { size, buffer } of images) {
    const entry = Buffer.alloc(ENTRY_SIZE);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width, 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height, 0 means 256
    entry.writeUInt8(0, 2); // color count: 0 = truecolor, no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel (RGBA)
    entry.writeUInt32LE(buffer.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // image data offset from file start
    offset += buffer.length;
    entries.push(entry);
    data.push(buffer);
  }

  return Buffer.concat([header, ...entries, ...data]);
}

async function main() {
  fs.mkdirSync(APP, { recursive: true });
  const written = [];

  const images = [];
  for (const size of ICO_SIZES) {
    images.push({ size, buffer: await renderPng(size, PROFILES.small, true) });
  }
  const ico = path.join(APP, 'favicon.ico');
  fs.writeFileSync(ico, buildIco(images));
  written.push([ico, `${ICO_SIZES.join(', ')}px`]);

  const icon = path.join(APP, 'icon.png');
  fs.writeFileSync(icon, await renderPng(512, PROFILES.large, true));
  written.push([icon, '512px']);

  const apple = path.join(APP, 'apple-icon.png');
  fs.writeFileSync(apple, await renderPng(180, PROFILES.large, false));
  written.push([apple, '180px, square — iOS masks it']);

  for (const [file, note] of written) {
    const { size } = fs.statSync(file);
    console.log(`✓ ${path.relative(path.join(__dirname, '..'), file)}  ${(size / 1024).toFixed(1)} KB  |  ${note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
