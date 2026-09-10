/**
 * The dimensions and the alpha channel a file DECLARES, from its own header.
 *
 * WHY THIS IS A MODULE OF ITS OWN. It used to live in requirements.js beside
 * the fitter's geometry and its validator, which was the right place for its
 * READER and the wrong place for its CALLERS. requirements.js statically
 * imports encode.js, resize.js, flatten.js and target-bytes.js, and those reach
 * capability.js and codecs.js — the whole pixel engine. So /image-metadata-viewer,
 * a page that decodes nothing and only ever reads bytes, downloaded a resampler
 * and an encoder to ask how wide a photograph is. Measured with the import-graph
 * helper the tests already own: `metadata-report.js -> requirements.js ->
 * encode.js`. One import, six modules.
 *
 * So the reader is a LEAF. It imports the magic-byte sniffer and nothing else,
 * and everything that wants a file's declared size — the fitter's validator,
 * the print sheet, the metadata viewer — reaches it without reaching the engine.
 * requirements.js re-exports it, so no existing caller changed.
 *
 * IT SHARES NO CODE WITH THE PIPELINE ON PURPOSE. This is the reading
 * validateOutput checks the pipeline's own output against, and a reading taken
 * with the pipeline's tools would agree with it by construction rather than by
 * evidence. Three small header parsers, written from the format specs.
 *
 * Never throws: a truncated or malformed file reads as null, because every
 * caller is asking about a file it has been given no promises about.
 */
import { sniffImageType } from '@/lib/image/magic-bytes';

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

function big16(bytes, at) {
    return (bytes[at] << 8) | bytes[at + 1];
}

function big32(bytes, at) {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function little24(bytes, at) {
    return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

function ascii(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]);
    return out;
}

/**
 * A JPEG's real dimensions come out of the frame header, and there is no
 * shortcut to it: APP and COM segments of arbitrary length sit in front of it,
 * so the marker chain has to be walked. Every SOFn is a frame header except
 * DHT (C4), JPG (C8) and DAC (CC), which share the C0-CF block and are not
 * frames — reading one of those as a frame is how a parser reports a 4-pixel
 * image.
 */
function jpegSize(bytes) {
    let at = 2;

    while (at + 3 < bytes.length) {
        if (bytes[at] !== 0xFF) {
            at += 1;
            continue;
        }

        const marker = bytes[at + 1];

        // Fill bytes, and the standalone markers that carry no length.
        if (marker === 0xFF) {
            at += 1;
            continue;
        }
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
            at += 2;
            continue;
        }
        // Start of scan: the entropy-coded data begins and there is no frame
        // header after it that this reader could reach.
        if (marker === 0xDA) return null;

        const length = big16(bytes, at + 2);
        if (length < 2) return null;

        const isFrame = marker >= 0xC0 && marker <= 0xCF
            && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;

        if (isFrame) {
            if (at + 9 > bytes.length) return null;
            return { width: big16(bytes, at + 7), height: big16(bytes, at + 5), hasAlpha: false };
        }

        at += 2 + length;
    }

    return null;
}

/**
 * IHDR is fixed at offset 8 and is always the first chunk. Colour types 4 and
 * 6 carry an alpha channel in every pixel; any other type can still be
 * transparent through a tRNS chunk further in — a palette with see-through
 * entries, or one colour declared transparent — so the chunks up to the first
 * IDAT are walked for one. This engine never writes a tRNS (@jsquash/png emits
 * full-colour RGBA), but the validator reads bytes, not the pipeline's
 * intentions, and a file handed in from elsewhere may carry one.
 */
function pngSize(bytes) {
    if (bytes.length < 26) return null;
    if (ascii(bytes, 12, 4) !== 'IHDR') return null;

    const colourType = bytes[25];

    return {
        width: big32(bytes, 16),
        height: big32(bytes, 20),
        hasAlpha: colourType === 4 || colourType === 6 || hasTrnsChunk(bytes),
    };
}

/** True when a tRNS chunk sits between IHDR and the first IDAT. */
function hasTrnsChunk(bytes) {
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = big32(bytes, offset);
        const type = ascii(bytes, offset + 4, 4);
        if (type === 'tRNS') return true;
        if (type === 'IDAT' || type === 'IEND') return false;
        offset += 12 + length;
    }
    return false;
}

/**
 * WebP is three formats behind one RIFF header and each states its size
 * differently.
 *
 *   VP8   lossy: a 3-byte frame tag, the 3-byte sync code 9D 01 2A, then two
 *         14-bit dimensions. No alpha.
 *   VP8L  lossless: a 0x2F signature then 28 bits of dimensions (each stored
 *         one less than it is) and an alpha_is_used bit.
 *   VP8X  extended: a flags byte whose 0x10 bit is ALPHA, then two 24-bit
 *         canvas dimensions, again stored one less than they are.
 *
 * An encode of an opaque picture here is a VP8, one carrying alpha is a VP8X,
 * and a lossless one is a VP8L — so all three are reachable and all three are
 * read.
 */
function webpSize(bytes) {
    if (bytes.length < 30) return null;
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;

    const chunk = ascii(bytes, 12, 4);
    const payload = 20;

    if (chunk === 'VP8 ') {
        if (bytes[payload + 3] !== 0x9D || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2A) return null;
        return {
            width: (bytes[payload + 6] | (bytes[payload + 7] << 8)) & 0x3FFF,
            height: (bytes[payload + 8] | (bytes[payload + 9] << 8)) & 0x3FFF,
            hasAlpha: false,
        };
    }

    if (chunk === 'VP8L') {
        if (bytes[payload] !== 0x2F) return null;
        const bits = (bytes[payload + 1]
            | (bytes[payload + 2] << 8)
            | (bytes[payload + 3] << 16)
            | (bytes[payload + 4] << 24)) >>> 0;

        return {
            width: (bits & 0x3FFF) + 1,
            height: ((bits >>> 14) & 0x3FFF) + 1,
            hasAlpha: ((bits >>> 28) & 1) === 1,
        };
    }

    if (chunk === 'VP8X') {
        return {
            width: little24(bytes, payload + 4) + 1,
            height: little24(bytes, payload + 7) + 1,
            hasAlpha: (bytes[payload] & 0x10) !== 0,
        };
    }

    return null;
}

/**
 * The dimensions and the alpha channel a file DECLARES, read from its own
 * header and nothing else.
 *
 * Shares no code with the decoder, the resampler or the encoder on purpose:
 * this is the reading validateOutput checks the pipeline against, and a reading
 * taken with the pipeline's own tools would agree with it by construction.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{ width: number, height: number, hasAlpha: boolean }|null}
 */
export function readImageSize(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length === 0) return null;

    const format = sniffImageType(bytes);

    try {
        if (format === 'jpeg') return jpegSize(bytes);
        if (format === 'png') return pngSize(bytes);
        if (format === 'webp') return webpSize(bytes);
    } catch {
        // A truncated or malformed file reads as "cannot be read", which is what
        // the report says. It is never a throw: the validator's whole job is to
        // report on a file it has been given no promises about.
        return null;
    }

    return null;
}
