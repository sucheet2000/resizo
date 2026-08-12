/**
 * The Five Jobs
 *
 * One function per tool — resize, crop, compress, convert, heic — expressed
 * against the engine in lib/image-client/*. This is the layer the worker calls;
 * the worker itself owns nothing but the message pump, exactly as a route
 * handler owns nothing but the request.
 *
 * Keeping the jobs out of the worker file buys two things. They can be unit
 * tested without spawning a Worker, and the identical code can run on the main
 * thread when a worker is unavailable, which is what lib/image-client/client.js
 * falls back to.
 *
 * EVERY GATE MIRRORS ITS SERVER ROUTE, BY IMPORT
 *
 * Each op declares the same `accept` list and the same invalid-type sentence as
 * its route in app/api. Each one parses its inputs with the same strict
 * parsers — parsePositiveInt, parseScale, parseQuality, parseCropParams — so a
 * request the server answered with 400 is refused here in the same words. What
 * changes is where the refusal happens, not what is refused.
 *
 * ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
 *
 *   0. read the head  the magic bytes and the EXIF Orientation, one slice, and
 *                     nothing is refused on it — the answers are what steps 2
 *                     and 3 are asked ABOUT
 *   1. file gate      is it a file, an allowed type, under 20 MB   (validateUpload)
 *   2. memory gate    will this job fit in this tab                (assessFile)
 *   3. format gate    do the magic bytes match this tool's list    (sniffImageType)
 *   4. option parse   strict, and before a single pixel is touched
 *   5. target gate    re-cost the job now the output size is known (assessPixels)
 *   6. decode → transform → encode
 *
 * Nothing allocates a pixel buffer before step 5. On iOS an over-committed tab
 * is killed silently, so a job that does not fit has to be refused while there
 * is still a page alive to say so.
 *
 * SHRINK BEFORE ENCODING, ALWAYS. MozJPEG measured 1.74-1.88 s on a full 12 MP
 * frame against 507 ms at 1920 px. Any downscale a job calls for happens before
 * the encoder sees the pixels, never after.
 */
import {
    ALLOWED_OUTPUT_FORMATS,
    CONVERT_INPUT_FORMATS,
    CONVERT_OUTPUT_FORMATS,
    DEFAULT_QUALITY,
    HEIC_INPUT_FORMATS,
    MAX_DIMENSION,
    MAX_PIXELS,
    RASTER_INPUT_FORMATS,
    RESIZE_INPUT_FORMATS,
} from '@/lib/constants';
import { savingsPercent } from '@/lib/hooks/submit-helpers';
import { formatLabel } from '@/lib/hooks/upload-helpers';
import { parsePositiveInt, parseScale } from '@/lib/image/dimensions';
import { buildOutputFilename } from '@/lib/image/filename';
import { sniffImageType } from '@/lib/image/magic-bytes';
import { parseQuality } from '@/lib/image/quality';
import { assessFile, assessPixels } from '@/lib/image-client/capability';
import { compressToTargetBytes } from '@/lib/image-client/compress-target';
import { cropImageData, resolveCropRect } from '@/lib/image-client/crop';
import { decodeAndDownscale, decodeToImageData } from '@/lib/image-client/decode';
import { BROWSER_OUTPUT_FORMATS, encodeImageData } from '@/lib/image-client/encode';
import { flattenImageData, formatKeepsAlpha } from '@/lib/image-client/flatten';
import { readExifOrientation, EXIF_SCAN_BYTES, ORIENTATION_NONE } from '@/lib/image-client/orientation';
import {
    centreCropRect,
    fitWithin,
    resampleSize,
    resizeImageData,
    targetDimensions,
    FIT_COVER,
} from '@/lib/image-client/resize';
import {
    impossibleTargetMessage,
    parseTargetBytes,
    TARGET_SEARCH_DEADLINE_MS,
} from '@/lib/image-client/target-bytes';

const SIGNATURE_BYTES = 16;

const DIMENSION_ERROR = 'Dimensions exceed maximum allowed values.';

