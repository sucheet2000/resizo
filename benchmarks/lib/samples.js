/**
 * The four benchmark inputs, drawn from scratch.
 *
 * A benchmark is only worth reading if someone else can re-run it, so the
 * inputs cannot be "four photos off my laptop". They are generated: a seeded
 * PRNG, shapes rasterised by sharp, no stock imagery, no third-party licence
 * and — because librsvg would pick a font from whatever machine it is running
 * on — no text anywhere. tests/lib/benchmarks/samples.test.js holds both
 * halves of that: the files are byte-identical on a rerun, and no draw
 * function may emit a <text> element or name a font.
 *
 * WHY FOUR, AND WHY THESE FOUR
 *
 * An encoder is not one number. JPEG is built for grain and falls apart on a
 * hard edge; PNG is the reverse; WebP sits between them and its lead over JPEG
 * depends entirely on which of those it is handed. A single input would
 * therefore let the report say something true about one picture and imply it
 * about all of them, so the set spans the four content types the tools are
 * actually pointed at:
 *
 *   photo         gradients, a sun, and grain built from thousands of small
 *                 seeded shapes. A SYNTHETIC PHOTOGRAPH-LIKE SCENE — never
 *                 call it a photograph; nobody took it.
 *   screenshot    window chrome, flat panels, thin rules, and rows of small
 *                 grey bars standing in for text.
 *   graphic       a logo-like mark: flat shapes, real transparency, curves for
 *                 anti-aliased edges.
 *   illustration  broad flat colour areas and very few edges.
 *
 * A fifth file is written beside them and is NOT one of the four: DEMO_SAMPLES
 * holds inputs that exist to be looked at rather than scored, and nothing in
 * the report is organised around them. The distinction is load-bearing —
 * scenario A loops over SAMPLES, so an entry added to the wrong list is four
 * extra encodes on every run.
 *
 * The committed files under benchmarks/samples/ are the reference. "Identical
 * on a rerun" is a promise about one machine: sharp bundles its own libvips and
 * librsvg, so a different sharp build may rasterise a curve one pixel
 * differently. That is exactly why the outputs are committed rather than built
 * on demand.
 */
const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

/** Where the committed copies live, and where the runner reads them from. */
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

/** Quality 95: high enough that the sample is the subject, not the artefacts. */
const PHOTO_QUALITY = 95;

