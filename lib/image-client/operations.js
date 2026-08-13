/**
 * The Jobs
 *
 * One function per tool — resize, crop, compress, convert, heic, jpg-to-pdf,
 * merge-pdf — expressed against the engine in lib/image-client/*. This is the
 * layer the worker calls; the worker itself owns nothing but the message pump,
 * exactly as a route handler owns nothing but the request.
 *
 * FIVE OF THE SEVEN TAKE ONE FILE. /jpg-to-pdf and /merge-pdf take a list, and
 * that is the only difference in their shape: the registry entry carries
 * `multi: true`, the source is an array, and the op is handed `entries` instead
 * of one `file`. Every gate below still runs once per file, in order, and the op
 * sees nothing that has not already been through all of them.
 *
 * SIX OF THE SEVEN TAKE AN IMAGE. /merge-pdf takes documents, so its registry
 * entry also carries a `prepare` of its own — the intake below is written
 * entirely around pixels and none of its questions has an answer for a PDF. See
 * prepareMergeEntry.
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
 * HEIC is the one format step 2 cannot cost, because no browser will decode it
 * and so nothing measured it at intake. Its gate therefore runs one level down,
 * inside decodeHeic, in the instant between libheif reporting the dimensions and
 * anything being allocated for them — see lib/image-client/decode.js. It refuses
 * with the same assessPixels and the same sentences; decodePixels below only has
 * to carry the code and suggestion back out as a JobError.
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
    MAX_FILE_SIZE,
    MAX_PIXELS,
    MERGE_PDF_INPUT_FORMATS,
    PDF_INPUT_FORMATS,
    PDF_MIME_TYPE,
    RASTER_INPUT_FORMATS,
    RESIZE_INPUT_FORMATS,
} from '@/lib/limits';
import { savingsPercent } from '@/lib/format/submit-helpers';
import { formatLabel } from '@/lib/format/upload-helpers';
import { parsePositiveInt, parseScale } from '@/lib/image/dimensions';
import { buildOutputFilename } from '@/lib/image/filename';
import { isPdfSignature, sniffImageType } from '@/lib/image/magic-bytes';
import { parseQuality } from '@/lib/image/quality';
import { assessFile, assessPdfJob, assessPdfMergeJob, assessPixels } from '@/lib/image-client/capability';
import { compressToTargetBytes } from '@/lib/image-client/compress-target';
import { cropImageData, resolveCropRect } from '@/lib/image-client/crop';
import { decodeAndDownscale, decodeToImageData } from '@/lib/image-client/decode';
import { BROWSER_OUTPUT_FORMATS, encodeImageData } from '@/lib/image-client/encode';
import { flattenImageData, formatKeepsAlpha } from '@/lib/image-client/flatten';
import { readExifOrientation, EXIF_SCAN_BYTES, ORIENTATION_NONE } from '@/lib/image-client/orientation';
import {
    buildPdf,
    canEmbedWithoutDecoding,
    parseMarginPoints,
    parsePageOrientation,
    parsePageSize,
    targetMissMessage,
    PDF_JPEG_QUALITY,
} from '@/lib/image-client/pdf';
import { mergePdfs, MERGE_FILENAME_PREFIX } from '@/lib/image-client/pdf-merge';
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
 * Used rather than a literal so a format leaving lib/limits.js cannot leave a
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

/**
 * A failure with a code the UI can branch on and a sentence a person can act on.
 *
 * `cause` is the raw throwable a codec produced, when there was one. It is kept
 * for a console and a bug report and NEVER shown: image.worker.js copies only
 * code, message and suggestion onto the wire, so an emscripten abort string
 * cannot reach a visitor through it. Passed through rather than assigned so a
 * refusal that had no cause does not grow a null one.
 */
