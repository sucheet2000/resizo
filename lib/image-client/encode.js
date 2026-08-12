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
 *  - AVIF is not available, and is no longer offered anywhere: it has left
 *    CONVERT_INPUT_FORMATS and CONVERT_OUTPUT_FORMATS, which were the last two
 *    lists carrying it. There is no AVIF codec in this build, so asking for one
 *    anyway throws a clear error instead of quietly producing a JPEG under an
 *    image/avif type — the same trap lib/image/pipeline.js calls out in its own
 *    switch.
 *
 *  - JPEG comes from MozJPEG, not libjpeg-turbo. At the same quality number
 *    MozJPEG produces a smaller file that is not byte-identical to sharp's.
 *    Progressive is on (the @jsquash default), as it is in sharp's.
 *
 *  - WebP can be asked for a SIZE instead of a quality. libwebp's own rate
 *    controller is exposed as `target_size`, and nothing on the server had an
 *    equivalent. See `targetBytes` below and lib/image-client/compress-target.js
 *    for the measurements behind it.
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

/**
 * Entropy-analysis passes to allow libwebp when a target size is set.
 *
 * @jsquash defaults `pass` to 1, and at 1 the rate controller barely engages: a
 * 1600x1200 frame asked for 20 KB measured 435 KB, twenty-one times over. cwebp
 * itself substitutes 6 whenever `-size` is given and that is what fixes it —
 * the same case lands at 17.3 KB. 10 passes measured identical output to 6 and
 * cost more time, so 6 it is.
 */
export const WEBP_TARGET_PASSES = 6;

function clampQuality(quality) {
    if (typeof quality !== 'number' || !Number.isFinite(quality)) return DEFAULT_QUALITY;
    return Math.min(100, Math.max(1, Math.round(quality)));
}

function positiveBytes(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

const ENCODERS = {
    jpeg: async (imageData, quality) => {
        const encode = await loadJpegEncoder();
        return encode(imageData, { quality });
    },
    /**
     * With a target, `quality` is deliberately NOT passed: libwebp treats
     * target_size as taking precedence over it and runs its own dichotomy, and
     * leaving the encoder on its own default seed is what the 84-pair
     * measurement in compress-target.js was taken against.
     */
    webp: async (imageData, quality, targetBytes) => {
        const encode = await loadWebpEncoder();
        return targetBytes
            ? encode(imageData, { target_size: targetBytes, pass: WEBP_TARGET_PASSES })
            : encode(imageData, { quality });
    },
    png: async (imageData) => {
        const encode = await loadPngEncoder();
        return encode(imageData);
    },
};

/**
 * Encodes one ImageData.
 *
 * `targetBytes` asks the encoder itself for a size in bytes. Only WebP has such
 * a mode, and it is a goal rather than a promise — the caller must measure
 * `bytes` against what it asked for. It is reported back as `targetRequested`,
 * and it turns `qualityApplied` off, because when the rate controller is
 * driving, the quality number did not decide anything.
 *
 * @param {ImageData} imageData
 * @param {{ format: string, quality?: number, targetBytes?: number }} options
 * @returns {Promise<{ blob: Blob, bytes: number, format: string, type: string,
 *                     quality: number, qualityApplied: boolean, targetRequested: number|null }>}
 */
export async function encodeImageData(imageData, { format, quality = DEFAULT_QUALITY, targetBytes = null } = {}) {
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
    const resolvedTarget = resolved === 'webp' ? positiveBytes(targetBytes) : null;
    const bytes = await ENCODERS[resolved](imageData, resolvedQuality, resolvedTarget);

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
        qualityApplied: formatSupportsQuality(resolved) && resolvedTarget === null,
        targetRequested: resolvedTarget,
    };
}
