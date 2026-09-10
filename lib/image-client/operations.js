/** True when any decoded pixel has alpha below 255. */
function hasTransparentPixel(imageData) {
    const data = imageData?.data;
    if (!data) return false;
    for (let index = 3; index < data.length; index += 4) {
        if (data[index] < 255) return true;
    }
    return false;
}

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
    DPI_INPUT_FORMATS,
    HEIC_INPUT_FORMATS,
    HEIC_OUTPUT_FORMATS,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
    MERGE_PDF_INPUT_FORMATS,
    METADATA_INPUT_FORMATS,
    PDF_INPUT_FORMATS,
    PDF_MIME_TYPE,
    RASTER_INPUT_FORMATS,
    RESIZE_INPUT_FORMATS,
    SIGNATURE_OUTPUT_FORMATS,
} from '@/lib/limits';
import { savingsPercent } from '@/lib/format/submit-helpers';
import { formatLabel } from '@/lib/format/upload-helpers';
// Deliberately on ONE line each, for the reason spelled out beside the
// requirements.js import below: the architecture tests read import edges with a
// regex that cannot cross a newline.
import { layoutSheet, sheetFilenameSuffix, sourceEnlargement, DEFAULT_GAP_MM, DEFAULT_MARGIN_MM, DEFAULT_SHEET_DPI } from '@/lib/format/print-sheet';
import { parsePositiveInt, parseScale } from '@/lib/image/dimensions';
import { buildOutputFilename } from '@/lib/image/filename';
import { isPdfSignature, sniffImageType } from '@/lib/image/magic-bytes';
import { parseQuality } from '@/lib/image/quality';
import {
    assessFile,
    assessPdfJob,
    assessPdfMergeJob,
    assessPixels,
    readDeviceProfile,
} from '@/lib/image-client/capability';
import { compressToTargetBytes, fitUnderTargetBytes } from '@/lib/image-client/compress-target';
import { cropImageData, resolveCropRect } from '@/lib/image-client/crop';
import { decodeAndDownscale, decodeToImageData } from '@/lib/image-client/decode';
import { readResolution, runDpi, writeResolution } from '@/lib/image-client/dpi';
import { BROWSER_OUTPUT_FORMATS, encodeImageData, formatSupportsQuality } from '@/lib/image-client/encode';
import { flattenImageData, formatKeepsAlpha, parseBackground } from '@/lib/image-client/flatten';
import { runStrip } from '@/lib/image-client/metadata-strip';
import { padImageData } from '@/lib/image-client/pad';
// Deliberately on ONE line. tests/helpers/import-graph.js reads import edges
// with a regex that cannot cross a newline, so a multi-line import is invisible
// to every architecture rule built on it — including the no-dead-code rule,
// which reported this module as unreachable while operations.js was importing
// it. See the note handed to the architect; until the walker is fixed, a lib/
// module whose ONLY importer spells the import across lines is unprotected.
import { fitGeometry, parseRequirements, validateOutput, MINIMUM_QUALITY_LADDER, MINIMUM_UNREACHABLE_CODE } from '@/lib/image-client/requirements';
import { readExifOrientation, EXIF_SCAN_BYTES, ORIENTATION_NONE } from '@/lib/image-client/orientation';
import {
    buildPdf,
    buildSheetPdf,
    canEmbedWithoutDecoding,
    parseMarginPoints,
    parsePageOrientation,
    parsePageSize,
    targetMissMessage,
    PDF_JPEG_QUALITY,
} from '@/lib/image-client/pdf';
import { composeSheet, validateSheet, SHEET_JPEG_QUALITY } from '@/lib/image-client/sheet';
import { mergePdfs, MERGE_FILENAME_PREFIX } from '@/lib/image-client/pdf-merge';
import {
    canUseNativeDownscale,
    centreCropRect,
    coverDimensions,
    fitWithin,
    resampleSize,
    resizeImageData,
    targetDimensions,
    FIT_COVER,
} from '@/lib/image-client/resize';
import {
    bytesToKb,
    impossibleTargetMessage,
    parseTargetBytes,
    TARGET_SEARCH_DEADLINE_MS,
    TARGET_UNREACHABLE_CODE,
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
    const { file, sourceFormat, sourceWidth, sourceHeight, operation, device, report, guard } = context;

    report(PROGRESS.decoding, 'decoding');
    guard();

    const box = (sourceWidth && sourceHeight) ? resampleSize(sourceWidth, sourceHeight, target) : null;

    /**
     * The native lane is the engine's default for any downscale — one call that
     * decodes and scales together, 110 ms against roughly 1.5 s for the WASM
     * lanczos3 fallback on a 12 MP photo.
     *
     * This used to demand that `fitWithin` reproduce `box` exactly, which is a
     * question about arithmetic rather than about capability: the target rounds
     * each side independently and fitWithin rounds both from one shared ratio,
     * so they disagree by a pixel whenever the target is not exactly
     * proportional. A 4032x3024 photo at 25% took the fast lane and the same
     * photo at 30% did not — measured across 49 real source sizes, ~21% of
     * percentage resizes were being pushed onto the slow resampler for that
     * reason alone.
     *
     * The condition that actually matters is whether the browser can do it at
     * all, which `canUseNativeDownscale` already states. `exact: true` then
     * stops the decoder recomputing a box the caller has already decided.
     */
    const nativeCanFit = Boolean(box && canUseNativeDownscale({
        sourceWidth,
        sourceHeight,
        width: box.width,
        height: box.height,
    }) && (box.width !== sourceWidth || box.height !== sourceHeight));

    let decoded;
    try {
        decoded = nativeCanFit
            ? await decodeAndDownscale(file, box.width, {
                maxHeight: box.height,
                sourceWidth,
                sourceHeight,
                mimeOrSniff: sourceFormat,
                exact: true,
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
            device,
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
            device: context.device,
            orientation: context.orientation,
        });
        if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });
    }

    const decoded = await decodePixels(context, resolved.target);

    // /resize offers JPEG for any source, so this is not a no-op lane: without
    // it a transparent PNG reached MozJPEG with live alpha and was written as
    // though it were opaque — 254,0,0 for a half-red pixel where /convert and
    // libvips both give 128,0,0. It also disagreed with itself, because
    // @jsquash/resize premultiplies and a resample therefore zeroed the RGB
    // under a clear pixel while the no-resample lane kept it white.
    // flattenImageData returns the same object when there is no transparency,
    // so an opaque photograph allocates nothing here.
    const pixels = formatKeepsAlpha(format)
        ? decoded.data
        : flattenImageData(decoded.data, parseBackground(context.options?.background));
    const encoded = await encodeStage(context, pixels, { format, quality: DEFAULT_QUALITY });

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
 * What a byte target is allowed to cost.
 *
 * 'keep' is the default and the one /compress has always had: hit the size
 * without touching the dimensions, and refuse when no quality reaches it. 'fit'
 * is the opt-in trade — the same target, with the picture allowed to get
 * smaller once the quality floor is reached. Which one ran comes back on the
 * result, because a resize the visitor did not ask for would otherwise be
 * indistinguishable from one they did.
 */
