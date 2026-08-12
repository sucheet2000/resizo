/**
 * Decoding
 *
 * Getting pixels out of a file, by the cheapest route that works.
 *
 * The order is not a preference, it is a measurement. On the Phase 0 spike,
 * against the same 12 MP JPEG:
 *
 *   createImageBitmap(file)                                    61 ms
 *   createImageBitmap(file, { resizeWidth, resizeQuality })   110 ms  (and it downscales)
 *   @jsquash/resize lanczos3, after decoding                 1700 ms
 *
 * So the browser's own decoder is always tried first and the WASM codecs are
 * the fallback for when it refuses — which it does for HEIC everywhere except
 * Safari, and can do for a truncated or unusual file that libvips or MozJPEG
 * would still accept.
 *
 * HEIC skips the attempt entirely. Chrome, Firefox and Edge cannot decode it at
 * all, so trying costs a rejected promise and a wasted round trip on the exact
 * path that is already the slowest (729 ms in libheif, plus 69 ms of init).
 *
 * Which route ran is reported back as `viaNative`, because the caller's timing
 * and its memory estimate both depend on it.
 */
import { sniffImageType } from '@/lib/image/magic-bytes';
import { nativeDownscaleSupported } from '@/lib/image-client/capability';
import {
    loadHeifDecoder,
    loadJpegDecoder,
    loadPngDecoder,
    loadWebpDecoder,
} from '@/lib/image-client/codecs';
import { fitWithin, resizeImageData } from '@/lib/image-client/resize';

const SIGNATURE_BYTES = 16;

/** Formats a WASM codec can decode when the browser will not. */
const WASM_DECODERS = {
    jpeg: loadJpegDecoder,
    png: loadPngDecoder,
    webp: loadWebpDecoder,
};