/**
 * Mulberry32. Small, fast, and — the only property that matters here — the
 * same sequence for the same seed on every machine and every Node version,
 * which Math.random is not.
 */
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
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `
        + `viewBox="0 0 ${width} ${height}">${body}</svg>`,
    );
}

const n = (value) => value.toFixed(1);

const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/**
 * Sky gradient, a low sun, three ridge lines, water with broken highlights, and
 * a shingle foreground of several thousand pebbles — then a fine grain pass
 * over the whole frame. The grain is what makes this behave like a photograph
 * under an encoder: flat SVG output would compress like the illustration and
 * the report would be measuring the wrong thing.
 */
function photo(width, height) {
    const random = rng(20260909);
    const horizon = Math.round(height * 0.44);
    const shore = Math.round(height * 0.74);

    const parts = [
        '<defs>',
        '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#173254"/>',
        '<stop offset="0.38" stop-color="#5d8cb8"/>',
        '<stop offset="0.74" stop-color="#d9a877"/>',
        '<stop offset="1" stop-color="#f2d5ab"/>',
        '</linearGradient>',
        '<radialGradient id="glow">',
        '<stop offset="0" stop-color="#fff4d6"/>',
        '<stop offset="0.3" stop-color="#ffd68d" stop-opacity="0.7"/>',
        '<stop offset="1" stop-color="#ffbc63" stop-opacity="0"/>',
        '</radialGradient>',
        '<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#416a83"/>',
        '<stop offset="1" stop-color="#1f3644"/>',
        '</linearGradient>',
        '<linearGradient id="shingle" x1="0" y1="0" x2="0" y2="1">',
        '<stop offset="0" stop-color="#6b6055"/>',
        '<stop offset="1" stop-color="#3b342d"/>',
        '</linearGradient>',
        '</defs>',
        `<rect width="${width}" height="${horizon}" fill="url(#sky)"/>`,
    ];

    const sunX = Math.round(width * 0.68);
    const sunY = Math.round(horizon * 0.62);
    parts.push(`<circle cx="${sunX}" cy="${sunY}" r="${Math.round(height * 0.3)}" fill="url(#glow)"/>`);
    parts.push(`<circle cx="${sunX}" cy="${sunY}" r="${Math.round(height * 0.055)}" fill="#fff2cd"/>`);

    // Cloud banks: overlapping soft ellipses rather than a filter, so the
    // rasteriser has nothing version-dependent to do.
    for (let i = 0; i < 90; i += 1) {
        const cy = random() * horizon * 0.6;
        const cx = random() * width;
        const rx = 60 + random() * 240;
        const ry = 8 + random() * 26;
        const tint = 200 + random() * 45;
        parts.push(
            `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" `
            + `fill="${rgb(tint, tint - 12, tint - 30)}" fill-opacity="${(0.05 + random() * 0.22).toFixed(3)}"/>`,
        );
    }

    const ridges = [
        { drop: 0.16, shade: [86, 104, 118], steps: 22 },
        { drop: 0.1, shade: [58, 74, 86], steps: 17 },
        { drop: 0.05, shade: [37, 50, 60], steps: 13 },
    ];

    for (const ridge of ridges) {
        const points = [`0,${horizon}`];
        for (let i = 0; i <= ridge.steps; i += 1) {
            const x = (width / ridge.steps) * i;
            const y = horizon - height * ridge.drop * (0.35 + random() * 0.65);
            points.push(`${n(x)},${n(y)}`);
        }
        points.push(`${width},${horizon}`);
        parts.push(`<polygon points="${points.join(' ')}" fill="${rgb(...ridge.shade)}"/>`);
    }

    parts.push(`<rect x="0" y="${horizon}" width="${width}" height="${shore - horizon}" fill="url(#water)"/>`);

    for (let i = 0; i < 520; i += 1) {
        const y = horizon + random() * (shore - horizon);
        const spread = (y - horizon) / (shore - horizon);
        const w = 12 + random() * (70 + spread * 220);
        const x = random() * width;
        const near = Math.abs(x + w / 2 - sunX) < width * 0.18 ? 0.3 : 0;
        parts.push(
            `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(1 + spread * 2)}" `
            + `fill="#f0e2c6" fill-opacity="${(0.04 + near + random() * 0.2).toFixed(3)}"/>`,
        );
    }

    parts.push(`<rect x="0" y="${shore}" width="${width}" height="${height - shore}" fill="url(#shingle)"/>`);

    for (let i = 0; i < 3600; i += 1) {
        const depth = random();
        const y = shore + depth * (height - shore);
        const x = random() * width;
        const r = 2 + depth * depth * 16 * (0.4 + random());
        const grey = 78 + random() * 105;
        parts.push(
            `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r * (0.5 + random() * 0.3))}" `
            + `fill="${rgb(grey, grey - 7, grey - 18)}"/>`,
        );
    }

    // Sensor-like grain over everything. Low opacity, one pixel wide, and the
    // reason the JPEG of this sample carries real high-frequency content.
    for (let i = 0; i < 9000; i += 1) {
        const x = random() * width;
        const y = random() * height;
        const light = random() > 0.5;
        parts.push(
            `<rect x="${n(x)}" y="${n(y)}" width="1.4" height="1.4" `
            + `fill="${light ? '#ffffff' : '#000000'}" fill-opacity="${(0.03 + random() * 0.1).toFixed(3)}"/>`,
        );
    }

    return svg(width, height, parts.join(''));
}

/**
 * An application window: chrome, a sidebar, cards, hairline rules and rows of
 * small grey bars where the text would be. Hard edges and large flat areas —
 * the case JPEG handles worst and PNG handles best.
 */
