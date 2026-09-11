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
 *  - AVIF comes from libavif through @jsquash/avif, at ONE speed and with no
 *    effort control. Every other setting this codec exposes is left at the
 *    package default. The reasons are measurements, and they are on
 *    AVIF_ENCODE_SPEED and the encoder entry below. The binary is 842 KB
 *    brotli and is fetched the first time a job writes an AVIF — never on a
 *    page load, which tests/e2e/contracts/lazy-loading.spec.js holds.
 *
 *    ITS QUALITY NUMBER IS NOT JPEG'S. 80 in libavif and 80 in MozJPEG are
 *    different pictures at different sizes, which is why the pages say the
 *    scale is the codec's own rather than implying one dial across formats.
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
import { ALLOWED_OUTPUT_FORMATS, DEFAULT_QUALITY } from '@/lib/limits';
import { contentTypeFor } from '@/lib/image/filename';
import { loadAvifEncoder, loadJpegEncoder, loadPngEncoder, loadWebpEncoder } from '@/lib/image-client/codecs';

/**
 * Formats whose 1-100 quality actually changes the output here. PNG is absent
 * for the reason in the header: this build has no quantiser. AVIF is present
 * because libavif's quality is live AND monotonic — the 2026-09-11 bench
 * counted zero inversions over 20 steps on both sources, at speed 9 and at
 * speed 7 — so the slider moves the bytes in the direction a person expects.
 */
export const QUALITY_FORMATS = ['jpeg', 'webp', 'avif'];

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

/**
 * libavif's effort dial, fixed at the one value the measurements support.
 *
 * The scale runs 0 (slowest, smallest) to 10 (fastest), and the 2026-09-11
 * bench (Node 20, M1 Pro, four sources from 0.31 to 24 megapixels) settled it
 * three ways at once:
 *
 *   10 IS BYTE-IDENTICAL TO 9 on every source and quality pair tested, so
 *   there is nothing above 9 to gain.
 *
 *   8 IS DOMINATED. On the 1.7 MP photo at q50: 240 ms for 33,739 bytes at
 *   speed 8 against 135 ms for 22,924 bytes at speed 9. Slower AND larger.
 *
 *   7 COSTS 8-15x THE TIME for 12-24% fewer bytes — 2.0 s on a 1.7 MP photo
 *   on a laptop, which is a phone hanging.
 *
 * There is no effort control on any page, deliberately: a second dial that only
 * ever wants one value is a way to make the tool slower by accident.
 */
export const AVIF_ENCODE_SPEED = 9;

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
    /**
     * Everything except `quality` and `speed` is the package default, and each
     * of those defaults is a decision:
     *
     *   subsample 1 is 4:2:0. 4:4:4 cost 4% more bytes on the bench photo for a
     *   difference nobody looking at a photograph can see. lib/image-client/avif.js
     *   reads the chroma back out of the finished file, so the pages can state
     *   it rather than assume it.
     *
     *   qualityAlpha -1 means "follow the colour quality". Measured on an alpha
     *   ramp: the largest error was 15/255 and every fully clear pixel stayed
     *   fully clear, against +28% bytes for a lossless alpha plane. A logo's
     *   hole is still a hole.
     *
     *   bitDepth 8, because every browser's own decoder hands this engine 8-bit
     *   RGBA anyway — a 10-bit source is already flattened before it gets here.
     *
     *   lossless false and not exposed. Lossless AVIF forces 4:4:4 and quality
     *   100, which is a different product from a quality slider.
     *
     * The pixel buffer is handed over as a view over its OWN backing store: the
     * package reads `data.data.buffer` whole, so a view over a larger buffer
     * would send the encoder somebody else's bytes. Every ImageData this engine
     * builds is already exact; the copy below is the guard for the one that is
     * not, and it allocates nothing in the normal case.
     */
    avif: async (imageData, quality) => {
        const { encode } = await loadAvifEncoder();
        return encode(exactlyBackedImageData(imageData), {
            quality,
            speed: AVIF_ENCODE_SPEED,
        });
    },
};

/**
 * An ImageData whose pixel array covers its whole ArrayBuffer.
 *
 * Returns the same object whenever that is already true, which it is for every
 * surface this engine produces.
 */
function exactlyBackedImageData(imageData) {
    const { data } = imageData;
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return imageData;

    return {
        data: new Uint8ClampedArray(data),
        width: imageData.width,
        height: imageData.height,
    };
}

/**
 * How much WebAssembly heap the AVIF encoder is holding, right now.
 *
 * libavif's heap NEVER SHRINKS — measured 16 MB after init, 60 MB after one 1.7
 * MP encode, 345 MB after a 12 MP one, and unchanged after nineteen more — so
 * this is a high-water mark that outlives the job. lib/image-client/client.js
 * recycles the worker on it rather than carrying a dead heap into the next
 * file. The loader is memoised, so asking costs nothing.
 */
async function avifHeapBytes() {
    try {
        const { module } = await loadAvifEncoder();
        const bytes = Number(module?.HEAPU8?.byteLength);
        return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
    } catch {
        // The encode already succeeded; a heap reading is a hint for the worker
        // lifecycle and never a reason to fail a job that produced a file.
        return null;
    }
}

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
        // AVIF only. Null everywhere else, because no other codec here keeps a
        // heap alive between calls.
        avifHeapBytes: resolved === 'avif' ? await avifHeapBytes() : null,
    };
}