function isBlobLike(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function toUint8(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

/** The first few bytes, without pulling a 20 MB file into memory to sniff it. */
async function readHeader(source) {
    if (isBlobLike(source)) {
        return new Uint8Array(await source.slice(0, SIGNATURE_BYTES).arrayBuffer());
    }
    const bytes = toUint8(source);
    if (!bytes) throw new Error('No valid file was provided.');
    return bytes.subarray(0, SIGNATURE_BYTES);
}

async function readAllBytes(source) {
    if (isBlobLike(source)) return new Uint8Array(await source.arrayBuffer());
    const bytes = toUint8(source);
    if (!bytes) throw new Error('No valid file was provided.');
    return bytes;
}

function asBlob(source, type) {
    if (isBlobLike(source)) return source;
    const bytes = toUint8(source);
    if (!bytes) throw new Error('No valid file was provided.');
    return new Blob([bytes], type ? { type } : undefined);
}

/**
 * A caller's declared format, normalised. Only ever consulted when the magic
 * bytes came back null: a declared MIME type is attacker-controlled and the
 * sniffed signature is not, which is the same order the server uses.
 */
function normaliseHint(hint) {
    if (typeof hint !== 'string' || hint === '') return null;
    const value = hint.toLowerCase().trim();
    const bare = value.startsWith('image/') ? value.slice(6) : value;
    if (bare === 'jpg') return 'jpeg';
    if (bare === 'heif') return 'heic';
    return bare;
}

/* --------------------------------------------------------------- native */

function imageDataFromBitmap(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser would not provide a 2D drawing surface.');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/* ----------------------------------------------------------------- HEIC */

/**
 * libheif decodes into its own heap and copies out through `display`, which is
 * callback-based and defers itself through setTimeout, so it needs a real event
 * loop underneath (it has one on the main thread and in a worker).
 *
 * The primary image is taken as the first entry rather than by asking each
 * image. `HeifImage.is_primary()` in libheif-js 1.19.8 calls an undeclared
 * bare identifier and throws a ReferenceError; the first top-level image is the
 * primary one for every camera-produced HEIC anyway.
 */
async function decodeHeic(source) {
    const [libheif, bytes] = await Promise.all([loadHeifDecoder(), readAllBytes(source)]);

    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(bytes);

    if (!Array.isArray(images) || images.length === 0) {
        throw new Error('This HEIC file could not be read.');
    }

    const image = images[0];

    try {
        const width = image.get_width();
        const height = image.get_height();

        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new Error('This HEIC file could not be read.');
        }

        const target = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);

        await new Promise((resolve, reject) => {
            image.display(target, (result) => {
                if (result) resolve(result);
                else reject(new Error('This HEIC file could not be read.'));
            });
        });

        return { data: target, width, height, format: 'heic', viaNative: false };
    } finally {
        // Each handle holds a decoded frame in the WASM heap. Leaking one on a
        // burst-mode HEIC leaks every frame in the burst.
        for (const entry of images) {
            if (typeof entry?.free === 'function') entry.free();
        }
    }
}

/* --------------------------------------------------------------- public */

/**
 * Pixels from a file, whichever way works.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} source
 * @param {{ mimeOrSniff?: string }} [options] a format hint, used only when the
 *   magic bytes are unrecognised
 * @returns {Promise<{ data: ImageData, width: number, height: number, format: string, viaNative: boolean }>}
 */
export async function decodeToImageData(source, { mimeOrSniff = null } = {}) {
    const header = await readHeader(source);
    const format = sniffImageType(header) ?? normaliseHint(mimeOrSniff);

    if (!format) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    if (format === 'heic') {
        return decodeHeic(source);
    }

    if (nativeDownscaleSupported()) {
        let bitmap = null;
        try {
            bitmap = await createImageBitmap(asBlob(source, `image/${format}`));
            const data = imageDataFromBitmap(bitmap);
            return { data, width: data.width, height: data.height, format, viaNative: true };
        } catch {
            // Falls through to the WASM codec. Nothing is logged: a browser
            // that cannot decode this particular file is an expected branch,
            // not an incident.
        } finally {
            bitmap?.close();
        }
    }

    const loadDecoder = WASM_DECODERS[format];
    if (!loadDecoder) {
        throw new Error(`This browser cannot open ${format.toUpperCase()} images.`);
    }

    const decode = await loadDecoder();
    const bytes = await readAllBytes(source);
    // The codecs want a standalone ArrayBuffer, and a Uint8Array view over a
    // larger buffer would hand them the whole thing.
    const data = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    return { data, width: data.width, height: data.height, format, viaNative: false };
}

/**
 * Pixels from a file, no larger than the given box — the 110 ms path.
 *
 * Prefer this over decodeToImageData whenever the caller only needs a smaller
 * image, which is every tool except a full-size re-encode: decoding at full
 * resolution and then resampling costs both the extra decode time and a second
 * full-size surface in memory.
 *
 * `sourceWidth`/`sourceHeight` should be passed whenever they are known
 * (lib/hooks/useImageUpload measures them at intake). Without them the bitmap
 * is decoded once to be measured and then resampled from the bitmap itself,
 * which is still native and still far cheaper than the WASM resizer, but is one
 * more pass than necessary.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} source
 * @param {number} maxWidth
 * @param {{ maxHeight?: number, sourceWidth?: number, sourceHeight?: number, mimeOrSniff?: string }} [options]
 * @returns {Promise<{ data: ImageData, width: number, height: number, format: string, viaNative: boolean, downscaled: boolean }>}
 */
export async function decodeAndDownscale(source, maxWidth, {
    maxHeight = null,
    sourceWidth = null,
    sourceHeight = null,
    mimeOrSniff = null,
} = {}) {
    const header = await readHeader(source);
    const format = sniffImageType(header) ?? normaliseHint(mimeOrSniff);

    if (!format) {
        throw new Error('Invalid file type. Only images are allowed.');
    }

    // HEIC has no native decoder to downscale with, and neither does the WASM
    // fallback path, so both go through a full decode and then the resampler.
    if (format === 'heic' || !nativeDownscaleSupported()) {
        const decoded = await decodeToImageData(source, { mimeOrSniff });
        const fit = fitWithin(decoded.width, decoded.height, maxWidth, maxHeight);
        if (!fit.changed) return { ...decoded, downscaled: false };

        const resized = await resizeImageData(decoded.data, { width: fit.width, height: fit.height });
        return {
            data: resized.data,
            width: resized.width,
            height: resized.height,
            format,
            viaNative: decoded.viaNative,
            downscaled: true,
        };
    }

    const blob = asBlob(source, `image/${format}`);
    let bitmap = null;
    let downscaled = false;

    try {
        if (sourceWidth && sourceHeight) {
            // The 110 ms path: one call that decodes and scales together.
            const fit = fitWithin(sourceWidth, sourceHeight, maxWidth, maxHeight);
            downscaled = fit.changed;
            bitmap = fit.changed
                ? await createImageBitmap(blob, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: 'high' })
                : await createImageBitmap(blob);
        } else {
            bitmap = await createImageBitmap(blob);
            const fit = fitWithin(bitmap.width, bitmap.height, maxWidth, maxHeight);
            if (fit.changed) {
                // Resampling the bitmap rather than the blob: no second decode,
                // and still the browser's own scaler.
                const scaled = await createImageBitmap(bitmap, {
                    resizeWidth: fit.width,
                    resizeHeight: fit.height,
                    resizeQuality: 'high',
                });
                bitmap.close();
                bitmap = scaled;
                downscaled = true;
            }
        }

        const data = imageDataFromBitmap(bitmap);

        return {
            data,
            width: data.width,
            height: data.height,
            format,
            viaNative: true,
            downscaled,
        };
    } catch {
        // Any native failure falls back to the slow-but-certain route. The
        // bitmap is released before that starts rather than in the finally,
        // so a full-size surface is not held alive across a second decode.
        bitmap?.close();
        bitmap = null;

        const decoded = await decodeToImageData(source, { mimeOrSniff });
        const fit = fitWithin(decoded.width, decoded.height, maxWidth, maxHeight);
        if (!fit.changed) return { ...decoded, downscaled: false };

        const resized = await resizeImageData(decoded.data, { width: fit.width, height: fit.height });
        return {
            data: resized.data,
            width: resized.width,
            height: resized.height,
            format,
            viaNative: false,
            downscaled: true,
        };
    } finally {
        bitmap?.close();
    }
}
