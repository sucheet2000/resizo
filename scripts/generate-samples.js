#!/usr/bin/env node
/**
 * Sample Image Generator for Resizo
 *
 * Writes the two-or-three bundled "try one of these" images the resize tool
 * offers to a visitor who does not want to hand a personal photo to a site
 * they have not used before (DESIGN.md > Layout).
 *
 * They are generated rather than sourced so the repo carries no third-party
 * photograph and no licence question: each one is a deterministic composition
 * of shapes rasterised by sharp, with enough fine detail that a downscale is
 * actually visible in the result preview. Three aspect ratios, because the
 * first thing a resize tool has to demonstrate is that it respects one.
 *
 * NOT EVERY FILE IN public/samples/ COMES FROM HERE. `metadata-sample.jpg` is
 * written by `scripts/generate-metadata-fixtures.js` instead, because it is a
 * byte-for-byte copy of `tests/fixtures/metadata/gps-greenwich.jpg` and has to
 * stay one: the Image Metadata Viewer's "Try the sample photo" button and the
 * tests that assert what that photo contains must be looking at the same
 * bytes. Its picture is the same kind of thing as these — flat shapes, no
 * photograph — and the coordinates inside it are the Royal Observatory
 * Greenwich, a public landmark. `tests/fixtures/metadata/README.md` carries the
 * provenance in full.
 *
 * Usage: node scripts/generate-samples.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'samples');

const QUALITY = 78;

/** Mulberry32 — a tiny seeded PRNG, so a rerun produces byte-identical files. */
function rng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svg(width, height, body) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  );
}

/** Horizon, water, sun, shingle. Wide, and the shingle is the fine detail. */
function landscape(width, height) {
  const random = rng(20260811);
  const horizon = Math.round(height * 0.46);
  const parts = [`<rect width="${width}" height="${height}" fill="#cdd8de"/>`];

  for (let i = 0; i < 26; i += 1) {
    const y = Math.round((horizon / 26) * i);
    const shade = 200 - i * 3;
    parts.push(
      `<rect x="0" y="${y}" width="${width}" height="${Math.ceil(horizon / 26) + 1}" fill="rgb(${shade - 20},${shade - 6},${shade + 6})"/>`,
    );
  }

  parts.push(
    `<circle cx="${Math.round(width * 0.72)}" cy="${Math.round(horizon * 0.42)}" r="${Math.round(height * 0.11)}" fill="#f0c98a"/>`,
  );
  parts.push(`<rect x="0" y="${horizon}" width="${width}" height="${height - horizon}" fill="#3c5a68"/>`);

  for (let i = 0; i < 220; i += 1) {
    const y = horizon + random() * (height - horizon) * 0.72;
    const w = 20 + random() * 190;
    const x = random() * width;
    const alpha = (0.05 + random() * 0.18).toFixed(3);
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="2" fill="#e8f0f2" opacity="${alpha}"/>`,
    );
  }

  parts.push(
    `<rect x="0" y="${Math.round(height * 0.82)}" width="${width}" height="${height}" fill="#5c5147"/>`,
  );

  for (let i = 0; i < 900; i += 1) {
    const y = height * 0.82 + random() * height * 0.18;
    const x = random() * width;
    const r = 2 + random() * 9;
    const grey = Math.round(96 + random() * 96);
    parts.push(
      `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.66).toFixed(1)}" fill="rgb(${grey},${grey - 6},${grey - 16})"/>`,
    );
  }

  return svg(width, height, parts.join(''));
}

/** A tall facade: columns of windows, half of them lit. Vertical, high-contrast. */
function portrait(width, height) {
  const random = rng(70414);
  const parts = [`<rect width="${width}" height="${height}" fill="#2b2f36"/>`];

  const cols = 9;
  const rows = 16;
  const gapX = width / cols;
  const gapY = height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * gapX + gapX * 0.18;
      const y = row * gapY + gapY * 0.18;
      const w = gapX * 0.64;
      const h = gapY * 0.58;
      const lit = random() > 0.52;
      const fill = lit ? `rgb(${230 - Math.round(random() * 40)},${196 - Math.round(random() * 50)},${132})` : '#1b1f25';
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`,
      );
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${(y + h).toFixed(1)}" width="${w.toFixed(1)}" height="3" fill="#12151a"/>`,
      );
    }
  }

  for (let col = 1; col < cols; col += 1) {
    parts.push(`<rect x="${(col * gapX).toFixed(1)}" y="0" width="2" height="${height}" fill="#171b21"/>`);
  }

  parts.push(`<rect x="0" y="${Math.round(height * 0.93)}" width="${width}" height="${height}" fill="#14171c"/>`);

  return svg(width, height, parts.join(''));
}

