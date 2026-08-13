/**
 * Image Magic-Byte Sniffing
 *
 * The single strict signature check shared by every upload path. Container
 * formats are checked in full: a WebP needs both the RIFF header and the WEBP
 * form type, a GIF needs all six signature bytes, and a HEIC needs an ftyp box
 * whose brand is actually a HEIF brand (otherwise every MP4 passes).
 */

/**
 * AVIF shares the ISOBMFF ftyp box with HEIC and MP4, so it is separated the
 * same way: by major brand, and only by the two brands the AV1 image format
 * registers. This set is consulted BEFORE the HEIC one because an AVIF file
 * usually lists 'mif1' among its compatible brands while its major brand stays
 * 'avif' — reading the major brand only, and reading AVIF first, keeps the two
 * apart.
 */
const AVIF_BRANDS = new Set(['avif', 'avis']);

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

function toBytes(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) {
        return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (Array.isArray(input)) return Uint8Array.from(input);
    return null;
}

function ascii(bytes, offset, length) {
    let out = '';
    for (let i = offset; i < offset + length; i += 1) {
        out += String.fromCharCode(bytes[i]);
    }
    return out;
}

/**
 * Returns 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | null.
 * Accepts a Buffer, Uint8Array, ArrayBuffer or byte array; never throws on
 * short, empty or missing input.
 */
export function sniffImageType(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length === 0) return null;

    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'jpeg';
    }

    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'png';
    }

    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
        return 'webp';
    }

    if (bytes.length >= 6) {
        const signature = ascii(bytes, 0, 6);
        if (signature === 'GIF87a' || signature === 'GIF89a') return 'gif';
    }

    if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
        const brand = ascii(bytes, 8, 4).toLowerCase();
        if (AVIF_BRANDS.has(brand)) return 'avif';
        if (HEIC_BRANDS.has(brand)) return 'heic';
    }

    return null;
}

/**
 * '%PDF-'. The five bytes every PDF opens with, and the whole signature there
 * is — the version digits after the dash are not part of the check because a
 * file claiming 1.3 and a file claiming 2.0 are both PDFs.
 */
const PDF_SIGNATURE = '%PDF-';

/**
 * True when these bytes start a PDF.
 *
 * AT OFFSET ZERO, with no search. Readers tolerate junk before the header and
 * that tolerance is exactly how a polyglot gets in — the same reason the WebP
 * and HEIC checks above read both of their fixed offsets instead of scanning
 * for a four-character code. A file that needs a search to look like a PDF is
 * refused here and told so plainly.
 *
 * Separate from sniffImageType because a PDF is not an image type and must
 * never be returned by a function whose answer feeds an image codec.
 */
export function isPdfSignature(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length < PDF_SIGNATURE.length) return false;
    return ascii(bytes, 0, PDF_SIGNATURE.length) === PDF_SIGNATURE;
}

/**
 * True when the sniffed type is in the caller's allowlist. Each route declares
 * its own accepted set instead of hand-rolling a signature check.
 */
export function isAcceptedType(input, allowedTypes) {
    if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return false;
    const detected = sniffImageType(input);
    return detected !== null && allowedTypes.includes(detected);
}