function screenshot(width, height) {
    const random = rng(4041972);
    const parts = [`<rect width="${width}" height="${height}" fill="#e7eaef"/>`];

    const frameX = 48;
    const frameY = 40;
    const frameW = width - frameX * 2;
    const frameH = height - frameY * 2;

    parts.push(`<rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" rx="10" fill="#ffffff"/>`);
    parts.push(`<rect x="${frameX}" y="${frameY}" width="${frameW}" height="44" rx="10" fill="#f3f4f7"/>`);
    parts.push(`<rect x="${frameX}" y="${frameY + 34}" width="${frameW}" height="10" fill="#f3f4f7"/>`);
    parts.push(`<rect x="${frameX}" y="${frameY + 43}" width="${frameW}" height="1" fill="#d6dae1"/>`);

    for (let i = 0; i < 3; i += 1) {
        const fill = ['#e8695f', '#e2b04a', '#57b25a'][i];
        parts.push(`<circle cx="${frameX + 24 + i * 20}" cy="${frameY + 22}" r="6" fill="${fill}"/>`);
    }

    parts.push(`<rect x="${frameX + 110}" y="${frameY + 12}" width="${frameW - 200}" height="20" rx="10" fill="#e4e7ec"/>`);
    parts.push(`<rect x="${frameX + 126}" y="${frameY + 20}" width="${Math.round(frameW * 0.22)}" height="5" rx="2" fill="#a8b0bb"/>`);

    const sidebarW = 210;
    const bodyY = frameY + 44;
    const bodyH = frameH - 44;
    parts.push(`<rect x="${frameX}" y="${bodyY}" width="${sidebarW}" height="${bodyH}" fill="#fafbfc"/>`);
    parts.push(`<rect x="${frameX + sidebarW}" y="${bodyY}" width="1" height="${bodyH}" fill="#e2e6eb"/>`);

    for (let i = 0; i < 11; i += 1) {
        const y = bodyY + 28 + i * 38;
        if (i === 2) parts.push(`<rect x="${frameX + 12}" y="${y - 10}" width="${sidebarW - 24}" height="30" rx="6" fill="#e9eef7"/>`);
        parts.push(`<rect x="${frameX + 24}" y="${y}" width="12" height="12" rx="3" fill="${i === 2 ? '#4a6cf7' : '#b7bec9'}"/>`);
        parts.push(
            `<rect x="${frameX + 46}" y="${y + 3}" width="${Math.round(58 + random() * 92)}" height="7" rx="3" `
            + `fill="${i === 2 ? '#3d4a63' : '#9aa3b0'}"/>`,
        );
    }

    const contentX = frameX + sidebarW + 1;
    const contentW = frameW - sidebarW - 1;

    parts.push(`<rect x="${contentX + 32}" y="${bodyY + 30}" width="240" height="13" rx="4" fill="#2c3444"/>`);
    parts.push(`<rect x="${contentX + 32}" y="${bodyY + 56}" width="360" height="7" rx="3" fill="#aab1bd"/>`);

    for (let card = 0; card < 3; card += 1) {
        const cardX = contentX + 32 + card * ((contentW - 96) / 3 + 16);
        const cardW = (contentW - 96) / 3;
        parts.push(`<rect x="${n(cardX)}" y="${bodyY + 88}" width="${n(cardW)}" height="104" rx="8" fill="#ffffff"/>`);
        parts.push(`<rect x="${n(cardX)}" y="${bodyY + 88}" width="${n(cardW)}" height="104" rx="8" fill="none" stroke="#e2e6eb" stroke-width="1"/>`);
        parts.push(`<rect x="${n(cardX + 18)}" y="${bodyY + 110}" width="86" height="7" rx="3" fill="#9aa3b0"/>`);
        parts.push(`<rect x="${n(cardX + 18)}" y="${bodyY + 132}" width="${n(60 + random() * 50)}" height="22" rx="4" fill="#2c3444"/>`);
        parts.push(`<rect x="${n(cardX + 18)}" y="${bodyY + 166}" width="${n(40 + random() * 60)}" height="6" rx="3" fill="#4a6cf7" fill-opacity="0.55"/>`);
    }

    const tableY = bodyY + 224;
    parts.push(`<rect x="${contentX + 32}" y="${tableY}" width="${contentW - 64}" height="30" fill="#f5f7fa"/>`);

    const columns = [0.06, 0.34, 0.56, 0.74, 0.88];
    for (const column of columns) {
        parts.push(
            `<rect x="${n(contentX + 32 + (contentW - 64) * column)}" y="${tableY + 12}" `
            + `width="${Math.round(44 + random() * 34)}" height="6" rx="3" fill="#8b939f"/>`,
        );
    }

    // The "text": short bars of varying width, on a hairline grid.
    const rows = Math.floor((frameY + frameH - 30 - tableY - 30) / 34);
    for (let row = 0; row < rows; row += 1) {
        const y = tableY + 30 + row * 34;
        parts.push(`<rect x="${contentX + 32}" y="${y + 33}" width="${contentW - 64}" height="1" fill="#eceff3"/>`);
        for (const column of columns) {
            const barW = Math.round(38 + random() * 118 * (column === 0.06 ? 1 : 0.55));
            const shade = random() > 0.7 ? '#5b6472' : '#a6adb8';
            parts.push(
                `<rect x="${n(contentX + 32 + (contentW - 64) * column)}" y="${y + 12}" `
                + `width="${barW}" height="7" rx="3" fill="${shade}"/>`,
            );
        }
    }

    return svg(width, height, parts.join(''));
}