export const COMPRESS_POLICIES = ['keep', 'fit'];

const DEFAULT_COMPRESS_POLICY = 'keep';

function resolveCompressPolicy(requested) {
    if (requested === null || requested === undefined) return DEFAULT_COMPRESS_POLICY;

    const value = String(requested).trim().toLowerCase();
    if (value === '') return DEFAULT_COMPRESS_POLICY;

    return COMPRESS_POLICIES.includes(value) ? value : null;
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

    const policy = resolveCompressPolicy(options.policy);
    if (!policy) {
        throw new JobError(`Invalid policy. Must be ${joinOr(COMPRESS_POLICIES)}.`, { code: 'invalid-policy' });
    }

    const decoded = await decodePixels(context, null);
    // Same rule as /convert: a format with no alpha channel gets pixels that
    // have already been composited, so the two lanes cannot disagree about what
    // a transparent pixel becomes.
    const pixels = formatKeepsAlpha(format)
        ? decoded.data
        : flattenImageData(decoded.data, parseBackground(context.options?.background));

    const sizing = {
        policy,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
    };

    if (!target.ok) {
        const encoded = await encodeStage(context, pixels, { format, quality });
        return {
            ...encoded,
            ...sizing,
            width: decoded.width,
            height: decoded.height,
            viaNative: decoded.viaNative,
            resized: false,
            steps: 0,
        };
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

    const searchInput = {
        imageData: pixels,
        format,
        targetBytes: target.value,
        deadline: now() + TARGET_SEARCH_DEADLINE_MS,
        now,
        guard,
        // The slowest job on the site, so the bar reports every real encode
        // rather than sitting still through eight of them. Under 'fit' the
        // total is the worst case across every step, which is the only total
        // that cannot make the bar go backwards when a step is added.
        onIteration: (index, total) => {
            report(
                Math.round(PROGRESS.resized + ((PROGRESS.encoded - PROGRESS.resized) * index) / total),
                'searching',
            );
        },
    };

    const search = policy === 'fit'
        ? await fitUnderTargetBytes(searchInput)
        : await compressToTargetBytes(searchInput);

    if (!search.fit) {
        const smallest = search.floorBytes ?? (Number(context.file.size) || 0);
        throw new JobError(impossibleTargetMessage(target.value, smallest), {
            code: TARGET_UNREACHABLE_CODE,
            // Under 'fit' the picture was already allowed to shrink, so "resize
            // it first" is advice the tool has just taken on the visitor's
            // behalf and failed with. The smallest size it reached is the only
            // useful thing left to say.
            suggestion: policy === 'fit'
                ? `Raise the target size. The smallest this could try was ${search.width}×${search.height} pixels.`
                : 'Raise the target size, or resize the image smaller first.',
        });
    }

    report(PROGRESS.encoded, 'encoded');

    return {
        ...search.fit,
        ...sizing,
        viaNative: decoded.viaNative,
        targetBytes: target.value,
        iterations: search.iterations,
        resized: search.resized ?? false,
        steps: search.steps ?? 0,
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
 * composited onto the colour the panel sends, and onto WHITE when it sends
 * none. Without that step MozJPEG would ignore the alpha byte entirely and the
 * chosen colour would never reach the picture at all.
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

    // QUALITY, READ BEFORE THE DECODE. /convert always encoded at
    // DEFAULT_QUALITY, which is the right answer for one picture somebody is
    // looking at and the wrong one for a folder of forty: the reason a batch is
    // being converted at all is usually size. Absent still means the default —
    // the single-file page sends nothing and is unchanged — and a malformed
    // value is refused here rather than after a decode has been spent on it.
    // PNG ignores it, because @jsquash/png is lossless and has no dial.
    const parsedQuality = parseQuality(context.options?.quality);
    if (!parsedQuality.ok && !parsedQuality.absent) {
        throw new JobError(parsedQuality.error, { code: 'invalid-quality' });
    }
    const quality = parsedQuality.ok ? parsedQuality.value : DEFAULT_QUALITY;

    const decoded = await decodePixels(context, null);
    // Whether any pixel was see-through, read from the decoded alpha bytes
    // rather than from the container: a screenshot saved as RGBA is fully
    // opaque, and only a real transparent pixel makes a flatten or an alpha
    // channel in the output a claim worth checking.
    const transparent = hasTransparentPixel(decoded.data);
    const pixels = formatKeepsAlpha(format)
        ? decoded.data
        : flattenImageData(decoded.data, parseBackground(context.options?.background));
    const encoded = await encodeStage(context, pixels, { format, quality });

    return { ...encoded, width: decoded.width, height: decoded.height, viaNative: decoded.viaNative, transparent };
}

/**
 * /heic — an iPhone photo out to JPEG, or to PNG.
 *
 * The slowest job here by a distance: libheif measured 729 ms of decode plus
 * 69 ms of one-off init on a 12 MP HEIC, and MozJPEG then wants 1.74-1.88 s to
 * write it back out at full size. No downscale is applied, because the route
 * applied none — a HEIC conversion returns the photo, not a smaller photo.
 *
 * JPEG stays the default and is what /heic-to-jpg promises. PNG is the other
 * half of the same intent and is a genuinely different lane rather than a
 * different string: it carries alpha, so the flatten JPEG needs would be
 * destroying information for nothing, and it has no quality dial for
 * HEIC_JPEG_QUALITY to set.
 */
function resolveHeicFormat(requested) {
    if (requested === null || requested === undefined) return 'jpeg';

    const value = String(requested).trim().toLowerCase();
    if (value === '') return 'jpeg';

    const normalised = value === 'jpg' ? 'jpeg' : value;
    return HEIC_OUTPUT_FORMATS.includes(normalised) ? normalised : null;
}

async function runHeic(context) {
    const format = resolveHeicFormat(context.options?.format);
    if (!format) {
        throw new JobError(`Invalid output format. Must be ${joinOr(HEIC_OUTPUT_FORMATS)}.`, {
            code: 'invalid-format',
        });
    }

    const decoded = await decodePixels(context, null);

    // A camera HEIC has no alpha, so for JPEG this is in practice the
    // same-object return — but libheif hands back interleaved RGBA, and a HEIC
    // carrying an alpha auxiliary channel would otherwise reach MozJPEG with
    // the byte still live, exactly as /resize did. Consistency with runConvert
    // is the point, and it is why the decision is formatKeepsAlpha rather than
    // a hard-coded flatten.
    const pixels = formatKeepsAlpha(format)
        ? decoded.data
        : flattenImageData(decoded.data, parseBackground(context.options?.background));
    const encoded = await encodeStage(context, pixels, { format, quality: HEIC_JPEG_QUALITY });

    return { ...encoded, width: decoded.width, height: decoded.height, viaNative: decoded.viaNative };
}

/**
 * /signature-resizer — a scan, cropped to the signature and sized to the box a
 * form asks for.
 *
 * WHY THIS IS AN OP AND NOT A PRESET ON /resize
 *
 * The forms that ask for a signature ask for a box in pixels AND a ceiling in
 * bytes at the same time ("300x100, under 50 KB"), on a picture whose useful
 * part is a fraction of the scan. Answering that with the existing tools is
 * /crop, then /resize, then /compress, with a guess between each pair. Every
 * stage below is one of those tools' own pieces, called in order — there is no
 * second cropper, no second resampler and no second byte search here.
 *
 * THE THREE WAYS TO REACH A BOX
 *
 * A signature is wide and short and the box almost never shares its ratio, so
 * "make it 300x100" is genuinely ambiguous and the visitor is the only one who
 * knows which they meant:
 *
 *   fit      scale until the whole signature is INSIDE the box, upscaling
 *            allowed. The output can be smaller than the box on one axis.
 *            Nothing is cropped and nothing is distorted, so it is the default.
 *   cover    fill the box exactly and trim the overflow off the centre — the
 *            same cover-then-crop /resize does for a two-sided target.
 *   stretch  resample straight to the box. The one deliberate distortion in
 *            this engine, and it exists because some portals check the
 *            dimensions and nothing else.
 *
 * WHITE, STATED RATHER THAN INHERITED. The engine's own fallback is white too
 * (lib/image-client/flatten.js), so this constant no longer differs from it —
 * but a signature going onto a form is the one job where a black box around the
 * ink would be indefensible, and this op should not start filling one in the
 * day somebody revisits that fallback. It is still only a default: the field is
 * honoured when it is set.
 */
const SIGNATURE_FIT_MODES = ['fit', FIT_COVER, 'stretch'];

const DEFAULT_SIGNATURE_FIT = 'fit';

const SIGNATURE_BACKGROUND = 'white';

/** One of the three named modes, or null for anything else. */
function resolveSignatureFit(requested) {
    if (requested === null || requested === undefined) return DEFAULT_SIGNATURE_FIT;

    const value = String(requested).trim().toLowerCase();
    if (value === '') return DEFAULT_SIGNATURE_FIT;

    return SIGNATURE_FIT_MODES.includes(value) ? value : null;
}

/** JPEG or PNG, or null. WebP is absent because the forms do not take it. */
function resolveSignatureFormat(requested) {
    if (requested === null || requested === undefined) return 'jpeg';

    const value = String(requested).trim().toLowerCase();
    if (value === '') return 'jpeg';

    const normalised = value === 'jpg' ? 'jpeg' : value;
    return SIGNATURE_OUTPUT_FORMATS.includes(normalised) ? normalised : null;
}

/**
 * The rectangle to keep, for the two ops that take an optional one.
 *
 * All four values absent means the whole image, because a signature that
 * already fills its scan — or a photo already framed the way its owner wants —
 * needs no crop; ANY of the four present means all four must be, which is
 * parseCropParams' own rule and the reason a half-filled rectangle is a refusal
 * rather than a guess.
 */
function resolveOptionalCrop(options, { sourceWidth, sourceHeight }) {
    const given = (value) => value !== null && value !== undefined && String(value).trim() !== '';

    if (![options.x, options.y, options.cropWidth, options.cropHeight].some(given)) {
        return { ok: true, rect: { x: 0, y: 0, width: sourceWidth, height: sourceHeight } };
    }

    return resolveCropRect(
        { x: options.x, y: options.y, width: options.cropWidth, height: options.cropHeight },
        { sourceWidth, sourceHeight },
    );
}

/**
 * The size to resample to and the size to hand back, for one fit mode.
 *
 * `intermediate` is non-null only for a cover, where the resampler is aimed at
 * a box BIGGER than the output on one axis and the difference is cropped off
 * afterwards. It is what the memory gate has to be told about, because it is
 * the surface that really gets allocated.
 */
function signatureTargetSize(fit, crop, box) {
    if (fit === 'stretch') {
        return { ok: true, width: box.width, height: box.height, intermediate: null };
    }

    if (fit === FIT_COVER) {
        const cover = coverDimensions(crop.width, crop.height, box.width, box.height);
        return { ok: true, width: box.width, height: box.height, intermediate: cover };
    }

    // Which side of the box the crop runs out of first, by integer
    // cross-product rather than a float division — the same way
    // centeredRectForRatio picks its constrained axis. The side that binds is
    // then held exactly and the other is derived off the CROP's ratio, which is
    // the one piece of arithmetic explicitTargetDimensions already owns.
    const bindsOnWidth = crop.width * box.height >= box.width * crop.height;
    const inside = targetDimensions(crop.width, crop.height, bindsOnWidth
        ? { width: box.width }
        : { height: box.height });

    if (!inside.ok) return inside;

    return { ok: true, width: inside.width, height: inside.height, intermediate: null };
}

async function runSignature(context) {
    const { options, report, guard } = context;

    // Everything that can be refused without pixels is refused without pixels.
    // A 45 MB surface allocated for a job that was never going to be allowed is
    // the exact shape of the failure the memory gate exists to prevent.
    const fit = resolveSignatureFit(options.fit);
    if (!fit) {
        throw new JobError(`Invalid fit. Must be ${joinOr(SIGNATURE_FIT_MODES)}.`, { code: 'invalid-fit' });
    }

    const format = resolveSignatureFormat(options.format);
    if (!format) {
        throw new JobError(`Invalid output format. Must be ${joinOr(SIGNATURE_OUTPUT_FORMATS)}.`, {
            code: 'invalid-format',
        });
    }

    const target = parseTargetBytes(options.targetBytes);
    if (!target.ok && !target.absent) throw new JobError(target.error, { code: 'invalid-target' });

    const parsedWidth = parsePositiveInt(options.width, { max: MAX_DIMENSION });
    const parsedHeight = parsePositiveInt(options.height, { max: MAX_DIMENSION });

    if ((!parsedWidth.ok && !parsedWidth.absent) || (!parsedHeight.ok && !parsedHeight.absent)) {
        throw new JobError(DIMENSION_ERROR, { code: 'invalid-dimensions' });
    }

    if (!parsedWidth.ok && !parsedHeight.ok) {
        throw new JobError('Provide a width or a height for the signature.', { code: 'invalid-dimensions' });
    }

    const decoded = await decodePixels(context, null);

    const crop = resolveOptionalCrop(options, {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
    });
    if (!crop.ok) throw new JobError(crop.error, { code: 'invalid-crop' });

    const cropped = cropImageData(decoded.data, crop.rect);
    guard();

    // The box, on the CROP's ratio rather than the source's. A width of 200
    // asked of a 400x200 selection is 200x100, and asking the source instead
    // would derive the height of a picture the visitor has just cut away.
    const box = targetDimensions(crop.rect.width, crop.rect.height, {
        width: parsedWidth.ok ? parsedWidth.value : null,
        height: parsedHeight.ok ? parsedHeight.value : null,
    });
    if (!box.ok) throw new JobError(box.error, { code: 'invalid-dimensions' });

    const size = signatureTargetSize(fit, crop.rect, box);
    if (!size.ok) throw new JobError(size.error, { code: 'invalid-dimensions' });

    const gate = assessPixels({
        sourceWidth: crop.rect.width,
        sourceHeight: crop.rect.height,
        targetWidth: size.width,
        targetHeight: size.height,
        intermediateWidth: size.intermediate?.width ?? null,
        intermediateHeight: size.intermediate?.height ?? null,
        fileBytes: Number(context.file.size) || 0,
        operation: 'signature',
        device: context.device,
        // The pixels are already upright and already cropped by this point, so
        // neither surface may be charged for a second time.
        orientation: ORIENTATION_NONE,
    });
    if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });

    const resampleTo = size.intermediate ?? { width: size.width, height: size.height };

    let pixels = cropped;

    if (pixels.width !== resampleTo.width || pixels.height !== resampleTo.height) {
        const resized = await resizeImageData(pixels, resampleTo);
        report(PROGRESS.resized, 'resizing');
        pixels = resized.data;
    }
    guard();

    if (pixels.width !== size.width || pixels.height !== size.height) {
        pixels = cropImageData(pixels, centreCropRect(pixels.width, pixels.height, size.width, size.height));
        guard();
    }

    // '' is "the field was not filled in", not "black" — the same rule every
    // other option on this op follows.
    const background = typeof options.background === 'string' && options.background.trim() !== ''
        ? options.background
        : SIGNATURE_BACKGROUND;

    const flat = formatKeepsAlpha(format) ? pixels : flattenImageData(pixels, parseBackground(background));
    guard();

    const described = {
        crop: crop.rect,
        requestedWidth: box.width,
        requestedHeight: box.height,
        fit,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        viaNative: decoded.viaNative,
    };

    if (!target.ok) {
        const encoded = await encodeStage(context, flat, { format, quality: DEFAULT_QUALITY });

        return {
            ...encoded,
            ...described,
            width: size.width,
            height: size.height,
            resized: false,
            steps: 0,
            scalePercent: 100,
        };
    }

    // The byte ceiling is spent AFTER the box has been reached, and it is the
    // only thing allowed to take the output below it. `resized` is therefore
    // true only when the ceiling cost the visitor pixels the box had not.
    const search = await fitUnderTargetBytes({
        imageData: flat,
        format,
        targetBytes: target.value,
        deadline: now() + TARGET_SEARCH_DEADLINE_MS,
        now,
        guard,
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
            code: TARGET_UNREACHABLE_CODE,
            suggestion: `Raise the target size. The smallest this could try was ${search.width}×${search.height} pixels.`,
        });
    }

    report(PROGRESS.encoded, 'encoded');

    return {
        ...search.fit,
        ...described,
        targetBytes: target.value,
        iterations: search.iterations,
        resized: search.resized,
        steps: search.steps,
    };
}

