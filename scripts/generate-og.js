#!/usr/bin/env node
/**
 * OG Image Generator for Resizo
 *
 * Renders the homepage and per-tool Open Graph / Twitter Card images
 * (1200x630) with sharp, compositing an SVG layer over the brand surface —
 * no ImageMagick shell-out, no network fonts. Colors mirror the light-theme
 * tokens in DESIGN.md / app/globals.css; if either changes, update TOKENS
 * below to match. Copy mirrors each tool's true, server-side processing —
 * no "no uploads" / "in your browser" claims (see DESIGN.md > Voice).
 *
 * Usage: node scripts/generate-og.js   (wired as `npm run generate:og`)
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public');
const WIDTH = 1200;
const HEIGHT = 630;

// Mirrors DESIGN.md's light-theme color table. This script has no build
// step that can read CSS custom properties from app/globals.css, so the
// hex values are copied here deliberately — keep the two in sync by hand.
const TOKENS = {
  surface: '#F8F7F5',
  surfaceRaised: '#FFFFFF',
  ink: '#201D1B',
  inkMuted: '#6E6862',
  line: '#E4E1DC',
  accent: '#C7431F',
};

// DESIGN.md specifies Bricolage Grotesque / Inclusive Sans / JetBrains Mono,
// self-hosted via next/font at Next's build time. Those font files live in
// next/font's build cache, not as files in this repo, and this script has
// to run standalone (before a build has ever happened, on a bare CI runner,
// etc.), so it uses the closest installed system faces instead of adding a
// vendored-font dependency: a bold system sans for display/UI text, a real
// monospace for the numeral/operation marks that carry the mono aesthetic.
// Single-quoted family names: these are interpolated into double-quoted SVG
// attributes below, and double quotes here would break the XML.
const SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', 'Menlo', 'Consolas', monospace";

const PANEL = { x: 48, y: 48, w: WIDTH - 96, h: HEIGHT - 96, r: 12 };

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  })[ch]);
}

// There is no text-shaping engine available here to measure real glyph
// widths, so this fits a font-size to a target pixel width using a fixed
// average-character-width factor per typeface — good enough to keep every
// mark/tagline on one line without overflowing the card.
function fitFontSize(text, maxWidth, maxSize, avgCharWidthFactor) {
  let size = maxSize;
  while (size > 12 && text.length * size * avgCharWidthFactor > maxWidth) {
    size -= 2;
  }
  return size;
}

// One operation mark per tool, matching DESIGN.md's own example vocabulary
// (`W×H`, `−%`, `→WEBP`, `⤢`, `HEIC→JPG`) and the truthful per-tool
// description already carried in lib/catalog.js TOOLS.
const PAGES = [
  {
    file: 'og-home.jpg',
    home: true,
    wordmark: 'Resizo',
    tagline: 'Resize, compress, convert, crop, and convert HEIC images.',
    formats: 'JPG · PNG · WEBP · HEIC',
  },
  {
    file: 'og-resize.jpg',
    title: 'Resize Image',
    mark: '1920×1080',
    tagline: 'Change image dimensions with pixel-perfect precision.',
  },
  {
    file: 'og-compress.jpg',
    title: 'Compress Image',
    mark: '−73%',
    tagline: 'Reduce file size without visible quality loss.',
  },
  {
    file: 'og-convert.jpg',
    title: 'Convert Format',
    mark: 'JPG→WEBP',
    tagline: 'Switch between JPEG, PNG, and WebP instantly.',
  },
  {
    file: 'og-crop.jpg',
    title: 'Crop Image',
    mark: '⤢',
    tagline: 'Remove unwanted areas with exact pixel control.',
  },
  {
    file: 'og-heic.jpg',
    title: 'Convert HEIC',
    mark: 'HEIC→JPG',
    tagline: 'Convert iPhone HEIC photos to universal JPEG.',
  },
];

function buildFooter() {
  const y = PANEL.y + PANEL.h - 40;
  return `
    <text x="${PANEL.x + 48}" y="${y}" font-family="${MONO}" font-size="20" fill="${TOKENS.inkMuted}">Processed server-side &#183; not stored</text>
    <text x="${PANEL.x + PANEL.w - 48}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="20" fill="${TOKENS.inkMuted}">resizo.net</text>
  `;
}

function buildHomeBody(page) {
  const taglineSize = fitFontSize(page.tagline, PANEL.w - 200, 30, 0.52);
  return `
    <text x="600" y="300" text-anchor="middle" font-family="${SANS}" font-weight="800" font-size="120" fill="${TOKENS.ink}">${escapeXml(page.wordmark)}</text>
    <rect x="470" y="332" width="260" height="6" rx="3" fill="${TOKENS.accent}"/>
    <text x="600" y="384" text-anchor="middle" font-family="${SANS}" font-size="${taglineSize}" fill="${TOKENS.inkMuted}">${escapeXml(page.tagline)}</text>
    <text x="600" y="432" text-anchor="middle" font-family="${MONO}" font-size="22" fill="${TOKENS.inkMuted}">${escapeXml(page.formats)}</text>
  `;
}

function buildToolBody(page) {
  const taglineSize = fitFontSize(page.tagline, PANEL.w - 200, 30, 0.52);
  const markMaxSize = page.mark.length <= 1 ? 300 : 150;
  const markSize = fitFontSize(page.mark, PANEL.w - 160, markMaxSize, 0.6);
  return `
    <text x="${PANEL.x + 48}" y="132" font-family="${SANS}" font-weight="800" font-size="32" fill="${TOKENS.ink}">Resizo</text>
    <text x="600" y="204" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="46" fill="${TOKENS.ink}">${escapeXml(page.title)}</text>
    <text x="600" y="420" text-anchor="middle" font-family="${MONO}" font-weight="700" font-size="${markSize}" fill="${TOKENS.accent}">${escapeXml(page.mark)}</text>
    <text x="600" y="490" text-anchor="middle" font-family="${SANS}" font-size="${taglineSize}" fill="${TOKENS.ink}">${escapeXml(page.tagline)}</text>
  `;
}

function buildSvg(page) {
  const body = page.home ? buildHomeBody(page) : buildToolBody(page);
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="${TOKENS.surface}"/>
    <rect x="${PANEL.x + 4}" y="${PANEL.y + 8}" width="${PANEL.w}" height="${PANEL.h}" rx="${PANEL.r}" fill="${TOKENS.ink}" opacity="0.06"/>
    <rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.w}" height="${PANEL.h}" rx="${PANEL.r}" fill="${TOKENS.surfaceRaised}" stroke="${TOKENS.line}" stroke-width="1"/>
    ${body}
    ${buildFooter()}
  </svg>
  `;
}

async function generate(page) {
  const svg = Buffer.from(buildSvg(page));
  const outPath = path.join(OUT_DIR, page.file);
  await sharp(svg).jpeg({ quality: 90 }).toFile(outPath);
  const stats = fs.statSync(outPath);
  console.log(`✓ ${page.file}  ${(stats.size / 1024).toFixed(1)} KB  |  ${WIDTH}×${HEIGHT}px`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const page of PAGES) {
    await generate(page);
  }
  // Legacy filename still referenced by app/layout.js's default metadata and
  // lib/seo.js's DEFAULT_OG_IMAGE. Keep it as an exact copy of the new
  // og-home.jpg instead of leaving the old ImageMagick-rendered asset (with
  // its false "No Uploads" badge) live in public/ until those call sites are
  // repointed at /og-home.jpg.
  fs.copyFileSync(path.join(OUT_DIR, 'og-home.jpg'), path.join(OUT_DIR, 'og-image.jpg'));
  console.log('✓ og-image.jpg (legacy alias of og-home.jpg, kept for existing references)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