/**
 * A logo-like mark on a transparent field: flat fills, one fully opaque shape
 * so the alpha channel spans 0 to 255, and curves everywhere so the edges are
 * anti-aliased. This is the sample that shows what a JPEG conversion costs —
 * there is nothing behind these shapes to flatten onto.
 */
function graphic(width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);

    const parts = [];

    parts.push(
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(unit * 0.36)}" fill="none" `
        + `stroke="#1f6feb" stroke-width="${n(unit * 0.055)}"/>`,
    );

    parts.push(
        `<circle cx="${n(cx - unit * 0.12)}" cy="${n(cy - unit * 0.08)}" r="${n(unit * 0.2)}" `
        + 'fill="#f05a3c" fill-opacity="0.85"/>',
    );
    parts.push(
        `<circle cx="${n(cx + unit * 0.12)}" cy="${n(cy - unit * 0.08)}" r="${n(unit * 0.2)}" `
        + 'fill="#ffc247" fill-opacity="0.85"/>',
    );
    parts.push(
        `<circle cx="${n(cx)}" cy="${n(cy + unit * 0.13)}" r="${n(unit * 0.2)}" `
        + 'fill="#2fb673" fill-opacity="0.85"/>',
    );

    // Fully opaque, so alpha reaches 255 and a flatten has something solid to
    // change. Everything above is translucent on purpose.
    parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(unit * 0.085)}" fill="#12161c"/>`);

    parts.push(
        `<path d="M ${n(cx - unit * 0.3)} ${n(cy + unit * 0.3)} `
        + `Q ${n(cx)} ${n(cy + unit * 0.46)} ${n(cx + unit * 0.3)} ${n(cy + unit * 0.3)}" `
        + `fill="none" stroke="#12161c" stroke-width="${n(unit * 0.022)}" stroke-linecap="round"/>`,
    );

    for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2 + Math.PI / 16;
        const r = unit * 0.44;
        parts.push(
            `<circle cx="${n(cx + Math.cos(angle) * r)}" cy="${n(cy + Math.sin(angle) * r)}" `
            + `r="${n(unit * 0.021)}" fill="#1f6feb" fill-opacity="${(0.35 + i * 0.08).toFixed(2)}"/>`,
        );
    }

    const corner = unit * 0.06;
    parts.push(
        `<rect x="${n(cx - unit * 0.46)}" y="${n(cy - unit * 0.46)}" width="${n(unit * 0.92)}" `
        + `height="${n(unit * 0.92)}" rx="${n(corner)}" fill="none" stroke="#1f6feb" `
        + `stroke-width="${n(unit * 0.012)}" stroke-opacity="0.4"/>`,
    );

    return svg(width, height, parts.join(''));
}

/**
 * Broad flat colour, hard boundaries, no gradient and no grain. The easiest
 * picture in the set for a lossless encoder and the one where a JPEG's ringing
 * around an edge is most visible.
 */