/**
 * /passport-photo — a picture made to satisfy a form's whole list of
 * requirements at once, and then checked against that list by something that
 * did not produce it.
 *
 * WHY IT MAY NEVER TRADE PIXELS FOR BYTES, AND WHY THAT IS THE WHOLE OP
 *
 * Every other byte-target path in this engine has a second lever. /compress
 * will shrink the picture to reach a size, because somebody asking for 100 KB
 * has asked about the file and not about the pixel count. Here the pixel count
 * IS the requirement: a portal that wants 600x750 rejects 540x675 exactly as
 * fast as it rejects a file that is too big, so an op that quietly spent the
 * dimensions to reach the bytes would produce a file that fails for a reason
 * nobody was told about. So the search is compressToTargetBytes, which never
 * resizes, and NEVER fitUnderTargetBytes, which does. A ceiling that cannot be
 * met at those dimensions is a refusal that says so, with the two things the
 * visitor can actually change named in the suggestion.
 *
 * THE FLOOR IS THE OTHER HALF, AND IT IS NOT A SEARCH
 *
 * "At least 50 KB" is a real rule on real forms — HM Passport Office states it
 * — and it is the one requirement a good encoder makes HARDER to meet. There is
 * no best answer to find, only the first quality that clears the bar, so the
 * ladder in requirements.js is walked in order and the first rung that clears
 * it (without breaking a ceiling on the other side) wins. PNG never climbs it:
 * this build has no PNG quality axis, so four identical encodes would be four
 * wasted seconds ending in the same refusal.
 *
 * THE VERDICT COMES FROM A SECOND READER. validateOutput opens the finished
 * bytes with its own header parser and reports six rows. It is called here, on
 * the real output, after the DPI record has been written — the last possible
 * moment — because a check run on anything earlier is a check on a file the
 * visitor is not being given.
 */