export class JobError extends Error {
    constructor(message, { code = 'failed', suggestion = null, cause = undefined } = {}) {
        super(message, cause === undefined ? undefined : { cause });
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

/**
 * The same, for a document.
 *
 * A transferred buffer has no name and no declared type, and there is only one
 * type it could be here — a merge accepts nothing else — so it is stated rather
 * than sniffed for. The magic bytes still decide whether the file is accepted;
 * see prepareMergeEntry.
 */
function normalisePdfSource(source, { filename = null } = {}) {
    if (isBlobLike(source)) {
        const name = typeof source.name === 'string' && source.name !== '' ? source.name : (filename || 'document');
        return { file: source, name };
    }

    const bytes = toUint8(source);
    if (!bytes) {
        throw new JobError('No valid file was provided.', { code: 'invalid-file' });
    }

    return { file: new Blob([bytes], { type: PDF_MIME_TYPE }), name: filename || 'document' };
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

    let decoded;
    try {
        decoded = nativeCanFit
            ? await decodeAndDownscale(file, box.width, {
                maxHeight: box.height,
                sourceWidth,
                sourceHeight,
                mimeOrSniff: sourceFormat,
            })
            : await decodeToImageData(file, { mimeOrSniff: sourceFormat });
    } catch (error) {
        // The decoder runs its own memory gate for the one format nothing could
        // measure at intake — see decodeHeic. It cannot build a JobError without
        // importing this module back, so it decorates a plain Error and the code
        // and suggestion are put back on here, exactly as runJpgToPdf does for
        // pdf.js. Anything with no code is a codec talking and is left alone.
        //
        // `cause` comes across too: decode.js translates a codec that could not
        // read the file into a sentence and keeps the emscripten or WebAssembly
        // detail underneath, and that detail is only useful if it survives the
        // rebuild.
        if (error?.code) {
            throw new JobError(error.message, {
                code: error.code,
                suggestion: error.suggestion ?? null,
                cause: error.cause,
            });
        }
        throw error;
    }

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
 * Sizes through explicitTargetDimensions in lib/image/dimensions.js: one side
 * supplied means the other is derived from the source ratio, and the derived
 * side is held to MAX_DIMENSION and the pixel budget too — width=8000 on a tall
 * thin source otherwise asks for a height in the hundreds of thousands.
 *
 * BOTH SIDES IS A DIFFERENT REQUEST FROM ONE SIDE, and only the sharp build
 * made that distinction at first. Sending sharp `{ width, height }` invokes its default fit,
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
 * /compress has always done. An
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
 * Which formats those are is read from lib/limits.js and never restated. The
 * pair AVIF was removed from — input and output both — needed no edit here for
 * exactly that reason: there is no AVIF decoder and no AVIF encoder available in
 * a browser build, and an AVIF encode was measured at 823 KB of extra download
 * for 15-30 seconds of work per image on a phone.
 *
 * The second gate below stays even though the registry no longer reaches it. It
 * is the thing that stops a format being added to CONVERT_OUTPUT_FORMATS one day
 * and quietly producing JPEG bytes under somebody else's Content-Type, which is
 * the same trap the sharp pipeline called out in its own switch.
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

/**
 * /jpg-to-pdf — a list of photos, one document, in the order they were given.
 *
 * The only op that takes more than one file, which is why runOperation grew a
 * `multi` branch rather than this growing a second front door. Everything about
 * how a page is built — which files avoid being decoded, why a tagged JPEG
 * cannot, how a size target is spent — lives in lib/image-client/pdf.js.
 *
 * The size target reports the way /compress reports it, with one deliberate
 * difference at the end. /compress THROWS when a byte target cannot be reached,
 * because the only thing it had to offer was the file the person asked to be
 * smaller. Here the document is up to twenty files' worth of work and it is a
 * perfectly good PDF; throwing it away would help nobody. So it comes back with
 * `targetMet: false` and the sentence that says by how much — the same honest
 * miss a PNG gets from /compress, never a silent one.
 */
async function runJpgToPdf(context) {
    const { entries, options, report, guard } = context;

    const size = parsePageSize(options.pageSize);
    if (!size.ok) throw new JobError(size.error, { code: 'invalid-page-size' });

    const pageOrientation = parsePageOrientation(options.pageOrientation);
    if (!pageOrientation.ok) throw new JobError(pageOrientation.error, { code: 'invalid-page-orientation' });

    const margin = parseMarginPoints(options.margin);
    if (!margin.ok) throw new JobError(margin.error, { code: 'invalid-margin' });

    const target = parseTargetBytes(options.targetBytes);
    if (!target.ok && !target.absent) throw new JobError(target.error, { code: 'invalid-target' });

    const quality = parseQuality(options.quality);
    if (!quality.ok && !quality.absent) throw new JobError(quality.error, { code: 'invalid-quality' });

    const images = entries.map((entry) => ({
        source: entry.file,
        name: entry.name,
        format: entry.sourceFormat,
        orientation: entry.orientation,
        fileBytes: Number(entry.file.size) || 0,
        sourceWidth: entry.sourceWidth,
        sourceHeight: entry.sourceHeight,
    }));

    // The whole-document gate. assessFile has already run per file — is this a
    // file, an allowed type, under 20 MB — and this is the question none of
    // those could answer: does the DOCUMENT they add up to fit in this tab,
    // given that only one page is ever decoded at a time.
    const gate = assessPdfJob({
        pages: images.map((image) => ({
            fileBytes: image.fileBytes,
            sourceWidth: image.sourceWidth,
            sourceHeight: image.sourceHeight,
            orientation: image.orientation,
            reencoded: !canEmbedWithoutDecoding(image),
        })),
    });
    if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });

    let built;
    try {
        built = await buildPdf({
            images,
            pageSize: size.value,
            orientation: pageOrientation.value,
            margin: margin.value,
            quality: quality.ok ? quality.value : PDF_JPEG_QUALITY,
            targetBytes: target.ok ? target.value : null,
            deadline: now() + TARGET_SEARCH_DEADLINE_MS,
            now,
            guard,
            onPage: (done, total) => {
                report(
                    Math.round(PROGRESS.decoding + ((PROGRESS.encoded - PROGRESS.decoding) * done) / total),
                    'building',
                );
            },
        });
    } catch (error) {
        // pdf.js cannot build a JobError without importing this module back, so
        // it decorates a plain Error instead and the code and suggestion are
        // put back on here. Anything with no code is a codec or the writer
        // talking and is left alone for the worker to sanitise. `cause` rides
        // along so a damaged page's underlying codec detail is not lost.
        if (error?.code) {
            throw new JobError(error.message, {
                code: error.code,
                suggestion: error.suggestion ?? null,
                cause: error.cause,
            });
        }
        throw error;
    }

    report(PROGRESS.encoded, 'encoded');

    return {
        blob: built.blob,
        bytes: built.bytes,
        format: 'pdf',
        type: 'application/pdf',
        // A document has no one width or height. Saying so is better than
        // reporting the first page's and letting a result panel print it as if
        // it described the file.
        width: null,
        height: null,
        pageCount: built.pageCount,
        reencodedCount: built.reencodedCount,
        iterations: built.iterations,
        targetBytes: built.targetBytes,
        targetMet: built.targetMet,
        targetMessage: built.targetMet === false
            ? targetMissMessage(built.targetBytes, built.bytes)
            : null,
        quality: built.quality,
        qualityApplied: built.reencodedCount > 0,
        pageSize: built.pageSize,
    };
}

/**
 * /merge-pdf — several PDFs, one document, in the order and at the pages the
 * caller asked for.
 *
 * The second op that takes a list, and the first whose files are not images at
 * all. That is the whole reason `prepare` exists on a registry entry: every gate
 * prepareEntry runs — sniff an image type, read an EXIF tag, cost a pixel
 * surface — is a question about a photograph, and asking any of them about a
 * bank statement gets an answer that is wrong rather than unavailable.
 *
 * Nothing is decoded on this path and nothing is encoded, so there is no
 * quality, no format choice and no size target. Everything that can go wrong
 * with a merge is a property of the FILE — not a PDF, locked, damaged, empty,
 * or asked for a page it does not have — and every one of those is refused by
 * name in lib/image-client/pdf-merge.js.
 */
async function runMergePdf(context) {
    const { entries, options, report, guard } = context;

    // The whole-job gate. Costed in bytes only: see estimatePdfMergePeakBytes
    // for why a merge is charged no pixel surfaces at all.
    const gate = assessPdfMergeJob({
        files: entries.map((entry) => ({ fileBytes: Number(entry.file.size) || 0 })),
    });
    if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });

    let merged;
    try {
        merged = await mergePdfs({
            sources: entries.map((entry) => ({ source: entry.file, name: entry.name })),
            // null means every page of every file, in the order they were given.
            plan: options.plan ?? null,
            guard,
            onFile: (done, total) => {
                report(
                    Math.round(PROGRESS.decoding + ((PROGRESS.encoded - PROGRESS.decoding) * done) / total),
                    'combining',
                );
            },
        });
    } catch (error) {
        // pdf-merge.js cannot build a JobError without importing this module
        // back, so it decorates a plain Error and the code and suggestion are
        // put back on here — the same arrangement runJpgToPdf has with pdf.js.
        if (error?.code) {
            throw new JobError(error.message, { code: error.code, suggestion: error.suggestion ?? null });
        }
        throw error;
    }

    report(PROGRESS.encoded, 'encoded');

    return {
        blob: merged.blob,
        bytes: merged.bytes,
        format: 'pdf',
        type: 'application/pdf',
        // A document has no one width or height, the same as /jpg-to-pdf.
        width: null,
        height: null,
        pageCount: merged.pageCount,
    };
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
    /**
     * The one op that takes a list. `multi` is read by runOperation and by
     * nothing else: it says the source is an array of files, that each one is
     * gated on its own, and that the op is handed `entries` instead of a single
     * `file`. The output format is a document rather than an image, which is why
     * this is also the one entry whose `format` is not decided by the caller.
     */
    pdf: {
        accept: PDF_INPUT_FORMATS,
        invalidTypeError: `File failed validation. Please add a valid ${joinOr(PDF_INPUT_FORMATS.map(formatLabel))} image.`,
        prefix: 'resizo',
        multi: true,
        run: runJpgToPdf,
    },
    /**
     * The one op whose files are not images. `prepare` swaps out the image
     * intake — magic bytes, EXIF, pixel budget — for the PDF one; see
     * prepareMergeEntry for why none of those questions transfers.
     */
    merge: {
        accept: MERGE_PDF_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please add a valid PDF.',
        emptySourceError: 'No PDFs were provided.',
        prefix: MERGE_FILENAME_PREFIX,
        multi: true,
        prepare: prepareMergeEntry,
        run: runMergePdf,
    },
};