function illustration(width, height) {
    const horizon = Math.round(height * 0.58);
    const parts = [`<rect width="${width}" height="${height}" fill="#f4ead8"/>`];

    parts.push(`<rect width="${width}" height="${Math.round(height * 0.3)}" fill="#e8dcc4"/>`);
    parts.push(`<circle cx="${Math.round(width * 0.24)}" cy="${Math.round(height * 0.22)}" r="${Math.round(height * 0.12)}" fill="#f0b24a"/>`);

    const bands = ['#dcd0b6', '#cfc1a4'];
    for (let i = 0; i < 2; i += 1) {
        parts.push(
            `<rect x="0" y="${Math.round(height * (0.3 + i * 0.06))}" width="${width}" `
            + `height="${Math.round(height * 0.06)}" fill="${bands[i]}"/>`,
        );
    }

    parts.push(
        `<polygon points="0,${horizon} ${Math.round(width * 0.22)},${Math.round(height * 0.28)} `
        + `${Math.round(width * 0.46)},${horizon}" fill="#5d7f74"/>`,
    );
    parts.push(
        `<polygon points="${Math.round(width * 0.3)},${horizon} ${Math.round(width * 0.58)},${Math.round(height * 0.2)} `
        + `${Math.round(width * 0.86)},${horizon}" fill="#41625a"/>`,
    );
    parts.push(
        `<polygon points="${Math.round(width * 0.58)},${Math.round(height * 0.2)} `
        + `${Math.round(width * 0.66)},${Math.round(height * 0.29)} ${Math.round(width * 0.5)},${Math.round(height * 0.29)}" fill="#f7f3ea"/>`,
    );
    parts.push(
        `<polygon points="${Math.round(width * 0.68)},${horizon} ${Math.round(width * 0.88)},${Math.round(height * 0.34)} `
        + `${width},${horizon}" fill="#6d8b7c"/>`,
    );

    parts.push(`<rect x="0" y="${horizon}" width="${width}" height="${height - horizon}" fill="#8fae90"/>`);
    parts.push(`<rect x="0" y="${Math.round(height * 0.76)}" width="${width}" height="${height}" fill="#6f8f74"/>`);

    for (let i = 0; i < 5; i += 1) {
        const x = Math.round(width * (0.1 + i * 0.19));
        const y = Math.round(height * (0.66 + (i % 2) * 0.1));
        const trunk = Math.round(height * 0.09);
        parts.push(`<rect x="${x}" y="${y}" width="${Math.round(width * 0.014)}" height="${trunk}" fill="#4a3b30"/>`);
        parts.push(
            `<circle cx="${Math.round(x + width * 0.007)}" cy="${y - Math.round(height * 0.02)}" `
            + `r="${Math.round(height * 0.055)}" fill="#3f6b4b"/>`,
        );
    }

    parts.push(
        `<path d="M 0 ${Math.round(height * 0.86)} L ${Math.round(width * 0.4)} ${Math.round(height * 0.82)} `
        + `L ${width} ${Math.round(height * 0.9)} L ${width} ${height} L 0 ${height} Z" fill="#59795f"/>`,
    );

    return svg(width, height, parts.join(''));
}

/**
 * Two opaque shapes on a fully transparent field, at the size a page can show
 * without downscaling: 480×320.
 *
 * This is not a fifth content type and it is deliberately NOT in the scored
 * set. It exists to be LOOKED at — the before half of the figure on
 * /png-to-jpg, where the whole question is what happens to the see-through
 * part of a PNG when JPEG, which has no alpha channel, has to write it down.
 * The graphic sample would have answered that too, but at 800×800 with eight
 * translucent shapes it answers several other questions at the same time; this
 * one is two flat colours and a corner a reader can point at.
 *
 * Every shape is fully opaque and none of them reaches a corner, so the alpha
 * channel is a clean 0 or 255 and the four corners are the transparent case in
 * its simplest form. The curves are the anti-aliasing: a rounded rectangle and
 * a disc give edge pixels at every alpha in between, which is the part a
 * flatten actually has to blend.
 *
 * Fixed geometry, no PRNG: there is nothing random to seed, and a constant is
 * more obviously reproducible than a seed is.
 */