/**
 * The way out of a ceiling that could not be met, in terms of the levers the
 * chosen format actually has: PNG has no quality axis in this build, and a
 * visitor already writing WebP cannot be told to choose it.
 */
function ceilingSuggestion(format) {
    const kept = 'The dimensions were kept as you asked.';
    if (format === 'png') {
        return `PNG has no quality setting here. Ask for JPEG, or WebP if the form accepts it, or raise the limit. ${kept}`;
    }
    if (format === 'webp') return `Allow a lower quality, or raise the limit. ${kept}`;
    return `Allow a lower quality, choose WebP if the form accepts it, or raise the limit. ${kept}`;
}

async function runFit(context) {
    const { options, report, guard } = context;

    // Everything that can be refused without pixels is refused without pixels.
    const parsed = parseRequirements(options);
    if (!parsed.ok) throw new JobError(parsed.error, { code: parsed.code });

    const requirement = parsed.requirement;

    const decoded = await decodePixels(context, null);

    const crop = resolveOptionalCrop(options, {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
    });
    if (!crop.ok) throw new JobError(crop.error, { code: 'invalid-crop' });

    const cropped = cropImageData(decoded.data, crop.rect);
    guard();

    const geometry = fitGeometry({
        sourceWidth: crop.rect.width,
        sourceHeight: crop.rect.height,
        width: requirement.width,
        height: requirement.height,
        geometry: requirement.geometry,
    });
    if (!geometry.ok) throw new JobError(geometry.error, { code: 'invalid-dimensions' });

    const gate = assessPixels({
        sourceWidth: crop.rect.width,
        sourceHeight: crop.rect.height,
        targetWidth: requirement.width,
        targetHeight: requirement.height,
        // A cover resamples to a surface bigger than the output on one axis,
        // and that surface is the one that really gets allocated.
        intermediateWidth: geometry.resampleTo.width,
        intermediateHeight: geometry.resampleTo.height,
        fileBytes: Number(context.file.size) || 0,
        operation: 'fit',
        device: context.device,
        // Already upright and already cropped, so neither surface is charged twice.
        orientation: ORIENTATION_NONE,
    });
    if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });

    let pixels = cropped;

    if (pixels.width !== geometry.resampleTo.width || pixels.height !== geometry.resampleTo.height) {
        const resized = await resizeImageData(pixels, geometry.resampleTo);
        report(PROGRESS.resized, 'resizing');
        pixels = resized.data;
    }
    guard();

    if (geometry.trim) {
        pixels = cropImageData(pixels, geometry.trim);
        guard();
    }

    if (geometry.pad) {
        pixels = padImageData(pixels, requirement.width, requirement.height, requirement.background);
        guard();
    }

    const flat = formatKeepsAlpha(requirement.format)
        ? pixels
        : flattenImageData(pixels, requirement.background);
    guard();

    const encoded = await encodeForRequirement(context, flat, requirement);
    const withDpi = await applyRequiredDpi(encoded, requirement);
    const validation = validateOutput(withDpi.bytes, requirement);

    return {
        blob: withDpi.blob,
        bytes: withDpi.bytes.byteLength,
        format: encoded.result.format,
        type: encoded.result.type,
        quality: encoded.result.quality,
        qualityApplied: encoded.result.qualityApplied,
        width: requirement.width,
        height: requirement.height,
        crop: crop.rect,
        requestedWidth: requirement.width,
        requestedHeight: requirement.height,
        fit: requirement.geometry,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        viaNative: decoded.viaNative,
        targetBytes: requirement.maxBytes,
        targetMet: requirement.maxBytes === null ? null : true,
        iterations: encoded.iterations,
        // Stated rather than defaulted: this op is the one that must never have
        // spent pixels to reach a size, and a reader of the result panel has to
        // be able to see that from the result itself.
        resized: false,
        dpi: withDpi.report,
        requirements: requirement,
        checks: validation.checks,
        verified: validation.verified,
    };
}