/** Concentric rings and radial ticks on a plain ground — edges everywhere. */
function square(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const parts = [`<rect width="${width}" height="${height}" fill="#f2ede6"/>`];

  for (let i = 22; i > 0; i -= 1) {
    const r = (Math.min(width, height) * 0.46 * i) / 22;
    const shade = i % 2 === 0 ? '#c2453a' : '#f7f3ee';
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${shade}"/>`);
  }

  for (let i = 0; i < 144; i += 1) {
    const angle = (i / 144) * Math.PI * 2;
    const inner = Math.min(width, height) * 0.47;
    const outer = Math.min(width, height) * (i % 12 === 0 ? 0.5 : 0.485);
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * outer;
    const y2 = cy + Math.sin(angle) * outer;
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#2f2a26" stroke-width="${i % 12 === 0 ? 5 : 2}"/>`,
    );
  }

  parts.push(`<circle cx="${cx}" cy="${cy}" r="${(Math.min(width, height) * 0.06).toFixed(1)}" fill="#2f2a26"/>`);

  return svg(width, height, parts.join(''));
}

/**
 * The logo mark /favicon-generator offers as "Try the sample logo".
 *
 * A PNG AND NOT A JPEG, and that is the whole reason this one is drawn
 * differently from the three above. The tool's default background is
 * Transparent, so the sample has to be able to carry an alpha channel: handed
 * a JPEG, the button would demonstrate the one input shape that makes the
 * default setting invisible.
 *
 * FLAT SHAPES ON A CLEAR GROUND, because that is what somebody brings to a
 * favicon generator — a brand mark, not a photograph. Three colours a small
 * downscale keeps apart, a plate at 60% of the short edge so a square crop of
 * this 640×400 keeps the whole mark with clear corners, and the disc and wedge
 * off-centre in opposite directions so a flipped or mis-read output looks
 * wrong rather than merely measuring wrong.
 *
 * PROVENANCE. Nothing here is sourced: it is shapes rasterised by sharp, with
 * no photograph, no third-party logo and no licence question — the same rule
 * the three samples above follow. It is the same drawing as `logoMark` in
 * tests/e2e/fixtures/files.js, and the two are deliberately separate copies:
 * this is the COMMITTED file the page fetches, whose bytes must not move
 * between runs, and that one is a throwaway written under os.tmpdir(). Each
 * file says so at its own end.
 */
function logoMark(width, height) {
  const short = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;

  const plate = short * 0.6;
  const radius = plate * 0.18;
  const disc = short * 0.13;
  const wedge = short * 0.17;

  const n = (value) => Number(value.toFixed(2));

  return svg(width, height, [
    `<rect x="${n(cx - plate / 2)}" y="${n(cy - plate / 2)}" width="${n(plate)}" height="${n(plate)}" rx="${n(radius)}" fill="#1f3a93"/>`,
    `<circle cx="${n(cx - plate * 0.16)}" cy="${n(cy - plate * 0.16)}" r="${n(disc)}" fill="#f0b429"/>`,
    `<path d="M ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30)} L ${n(cx + plate * 0.30 - wedge)} ${n(cy + plate * 0.30)} L ${n(cx + plate * 0.30)} ${n(cy + plate * 0.30 - wedge)} Z" fill="#c8283c"/>`,
  ].join(''));
}

const SAMPLES = [
  { file: 'landscape-1600x1067.jpg', width: 1600, height: 1067, draw: landscape },
  { file: 'portrait-1080x1440.jpg', width: 1080, height: 1440, draw: portrait },
  { file: 'square-1200x1200.jpg', width: 1200, height: 1200, draw: square },
  {
    file: 'logo-mark-640x400.png', width: 640, height: 400, draw: logoMark, format: 'png',
  },
];

/**
 * One encoder per sample. PNG is lossless and takes no quality, so a sample
 * that has to keep an alpha channel is written with `compressionLevel` alone —
 * the same settings tests/e2e/fixtures/files.js writes its transparent
 * fixtures with, so the two copies of the mark differ in nothing but where
 * they land.
 */
function encode(pipeline, format) {
  return format === 'png'
    ? pipeline.png({ compressionLevel: 9 })
    : pipeline.jpeg({ quality: QUALITY, chromaSubsampling: '4:2:0', mozjpeg: false });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const sample of SAMPLES) {
    const source = sample.draw(sample.width, sample.height);
    const out = path.join(OUT_DIR, sample.file);

    await encode(sharp(source), sample.format).toFile(out);

    const { size } = fs.statSync(out);
    process.stdout.write(`${sample.file}  ${sample.width}x${sample.height}  ${(size / 1024).toFixed(1)} KB\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
