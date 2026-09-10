/**
 * The downloaded file, judged by an implementation that is not the product.
 *
 * sharp is a devDependency and the repository's independent libvips reference
 * (CLAUDE.md > Gotchas). A result panel and the file it describes are exactly
 * the two things that can disagree, so no test here believes the panel: it
 * reopens the bytes and asks libvips what they are.
 */
const fs = require('node:fs');

const sharp = require('sharp');

/** Format, dimensions, alpha, density, EXIF presence, byte size — from the bytes. */
async function inspect(file) {
    const meta = await sharp(file).metadata();
    return {
        format: meta.format,
        width: meta.width,
        height: meta.height,
        hasAlpha: meta.hasAlpha === true,
        density: meta.density ?? null,
        hasExif: Boolean(meta.exif),
        hasIcc: Boolean(meta.icc),
        bytes: fs.statSync(file).size,
    };
}

/**
 * Mean absolute difference per channel between two images, each decoded by
 * sharp and resampled to the same size. Lossy codecs move pixels a little;
 * a decoder that produced the wrong picture moves them a lot.
 */
async function meanAbsoluteDifference(fileA, fileB, { width, height }) {
    const raw = (file) => sharp(file)
        .resize(width, height, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();
    const [a, b] = await Promise.all([raw(fileA), raw(fileB)]);
    if (a.length !== b.length) throw new Error(`buffers differ in length: ${a.length} vs ${b.length}`);
    let total = 0;
    for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
    return total / a.length;
}

/** The share of pixels whose alpha is below full opacity. */
async function transparentShare(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) transparent += 1;
    return transparent / (info.width * info.height);
}

module.exports = { inspect, meanAbsoluteDifference, transparentShare };