/** '600 × 600 pixels' — the phrasing both requirement refusals share. */
function describePixels(requirement) {
    return `${requirement.width} × ${requirement.height} pixels`;
}

/**
 * One encode, or the bounded search that reaches a ceiling, followed by the
 * ladder that reaches a floor. Split out of runFit because it is the only part
 * of the op with more than one way through it.
 */
async function encodeForRequirement(context, imageData, requirement) {
    const { report, guard } = context;
    const label = formatLabel(requirement.format);

    let result;
    let iterations = null;

    if (requirement.maxBytes === null) {
        result = await encodeStage(context, imageData, {
            format: requirement.format,
            quality: DEFAULT_QUALITY,
        });
    } else {
        const search = await compressToTargetBytes({
            imageData,
            format: requirement.format,
            targetBytes: requirement.maxBytes,
            minQuality: requirement.minQuality,
            deadline: now() + TARGET_SEARCH_DEADLINE_MS,
            now,
            guard,
            onIteration: (index, total) => {
                report(
                    Math.round(PROGRESS.resized + ((PROGRESS.encoded - PROGRESS.resized) * index) / total),
                    'searching',
                );
            },
        });

        iterations = search.iterations;

        // `targetMet` rather than `fit`: a PNG always hands its one lossless
        // encode back, and its honesty about whether that met the ceiling is
        // the only thing distinguishing the two cases.
        if (!search.targetMet) {
            throw new JobError(
                `Resizo couldn’t produce a ${label} under ${bytesToKb(requirement.maxBytes)} KB `
                + `at ${describePixels(requirement)}.`,
                {
                    code: TARGET_UNREACHABLE_CODE,
                    suggestion: ceilingSuggestion(requirement.format),
                },
            );
        }

        report(PROGRESS.encoded, 'encoded');
        result = search.fit;
    }

    if (requirement.minBytes === null || result.bytes >= requirement.minBytes) {
        return { result, iterations };
    }

    const raised = await climbToMinimumBytes(context, imageData, requirement);

    if (!raised) {
        throw new JobError(
            `Resizo couldn’t reach the ${bytesToKb(requirement.minBytes)} KB minimum `
            + `at ${describePixels(requirement)} even at the highest quality.`,
            {
                code: MINIMUM_UNREACHABLE_CODE,
                // Offering PNG to somebody already asking for PNG is advice
                // they cannot take, and this refusal is reachable for a PNG:
                // a flat picture is a few hundred bytes losslessly.
                suggestion: requirement.format === 'png'
                    ? 'Ask for larger dimensions. PNG is already the largest format Resizo writes.'
                    : 'Ask for larger dimensions, or PNG, which is bigger.',
            },
        );
    }

    return { result: raised.result, iterations: (iterations ?? 0) + raised.iterations };
}