/**
 * 'jpeg, png, or webp' — the shape the route's own refusals have always had.
 *
 * Used rather than a literal so a format leaving lib/constants.js cannot leave a
 * sentence behind still advertising it. AVIF was dropped from /convert in both
 * directions and this is why nothing here had to be re-typed to say so.
 */
function joinOr(values) {
    if (values.length <= 1) return values.join('');
    if (values.length === 2) return `${values[0]} or ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

/**
 * heic-convert ran at quality 0.9 on the server. Expressed on the 1-100 scale
 * MozJPEG takes, that is 90 — stated here so the browser build produces a file
 * the same size as the one people were downloading last week.
 */
export const HEIC_JPEG_QUALITY = 90;

/**
 * Progress checkpoints, as percentages of the bar.
 *
 * These are stage boundaries, not a measurement: none of the codecs report
 * intermediate progress, so a bar that claimed to be smooth would be lying. The
 * gaps are sized by the Phase 0 timings — decode is the long first stretch,
 * encode is the long last one — so the bar at least moves in proportion to what
 * is actually happening. The exact-size search is the one stage with real
 * granularity, and it reports per probe.
 */
export const PROGRESS = {
    start: 0,
    checked: 5,
    decoding: 10,
    decoded: 45,
    resized: 60,
    encoding: 65,
    encoded: 95,
    done: 100,
};

/** A failure with a code the UI can branch on and a sentence a person can act on. */
export class JobError extends Error {
    constructor(message, { code = 'failed', suggestion = null } = {}) {
        super(message);
        this.name = 'JobError';
        this.code = code;
        this.suggestion = suggestion;
    }
}

function now() {
    return typeof performance === 'object' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function isBlobLike(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

function toUint8(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

function positiveOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Accepts what the caller actually has: the File from the picker, or a raw
 * buffer that was transferred into the worker.
 *
 * A transferred buffer arrives with no name and no MIME type, so the type is
 * taken from the magic bytes before the Blob is built — otherwise the file gate
 * would reject a perfectly good JPEG for having no declared type. A real File
 * is passed through untouched so its declared type is judged exactly as the
 * server judged it.
 */
function normaliseSource(source, { filename = null, mimeType = null } = {}) {
    if (isBlobLike(source)) {
        const name = typeof source.name === 'string' && source.name !== '' ? source.name : (filename || 'image');
        return { file: source, name };
    }

    const bytes = toUint8(source);
    if (!bytes) {
        throw new JobError('No valid file was provided.', { code: 'invalid-file' });
    }

    const sniffed = sniffImageType(bytes.subarray(0, SIGNATURE_BYTES));
    const type = mimeType || (sniffed ? `image/${sniffed}` : '');

    return { file: new Blob([bytes], { type }), name: filename || 'image' };
}

/* ------------------------------------------------------------ decode stage */

/**
 * Pixels, at the size the job needs them, by the cheapest route that gets there.
 *
 * `target` null means "the source size" — a re-encode, a crop or a conversion.
 * A target that is exactly what fitWithin would produce is a ratio-preserving
 * downscale, which is the 110 ms native decode-and-scale path. An upscale
 * decodes at full size and goes through the lanczos3 resampler, because that is
 * the case where the slower, better filter earns its 1700 ms.
 *
 * A TARGET IS NOT ALWAYS THE SIZE TO RESAMPLE TO. When both sides were asked
 * for, the target carries `fit: 'cover'` and the resampler is aimed at the
 * COVERING size instead — bigger than the output on one axis — with the
 * overflow cropped off afterwards. That is what sharp does by default, and it
 * is the difference between a photo that is trimmed and a photo that is
 * squashed. It matters most on the native path: createImageBitmap's
 * resizeWidth/resizeHeight stretch to whatever box they are handed, so handing
 * that call the target directly is how the stretch used to survive.
 *
 * The second memory gate lives here. When the caller had no dimensions to give,
 * the pre-flight could only check the file; once the image has been measured
 * the job is re-costed before anything else allocates — against the covering
 * size, which is the surface that is really about to exist.
 */
async function decodePixels(context, target) {
    const { file, sourceFormat, sourceWidth, sourceHeight, operation, report, guard } = context;

    report(PROGRESS.decoding, 'decoding');
    guard();

    const box = (sourceWidth && sourceHeight) ? resampleSize(sourceWidth, sourceHeight, target) : null;

    const fit = box ? fitWithin(sourceWidth, sourceHeight, box.width, box.height) : null;
    const nativeCanFit = Boolean(fit?.changed && fit.width === box.width && fit.height === box.height);

    const decoded = nativeCanFit
        ? await decodeAndDownscale(file, box.width, {
            maxHeight: box.height,
            sourceWidth,
            sourceHeight,
            mimeOrSniff: sourceFormat,
        })
        : await decodeToImageData(file, { mimeOrSniff: sourceFormat });

    report(PROGRESS.decoded, 'decoded');
    guard();

    if (!sourceWidth || !sourceHeight) {
        const measured = resampleSize(decoded.width, decoded.height, target);
        const recheck = assessPixels({
            sourceWidth: decoded.width,
            sourceHeight: decoded.height,
            targetWidth: target?.width ?? null,
            targetHeight: target?.height ?? null,
            intermediateWidth: measured?.width ?? null,
            intermediateHeight: measured?.height ?? null,
            fileBytes: Number(file.size) || 0,
            operation,
            // The pixels are already the right way up by this point, so the
            // extra surface has been spent and must not be charged twice.
            orientation: ORIENTATION_NONE,
        });
        if (!recheck.ok) {
            throw new JobError(recheck.reason, { code: recheck.code, suggestion: recheck.suggestion });
        }
    }

    if (!target) return decoded;

    // Recomputed against the dimensions the decoder actually produced rather
    // than the ones the page measured. They are normally the same; when they
    // are not, these are the numbers the crop below has to be consistent with.
    const resample = resampleSize(decoded.width, decoded.height, target);

    let pixels = decoded;

    if (decoded.width !== resample.width || decoded.height !== resample.height) {
        const resized = await resizeImageData(decoded.data, {
            width: resample.width,
            height: resample.height,
        });
        report(PROGRESS.resized, 'resizing');
        guard();

        pixels = { ...decoded, data: resized.data, width: resized.width, height: resized.height };
    }

    if (pixels.width === target.width && pixels.height === target.height) return pixels;

    // The trim. cropImageData is the same slicer /crop uses — a crop is a crop,
    // and a second one written here would be a second thing to keep correct.
    const cropped = cropImageData(pixels.data, centreCropRect(
        pixels.width,
        pixels.height,
        target.width,
        target.height,
    ));
    guard();

    return { ...pixels, data: cropped, width: cropped.width, height: cropped.height };
}

/** One encode, with the progress bookends every op wants around it. */
async function encodeStage(context, imageData, { format, quality }) {
    context.report(PROGRESS.encoding, 'encoding');
    context.guard();

    const encoded = await encodeImageData(imageData, { format, quality });

    context.report(PROGRESS.encoded, 'encoded');
    return encoded;
}

/* -------------------------------------------------------------------- ops */

/**
 * /resize — width, height or scale, then a re-encode.
 *
 * Mirrors resolveExplicitTarget in app/api/resize/route.js exactly: one side
 * supplied means the other is derived from the source ratio, and the derived
 * side is held to MAX_DIMENSION and the pixel budget too — width=8000 on a tall
 * thin source otherwise asks for a height in the hundreds of thousands.
 *
 * BOTH SIDES IS A DIFFERENT REQUEST FROM ONE SIDE, and only the route made that
 * distinction before. Sending sharp `{ width, height }` invokes its default fit,
 * 'cover': fill the box, keep the shape, trim the overflow from the centre. One
 * side, or a percentage, lands on the source's own ratio and has nothing to
 * trim. So the two-sided target — and only the two-sided target — carries
 * FIT_COVER, and lib/image-client/resize.js turns that into the size to
 * resample to and the rectangle to keep.
 *
 * No quality is accepted, because the route accepts none: JPEG and WebP take
 * DEFAULT_QUALITY, PNG stays lossless. A quality control on /resize would be a
 * product change, not a port.
 */
function resolveResizeTarget({ width, height, scale }, sourceWidth, sourceHeight) {
    const parsedWidth = parsePositiveInt(width, { max: MAX_DIMENSION });
    const parsedHeight = parsePositiveInt(height, { max: MAX_DIMENSION });

    if ((!parsedWidth.ok && !parsedWidth.absent) || (!parsedHeight.ok && !parsedHeight.absent)) {
        return { ok: false, error: DIMENSION_ERROR };
    }

    const wantsExplicit = parsedWidth.ok || parsedHeight.ok;
    const wantsScale = !wantsExplicit && scale !== null && scale !== undefined && String(scale).trim() !== '';

    if (!wantsExplicit && !wantsScale) {
        return { ok: true, target: null };
    }

    if (!sourceWidth || !sourceHeight) {
        return { ok: false, error: 'Unable to determine the source image dimensions.' };
    }

    if (wantsScale) {
        const parsedScale = parseScale(scale);
        if (!parsedScale.ok) return { ok: false, error: parsedScale.error };

        const scaled = targetDimensions(sourceWidth, sourceHeight, { scalePercent: parsedScale.value });
        return scaled.ok
            ? { ok: true, target: { width: scaled.width, height: scaled.height } }
            : { ok: false, error: scaled.error };
    }

    const explicit = targetDimensions(sourceWidth, sourceHeight, {
        width: parsedWidth.ok ? parsedWidth.value : null,
        height: parsedHeight.ok ? parsedHeight.value : null,
    });

    if (!explicit.ok) return { ok: false, error: explicit.error };

    return {
        ok: true,
        target: {
            width: explicit.width,
            height: explicit.height,
            ...(parsedWidth.ok && parsedHeight.ok ? { fit: FIT_COVER } : {}),
        },
    };
}

async function runResize(context) {
    const { options, sourceWidth, sourceHeight } = context;

    // An unrecognised format falls back to JPEG rather than erroring — the same
    // forgiving branch the route has, so a stale form field cannot break a resize.
    const format = ALLOWED_OUTPUT_FORMATS.includes(options.format) ? options.format : 'jpeg';

    const resolved = resolveResizeTarget(options, sourceWidth, sourceHeight);
    if (!resolved.ok) throw new JobError(resolved.error, { code: 'invalid-dimensions' });

    if (resolved.target && sourceWidth && sourceHeight) {
        // Costed against the COVERING size, not the output size: a two-sided
        // target allocates the surface it is about to crop down, and a gate
        // that priced only the finished file would wave through a job that
        // cannot fit. The output caps still apply to the output — see
        // assessPixels.
        const cover = resampleSize(sourceWidth, sourceHeight, resolved.target);

        const gate = assessPixels({
            sourceWidth,
            sourceHeight,
            targetWidth: resolved.target.width,
            targetHeight: resolved.target.height,
            intermediateWidth: cover.width,
            intermediateHeight: cover.height,
            fileBytes: Number(context.file.size) || 0,
            operation: 'resize',
            orientation: context.orientation,
        });
        if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });
    }

    const decoded = await decodePixels(context, resolved.target);
    const encoded = await encodeStage(context, decoded.data, { format, quality: DEFAULT_QUALITY });

    return {
        ...encoded,
        width: decoded.width,
        height: decoded.height,
        viaNative: decoded.viaNative,
    };
}

/**
 * /crop — a rectangle in SOURCE-image pixels, then a re-encode in the source
 * format.
 *
 * The rectangle is checked twice against two different authorities. First
 * against the dimensions the page measured at intake, so a nonsense rectangle
 * is refused before a 45 MB surface is allocated. Then against the dimensions
 * the decoder actually produced, which is what sharp's metadata was on the
 * server and is the only number that can be trusted to bound the slice.
 */
async function runCrop(context) {
    const { options, sourceFormat, sourceWidth, sourceHeight } = context;

    if (sourceWidth && sourceHeight) {
        const early = resolveCropRect(options, { sourceWidth, sourceHeight });
        if (!early.ok) throw new JobError(early.error, { code: 'invalid-crop' });
    }

    const decoded = await decodePixels(context, null);

    const resolved = resolveCropRect(options, {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
    });
    if (!resolved.ok) throw new JobError(resolved.error, { code: 'invalid-crop' });

    const cropped = cropImageData(decoded.data, resolved.rect);
    context.guard();

    const encoded = await encodeStage(context, cropped, { format: sourceFormat, quality: DEFAULT_QUALITY });

    return {
        ...encoded,
        width: cropped.width,
        height: cropped.height,
        viaNative: decoded.viaNative,
        crop: resolved.rect,
    };
}

/**
 * The output format for a compress job.
 *
 * Absent, blank or the bulk sentinel means "whatever came in", which is what
 * /compress has always done and what app/api/compress/route.js still does. An
 * explicit format is honoured so /compress can offer WebP to a PNG that has
 * been asked for a byte target — the one job PNG cannot do in this build
 * without shrinking the picture. See lib/image-client/compress-target.js.
 */
function resolveCompressFormat(requested, sourceFormat) {
    if (requested === null || requested === undefined) return sourceFormat;

    const value = String(requested).trim().toLowerCase();
    if (value === '' || value === 'original' || value === 'same') return sourceFormat;

    const normalised = value === 'jpg' ? 'jpeg' : value;
    return ALLOWED_OUTPUT_FORMATS.includes(normalised) ? normalised : null;
}

/**
 * /compress — a quality, or an exact byte target.
 *
 * The source is decoded ONCE and only the encode repeats, so a byte-target
 * search costs eight encodes here where sharp paid for eight decode-and-encode
 * round trips. Everything else about the target path — which format can reach a
 * byte count, why WebP takes one encode instead of eight, and why PNG is never
 * downscaled to fake a hit — lives in lib/image-client/compress-target.js.
 *
 * The one thing to know here: for PNG, `targetMet` can come back false with a
 * perfectly good file attached. That is deliberate. It is the honest answer to
 * a request this build cannot meet, and it is the caller's job to say so.
 */
async function runCompress(context) {
    const { options, sourceFormat, report, guard } = context;

    const target = parseTargetBytes(options.targetBytes);
    if (!target.ok && !target.absent) throw new JobError(target.error, { code: 'invalid-target' });

    const format = resolveCompressFormat(options.format, sourceFormat);
    if (!format) {
        throw new JobError(`Invalid output format. Must be ${joinOr(ALLOWED_OUTPUT_FORMATS)}.`, {
            code: 'invalid-format',
        });
    }

    const parsedQuality = parseQuality(options.quality);
    if (!parsedQuality.ok && !parsedQuality.absent) {
        throw new JobError(parsedQuality.error, { code: 'invalid-quality' });
    }
    const quality = parsedQuality.ok ? parsedQuality.value : DEFAULT_QUALITY;

    const decoded = await decodePixels(context, null);
    // Same rule as /convert: a format with no alpha channel gets pixels that
    // have already been composited, so the two lanes cannot disagree about what
    // a transparent pixel becomes.
    const pixels = formatKeepsAlpha(format) ? decoded.data : flattenImageData(decoded.data);

    if (!target.ok) {
        const encoded = await encodeStage(context, pixels, { format, quality });
        return { ...encoded, width: decoded.width, height: decoded.height, viaNative: decoded.viaNative };
    }

    // The route refuses an exact-size request on a source past the output
    // budget, because the search re-encodes it up to eight times. Same refusal,
    // same sentence — only now the pixel count is known for certain.
    if (decoded.width * decoded.height > MAX_PIXELS) {
        throw new JobError('This image is too large to compress to an exact size. Resize it first.', {
            code: 'source-too-large',
            suggestion: 'Resize the image first, then compress it to an exact size.',
        });
    }

    const search = await compressToTargetBytes({
        imageData: pixels,
        format,
        targetBytes: target.value,
        deadline: now() + TARGET_SEARCH_DEADLINE_MS,
        now,
        guard,
        // The slowest job on the site, so the bar reports every real encode
        // rather than sitting still through eight of them.
        onIteration: (index, total) => {
            report(
                Math.round(PROGRESS.resized + ((PROGRESS.encoded - PROGRESS.resized) * index) / total),
                'searching',
            );
        },
    });

    if (!search.fit) {
        const smallest = search.floorBytes ?? (Number(context.file.size) || 0);
        throw new JobError(impossibleTargetMessage(target.value, smallest), {
            code: 'target-unreachable',
            suggestion: 'Raise the target size, or resize the image smaller first.',
        });
    }

    report(PROGRESS.encoded, 'encoded');

    return {
        ...search.fit,
        viaNative: decoded.viaNative,
        targetBytes: target.value,
        iterations: search.iterations,
    };
}

/**
 * /convert — one format in, another out.
 *
 * No quality is passed, exactly as the route passes none: a format conversion
 * must not quantise a PNG the way /compress deliberately does.
 *
 * Which formats those are is read from lib/constants.js and never restated. The
 * pair AVIF was removed from — input and output both — needed no edit here for
 * exactly that reason: there is no AVIF decoder and no AVIF encoder available in
 * a browser build, and an AVIF encode was measured at 823 KB of extra download
 * for 15-30 seconds of work per image on a phone.
 *
 * The second gate below stays even though the registry no longer reaches it. It
 * is the thing that stops a format being added to CONVERT_OUTPUT_FORMATS one day
 * and quietly producing JPEG bytes under somebody else's Content-Type, which is
 * the same trap lib/image/pipeline.js calls out in its own switch.
 *
 * TRANSPARENCY. A PNG or WebP going out as JPEG loses its alpha channel, and
 * what fills the transparent pixels is decided in lib/image-client/flatten.js —
 * composited onto black, because that is what libvips does for the server when
 * no background is given. Without that step MozJPEG would ignore the alpha byte
 * and return WHITE where the server returns BLACK for the same file.
 */
async function runConvert(context) {
    const format = typeof context.options.format === 'string' ? context.options.format.trim() : '';

    if (!CONVERT_OUTPUT_FORMATS.includes(format)) {
        throw new JobError(`Invalid target format. Must be ${joinOr(CONVERT_OUTPUT_FORMATS)}.`, {
            code: 'invalid-format',
        });
    }

    if (!BROWSER_OUTPUT_FORMATS.includes(format)) {
        throw new JobError(`${formatLabel(format)} files cannot be created on this device yet.`, {
            code: 'unsupported-output',
            suggestion: `Choose ${joinOr(BROWSER_OUTPUT_FORMATS.map(formatLabel))} instead.`,
        });
    }

    const decoded = await decodePixels(context, null);
    const pixels = formatKeepsAlpha(format) ? decoded.data : flattenImageData(decoded.data);
    const encoded = await encodeStage(context, pixels, { format, quality: DEFAULT_QUALITY });

    return { ...encoded, width: decoded.width, height: decoded.height, viaNative: decoded.viaNative };
}

/**
 * /heic — an iPhone photo out to JPEG.
 *
 * The slowest job here by a distance: libheif measured 729 ms of decode plus
 * 69 ms of one-off init on a 12 MP HEIC, and MozJPEG then wants 1.74-1.88 s to
 * write it back out at full size. No downscale is applied, because the route
 * applied none — a HEIC conversion returns the photo, not a smaller photo.
 */
async function runHeic(context) {
    const decoded = await decodePixels(context, null);
    const encoded = await encodeStage(context, decoded.data, { format: 'jpeg', quality: HEIC_JPEG_QUALITY });

    return { ...encoded, width: decoded.width, height: decoded.height, viaNative: decoded.viaNative };
}

/* -------------------------------------------------------------- registry */

/**
 * The accept lists, the invalid-type sentences and the filename prefixes are
 * lifted from the route each op replaces. Changing one here without changing it
 * there would mean the two builds disagree about what a valid upload is.
 */
const OPERATIONS = {
    resize: {
        accept: RESIZE_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid image.',
        prefix: 'resizo-processed',
        run: runResize,
    },
    crop: {
        accept: RASTER_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-cropped',
        run: runCrop,
    },
    compress: {
        accept: RASTER_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-compressed',
        run: runCompress,
    },
    convert: {
        accept: CONVERT_INPUT_FORMATS,
        invalidTypeError: `File failed validation. Please upload a valid ${joinOr(CONVERT_INPUT_FORMATS.map(formatLabel))} image.`,
        prefix: 'resizo-converted',
        run: runConvert,
    },
    heic: {
        accept: HEIC_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid HEIC or HEIF image.',
        prefix: 'resizo-converted',
        run: runHeic,
    },
};

/** The op names the worker and the hook accept. */
export const CLIENT_OPS = Object.keys(OPERATIONS);

/**
 * Runs one job end to end.
 *
 * @param {string} operation                  one of CLIENT_OPS
 * @param {File|Blob|ArrayBuffer|Uint8Array} source
 * @param {object} [options]                  the op's own fields, plus
 *   sourceWidth/sourceHeight (pass them whenever the page has measured the
 *   image — without them the memory gate cannot run until after the decode) and
 *   filename/mimeType for a raw buffer
 * @param {{ onProgress?: (progress: number, phase: string) => void, checkCancelled?: () => void }} [hooks]
 * @returns {Promise<object>} blob, filename and the numbers the result panel prints
 */
export async function runOperation(operation, source, options = {}, { onProgress = null, checkCancelled = null } = {}) {
    const startedAt = now();

    const spec = OPERATIONS[operation];
    if (!spec) {
        throw new JobError(`Unknown operation: ${operation}.`, { code: 'unknown-operation' });
    }

    const report = (progress, phase) => onProgress?.(progress, phase);
    const guard = () => checkCancelled?.();

    report(PROGRESS.start, 'starting');

    const { file, name } = normaliseSource(source, options);
    const sourceWidth = positiveOrNull(options.sourceWidth);
    const sourceHeight = positiveOrNull(options.sourceHeight);

    // The head of the file, read once and used for both questions asked of it:
    // what format is this, and does it need turning the right way up. The
    // second one belongs BEFORE the memory gate, because turning a photo costs
    // a whole extra surface and a gate that has not been told about it is
    // costing the wrong job.
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    const sourceFormat = sniffImageType(head.subarray(0, SIGNATURE_BYTES));
    const orientation = readExifOrientation(head);

    const gate = assessFile(file, { operation, sourceWidth, sourceHeight, orientation });
    if (!gate.ok) {
        throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });
    }

    if (!sourceFormat || !spec.accept.includes(sourceFormat)) {
        throw new JobError(spec.invalidTypeError, { code: 'invalid-type' });
    }

    report(PROGRESS.checked, 'checked');
    guard();

    const outcome = await spec.run({
        file,
        name,
        options,
        sourceFormat,
        sourceWidth,
        sourceHeight,
        orientation,
        operation,
        report,
        guard,
    });

    guard();

    const originalBytes = Number(file.size) || 0;
    const filename = buildOutputFilename({ name, prefix: spec.prefix, format: outcome.format });

    report(PROGRESS.done, 'done');

    return {
        blob: outcome.blob,
        filename,
        operation,
        format: outcome.format,
        type: outcome.type,
        sourceFormat,
        width: outcome.width,
        height: outcome.height,
        originalBytes,
        resultBytes: outcome.bytes,
        savedPercent: savingsPercent(originalBytes, outcome.bytes),
        targetBytes: outcome.targetBytes ?? null,
        // Only ever false for a PNG asked for a byte target: this build has no
        // quantiser, and the answer to that is to say so, not to hand back a
        // shrunken picture. null whenever no target was asked for.
        targetMet: outcome.targetMet ?? null,
        quality: outcome.quality ?? null,
        // False whenever the number on the slider did not change the bytes —
        // which is every PNG in this build. The UI must not imply otherwise.
        qualityApplied: outcome.qualityApplied ?? false,
        scalePercent: outcome.scalePercent ?? null,
        crop: outcome.crop ?? null,
        iterations: outcome.iterations ?? null,
        viaNative: outcome.viaNative ?? false,
        // No HTTP was involved, so there is no rate limit to report and no
        // headers to read. Both fields stay for shape-compatibility with the
        // server result the tool pages read today.
        remaining: null,
        durationMs: Math.round(now() - startedAt),
    };
}