/** The op names the worker and the hook accept. */
export const CLIENT_OPS = Object.keys(OPERATIONS);

/** The ops whose source is a LIST of files rather than one. */
export const MULTI_FILE_OPS = Object.keys(OPERATIONS).filter((name) => OPERATIONS[name].multi);

/**
 * Everything that happens to one file before an op is allowed to look at it.
 *
 * Steps 0 to 3 of the order at the top of this file, in one place, because a
 * multi-file job has to do all of them once per file and doing them twice —
 * here and again in a loop — is how the two paths would start to disagree about
 * what a valid file is.
 */
async function prepareEntry(source, options, { spec, operation, sourceWidth, sourceHeight }) {
    const { file, name } = normaliseSource(source, options);

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

    return { file, name, sourceFormat, orientation, sourceWidth, sourceHeight };
}

/**
 * The same job prepareEntry does, for a file that is not an image.
 *
 * A SEPARATE FUNCTION RATHER THAN A BRANCH, because every step of the image
 * intake is a question a PDF cannot be asked. sniffImageType has no answer for
 * it and returning null would read as "damaged". readExifOrientation would walk
 * a JPEG segment table across a PDF's header. assessFile would refuse it outright
 * — its allowlist is `image/*` — and if it did not, it would go on to cost a
 * pixel surface for a file that never becomes pixels. Bending any of those to
 * accept a PDF would make the image path worse to make this one possible.
 *
 * What is left is the three checks that do transfer, in the same order the
 * server's gate has always used: is it a file, is it under the size limit, and
 * do its magic bytes say what it claims to be.
 *
 * The signature is read here so a wrong file is named at intake rather than
 * after the whole list has been accepted. mergePdfs checks it again over the
 * full bytes, because it is an engine entry point in its own right and must not
 * depend on having been called through this.
 */