/**
 * The first quality on the ladder whose encode clears the floor without
 * breaking a ceiling, or null when none of them does.
 *
 * FIRST rather than best, and that is deliberate: output grows with quality, so
 * the first rung that clears the floor is also the smallest file that clears
 * it, which is the one most likely to still fit a maximum on the other side.
 */
async function climbToMinimumBytes(context, imageData, requirement) {
    // PNG has no quality axis in this build, so every rung would encode the
    // identical file. Saying so costs nothing; climbing it costs four encodes.
    if (!formatSupportsQuality(requirement.format)) return null;

    let iterations = 0;

    for (const quality of MINIMUM_QUALITY_LADDER) {
        context.guard();

        const attempt = await encodeStage(context, imageData, { format: requirement.format, quality });
        iterations += 1;

        const clearsFloor = attempt.bytes >= requirement.minBytes;
        const keepsCeiling = requirement.maxBytes === null || attempt.bytes <= requirement.maxBytes;

        if (clearsFloor && keepsCeiling) return { result: attempt, iterations };
    }

    return null;
}

/**
 * The DPI record, written into the finished file the same way
 * /change-image-dpi writes it — the compressed image data is copied across byte
 * for byte and only the header block changes.
 *
 * `before` is null rather than a reading, because there is no before: the file
 * was created moments ago by this same job, so what its encoder happened to put
 * in a JFIF header is not a fact about the visitor's image.
 */
async function applyRequiredDpi(encoded, requirement) {
    const bytes = new Uint8Array(await encoded.result.blob.arrayBuffer());

    if (requirement.dpi === null) {
        return { bytes, blob: encoded.result.blob, report: null };
    }

    const written = writeResolution(bytes, requirement.dpi);

    return {
        bytes: written.bytes,
        blob: new Blob([written.bytes], { type: encoded.result.type }),
        report: { before: null, after: readResolution(written.bytes) },
    };
}

/* ------------------------------------------------------------ /passport-photo-print */

/** What this op can write. Two, and neither of them is a picture format choice. */
const SHEET_OUTPUTS = ['jpeg', 'pdf'];

/**
 * How a photo of one shape reaches a cell of another. Two, not the fitter's
 * three: a print sheet may never stretch a face, and there is no honest reason
 * to offer it here.
 */
const SHEET_FITS = ['cover', 'contain'];

function parseChoice(raw, allowed, fallback) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
    const value = String(raw).trim().toLowerCase();
    return allowed.includes(value) ? value : null;
}

/**
 * /passport-photo-print — several copies of one photo, at an exact physical
 * size, on one sheet of paper.
 *
 * WHY THE LAYOUT IS DECIDED BEFORE A PIXEL IS TOUCHED. Everything anyone can
 * get wrong about a print sheet is arithmetic on millimetres: a photo that does
 * not fit, a DPI outside what a printer resolves, more copies than the paper
 * holds. lib/format/print-sheet.js answers all of it with no image in hand, so
 * a refusal costs a sentence rather than a decode, and the page can draw the
 * exact same layout as a preview before a file is even chosen.
 *
 * WHY THE MEMORY GATE IS AIMED AT THE PAPER AND NOT AT THE PHOTO. The photo is
 * 600 x 600; the canvas it goes onto is 2480 x 3508 for an A4 sheet at 300 DPI,
 * and that canvas is what gets allocated and encoded. Costing this job by its
 * output picture — which is what every other op's target means — would let a
 * phone start a sheet it cannot hold and be killed silently mid-encode.
 *
 * WHY THE VERDICT COMES FROM THE BYTES. See the header of
 * lib/image-client/sheet.js: this is the one output on the site that is judged
 * with a ruler, after the ink is dry.
 */
