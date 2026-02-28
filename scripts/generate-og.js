#!/usr/bin/env node
/**
 * OG Image Generator for Resizo
 * Generates a 1200×630 Open Graph / Twitter Card image.
 *
 * Usage:
 *   node scripts/generate-og.js
 *
 * Requires: ImageMagick (install via `apt install imagemagick` or `brew install imagemagick`)
 * Falls back to sharp if ImageMagick is not available.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', 'public', 'og-image.jpg');

// Ensure the public directory exists
fs.mkdirSync(path.dirname(OUT), { recursive: true });

function generateWithImageMagick() {
  const cmd = [
    'convert',
    '-size 1200x630',
    'xc:"#1A1410"',

    // Glow accents (top-left, bottom-right)
    '-fill "#B8860B" -draw "circle 140,120 340,120"',
    '-fill "#1A1410" -draw "circle 140,120 260,120"',
    '-fill "#B8860B" -draw "circle 1060,510 1260,510"',
    '-fill "#1A1410" -draw "circle 1060,510 970,510"',

    // Border
    '-fill none -stroke "#3D2B1F" -strokewidth 2',
    '-draw "roundrectangle 32,32 1168,598 18,18"',

    // Main title
    '-font DejaVu-Sans-Bold -fill "#F5ECD7" -pointsize 120',
    '-gravity Center',
    '-annotate +0-60 "Resizo"',

    // Gold underline
    '-fill "#B8860B" -stroke none',
    '-draw "roundrectangle 430,348 770,354 3,3"',

    // Subtitle
    '-font DejaVu-Sans -fill "#A89070" -pointsize 32',
    '-gravity Center',
    '-annotate +0+40 "Free Online Image Resizer"',

    // Tag badges row
    '-fill "#D4A346" -pointsize 20',
    '-gravity Center',
    '-annotate +0+120 "No Uploads  •  100% Private  •  Always Free"',

    // URL
    '-fill "#8C7558" -pointsize 22',
    '-gravity Center',
    '-annotate +0+220 "www.resizo.net"',

    `-quality 92 "${OUT}"`,
  ].join(' \\\n  ');

  console.log('Generating with ImageMagick...');
  execSync(cmd, { stdio: 'inherit' });
}

try {
  execSync('which convert', { stdio: 'ignore' });
  generateWithImageMagick();
} catch {
  console.error('ImageMagick not found. Install it: apt install imagemagick or brew install imagemagick');
  process.exit(1);
}

const stats = fs.statSync(OUT);
console.log(`✓ OG image saved → ${OUT}`);
console.log(`  ${(stats.size / 1024).toFixed(1)} KB  |  1200 × 630 px`);
