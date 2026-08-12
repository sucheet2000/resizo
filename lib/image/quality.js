/**
 * Quality Parsing and PNG Compression Mapping
 */
import { DEFAULT_QUALITY } from '@/lib/constants';

const INTEGER_PATTERN = /^[0-9]+$/;

/**
 * Strict 1-100 parser. null/undefined means "not supplied" so the caller can
 * apply its default; an empty or malformed string is a 400.
 */
export function parseQuality(raw, { min = 1, max = 100 } = {}) {
    if (raw === null || raw === undefined) {
        return { ok: false, absent: true, error: 'Quality is required.' };
    }

    let value;

    if (typeof raw === 'number') {
        if (!Number.isInteger(raw)) {
            return { ok: false, absent: false, error: `Quality must be an integer between ${min} and ${max}.` };
        }
        value = raw;
    } else if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!INTEGER_PATTERN.test(trimmed)) {
            return { ok: false, absent: false, error: `Quality must be an integer between ${min} and ${max}.` };
        }
        value = Number(trimmed);
    } else {
        return { ok: false, absent: false, error: `Quality must be an integer between ${min} and ${max}.` };
    }

    if (value < min || value > max) {
        return { ok: false, absent: false, error: `Quality must be an integer between ${min} and ${max}.` };
    }

    return { ok: true, value };
}

/**
 * Maps a 1-100 quality to sharp's zlib compressionLevel. Pinned to the shipped
 * mapping and clamped, because sharp throws outside 0-9.
 */
export function pngCompressionLevel(quality) {
    const value = typeof quality === 'number' && Number.isFinite(quality) ? quality : DEFAULT_QUALITY;
    const level = Math.round((100 - value) / 11);
    return Math.min(9, Math.max(0, level));
}

/**
 * Maps a 1-100 quality to a PNG palette size (2-256 colours).
 *
 * The `quality` option on sharp's PNG encoder only does anything when libvips
 * is built with libimagequant, which the shipped binaries are not — measured on
 * sharp 0.34.5 / libvips 8.17.3, q20 and q90 produce byte-identical output.
 * `colours` is the lever that actually works, so the slider drives that.
 */
export function pngPaletteColours(quality) {
    const value = typeof quality === 'number' && Number.isFinite(quality) ? quality : DEFAULT_QUALITY;
    const colours = Math.round(2 + (value / 100) * 254);
    return Math.min(256, Math.max(2, colours));
}