function transparentGraphic(width, height) {
    const px = (fraction, of) => Math.round(fraction * of);

    const parts = [];

    parts.push(
        `<rect x="${px(0.1167, width)}" y="${px(0.1375, height)}" width="${px(0.6333, width)}" `
        + `height="${px(0.725, height)}" rx="${px(0.1, height)}" fill="#1f6feb"/>`,
    );

    parts.push(
        `<circle cx="${px(0.775, width)}" cy="${px(0.325, height)}" r="${px(0.2, height)}" fill="#f05a3c"/>`,
    );

    return svg(width, height, parts.join(''));
}

/**
 * The four inputs every comparison in the report is organised around. Adding a
 * fifth here multiplies scenario A by another four cases, which is why the
 * demo-only input below is a separate list rather than an entry in this one.
 */
const SAMPLES = [
    {
        file: 'photo-1600x1067.jpg',
        width: 1600,
        height: 1067,
        format: 'jpeg',
        description: 'A synthetic photograph-like scene: sky gradient, a low sun, ridge lines, '
            + 'broken water highlights and a shingle foreground, with fine grain over the whole frame.',
        draw: photo,
    },
    {
        file: 'screenshot-1440x900.png',
        width: 1440,
        height: 900,
        format: 'png',
        description: 'An application window: chrome, sidebar, cards, hairline rules and rows of '
            + 'small grey bars standing in for text. Hard edges and large flat areas.',
        draw: screenshot,
    },
    {
        file: 'graphic-800x800.png',
        width: 800,
        height: 800,
        format: 'png',
        description: 'A logo-like mark on a fully transparent field: flat fills, one opaque shape, '
            + 'curved anti-aliased edges.',
        draw: graphic,
    },
    {
        file: 'illustration-1200x900.png',
        width: 1200,
        height: 900,
        format: 'png',
        description: 'A flat-colour illustration: broad areas, hard boundaries, no gradients and no grain.',
        draw: illustration,
    },
];

/**
 * Inputs that exist to be shown rather than scored.
 *
 * They are written alongside the four and driven through the tools like any
 * other file, but no comparison table is organised around them, so they stay
 * out of SAMPLES: scenario A loops over that list and would turn one extra
 * entry into four more encodes on every run, for a figure that needs one.
 */
const DEMO_SAMPLES = [
    {
        file: 'transparent-480x320.png',
        width: 480,
        height: 320,
        format: 'png',
        description: 'Two opaque flat-coloured shapes — a rounded rectangle and a disc — on a fully '
            + 'transparent field, with anti-aliased edges and all four corners see-through.',
        draw: transparentGraphic,
    },
];

/** Everything written to samples/, scored or not. */
const ALL_SAMPLES = [...SAMPLES, ...DEMO_SAMPLES];

/**
 * Draws every sample into `dir` and returns what it wrote.
 *
 * Encoder settings are pinned rather than left to defaults, because a default
 * that changes under a dependency bump would silently change the inputs the
 * whole report is built on.
 */
async function writeSamples(dir) {
    fs.mkdirSync(dir, { recursive: true });

    const written = [];

    for (const sample of ALL_SAMPLES) {
        const file = path.join(dir, sample.file);
        const pipeline = sharp(sample.draw(sample.width, sample.height), { density: 72 });

        if (sample.format === 'jpeg') {
            await pipeline
                .jpeg({ quality: PHOTO_QUALITY, chromaSubsampling: '4:2:0', mozjpeg: false })
                .toFile(file);
        } else {
            await pipeline.png({ compressionLevel: 9, palette: false }).toFile(file);
        }

        written.push({
            file: sample.file,
            path: file,
            bytes: fs.statSync(file).size,
            width: sample.width,
            height: sample.height,
            format: sample.format,
        });
    }

    return written;
}

module.exports = {
    ALL_SAMPLES,
    DEMO_SAMPLES,
    rng,
    SAMPLES,
    SAMPLES_DIR,
    writeSamples,
};
