/**
 * HEIC Dimension Probe
 *
 * heic-convert decodes with libheif (WASM) and encodes with jpeg-js, both
 * synchronous and both on the event loop, and neither imposes a pixel cap. A
 * HEIC compresses ~2x better than JPEG, so a legal 20MB upload can be ~100MP —
 * a ~400MB synchronous allocation that stalls every co-resident request.
 *
 * This reads the image's declared dimensions straight from the ISOBMFF
 * container — the `ispe` (image spatial extent) box inside `meta` — WITHOUT
 * decoding a single pixel, so an oversized file is rejected before libheif ever
 * runs. It is a cheap read of a few header bytes.
 *
 * Returns { width, height, pixels } for the largest declared extent, or null
 * when the container cannot be parsed (in which case the caller falls back to
 * its wall-clock guard and libheif's own errors).
 */

// A sane upper bound on a single dimension; anything past it is a mis-parse,
// not a real image, so it is ignored rather than trusted.
const MAX_PLAUSIBLE_DIMENSION = 100_000;
const MAX_ISPE_MATCHES = 64;

function scanIspe(buffer, start, end) {
    const limit = Math.min(end, buffer.length);
    let best = null;
    let idx = start;
    let matches = 0;

    while (matches < MAX_ISPE_MATCHES) {
        const at = buffer.indexOf('ispe', idx, 'latin1');
        if (at < 0 || at + 16 > limit) break;

        // Box content after the 4-char type: version+flags (4), width (4),
        // height (4).
        const width = buffer.readUInt32BE(at + 8);
        const height = buffer.readUInt32BE(at + 12);
        idx = at + 4;
        matches += 1;

        if (
            width > 0 && height > 0
            && width < MAX_PLAUSIBLE_DIMENSION && height < MAX_PLAUSIBLE_DIMENSION
        ) {
            const pixels = width * height;
            if (!best || pixels > best.pixels) best = { width, height, pixels };
        }
    }

    return best;
}

export function probeHeicPixels(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;

    let offset = 0;

    while (offset + 8 <= buffer.length) {
        let size = buffer.readUInt32BE(offset);
        const type = buffer.toString('latin1', offset + 4, offset + 8);
        let headerSize = 8;

        if (size === 1) {
            if (offset + 16 > buffer.length) break;
            const high = buffer.readUInt32BE(offset + 8);
            const low = buffer.readUInt32BE(offset + 12);
            size = high * 2 ** 32 + low;
            headerSize = 16;
        } else if (size === 0) {
            size = buffer.length - offset;
        }

        if (size < headerSize) break;

        if (type === 'meta') {
            // `meta` is a FullBox: 4 bytes of version+flags precede its children.
            const payloadStart = offset + headerSize + 4;
            const payloadEnd = offset + size;
            return scanIspe(buffer, payloadStart, payloadEnd);
        }

        offset += size;
    }

    return null;
}
