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
 *
 * EVERY ROUTE RETURNS PIXELS THAT ARE ALREADY THE RIGHT WAY UP
 *
 * A phone photo is stored sideways plus an EXIF Orientation tag, and this engine
 * drops all metadata, so the turn has to happen here or it is lost — the same
 * bug a `.rotate()` call fixed in the old sharp pipeline. The three routes
 * get there differently, which is why this is stated once, here:
 *
 *   native  the browser applies the tag; `imageOrientation: 'from-image'` is
 *           pinned on every call rather than inherited as a default
 *   WASM    @jsquash/jpeg does not apply it, so applyOrientation does
 *   HEIC    libheif applies the container's own irot/imir and must not be
 *           given a second turn on top
 *
 * lib/image-client/orientation.js carries the measurements behind each of those.
 */
import { sniffImageType } from '@/lib/image/magic-bytes';
import { assessPixels, nativeDownscaleSupported, DECODE_OPERATION } from '@/lib/image-client/capability';
import {
    loadHeifDecoder,
    loadJpegDecoder,
    loadPngDecoder,
    loadWebpDecoder,
} from '@/lib/image-client/codecs';
import { applyOrientation, readExifOrientation, EXIF_SCAN_BYTES } from '@/lib/image-client/orientation';
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

/**
 * The EXIF Orientation of the source, read from its head.
 *
 * Only the WASM route needs this — the native decoder and libheif both apply the
 * turn themselves — and by the time it is called the bytes are in hand anyway,
 * so it is a scan of at most 128 KB and never a second read of the file.
 */