async function prepareMergeEntry(source, options, { spec }) {
    const { file, name } = normalisePdfSource(source, options);

    if (typeof file?.size !== 'number' || !Number.isFinite(file.size) || file.size === 0) {
        throw new JobError('That file is empty.', {
            code: 'invalid-file',
            suggestion: 'Choose a PDF that has something in it.',
        });
    }

    if (file.size > MAX_FILE_SIZE) {
        throw new JobError(`${name} is larger than ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB.`, {
            code: 'invalid-file',
            suggestion: `PDFs up to ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB are supported.`,
        });
    }

    const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
    const sourceFormat = isPdfSignature(head) ? 'pdf' : null;

    if (!sourceFormat || !spec.accept.includes(sourceFormat)) {
        throw new JobError(spec.invalidTypeError, { code: 'invalid-type' });
    }

    // No orientation and no dimensions, and both nulls are the truth rather
    // than a gap: a document has neither.
    return { file, name, sourceFormat, orientation: ORIENTATION_NONE, sourceWidth: null, sourceHeight: null };
}

/**
 * A caller's per-file dimensions, if it measured any.
 *
 * A multi-file job takes them as an array lined up with the files —
 * `sizes: [{ width, height }, null, ...]` — because there is no single
 * sourceWidth to pass. A hole is allowed and means "not measured": the gate
 * then defers on that file exactly as it does for a HEIC with no preview.
 */