async function runSheet(context) {
    const { options, report, guard } = context;

    const output = parseChoice(options.output, SHEET_OUTPUTS, 'jpeg');
    if (output === null) {
        throw new JobError(`Invalid output. Must be ${joinOr(['JPEG', 'PDF'])}.`, {
            code: 'invalid-output',
        });
    }

    const fit = parseChoice(options.fit, SHEET_FITS, 'cover');
    if (fit === null) {
        throw new JobError(`Invalid fill behaviour. Must be ${joinOr(SHEET_FITS)}.`, {
            code: 'invalid-fit',
        });
    }

    // 'off' and 'false' turn it off; anything else, including nothing at all,
    // leaves it on. A checkbox that is unticked posts no field.
    const wantsReference = !['off', 'false', '0'].includes(String(options.reference ?? '').trim().toLowerCase());

    const background = parseBackground(options.background);

    const layout = layoutSheet({
        paperWidthMm: options.paperWidthMm,
        paperHeightMm: options.paperHeightMm,
        orientation: options.orientation ?? 'auto',
        photoWidthMm: options.photoWidthMm,
        photoHeightMm: options.photoHeightMm,
        dpi: options.dpi ?? DEFAULT_SHEET_DPI,
        marginMm: options.marginMm ?? DEFAULT_MARGIN_MM,
        gapMm: options.gapMm ?? DEFAULT_GAP_MM,
        copies: options.copies ?? 'auto',
        guides: options.guides ?? 'corners',
        reference: wantsReference,
    });

    if (!layout.ok) throw new JobError(layout.error, { code: 'sheet-layout' });

    const decoded = await decodePixels(context, null);

    const crop = resolveOptionalCrop(options, {
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
    });
    if (!crop.ok) throw new JobError(crop.error, { code: 'invalid-crop' });

    const cropped = cropImageData(decoded.data, crop.rect);
    guard();

    const geometry = fitGeometry({
        sourceWidth: crop.rect.width,
        sourceHeight: crop.rect.height,
        width: layout.photo.widthPx,
        height: layout.photo.heightPx,
        geometry: fit,
    });
    if (!geometry.ok) throw new JobError(geometry.error, { code: 'invalid-dimensions' });

    const gate = assessPixels({
        sourceWidth: crop.rect.width,
        sourceHeight: crop.rect.height,
        // The paper, not the photo — the canvas that actually gets allocated.
        targetWidth: layout.paper.widthPx,
        targetHeight: layout.paper.heightPx,
        intermediateWidth: geometry.resampleTo.width,
        intermediateHeight: geometry.resampleTo.height,
        fileBytes: Number(context.file.size) || 0,
        operation: 'sheet',
        device: context.device,
        // Already upright and already cropped, so neither surface is charged twice.
        orientation: ORIENTATION_NONE,
    });
    if (!gate.ok) throw new JobError(gate.reason, { code: gate.code, suggestion: gate.suggestion });

    let pixels = cropped;

    if (pixels.width !== geometry.resampleTo.width || pixels.height !== geometry.resampleTo.height) {
        const resized = await resizeImageData(pixels, geometry.resampleTo);
        report(PROGRESS.resized, 'resizing');
        pixels = resized.data;
    }
    guard();

    if (geometry.trim) {
        pixels = cropImageData(pixels, geometry.trim);
        guard();
    }

    if (geometry.pad) {
        pixels = padImageData(pixels, layout.photo.widthPx, layout.photo.heightPx, background);
        guard();
    }

    // The paper is opaque, so a transparent source is composited onto the
    // padding colour rather than reaching the encoder with an alpha byte
    // MozJPEG would ignore.
    const photo = flattenImageData(pixels, background);
    guard();

    const enlargement = sourceEnlargement({
        keptWidth: crop.rect.width,
        keptHeight: crop.rect.height,
        photoWidthPx: layout.photo.widthPx,
        photoHeightPx: layout.photo.heightPx,
    });

    report(PROGRESS.encoding, 'encoding');

    const shared = {
        crop: crop.rect,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        viaNative: decoded.viaNative,
        fit,
        layout,
        enlargement,
        filenameSuffix: sheetFilenameSuffix(layout),
        resized: false,
    };

    if (output === 'pdf') {
        // One photo, embedded once and referenced by every cell — see
        // buildSheetPdf. Nothing paper-sized is ever allocated on this lane.
        const encodedPhoto = await encodeImageData(photo, {
            format: 'jpeg',
            quality: SHEET_JPEG_QUALITY,
        });
        guard();

        const document = await buildSheetPdf({
            photoJpegBytes: new Uint8Array(await encodedPhoto.blob.arrayBuffer()),
            layout,
        });
        guard();

        const validation = await validateSheet(
            new Uint8Array(await document.blob.arrayBuffer()),
            layout,
            { output },
        );

        report(PROGRESS.encoded, 'encoded');

        return {
            ...shared,
            blob: document.blob,
            bytes: document.bytes,
            format: 'pdf',
            type: PDF_MIME_TYPE,
            // A document is measured in points, and layout.paper carries them.
            width: null,
            height: null,
            pageCount: document.pageCount,
            quality: null,
            qualityApplied: false,
            checks: validation.checks,
            verified: validation.verified,
        };
    }

    const canvas = composeSheet(layout, photo);
    guard();

    const encoded = await encodeImageData(canvas, { format: 'jpeg', quality: SHEET_JPEG_QUALITY });
    guard();

    // The resolution record is the whole point of a printed sheet: without it a
    // print dialog has nothing to scale by and picks its own size.
    const written = writeResolution(new Uint8Array(await encoded.blob.arrayBuffer()), layout.dpi);
    const validation = await validateSheet(written.bytes, layout, { output });

    report(PROGRESS.encoded, 'encoded');

    return {
        ...shared,
        blob: new Blob([written.bytes], { type: encoded.type }),
        bytes: written.bytes.byteLength,
        format: encoded.format,
        type: encoded.type,
        width: layout.paper.widthPx,
        height: layout.paper.heightPx,
        quality: encoded.quality,
        qualityApplied: encoded.qualityApplied,
        dpi: { before: null, after: readResolution(written.bytes) },
        checks: validation.checks,
        verified: validation.verified,
    };
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
        // ESCAPE 2 in the iPad divergence: this gate runs ONLY here.
        // useLocalProcess gates /jpg-to-pdf per file with assessJob and never
        // calls assessPdfJob, so there is no main-thread check in front of it —
        // the document budget was simply 1024 MiB where it should be 614.
        device: context.device,
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
    signature: {
        accept: RASTER_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-signature',
        run: runSignature,
    },
    /**
     * /passport-photo. Wrapped in withJobErrors because the DPI write at the
     * end of it is dpi.js's, and dpi.js is a leaf that cannot build a JobError
     * without importing this module back.
     */
    fit: {
        accept: RASTER_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-photo',
        run: withJobErrors(runFit),
    },
    /**
     * /passport-photo-print. Wrapped in withJobErrors for the same reason the
     * fitter is: the DPI write, the compositor and the PDF writer are all
     * leaves that cannot build a JobError without importing this module back.
     */
    sheet: {
        accept: RASTER_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-print-sheet',
        run: withJobErrors(runSheet),
    },
    // The two byte-only ops. No pixel is decoded, so the intake is the header
    // one and the memory gate's bytes-only profile is the only budget they carry.
    dpi: {
        accept: DPI_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG or PNG image.',
        prefix: 'resizo-dpi',
        prepare: prepareBytesEntry,
        run: withJobErrors(runDpi),
    },
    strip: {
        accept: METADATA_INPUT_FORMATS,
        invalidTypeError: 'File failed validation. Please upload a valid JPEG, PNG, or WebP image.',
        prefix: 'resizo-clean',
        prepare: prepareBytesEntry,
        run: withJobErrors(runStrip),
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
async function prepareEntry(source, options, { spec, operation, device, sourceWidth, sourceHeight }) {
    const { file, name } = normaliseSource(source, options);

    // The head of the file, read once and used for both questions asked of it:
    // what format is this, and does it need turning the right way up. The
    // second one belongs BEFORE the memory gate, because turning a photo costs
    // a whole extra surface and a gate that has not been told about it is
    // costing the wrong job.
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    const sourceFormat = sniffImageType(head.subarray(0, SIGNATURE_BYTES));
    const orientation = readExifOrientation(head);

    const gate = assessFile(file, { operation, sourceWidth, sourceHeight, orientation, device });
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
 * The intake for an op that never becomes pixels — 'dpi' and 'strip'.
 *
 * A separate function for the same reason prepareMergeEntry is one. Three of
 * the image intake's questions transfer — is it a file, is it under the size
 * cap, do its magic bytes match the op's accept list — and the fourth does
 * not: assessFile costs a decoded surface, and a header edit allocates none.
 * The page has already asked assessJob with the op's bytes-only profile, and a
 * few copies of the file itself is the whole budget these ops have.
 *
 * The orientation tag is not read either. It is one of the things 'strip'
 * removes and one of the things 'dpi' leaves exactly where it found it, and
 * neither op turns a pixel.
 */
async function prepareBytesEntry(source, options, { spec, sourceWidth, sourceHeight }) {
    const { file, name } = normaliseSource(source, options);

    if (typeof file?.size !== 'number' || !Number.isFinite(file.size) || file.size === 0) {
        throw new JobError('That file is empty.', {
            code: 'invalid-file',
            suggestion: 'Choose an image that has something in it.',
        });
    }

    if (file.size > MAX_FILE_SIZE) {
        throw new JobError(`${name} is larger than ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB.`, {
            code: 'invalid-file',
            suggestion: `Images up to ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB are supported.`,
        });
    }

    const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
    const sourceFormat = sniffImageType(head);

    if (!sourceFormat || !spec.accept.includes(sourceFormat)) {
        throw new JobError(spec.invalidTypeError, { code: 'invalid-type' });
    }

    return { file, name, sourceFormat, orientation: ORIENTATION_NONE, sourceWidth, sourceHeight };
}

/**
 * dpi.js and metadata-strip.js are leaves — they must not import this file,
 * or the engine would have a cycle — so they throw plain Errors that carry a
 * `code`. Rebuilt as JobError here, because the worker's wire keeps the code
 * of a JobError and flattens anything else to 'failed'.
 */
function withJobErrors(run) {
    return async (context) => {
        try {
            return await run(context);
        } catch (error) {
            if (error instanceof JobError || typeof error?.code !== 'string') throw error;
            throw new JobError(error.message, { code: error.code, suggestion: error.suggestion ?? null });
        }
    };
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
/**
 * `device` travels rather than being re-derived, and that is a correctness fix.
 *
 * isIosLike() distinguishes iPadOS-pretending-to-be-a-Mac by `maxTouchPoints`,
 * which is spec'd only on Navigator — a WorkerNavigator does not have it. So
 * the worker read the same iPad as a Mac and dropped the 0.6 iOS haircut:
 * 1024 MiB where the page had correctly computed 614 MiB. Two worker-only
 * estimates escaped through that gap — the cover-resize gate, which charges an
 * intermediate the page never computes, and assessPdfJob, which has no
 * main-thread counterpart at all.
 *
 * The page owns the only complete view of the environment, so it reads the
 * profile once and sends it. The `readDeviceProfile()` default stays so every
 * existing caller and test keeps working unchanged.
 */
export async function runOperation(operation, source, options = {}, {
    onProgress = null,
    checkCancelled = null,
    device = readDeviceProfile(),
} = {}) {
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

        entries.push(await prepare(sources[index], options, { spec, operation, device, ...measured }));
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
        device,
        report,
        guard,
    });

    guard();

    // Every file in the job, because a document made of twenty photos was made
    // of all twenty and a saving measured against the first one would be a
    // made-up number.
    const originalBytes = entries.reduce((sum, entry) => sum + (Number(entry.file.size) || 0), 0);
    const sourceFormat = first.sourceFormat;
    // `filenameSuffix` is /passport-photo-print's alone: a sheet's identity is
    // the paper and the resolution it was laid out for, and two sheets of the
    // same photo differ in nothing else — so the source's own name is not part
    // of it. It still goes through the one sanitiser rather than being pasted
    // onto the name.
    const filename = buildOutputFilename({
        name: outcome.filenameSuffix ? null : first.name,
        prefix: spec.prefix,
        format: outcome.format,
        suffix: outcome.filenameSuffix ?? undefined,
    });

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
        transparent: outcome.transparent ?? null,
        quality: outcome.quality ?? null,
        // False whenever the number on the slider did not change the bytes —
        // which is every PNG in this build. The UI must not imply otherwise.
        qualityApplied: outcome.qualityApplied ?? false,
        scalePercent: outcome.scalePercent ?? null,
        crop: outcome.crop ?? null,
        iterations: outcome.iterations ?? null,
        viaNative: outcome.viaNative ?? false,
        // /compress and /signature-resizer only. `resized` is the one field a
        // panel must not get wrong: it is the difference between "we hit your
        // size" and "we hit your size by making your picture smaller", and the
        // second one has to be said out loud. Null and false everywhere else,
        // because no other op is allowed to trade pixels for bytes.
        policy: outcome.policy ?? null,
        resized: outcome.resized ?? false,
        originalWidth: outcome.originalWidth ?? null,
        originalHeight: outcome.originalHeight ?? null,
        steps: outcome.steps ?? null,
        // /signature-resizer only: the box that was asked for and how the
        // picture was made to meet it, which is the difference between an
        // output that is smaller than the box and one that was trimmed.
        requestedWidth: outcome.requestedWidth ?? null,
        requestedHeight: outcome.requestedHeight ?? null,
        fit: outcome.fit ?? null,
        // /passport-photo only: the requirement that was asked for, the six
        // rows an independent reader found in the finished bytes, and whether
        // every row that was asked for passed. Null on every other op, because
        // no other op makes a claim about its output that a form will check.
        requirements: outcome.requirements ?? null,
        checks: outcome.checks ?? null,
        verified: outcome.verified ?? null,
        // /passport-photo-print only: the whole physical layout the sheet was
        // built from — paper, photo, grid, cells, guides, the capacity notice —
        // so the panel and the preview read the same object the compositor did
        // rather than re-deriving a second, disagreeing one. `enlargement` is
        // the blow-up warning, null when the source was big enough.
        layout: outcome.layout ?? null,
        enlargement: outcome.enlargement ?? null,
        // /change-image-dpi only: the reading before and after, whether a record
        // had to be added, and which header fields were written.
        dpi: outcome.dpi ?? null,
        inserted: outcome.inserted ?? null,
        changed: outcome.changed ?? null,
        // /remove-image-metadata only: the blocks found, the ones removed and
        // the ones deliberately kept (an ICC profile) — never their values.
        detected: outcome.detected ?? null,
        removed: outcome.removed ?? null,
        kept: outcome.kept ?? null,
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