function orientationOf(bytes) {
    return readExifOrientation(bytes.subarray(0, Math.min(bytes.length, EXIF_SCAN_BYTES)));
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

/**
 * Pinned on every createImageBitmap call that is handed a file.
 *
 * 'from-image' is already the specified default, so this changes no behaviour in
 * a browser that follows the spec — measured in Chromium, all eight tag values
 * came out identical with the option and without it. It is stated anyway because
 * the default is the ONE thing standing between a phone photo and being returned
 * on its side, and a default is invisible: nobody reviewing this file would see
 * that the rotation depends on it, and a browser that got it wrong would fail
 * silently and only on portrait photos. Writing it down makes the decision
 * reviewable, and pins it against the WASM route below, whose default is the
 * opposite.
 *
 * Two things the same measurement settled, both of which this file relies on:
 *
 *  - the orientation is applied BEFORE `resizeWidth`/`resizeHeight`, so the box
 *    asked for below is in upright coordinates, which is also the space the
 *    caller's measured dimensions are in
 *  - `imageOrientation: 'none'` did NOT suppress the turn in Chromium, so it is
 *    no use as a way to normalise every route through applyOrientation instead
 *
 * It is NOT passed when the source is an ImageBitmap rather than a file — those
 * pixels have already been oriented and carry no EXIF to consult.
 */
const NATIVE_ORIENTATION = { imageOrientation: 'from-image' };

function imageDataFromBitmap(bitmap) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser would not provide a 2D drawing surface.');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/* ----------------------------------------------------------------- HEIC */

/**
 * A gate refusal, shaped so operations.js can put it back together as a
 * JobError.
 *
 * Written this way — a plain Error wearing a `code` and a `suggestion` — for the
 * same reason lib/image-client/pdf.js writes its refusals this way: JobError
 * lives in operations.js, operations.js imports this module, and importing it
 * back would close a cycle. The two fields are what operations.js reads to
 * rebuild the refusal, so a person sees the gate's own words either way.
 */
function gateRefusal(assessment) {
    return Object.assign(new Error(assessment.reason), {
        code: assessment.code,
        suggestion: assessment.suggestion ?? null,
    });
}

/**
 * libheif decodes into its own heap and copies out through `display`, which is
 * callback-based and defers itself through setTimeout, so it needs a real event
 * loop underneath (it has one on the main thread and in a worker).
 *
 * NO ORIENTATION WORK HAPPENS HERE, AND NONE MAY BE ADDED. HEIF does not carry
 * the turn as an EXIF tag the way JPEG does; it carries it as `irot` and `imir`
 * properties on the image item, and libheif applies those itself. Measured:
 * libheif's own heif-enc converted EXIF orientations 1, 2, 4, 6 and 8 into irot
 * and imir boxes, and decoding those files back through libheif-js returned
 * upright pixels with the dimensions already swapped — `get_width()` reports the
 * post-transform width, and `display()` fills a buffer of that shape. Applying
 * an orientation on top of that would turn every affected photo twice.
 *
 * The primary image is taken as the first entry rather than by asking each
 * image. `HeifImage.is_primary()` in libheif-js 1.19.8 calls an undeclared
 * bare identifier and throws a ReferenceError; the first top-level image is the
 * primary one for every camera-produced HEIC anyway.
 *
 * THIS IS THE ONLY PLACE A HEIC'S SIZE IS EVER KNOWN, SO THE GATE RUNS HERE
 *
 * Every other tool is gated before the engine is entered at all, because the
 * page measured the image with an <img> at intake. No browser decodes HEIC, so
 * /heic has no preview and no measurement: `assessFile` comes back
 * `dimensions-unknown` and defers, and the first thing on earth that knows how
 * big the picture is, is libheif — right here.
 *
 * Which is why the gate had to move INSIDE this function. Reading the size and
 * then allocating for it is not a gate; the width and height come out of the
 * file's own `ispe` box, which is to say out of whoever wrote the file. A
 * 745-byte container declaring 25000 x 25000 asked the old code for 2.5 GB, and
 * an ordinary 48 MP iPhone photo asked it for 192 MB on a device budgeted for
 * about 154 MB — the silent tab kill capability.js exists to prevent, on the one
 * tool where the gate could not run.
 *
 * MEASURED, NOT ASSUMED: libheif reports the dimensions without decoding.
 * `HeifImage.get_width()` in libheif-js 1.19.8 is
 * `heif_image_handle_get_width(this.handle)` — a read off the parsed box
 * structure — and `decode()` before it only walks the container and takes image
 * handles. The pixels are materialised by `display()`, and by nothing else.
 * Running the file through the real decoder confirms it: a container patched to
 * declare 25000 x 25000 reports 25000 x 25000 from `get_width`/`get_height`
 * with no allocation of any kind. So no `ispe` parser of our own was needed —
 * asking libheif is both simpler and the same answer libheif will act on.
 *
 * The job is costed as a plain DECODE, which is exactly the allocation about to
 * be made: libheif's own RGBA surface in the WASM heap, plus the ImageData copy
 * it fills. What the caller goes on to do with the pixels is re-costed by
 * operations.js the moment this returns, against the same assessPixels and the
 * same sentences.
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

        const gate = assessPixels({
            sourceWidth: width,
            sourceHeight: height,
            fileBytes: bytes.byteLength,
            operation: DECODE_OPERATION,
        });

        if (!gate.ok) throw gateRefusal(gate);

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
            bitmap = await createImageBitmap(asBlob(source, `image/${format}`), NATIVE_ORIENTATION);
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
    const decoded = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    // The one route that has to turn the pixels itself. applyOrientation hands
    // the same object straight back when there is nothing to do, so an untagged
    // file — which is most of them — allocates nothing here.
    const data = applyOrientation(decoded, orientationOf(bytes));

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
            // The 110 ms path: one call that decodes and scales together. The
            // dimensions the caller measured came from an <img>, which honours
            // the orientation tag, so they are the UPRIGHT ones — and so is the
            // box the bitmap is asked for, since the orientation is applied
            // before the resize.
            const fit = fitWithin(sourceWidth, sourceHeight, maxWidth, maxHeight);
            downscaled = fit.changed;
            bitmap = fit.changed
                ? await createImageBitmap(blob, {
                    ...NATIVE_ORIENTATION,
                    resizeWidth: fit.width,
                    resizeHeight: fit.height,
                    resizeQuality: 'high',
                })
                : await createImageBitmap(blob, NATIVE_ORIENTATION);
        } else {
            bitmap = await createImageBitmap(blob, NATIVE_ORIENTATION);
            const fit = fitWithin(bitmap.width, bitmap.height, maxWidth, maxHeight);
            if (fit.changed) {
                // Resampling the bitmap rather than the blob: no second decode,
                // and still the browser's own scaler. No orientation option —
                // this bitmap is already upright and has no tag to read.
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