function sizeAt(options, index) {
    const entry = Array.isArray(options?.sizes) ? options.sizes[index] : null;
    return {
        sourceWidth: positiveOrNull(entry?.width),
        sourceHeight: positiveOrNull(entry?.height),
    };
}

/**
 * Runs one job end to end.
 *
 * @param {string} operation                  one of CLIENT_OPS
 * @param {File|Blob|ArrayBuffer|Uint8Array|Array} source  an ARRAY for an op in
 *   MULTI_FILE_OPS, in the order the pages are wanted; one file for every other
 * @param {object} [options]                  the op's own fields, plus
 *   sourceWidth/sourceHeight (pass them whenever the page has measured the
 *   image — without them the memory gate cannot run until after the decode),
 *   `sizes` for a multi-file op, and filename/mimeType for a raw buffer
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

    const sources = spec.multi ? source : [source];

    if (spec.multi && (!Array.isArray(sources) || sources.length === 0)) {
        throw new JobError(spec.emptySourceError ?? 'No images were provided.', { code: 'invalid-file' });
    }

    // Which intake this op's files go through. Everything on this site is an
    // image except /merge-pdf, so the image one is the default and an op that
    // takes something else says so once, in its registry entry.
    const prepare = spec.prepare ?? prepareEntry;

    // Sequential, not Promise.all: each file's head is a real read and the
    // refusals are ordered — the first bad file is the one named, every time,
    // rather than whichever read happened to finish first.
    const entries = [];
    for (let index = 0; index < sources.length; index += 1) {
        const measured = spec.multi
            ? sizeAt(options, index)
            : {
                sourceWidth: positiveOrNull(options.sourceWidth),
                sourceHeight: positiveOrNull(options.sourceHeight),
            };

        entries.push(await prepare(sources[index], options, { spec, operation, ...measured }));
        guard();
    }

    const [first] = entries;

    report(PROGRESS.checked, 'checked');
    guard();

    const outcome = await spec.run({
        file: first.file,
        name: first.name,
        entries,
        options,
        sourceFormat: first.sourceFormat,
        sourceWidth: first.sourceWidth,
        sourceHeight: first.sourceHeight,
        orientation: first.orientation,
        operation,
        report,
        guard,
    });

    guard();

    // Every file in the job, because a document made of twenty photos was made
    // of all twenty and a saving measured against the first one would be a
    // made-up number.
    const originalBytes = entries.reduce((sum, entry) => sum + (Number(entry.file.size) || 0), 0);
    const sourceFormat = first.sourceFormat;
    const filename = buildOutputFilename({ name: first.name, prefix: spec.prefix, format: outcome.format });

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
        // Documents only, null everywhere else. `targetMessage` is the sentence
        // for a size target that could not be met — /jpg-to-pdf hands back the
        // PDF anyway and says by how much it missed, where /compress throws.
        pageCount: outcome.pageCount ?? null,
        reencodedCount: outcome.reencodedCount ?? null,
        pageSize: outcome.pageSize ?? null,
        targetMessage: outcome.targetMessage ?? null,
        // No HTTP was involved, so there is no rate limit to report and no
        // headers to read. Both fields stay for shape-compatibility with the
        // server result the tool pages read today.
        remaining: null,
        durationMs: Math.round(now() - startedAt),
    };
}
