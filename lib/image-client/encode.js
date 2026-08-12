/**
 * Encoding
 *
 * Pixels back out to a file, in the browser, through MozJPEG, libwebp and the
 * Rust PNG encoder that Squoosh shipped.
 *
 * ALWAYS SHRINK BEFORE ENCODING. MozJPEG measured 1.74-1.88 s on a full 12 MP
 * frame and 507 ms at 1920 px wide. Encoding is the most expensive stage in the
 * whole pipeline and its cost is linear in pixels, so any downscale the job
 * calls for belongs before this module, not after it.
 *
 * WHERE THIS DIFFERS FROM THE SERVER
 *
 *  - PNG quality does nothing. sharp shrinks a PNG by quantising it — the
 *    `palette: true` + `colours:` pair that lib/image/quality.js maps the 1-100
 *    slider onto, because libvips' own `quality` option is inert without
 *    libimagequant. @jsquash/png has no quantiser at all: it is a lossless
 *    encoder with no knobs. So a PNG encoded here is always full-colour and
 *    always lossless, and `pngPaletteColours` has nothing to drive. Callers are
 *    told so through `qualityApplied: false` rather than being allowed to
 *    believe a slider worked. See formatSupportsQuality().
 *
 *  - AVIF is not available. It is a /convert-only format on the server and
 *    there is no AVIF codec in this build, so asking for it throws a clear
 *    error instead of quietly producing a JPEG under an image/avif type — the
 *    same trap lib/image/pipeline.js calls out in its own switch.
 *
 *  - JPEG comes from MozJPEG, not libjpeg-turbo. At the same quality number
 *    MozJPEG produces a smaller file that is not byte-identical to sharp's.
 *    Progressive is on (the @jsquash default), as it is in sharp's.
 */
import { ALLOWED_OUTPUT_FORMATS, DEFAULT_QUALITY } from '@/lib/constants';
import { contentTypeFor } from '@/lib/image/filename';
import { loadJpegEncoder, loadPngEncoder, loadWebpEncoder } from '@/lib/image-client/codecs';

/**
 * Formats whose 1-100 quality actually changes the output here. PNG is absent
 * for the reason in the header: this build has no quantiser.
 */
export const QUALITY_FORMATS = ['jpeg', 'webp'];

/** Formats this build can write at all. Deliberately narrower than the server. */
export const BROWSER_OUTPUT_FORMATS = ALLOWED_OUTPUT_FORMATS;

export function normaliseFormat(format) {
    if (typeof format !== 'string') return null;
    const value = format.toLowerCase().trim();
    const bare = value.startsWith('image/') ? value.slice(6) : value;
    return bare === 'jpg' ? 'jpeg' : bare;
}

/** True when a quality number will change this format's output. */
export function formatSupportsQuality(format) {
    return QUALITY_FORMATS.includes(normaliseFormat(format));
}

function clampQuality(quality) {
    if (typeof quality !== 'number' || !Number.isFinite(quality)) return DEFAULT_QUALITY;
    return Math.min(100, Math.max(1, Math.round(quality)));
}

const ENCODERS = {
    jpeg: async (imageData, quality) => {
        const encode = await loadJpegEncoder();
        return encode(imageData, { quality });
    },
    webp: async (imageData, quality) => {
        const encode = await loadWebpEncoder();
        return encode(imageData, { quality });
    },
    png: async (imageData) => {
        const encode = await loadPngEncoder();
        return encode(imageData);
    },
};

/**
 * Encodes one ImageData.
 *
 * @param {ImageData} imageData
 * @param {{ format: string, quality?: number }} options
 * @returns {Promise<{ blob: Blob, bytes: number, format: string, type: string, quality: number, qualityApplied: boolean }>}
 */
export async function encodeImageData(imageData, { format, quality = DEFAULT_QUALITY } = {}) {
    if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        throw new Error('There are no pixels to encode.');
    }

    const resolved = normaliseFormat(format);

    if (resolved === 'avif') {
        throw new Error('AVIF is not supported in the browser build yet.');
    }

    if (!resolved || !BROWSER_OUTPUT_FORMATS.includes(resolved)) {
        throw new Error(`Unsupported output format: ${format}.`);
    }

    const resolvedQuality = clampQuality(quality);
    const bytes = await ENCODERS[resolved](imageData, resolvedQuality);

    if (!bytes || bytes.byteLength === 0) {
        throw new Error('The image could not be saved.');
    }

    const type = contentTypeFor(resolved);

    return {
        blob: new Blob([bytes], { type }),
        bytes: bytes.byteLength,
        format: resolved,
        type,
        quality: resolvedQuality,
        qualityApplied: formatSupportsQuality(resolved),
    };
}
