#!/usr/bin/env node
/**
 * Generates public/favicon.ico — a 32×32 gold (#B8860B) favicon
 * with a white "R" lettermark.
 *
 * Uses ImageMagick (convert) as a fallback when the Sharp linux binary
 * is unavailable in the current environment.
 *
 * Usage: node scripts/generate-favicon.js
 */

const { execSync } = require('child_process');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'favicon.ico');

try {
  execSync(
    `convert -size 32x32 xc:"#B8860B" ` +
    `-fill "#F5ECD7" ` +
    `-font DejaVu-Sans-Bold ` +
    `-pointsize 18 ` +
    `-gravity Center ` +
    `-annotate 0 "R" ` +
    `"${OUT}"`,
    { stdio: 'inherit' }
  );
  console.log(`✓ favicon.ico written to ${OUT}`);
} catch (err) {
  console.error('Failed to generate favicon. Is ImageMagick installed?');
  console.error(err.message);
  process.exit(1);
}
