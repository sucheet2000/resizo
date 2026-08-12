/**
 * Quality Parsing
 *
 * This file also held two sharp-only mappings — a 1-100 quality onto zlib's
 * compressionLevel, and onto a PNG palette size. Both existed because libvips
 * shipped without libimagequant and `png({ quality })` was inert there, so
 * `colours` was the only lever that moved a PNG's size. There is no libvips
 * here: @jsquash/png is lossless with no quantiser at all, which is why
 * /compress disables its slider for PNG and says so out loud. The mappings went
 * with the encoder they were written for.
 */
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
