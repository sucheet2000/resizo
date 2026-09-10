/**
 * Pre-Flight Capability and Memory Gate
 *
 * The server had an operating system underneath it. The browser does not: a
 * tab that asks for more memory than the device can spare is killed, and on
 * iOS it is killed SILENTLY — no exception, no error event, no chance to show
 * a message. The tab simply reloads and the user's photo is gone.
 *
 * So nothing in this engine allocates hopefully. Every job is costed here
 * first, against a budget derived from what the device actually reports, and a
 * job that does not fit is refused with a sentence a person can act on BEFORE
 * a single pixel buffer is created.
 *
 * The estimates are deliberately pessimistic. Being wrong by refusing a job
 * that would have worked costs one apologetic message; being wrong by
 * attempting a job that does not fit costs the user their file.
 *
 * Every threshold below is a named constant with its provenance in the comment
 * above it. If a number here has no stated source, that is a bug.
 */
import {
    HEIC_EXTENSIONS,
    HEIC_MIME_TYPES,
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
} from '@/lib/limits';
import { withinPixelBudget } from '@/lib/image/dimensions';
import { validateUpload } from '@/lib/image/validate';
import { ORIENTATION_NONE } from '@/lib/image-client/orientation';

/* ------------------------------------------------------- memory constants */

/** RGBA. Every decoded surface in this engine is 8-bit RGBA, never planar. */
export const BYTES_PER_PIXEL = 4;

/**
 * Decode holds two full surfaces at once: the codec's own output (an
 * ImageBitmap on the native path, a buffer inside the WASM heap on the codec
 * path) and the ImageData copy handed back to JS. Measured against the Phase 0
 * figure of 45.8 MB for one 12 MP RGBA surface, a 12 MP decode transiently
 * touches ~92 MB.
 */
export const DECODE_SURFACE_COPIES = 2;

/**
 * One more full surface, for turning a photo the right way up.
 *
 * A rotation cannot be done in place — a pixel's destination is somewhere the
 * loop has not read yet — so applyOrientation allocates a whole second surface
 * and both are live until the source is dropped. On a 12 MP photo that is
 * another 48 MB on top of the 92 MB the decode already touches.
 *
 * It is charged ONLY when the pixels have to be turned in JavaScript, which is
 * the WASM decode route and nothing else. The native decoder folds the turn into
 * its own single pass, and libheif applies the HEIF transform inside its heap —
 * in both of those the copy is already counted as the codec's own output. This
 * follows the same modelling as the resize stage below, which likewise prices
 * the route the job is expected to take rather than the route it might fall back
 * to; over-charging here would refuse a perfectly ordinary portrait photo on an
 * iPhone, which is the single most common job this engine has.
 */
export const ORIENTATION_SURFACE_COPIES = 1;

/**
 * The WASM resizer copies the source into its linear memory and writes the
 * destination there too, then copies the destination back out. So the source
 * is resident twice and the destination twice.
 */
export const WASM_RESIZE_SOURCE_COPIES = 2;
export const WASM_RESIZE_DEST_COPIES = 2;

/**
 * createImageBitmap({ resizeWidth }) decodes and scales in one pass inside the
 * browser's own image pipeline, so only one source surface and one destination
 * surface are ever ours. This is the whole reason the native path is preferred:
 * 110 ms instead of 1700 ms, and roughly half the peak.
 */
export const NATIVE_RESIZE_SOURCE_COPIES = 1;
export const NATIVE_RESIZE_DEST_COPIES = 1;

/**
 * An encode holds the pixels twice — the JS-side ImageData and the copy the
 * codec makes into its heap — plus its own working set. The 0.35 factor is a
 * rounded-up allowance for MozJPEG's row buffers, colour-converted planes and
 * Huffman tables; the compressed output itself is an order of magnitude
 * smaller than the pixels and is folded into the same allowance.
 */
export const ENCODE_INPUT_COPIES = 2;
export const ENCODE_WORKING_SET_FACTOR = 0.35;

/**
 * Copies of the assembled PDF that are resident at the peak of a /jpg-to-pdf
 * job. This is the one number that decides whether twenty photos fit, because
 * the document is the only thing in that job which grows with the file count —
 * everything else is one page at a time.
 *
 *   1. the embedded image streams held inside the PDFDocument while it is built
 *   2. the single Uint8Array doc.save() serialises the whole document into
 *   3. the Blob built from that array, before the array can be collected
 *
 * Three rather than two because the third copy is real, brief and lands at
 * exactly the moment the first two are both still alive. It is the same
 * pessimism the rest of this file is written with: refusing a job that would
 * have worked costs a message, attempting one that does not costs the file.
 */
export const PDF_DOCUMENT_COPIES = 3;

/**
 * What one JPEG page costs on the lane that never decodes: the bytes read off
 * the file, and the metadata-stripped copy handed to embedJpg. No pixel surface
 * is ever allocated on that lane, which is the whole reason a phone can put
 * twenty 12 MP photos in one document — a decode of a single one of them is
 * 45.8 MB, and 0.45 MB of heap growth was measured for the embed instead.
 */
export const PDF_EMBED_FILE_COPIES = 2;

/**
 * What ONE source PDF costs while its pages are being copied out of it: the
 * Uint8Array read off the file, and the object graph pdf-lib parses from it.
 *
 * Two rather than more because the parse is not a second full expansion — the
 * content streams stay as the compressed bytes they already were, and what is
 * built around them is a dictionary tree over the same buffer. Two rather than
 * one because that buffer and the tree are both alive at once, and there is no
 * point in the copy where either can be dropped.
 */
export const PDF_MERGE_SOURCE_COPIES = 2;

/**
 * Copies of the ZIP payload that are resident at the peak of a bulk job.
 *
 * The same number as PDF_DOCUMENT_COPIES and deliberately NOT the same constant,
 * because it counts a different set of objects and either could move without the
 * other. What is resident here, at the moment generateAsync returns:
 *
 *   1. every finished output Blob, held in processBatch's `successes` until the
 *      whole run is assembled
 *   2. the ArrayBuffer JSZip holds per entry, read out of each of those Blobs
 *   3. the single buffer generateAsync serialises the whole archive into
 *
 * Three rather than four: the final `new Blob([output])` is a fourth object, but
 * a Blob that large is moved to disk by every engine that has to, and (1) is the
 * copy most likely to have been paged out by then. Counting both would be double
 * -charging the one copy the browser is most willing to take off the heap.
 *
 * lib/upload/folder-select.js already reasoned in exactly these three copies to
 * justify keeping MAX_BULK_FILES at 20; this is that reasoning made executable.
 */
export const ZIP_ARCHIVE_COPIES = 3;

/**
 * Flat allowance for the instantiated codecs themselves: the module bytes plus
 * each emscripten build's initial linear memory reservation, which never
 * shrinks once grown. Three codecs resident at once (a decoder, the resizer and
 * an encoder) round to this.
 */
export const WASM_BASELINE_BYTES = 24 * 1024 * 1024;

/* ------------------------------------------------------- device constants */

/**
 * The stated floor device is "a 2021 phone or newer". The 2021 baselines are
 * the iPhone 13 (4 GB) and the mid-tier Android of that year (4 GB), so 4 GB is
 * what we assume whenever the browser will not tell us — which is most of the
 * time, because navigator.deviceMemory is Chromium-only.
 */
export const DEFAULT_DEVICE_MEMORY_GB = 4;

/**
 * The share of device memory one tab may plan to use. A tab is not alone: the
 * OS, the rest of the browser, the page's own DOM and the preview bitmaps all
 * want the same RAM. A quarter of 4 GB is 1 GB, which is also roughly the
 * per-tab ceiling iOS Safari is observed to enforce before it reaps the tab —
 * the two numbers agreeing at the floor device is why this fraction was chosen.
 */
export const TAB_HEAP_FRACTION = 0.25;

/**
 * Floor for the budget. Below this nothing useful is possible at all — even a
 * 6 MP phone photo round-trip needs ~70 MB — so a device reporting less is
 * given this and allowed to fail honestly on the big jobs rather than being
 * refused everything.
 */
export const MIN_TAB_BUDGET_BYTES = 192 * 1024 * 1024;

/**
 * Ceiling for the budget. A desktop with 32 GB does not get to plan an 8 GB
 * job: wasm32 linear memory tops out at 4 GiB, browsers cap a single WASM
 * memory well below that, and past ~1 GB the tab is fragile regardless of what
 * the machine has. 1 GB is also comfortably above the worst legal job (see
 * MAX_PIXELS in lib/limits).
 */
export const MAX_TAB_BUDGET_BYTES = 1024 * 1024 * 1024;

/**
 * Extra haircut on iOS. iOS kills a tab that oversteps without raising
 * anything catchable, so there is no recovery path and no way to even log it —
 * the only defence is a wider margin. Applies to iPadOS too, which reports
 * itself as a Mac and is separated by its touch points.
 */
export const IOS_BUDGET_MULTIPLIER = 0.6;

/**
 * Memory assumed per core count when navigator.deviceMemory is unavailable
 * (Safari, Firefox). A heuristic, not a measurement: the iPhone 13 — the floor
 * device — reports 6 cores against 4 GB, an Apple-silicon Mac reports 8+ with
 * 8 GB or more, and a 4-core budget Android of the same era is a 3 GB machine.
 * First matching row wins.
 */
export const CORES_TO_MEMORY_GB = [
    { minCores: 8, memoryGb: 6 },
    { minCores: 6, memoryGb: 4 },
    { minCores: 0, memoryGb: 3 },
];

/* -------------------------------------------------------- pixel constants */

/**
 * Absolute source ceiling, independent of memory. MAX_FILE_SIZE is 20 MB and a
 * HEIC packs roughly twice as tightly as a JPEG, so a legal upload can declare
 * something near 100 MP — the same reasoning that once put a HEIC header probe
 * in front of the sharp decoder. 80 MP is 320 MB of RGBA before a
 * single copy, which no tab budget here survives, so it is refused up front
 * rather than after a 320 MB allocation has already been attempted.
 *
 * This IS stricter than the server, which decoded up to sharp's 268 MP default.
 * That headroom does not exist in a tab and cannot be bought back.
 */
export const HARD_MAX_SOURCE_PIXELS = 80_000_000;

/**
 * Advisory, not a gate. MozJPEG measured 1.74-1.88 s encoding a full 12 MP
 * frame against 507 ms at 1920 px wide (~2 MP). Past this the suggestion text
 * tells the caller to shrink first, because that is nearly always what the user
 * actually wanted.
 */
export const COMFORTABLE_ENCODE_PIXELS = 4_000_000;

/**
 * A byte-only job holds the file it was given, the file it writes and one
 * working copy while the container is rebuilt. Three, not two: the rebuild
 * happens into a fresh buffer while the source is still mapped.
 */
export const BYTES_ONLY_FILE_COPIES = 3;

/* ------------------------------------------------------------- operations */

/**
 * What each tool's pipeline actually does, which is what decides its peak.
 * `resizes` means a real resampling stage; `crop` slices an existing buffer and
 * only ever gets smaller, so it is costed as a plain re-encode.
 */
const OPERATION_PROFILES = {
    decode: { resizes: false, encodes: false },
    resize: { resizes: true, encodes: true },
    compress: { resizes: false, encodes: true },
    convert: { resizes: false, encodes: true },
    crop: { resizes: false, encodes: true },
    heic: { resizes: false, encodes: true },
    // Crop, then a real resample to the requested size, then an encode — the
    // /resize profile, because that is the stage that sets its peak.
    signature: { resizes: true, encodes: true },
    // The requirement fitter behind /passport-photo. Same shape as the
    // signature workflow and costed the same way: an optional crop, then a real
    // resample (to a COVERING size for the default geometry, which is why its
    // caller passes an intermediate), then one or more encodes.
    fit: { resizes: true, encodes: true },
    // /passport-photo-print. The resample is the PHOTO, which is small; the
    // encode is the PAPER, which is not — an A4 sheet at 300 DPI is 8.7
    // megapixels of canvas built from a 600 x 600 picture. So the caller passes
    // the paper as the target and the photo's covering size as the
    // intermediate, and the encode stage is what sets this profile's peak.
    sheet: { resizes: true, encodes: true },
    // The two tools that never decode. A DPI change rewrites a few metadata
    // bytes and a metadata strip copies the compressed image data across
    // untouched, so neither holds a pixel surface: they are costed in BYTES —
    // the input, the output and a working copy — and the pixel caps, which
    // bound the OUTPUT picture, do not apply to a job that produces the same
    // picture it was given. See estimatePeakBytes and assessPixels.
    dpi: { bytesOnly: true, resizes: false, encodes: false },
    strip: { bytesOnly: true, resizes: false, encodes: false },
    // One PAGE of a PDF, on the lane that has to re-encode it: decode, then a
    // JPEG encode, with nothing resampled. Identical to a conversion because
    // that is exactly what it is. The other lane — a JPEG copied in byte for
    // byte — never reaches this table at all; see estimatePdfPeakBytes.
    pdf: { resizes: false, encodes: true },
};

const DEFAULT_OPERATION = 'convert';

function profileFor(operation) {
    return OPERATION_PROFILES[operation] ?? OPERATION_PROFILES[DEFAULT_OPERATION];
}

/* ------------------------------------------------------ environment probes */

function globalScope() {
    return typeof globalThis === 'undefined' ? {} : globalThis;
}

/** True when the browser can decode and downscale in one native pass. */
export function nativeDownscaleSupported() {
    const scope = globalScope();
    return typeof scope.createImageBitmap === 'function'
        && typeof scope.OffscreenCanvas === 'function';
}

/** True when WebAssembly can run at all — a CSP without 'wasm-unsafe-eval' kills it. */
export function wasmSupported() {
    const scope = globalScope();
    return typeof scope.WebAssembly === 'object' && typeof scope.WebAssembly.instantiate === 'function';
}

function isIosLike(navigatorLike) {
    if (!navigatorLike) return false;
    const platform = String(navigatorLike.platform ?? '');
    const agent = String(navigatorLike.userAgent ?? '');
    if (/iPhone|iPad|iPod/.test(platform) || /iPhone|iPad|iPod/.test(agent)) return true;
    // iPadOS reports itself as a Mac; the touch points give it away.
    return /Mac/.test(platform) && Number(navigatorLike.maxTouchPoints ?? 0) > 1;
}

/**
 * What the device says about itself, normalised. Every field is optional in
 * some browser, so every field has a stated fallback.
 */
export function readDeviceProfile(navigatorLike) {
    const nav = navigatorLike ?? globalScope().navigator ?? null;

    const reportedMemory = Number(nav?.deviceMemory);
    const cores = Number(nav?.hardwareConcurrency);
    const hasReportedMemory = Number.isFinite(reportedMemory) && reportedMemory > 0;

    let memoryGb;
    if (hasReportedMemory) {
        memoryGb = reportedMemory;
    } else if (Number.isFinite(cores) && cores > 0) {
        memoryGb = CORES_TO_MEMORY_GB.find((row) => cores >= row.minCores).memoryGb;
    } else {
        memoryGb = DEFAULT_DEVICE_MEMORY_GB;
    }

    return {
        memoryGb,
        memoryReported: hasReportedMemory,
        cores: Number.isFinite(cores) && cores > 0 ? cores : null,
        ios: isIosLike(nav),
        nativeDownscale: nativeDownscaleSupported(),
        wasm: wasmSupported(),
    };
}

/** The byte budget one job may plan against on this device. */
export function deviceBudgetBytes(device = readDeviceProfile()) {
    const raw = device.memoryGb * 1024 * 1024 * 1024 * TAB_HEAP_FRACTION;
    const capped = Math.min(MAX_TAB_BUDGET_BYTES, Math.max(MIN_TAB_BUDGET_BYTES, raw));
    return Math.floor(device.ios ? capped * IOS_BUDGET_MULTIPLIER : capped);
}

/* ------------------------------------------------------------- estimation */

function surfaceBytes(width, height) {
    return width * height * BYTES_PER_PIXEL;
}

/**
 * Peak resident bytes for one job, as the largest single stage rather than the
 * sum: the stages run in sequence and each releases before the next. The WASM
 * baseline is added on top because it is resident throughout and never shrinks.
 *
 * @param {object} input
 * @param {number} input.sourceWidth
 * @param {number} input.sourceHeight
 * @param {number} [input.targetWidth]   defaults to the source width
 * @param {number} [input.targetHeight]  defaults to the source height
 * @param {number} [input.intermediateWidth]   the size the resampler is asked
 *   for, when that is NOT the output size — a two-sided /resize covers the box
 *   first and crops afterwards, so the surface it really allocates is bigger
 *   than the file the user gets. Defaults to the target, which is the truth for
 *   every other job.
 * @param {number} [input.intermediateHeight]
 * @param {number} [input.fileBytes]     encoded input, resident during decode
 * @param {string} [input.operation]
 * @param {boolean} [input.nativeDownscale]
 * @param {number} [input.orientation]   the source's EXIF Orientation, 1-8;
 *   anything other than 1 buys a second decode-stage surface on the WASM route
 */
export function estimatePeakBytes({
    sourceWidth,
    sourceHeight,
    targetWidth = null,
    targetHeight = null,
    intermediateWidth = null,
    intermediateHeight = null,
    fileBytes = 0,
    operation = DEFAULT_OPERATION,
    nativeDownscale = nativeDownscaleSupported(),
    orientation = ORIENTATION_NONE,
} = {}) {
    const profile = profileFor(operation);

    if (profile.bytesOnly) {
        return Math.round(fileBytes * BYTES_ONLY_FILE_COPIES + WASM_BASELINE_BYTES);
    }

    const source = surfaceBytes(sourceWidth, sourceHeight);
    const destination = surfaceBytes(
        targetWidth ?? sourceWidth,
        targetHeight ?? sourceHeight,
    );
    // What the resampler actually writes. Equal to the destination unless the
    // job covers-then-crops, in which case charging the destination would
    // under-count the one surface most likely to be the peak.
    const intermediate = surfaceBytes(
        intermediateWidth ?? targetWidth ?? sourceWidth,
        intermediateHeight ?? targetHeight ?? sourceHeight,
    );

    const turnsInJs = !nativeDownscale && orientation !== ORIENTATION_NONE;
    const decodeCopies = DECODE_SURFACE_COPIES + (turnsInJs ? ORIENTATION_SURFACE_COPIES : 0);

    const decodeStage = source * decodeCopies + fileBytes;

    const resizeStage = profile.resizes
        ? (nativeDownscale
            ? source * NATIVE_RESIZE_SOURCE_COPIES + intermediate * NATIVE_RESIZE_DEST_COPIES
            : source * WASM_RESIZE_SOURCE_COPIES + intermediate * WASM_RESIZE_DEST_COPIES)
        : 0;

    // The crop that follows a cover resample holds both surfaces at once: the
    // covered one it is reading and the smaller one it is writing. Zero when
    // nothing is cropped, which is every job but a two-sided /resize.
    const cropStage = intermediate > destination ? intermediate + destination : 0;

    const encodeStage = profile.encodes
        ? destination * (ENCODE_INPUT_COPIES + ENCODE_WORKING_SET_FACTOR)
        : 0;

    return Math.round(Math.max(decodeStage, resizeStage, cropStage, encodeStage) + WASM_BASELINE_BYTES);
}

function megapixelsOf(width, height) {
    return Math.round((width * height) / 100_000) / 10;
}

function refuse(code, reason, suggestion, extra = {}) {
    return { ok: false, code, reason, suggestion, ...extra };
}

/* ----------------------------------------------------------------- gates */

/**
 * The pixel-and-memory half of the gate, for when the dimensions are known.
 * Callers that only have a File should use assessFile, which runs the file
 * gates first and then defers here.
 *
 * `intermediateWidth`/`intermediateHeight` change the MEMORY estimate and
 * nothing else. MAX_DIMENSION and the pixel budget are limits on the file the
 * user gets, and the server applies them to exactly that, so a cover resample
 * that is briefly larger than the output must not be refused for being over a
 * limit it was never held to — but it must be paid for, because it is the
 * surface that gets allocated.
 */
export function assessPixels({
    sourceWidth,
    sourceHeight,
    targetWidth = null,
    targetHeight = null,
    intermediateWidth = null,
    intermediateHeight = null,
    fileBytes = 0,
    operation = DEFAULT_OPERATION,
    orientation = ORIENTATION_NONE,
    device = readDeviceProfile(),
} = {}) {
    const usable = (value) => Number.isFinite(value) && value > 0;

    if (!usable(sourceWidth) || !usable(sourceHeight)) {
        return refuse(
            'unknown-dimensions',
            'This image’s dimensions could not be read.',
            'The file may be damaged. Try opening it in another app and saving a copy.',
            { megapixels: null, estimatedPeakBytes: null, budgetBytes: deviceBudgetBytes(device), device },
        );
    }

    const megapixels = megapixelsOf(sourceWidth, sourceHeight);
    const budgetBytes = deviceBudgetBytes(device);

    if (!device.wasm) {
        return refuse(
            'no-wasm',
            'This browser has WebAssembly turned off, so images cannot be processed here.',
            'Turn WebAssembly back on, or try a different browser.',
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    // A job that never decodes has no source surface to bound and no output
    // picture to cap; only the memory question below applies to it.
    const bytesOnly = Boolean(profileFor(operation).bytesOnly);

    if (!bytesOnly && sourceWidth * sourceHeight > HARD_MAX_SOURCE_PIXELS) {
        return refuse(
            'source-too-large',
            `This image is ${megapixels} megapixels, which is past the ${Math.round(HARD_MAX_SOURCE_PIXELS / 1_000_000)} megapixel limit for processing in a browser tab.`,
            'Scale it down in a desktop app first, then bring it back here.',
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    const outputWidth = targetWidth ?? sourceWidth;
    const outputHeight = targetHeight ?? sourceHeight;

    if (!bytesOnly && (outputWidth > MAX_DIMENSION || outputHeight > MAX_DIMENSION)) {
        return refuse(
            'output-too-large',
            `The output cannot be wider or taller than ${MAX_DIMENSION} pixels.`,
            `Pick a size at or under ${MAX_DIMENSION} pixels on the long side.`,
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    if (!bytesOnly && !withinPixelBudget(outputWidth, outputHeight, MAX_PIXELS)) {
        return refuse(
            'output-too-large',
            `The output is past the ${Math.round(MAX_PIXELS / 1_000_000)} megapixel limit.`,
            'Choose smaller output dimensions.',
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    const estimatedPeakBytes = estimatePeakBytes({
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        intermediateWidth,
        intermediateHeight,
        fileBytes,
        operation,
        orientation,
        nativeDownscale: device.nativeDownscale,
    });

    if (estimatedPeakBytes > budgetBytes) {
        return refuse(
            'not-enough-memory',
            `This ${megapixels} megapixel image needs about ${Math.round(estimatedPeakBytes / (1024 * 1024))} MB of memory to process, and this device can only spare about ${Math.round(budgetBytes / (1024 * 1024))} MB for it.`,
            'Try it on a computer, or scale the image down before uploading it.',
            { megapixels, estimatedPeakBytes, budgetBytes, device },
        );
    }

    return {
        ok: true,
        code: 'ok',
        reason: null,
        suggestion: !bytesOnly && (outputWidth * outputHeight) > COMFORTABLE_ENCODE_PIXELS
            ? 'This is a large image, so it may take a few seconds.'
            : null,
        megapixels,
        estimatedPeakBytes,
        budgetBytes,
        device,
    };
}

/**
 * The operation name a bare decode is costed under — no resample, no encode,
 * just the surfaces the decoder itself holds.
 *
 * It exists for the one caller that has to gate a decode on its own, without
 * knowing what the job around it will go on to do: lib/image-client/decode.js,
 * where a HEIC's dimensions are first learned. Everything else reaches the gate
 * already knowing its operation.
 */
export const DECODE_OPERATION = 'decode';

/* --------------------------------------------------------------- the PDF */

/** The operation name a re-encoded PDF page is costed under. */
export const PDF_OPERATION = 'pdf';

function pageBytesOf(page) {
    const bytes = Number(page?.fileBytes);
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

/**
 * Peak resident bytes for a whole /jpg-to-pdf job.
 *
 * Two things are being added, and the split is the entire memory story of the
 * tool:
 *
 *   THE DOCUMENT is resident for the whole job and grows with every page, so it
 *   is the SUM of the pages, times PDF_DOCUMENT_COPIES.
 *
 *   THE PAGE BEING WORKED ON is one page at a time — decoded, encoded, embedded,
 *   released, next — so it is the LARGEST single page's stage, never the sum.
 *   Charging twenty surfaces here would refuse every job the tool exists for;
 *   charging none would under-charge the PNG and HEIC lane, which really does
 *   allocate a full decode surface.
 *
 * A page with no dimensions is charged as an embed. Nothing else is possible —
 * its surface cannot be sized until it has been decoded — and the engine
 * re-costs it with assessPixels the moment the decoder reports a real size,
 * which is the same deferral decodePixels makes for a single-image job.
 *
 * @param {object} input
 * @param {Array<{ fileBytes: number, sourceWidth?: number|null, sourceHeight?: number|null,
 *                 orientation?: number, reencoded?: boolean }>} input.pages  in caller order
 * @param {boolean} [input.nativeDownscale]
 */
export function estimatePdfPeakBytes({ pages = [], nativeDownscale = nativeDownscaleSupported() } = {}) {
    let documentBytes = 0;
    let largestPageStage = 0;

    for (const page of pages) {
        const fileBytes = pageBytesOf(page);
        documentBytes += fileBytes;

        const sized = Number.isFinite(page?.sourceWidth) && page.sourceWidth > 0
            && Number.isFinite(page?.sourceHeight) && page.sourceHeight > 0;

        const stage = (page?.reencoded && sized)
            ? estimatePeakBytes({
                sourceWidth: page.sourceWidth,
                sourceHeight: page.sourceHeight,
                fileBytes,
                operation: PDF_OPERATION,
                orientation: page.orientation ?? ORIENTATION_NONE,
                nativeDownscale,
            })
            : fileBytes * PDF_EMBED_FILE_COPIES + WASM_BASELINE_BYTES;

        if (stage > largestPageStage) largestPageStage = stage;
    }

    return Math.round((documentBytes * PDF_DOCUMENT_COPIES) + largestPageStage);
}

/**
 * The pre-flight gate for a whole /jpg-to-pdf job.
 *
 * Deliberately NOT a loop over assessFile: that is the per-file gate — is this a
 * file, is it an allowed type, is it under 20 MB — and the engine still runs it
 * once per image. This is the question no single file can answer, which is
 * whether the DOCUMENT they add up to fits in the tab.
 *
 * The two count limits are the bulk-resize ones rather than new numbers. Twenty
 * files and 80 MB is a promise this site already makes and already tests, and a
 * second pair for the same shape of job would be one more thing to keep in step.
 *
 * @param {object} input
 * @param {Array} input.pages  as estimatePdfPeakBytes takes them
 * @param {object} [input.device]
 */
export function assessPdfJob({ pages = [], device = readDeviceProfile() } = {}) {
    const budgetBytes = deviceBudgetBytes(device);
    const list = Array.isArray(pages) ? pages : [];
    const totalBytes = list.reduce((sum, page) => sum + pageBytesOf(page), 0);
    const base = { pageCount: list.length, totalBytes, estimatedPeakBytes: null, budgetBytes, device };

    if (!device.wasm) {
        return refuse('no-wasm', NO_WASM_REASON, NO_WASM_SUGGESTION, base);
    }

    if (list.length === 0) {
        return refuse('no-file', NO_FILE_REASON, 'Choose the images you want in the PDF.', base);
    }

    if (list.length > MAX_BULK_FILES) {
        return refuse(
            'too-many-files',
            `A PDF can hold up to ${MAX_BULK_FILES} images at a time, and ${list.length} were chosen.`,
            `Make one PDF from the first ${MAX_BULK_FILES}, then another from the rest.`,
            base,
        );
    }

    if (totalBytes > MAX_BULK_TOTAL_BYTES) {
        return refuse(
            'total-too-large',
            `Those images add up to ${Math.round(totalBytes / (1024 * 1024))} MB, and ${Math.round(MAX_BULK_TOTAL_BYTES / (1024 * 1024))} MB is the most one PDF can be built from here.`,
            'Split them across two PDFs.',
            base,
        );
    }

    const estimatedPeakBytes = estimatePdfPeakBytes({ pages: list, nativeDownscale: device.nativeDownscale });

    if (estimatedPeakBytes > budgetBytes) {
        return refuse(
            'not-enough-memory',
            `These ${list.length} images need about ${Math.round(estimatedPeakBytes / (1024 * 1024))} MB of memory to turn into a PDF, and this device can only spare about ${Math.round(budgetBytes / (1024 * 1024))} MB.`,
            'Make the PDF from fewer images at a time, or try it on a computer.',
            base,
        );
    }

    return {
        ok: true,
        code: 'ok',
        reason: null,
        suggestion: null,
        ...base,
        estimatedPeakBytes,
    };
}

/* ------------------------------------------------------- the PDF merge */

/**
 * The op name a merge runs under.
 *
 * Named here because the front door below — assessJob — cannot gate a merge:
 * its file check is an IMAGE file check, so a caller holding PDFs has to route
 * itself to assessPdfMergeJob instead, and it should not do that by typing the
 * string. lib/hooks/useLocalProcess.js is the one caller that does.
 */
export const MERGE_OPERATION = 'merge';

/**
 * Peak resident bytes for a whole /merge-pdf job.
 *
 * NOTHING HERE IS DECODED, so nothing here is charged a pixel surface. A page
 * moves between documents as an OBJECT — its content stream is carried across
 * as the compressed bytes it already was, its images are never opened — which
 * is why merging a hundred megabytes of scans is cheap where converting one
 * photograph is not. Charging this job the way estimatePeakBytes charges an
 * image would refuse a stack of bank statements that costs a tab almost
 * nothing.
 *
 * What IS resident is bytes, in two parts, and the split is the same one
 * estimatePdfPeakBytes makes:
 *
 *   THE SOURCE BEING READ  one at a time. mergePdfs opens a file, copies the
 *                          pages it contributes into the output and drops it
 *                          before opening the next, so it is the LARGEST single
 *                          source and never the sum — times
 *                          PDF_MERGE_SOURCE_COPIES.
 *
 *   THE OUTPUT             alive for the whole job and growing with every page
 *                          copied into it, so it is the SUM of the inputs,
 *                          times PDF_DOCUMENT_COPIES — the same three copies
 *                          /jpg-to-pdf pays at its peak (the streams held in
 *                          the document, the array save() serialises into, the
 *                          Blob built from that array).
 *
 * The sum is charged over the WHOLE of each input rather than the pages
 * actually chosen. Selecting three pages out of forty really does carry less,
 * but nothing knows how much less until the file has been parsed — and this
 * number has to be answered before a byte is read. Over-charging is the
 * direction this file is written to be wrong in.
 *
 * NO WASM_BASELINE_BYTES. No codec is loaded on this path, and adding an
 * allowance for three that never instantiate would be inventing 24 MB.
 *
 * @param {object} input
 * @param {Array<{ fileBytes: number }>} input.files  in caller order
 */
export function estimatePdfMergePeakBytes({ files = [] } = {}) {
    let documentBytes = 0;
    let largestSourceBytes = 0;

    for (const file of files) {
        const fileBytes = pageBytesOf(file);
        documentBytes += fileBytes;
        if (fileBytes > largestSourceBytes) largestSourceBytes = fileBytes;
    }

    return Math.round((documentBytes * PDF_DOCUMENT_COPIES) + (largestSourceBytes * PDF_MERGE_SOURCE_COPIES));
}

/**
 * The pre-flight gate for a whole /merge-pdf job.
 *
 * THE WEBASSEMBLY CHECK IS DELIBERATELY ABSENT, and it is the only gate in this
 * file without one. @cantoo/pdf-lib is plain JavaScript with no WASM anywhere in
 * it, so a browser with WebAssembly switched off can merge PDFs perfectly well.
 * Refusing this job for a capability it does not use would be a lie told by
 * copying the gate next door.
 *
 * The count and total limits are the bulk ones every multi-file job on this site
 * already uses, for the same reason assessPdfJob uses them: a second pair of
 * numbers for the same shape of job is one more thing to keep in step.
 *
 * @param {object} input
 * @param {Array<{ fileBytes: number }>} input.files
 * @param {object} [input.device]
 */
export function assessPdfMergeJob({ files = [], device = readDeviceProfile() } = {}) {
    const budgetBytes = deviceBudgetBytes(device);
    const list = Array.isArray(files) ? files : [];
    const totalBytes = list.reduce((sum, file) => sum + pageBytesOf(file), 0);
    const base = { fileCount: list.length, totalBytes, estimatedPeakBytes: null, budgetBytes, device };

    if (list.length === 0) {
        return refuse('no-file', 'No PDFs were provided.', 'Choose the PDFs you want to combine.', base);
    }

    if (list.length > MAX_BULK_FILES) {
        return refuse(
            'too-many-files',
            `Up to ${MAX_BULK_FILES} PDFs can be combined at a time, and ${list.length} were chosen.`,
            `Combine the first ${MAX_BULK_FILES}, then add the result to the rest.`,
            base,
        );
    }

    if (totalBytes > MAX_BULK_TOTAL_BYTES) {
        return refuse(
            'total-too-large',
            `Those PDFs add up to ${Math.round(totalBytes / (1024 * 1024))} MB, and ${Math.round(MAX_BULK_TOTAL_BYTES / (1024 * 1024))} MB is the most that can be combined here at once.`,
            'Combine them in two goes.',
            base,
        );
    }

    const estimatedPeakBytes = estimatePdfMergePeakBytes({ files: list });

    if (estimatedPeakBytes > budgetBytes) {
        return refuse(
            'not-enough-memory',
            `These ${list.length} PDFs need about ${Math.round(estimatedPeakBytes / (1024 * 1024))} MB of memory to combine, and this device can only spare about ${Math.round(budgetBytes / (1024 * 1024))} MB.`,
            'Combine fewer at a time, or try it on a computer.',
            base,
        );
    }

    return {
        ok: true,
        code: 'ok',
        reason: null,
        suggestion: null,
        ...base,
        estimatedPeakBytes,
    };
}

/* ----------------------------------------------------- the bulk archive */

/**
 * OUTPUT BYTES ARE NOT INPUT BYTES, AND THAT IS THE WHOLE POINT OF THIS SECTION.
 *
 * lib/upload/folder-select.js costs a bulk run as "up to 240 MB of ZIP, bounded
 * by the 80 MB byte cap". That arithmetic silently assumes every output is no
 * bigger than its input. True for a resize, which is the only bulk tool that
 * existed when it was written. False for everything the bulk tab is about to
 * grow, measured with this repo's own sharp reference against public/samples/
 * (three JPEG photographs, and the PNG and WebP re-encodings of each, so that
 * every source format the input allowlists admit is a real measurement and not
 * an extrapolation):
 *
 *   TARGET   worst ratio seen   where it came from
 *   webp     1.26x              WebP -> WebP q90 (JPEG -> WebP is 0.25-0.65x)
 *   jpeg     1.19x              JPEG -> JPEG q90 (PNG -> JPEG is 0.12-0.39x)
 *   png      8.69x              JPEG -> PNG, on the 1200x1200 sample
 *
 * KEYED ON THE TARGET FORMAT, NOT ON THE OPERATION. /convert alone spans 0.25x
 * to 8.69x depending only on which format was picked in the dropdown, which is a
 * wider spread than the one between the operations — so an op-keyed factor would
 * be wrong in both directions for the same tool on the same file. The format is
 * what the encoder is, and the encoder is what decides the size.
 *
 * WHAT THESE NUMBERS DO NOT COVER, STATED PLAINLY. A source that is already more
 * efficient than its target expands further than any figure above: measured on
 * the same samples, WebP -> JPEG q80 reaches 4.18x and WebP -> PNG reaches
 * 15.92x, and this repo's own /heic copy puts HEIC -> JPEG at roughly 2x. A
 * factor keyed on the target format cannot see any of that, and raising the JPEG
 * factor to cover it would refuse the flagship job — a full 80 MB bulk resize on
 * the iOS floor device needs the JPEG factor to stay under 1.80 to pass at all.
 * So the pre-flight below is deliberately the EARLY warning and not the
 * guarantee. The guarantee is the running ceiling in lib/upload/bulk-batch.js,
 * which accumulates REAL result bytes and stops on the archive budget this
 * module hands it — no estimate involved, so no source/target pair can surprise
 * it. Between them: this refuses the job that is obviously impossible before the
 * user waits for it, and that one refuses to grow an archive past the tab.
 */
export const OUTPUT_EXPANSION_BY_FORMAT = {
    jpeg: 1.2,
    png: 9,
    webp: 1.3,
};

/**
 * The bulk format sentinel — `'original'`, and its `'same'` alias — means every
 * file keeps its own format, so the job is a same-format re-encode. Measured on
 * the samples that is 1.19x for JPEG, 1.00x for PNG and 1.26x for WebP; the
 * largest of the three is the honest charge, because a mixed batch is normal and
 * nothing here knows which file is which format.
 */
export const SAME_FORMAT_EXPANSION = 1.3;

/**
 * What an unrecognised target costs. The most expensive format known, not the
 * average and not 1: a caller that has not said what it is writing must not be
 * quoted the cheapest possible answer, which is the same reasoning that leaves
 * `operation` without a default on assessJob.
 */
export const DEFAULT_OUTPUT_EXPANSION = 9;

/** The output-to-input byte ratio charged for a batch writing `format`. */
export function outputExpansionFor(format) {
    const key = String(format ?? '').trim().toLowerCase();
    if (key === '' || key === 'original' || key === 'same') return SAME_FORMAT_EXPANSION;
    if (key === 'jpg') return OUTPUT_EXPANSION_BY_FORMAT.jpeg;
    return OUTPUT_EXPANSION_BY_FORMAT[key] ?? DEFAULT_OUTPUT_EXPANSION;
}

/**
 * What ONE file costs while it is the one being worked on, or null when the
 * per-file gate is going to refuse it before it allocates anything.
 *
 * THE NULL IS THE POINT. A file past HARD_MAX_SOURCE_PIXELS, or one whose own
 * working set is bigger than the whole tab budget, is refused by assessPixels
 * inside lib/upload/process-file.js: it is never decoded, never encoded, and it
 * puts nothing in the archive. Costing it anyway is costing a job that will not
 * happen — and because it is by definition the largest thing in the batch, it
 * became the number every other file was measured against.
 *
 * That is not a theoretical tidy-up. A batch of one ordinary 1600x1200 photo
 * plus one 12000x9000 file gave the 108 MP file a 1672 MB working set, which is
 * past every budget this file can produce, so the archive ceiling came out as
 * ZERO and the 400-byte output of the perfectly good photo was refused for not
 * fitting in it. The two refusals below are exactly the two assessPixels makes
 * on size, and they must stay in step with it.
 *
 * An unsized file is charged its own bytes twice — read, then handed to the
 * decoder — which is the most that can be said before a decoder reports a real
 * size, and it is never excluded: nothing yet knows enough to refuse it.
 */
function fileStageBytes(file, operation, nativeDownscale, budgetBytes) {
    const fileBytes = pageBytesOf(file);

    const sized = Number.isFinite(file?.sourceWidth) && file.sourceWidth > 0
        && Number.isFinite(file?.sourceHeight) && file.sourceHeight > 0;

    if (!sized) return fileBytes * PDF_EMBED_FILE_COPIES + WASM_BASELINE_BYTES;

    if (file.sourceWidth * file.sourceHeight > HARD_MAX_SOURCE_PIXELS) return null;

    const stage = estimatePeakBytes({
        sourceWidth: file.sourceWidth,
        sourceHeight: file.sourceHeight,
        targetWidth: file.targetWidth ?? null,
        targetHeight: file.targetHeight ?? null,
        fileBytes,
        operation,
        orientation: file.orientation ?? ORIENTATION_NONE,
        nativeDownscale,
    });

    return stage > budgetBytes ? null : stage;
}

/**
 * True when this file can still put something in the archive — which is the
 * only reason a file gets to consume any of the archive's budget.
 */
function contributesOutput(file, operation, nativeDownscale, budgetBytes) {
    return fileStageBytes(file, operation, nativeDownscale, budgetBytes) !== null;
}

/**
 * What the single most expensive PROCESSABLE file in the batch costs while it is
 * the one being worked on. The same split estimatePdfPeakBytes makes, for the
 * same reason: processBatch awaits each file before starting the next, so this
 * is the LARGEST single file's stage and never the sum. Charging twenty decode
 * surfaces at once would refuse every batch the tool exists for.
 */
function largestFileStageBytes(files, operation, nativeDownscale, budgetBytes) {
    let largest = 0;

    for (const file of files) {
        const stage = fileStageBytes(file, operation, nativeDownscale, budgetBytes);
        if (stage !== null && stage > largest) largest = stage;
    }

    return largest;
}

/**
 * Peak resident bytes for a whole bulk job.
 *
 *   THE ARCHIVE is alive for the whole run and grows with every finished file,
 *   so it is the SUM of the OUTPUTS — the inputs times the target format's
 *   expansion — times ZIP_ARCHIVE_COPIES.
 *
 *   THE FILE BEING WORKED ON is one at a time, so it is the LARGEST single
 *   file's stage.
 *
 * @param {object} input
 * @param {Array<{ fileBytes: number, sourceWidth?: number|null, sourceHeight?: number|null,
 *                 targetWidth?: number|null, targetHeight?: number|null, orientation?: number }>} input.files
 * A file the per-file gate will refuse counts for NEITHER of those, because it
 * produces no output and allocates no working set. It is still counted by the
 * intake limits in assessBatchJob — MAX_BULK_TOTAL_BYTES is a limit on what was
 * chosen, not on what survives — but it must not inflate a memory estimate for
 * work that will not happen.
 *
 * @param {string} [input.format]      the TARGET format, or the 'original' sentinel
 * @param {string} [input.operation]
 * @param {boolean} [input.nativeDownscale]
 * @param {number} [input.budgetBytes]  what this device can spare, so a file too
 *   big for it can be recognised as one that will be refused rather than run
 */
export function estimateBatchPeakBytes({
    files = [],
    format = null,
    operation = DEFAULT_OPERATION,
    nativeDownscale = nativeDownscaleSupported(),
    budgetBytes = Infinity,
} = {}) {
    const list = (Array.isArray(files) ? files : [])
        .filter((file) => contributesOutput(file, operation, nativeDownscale, budgetBytes));

    const inputBytes = list.reduce((sum, file) => sum + pageBytesOf(file), 0);
    const archiveBytes = inputBytes * outputExpansionFor(format) * ZIP_ARCHIVE_COPIES;

    return Math.round(archiveBytes + largestFileStageBytes(list, operation, nativeDownscale, budgetBytes));
}

/**
 * How many bytes of FINISHED OUTPUT the archive may hold on this device.
 *
 * This is the other half of the same arithmetic estimateBatchPeakBytes does,
 * solved for the archive instead of checked against the budget, and it exists so
 * that lib/upload/bulk-batch.js can stop a run on real bytes without re-deriving
 * a single constant of its own. The file being worked on is subtracted first
 * because it is resident at the same moment the archive is.
 *
 * ZERO IS NOT REACHABLE THROUGH NORMAL INTAKE, AND THAT IS THE FIX.
 *
 * Every file that survives the filter has a working set the per-file gate has
 * already accepted against this same budget, so the subtraction below cannot go
 * negative while the batch still has work in it; and a batch whose files are ALL
 * refused subtracts nothing at all, because there is no working set to reserve.
 * Reaching zero now needs a file the gate accepts whose working set is exactly
 * the whole budget to the byte, which intake cannot produce.
 *
 * Before the filter existed it was trivially reachable: one 12000x9000 file that
 * was never going to be processed reserved 1672 MB, and a 400-byte output of an
 * ordinary photo in the same batch was refused for not fitting in what was left.
 */
export function batchArchiveBudgetBytes({
    files = [],
    operation = DEFAULT_OPERATION,
    device = readDeviceProfile(),
} = {}) {
    const budgetBytes = deviceBudgetBytes(device);
    const list = Array.isArray(files) ? files : [];
    const spare = budgetBytes - largestFileStageBytes(list, operation, device.nativeDownscale, budgetBytes);

    return Math.max(0, Math.floor(spare / ZIP_ARCHIVE_COPIES));
}

/**
 * The pre-flight gate for a whole bulk job.
 *
 * Deliberately NOT a loop over assessFile, for the same reason assessPdfJob is
 * not: that is the per-file gate and processBatch still runs it once per image
 * through lib/upload/process-file.js. This is the question no single file can
 * answer, which is whether the ARCHIVE they add up to fits in the tab.
 *
 * The count and byte limits are MAX_BULK_FILES and MAX_BULK_TOTAL_BYTES
 * unchanged. They are published product numbers and they still bound intake;
 * what they never bounded is the OUTPUT, which is what this adds.
 *
 * @param {object} input
 * @param {Array} input.files          as estimateBatchPeakBytes takes them
 * @param {string} [input.format]      the TARGET format, or the 'original' sentinel
 * @param {string} [input.operation]
 * @param {object} [input.device]
 */
export function assessBatchJob({
    files = [],
    format = null,
    operation = DEFAULT_OPERATION,
    device = readDeviceProfile(),
} = {}) {
    const budgetBytes = deviceBudgetBytes(device);
    const list = Array.isArray(files) ? files : [];
    const totalBytes = list.reduce((sum, file) => sum + pageBytesOf(file), 0);
    const base = { fileCount: list.length, totalBytes, estimatedPeakBytes: null, budgetBytes, device };

    if (!device.wasm) {
        return refuse('no-wasm', NO_WASM_REASON, NO_WASM_SUGGESTION, base);
    }

    if (list.length === 0) {
        return refuse('no-file', NO_FILE_REASON, 'Choose the images you want to work on.', base);
    }

    if (list.length > MAX_BULK_FILES) {
        return refuse(
            'too-many-files',
            `Up to ${MAX_BULK_FILES} images can be done at a time, and ${list.length} were chosen.`,
            `Do the first ${MAX_BULK_FILES}, then come back for the rest.`,
            base,
        );
    }

    if (totalBytes > MAX_BULK_TOTAL_BYTES) {
        return refuse(
            'total-too-large',
            // CEIL, not round. A batch one byte over the cap rounds DOWN to
            // "add up to 80 MB, and 80 MB is the most one batch can hold",
            // which reads as a contradiction and tells the person nothing they
            // can act on. Rounding up is also the only direction that cannot
            // understate a total the sentence is refusing.
            `Those images add up to ${Math.ceil(totalBytes / (1024 * 1024))} MB, and ${Math.round(MAX_BULK_TOTAL_BYTES / (1024 * 1024))} MB is the most one batch can hold.`,
            'Split them across two batches.',
            base,
        );
    }

    const estimatedPeakBytes = estimateBatchPeakBytes({
        files: list,
        format,
        operation,
        nativeDownscale: device.nativeDownscale,
        // So that one file the per-file gate will refuse cannot refuse the
        // whole batch on its behalf. The intake checks above still counted it.
        budgetBytes,
    });

    if (estimatedPeakBytes > budgetBytes) {
        return refuse(
            'not-enough-memory',
            `These ${list.length} images would make a ZIP needing about ${Math.round(estimatedPeakBytes / (1024 * 1024))} MB of memory, and this device can only spare about ${Math.round(budgetBytes / (1024 * 1024))} MB.`,
            'Do fewer at a time, or try it on a computer.',
            base,
        );
    }

    return {
        ok: true,
        code: 'ok',
        reason: null,
        suggestion: null,
        ...base,
        estimatedPeakBytes,
    };
}

/**
 * The full pre-flight gate for one file.
 *
 * Order matters and mirrors the server's: is-it-a-file, then type, then size —
 * a plain form field has no `size`, so a size-first order passes it through and
 * blows up later on `file.name`. Only then are the pixels costed, and only if
 * the caller already knows the dimensions (from lib/hooks/useImageUpload, which
 * measures them at intake). Without dimensions this returns ok with
 * `dimensionsKnown: false` and the caller must re-gate with assessPixels once
 * the image has been measured.
 *
 * @param {File|Blob} file
 * @param {object} [options]
 * @param {string} [options.operation]     one of OPERATION_PROFILES
 * @param {number} [options.sourceWidth]
 * @param {number} [options.sourceHeight]
 * @param {number} [options.targetWidth]
 * @param {number} [options.targetHeight]
 * @param {number} [options.orientation]   the source's EXIF Orientation, 1-8
 * @param {object} [options.device]        injected for tests
 */
export function assessFile(file, {
    operation = DEFAULT_OPERATION,
    sourceWidth = null,
    sourceHeight = null,
    targetWidth = null,
    targetHeight = null,
    orientation = ORIENTATION_NONE,
    device = readDeviceProfile(),
} = {}) {
    const budgetBytes = deviceBudgetBytes(device);
    const base = { megapixels: null, estimatedPeakBytes: null, budgetBytes, device, dimensionsKnown: false };

    const upload = validateUpload(file, {
        allowedTypes: ['image/*', ...HEIC_MIME_TYPES],
        allowedExtensions: HEIC_EXTENSIONS,
        maxBytes: MAX_FILE_SIZE,
    });

    if (!upload.ok) {
        return refuse(
            'invalid-file',
            upload.error,
            `Images up to ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB are supported.`,
            base,
        );
    }

    if (sourceWidth === null || sourceHeight === null) {
        return {
            ok: true,
            code: 'dimensions-unknown',
            reason: null,
            suggestion: null,
            ...base,
        };
    }

    const pixels = assessPixels({
        sourceWidth,
        sourceHeight,
        targetWidth,
        targetHeight,
        fileBytes: Number(file?.size) || 0,
        operation,
        orientation,
        device,
    });

    return { ...pixels, dimensionsKnown: true };
}

/* ------------------------------------------------------- the whole gate */

/**
 * Fallbacks for the two refusals that happen BEFORE assessFile can run, so
 * every path out of assessJob carries a sentence and a suggestion rather than
 * an empty object a caller has to invent words for.
 */
const NO_WASM_REASON = 'This browser cannot run WebAssembly, so images cannot be processed here.';
const NO_WASM_SUGGESTION = 'Turn WebAssembly back on in your browser’s settings, or try a different browser.';
const NO_FILE_REASON = 'No image was provided.';
const NO_FILE_SUGGESTION = 'Choose an image and try again.';
const FALLBACK_REASON = 'This image cannot be processed on this device.';

/**
 * The one question asked before any work starts: can this device do this job?
 *
 * Every tool runs in the tab and nowhere else, so this is the whole decision.
 * There is no second place to try, which is why it answers with the full
 * assessment — a reason and a suggestion, not a boolean. A caller that refuses a
 * job has to be able to say why in words the person can act on.
 *
 * The WebAssembly check comes first and separately: assessPixels only reaches
 * its own `no-wasm` branch once the dimensions are known, and a browser with
 * WASM off must be told so even for a file nothing has measured yet.
 *
 * `operation` has NO DEFAULT here, unlike assessPixels and assessFile below.
 * The operation is what decides the memory profile — whether a resampling stage
 * is charged at all — so quietly costing an unnamed job as the cheapest one
 * would under-charge exactly the caller that forgot to say what it was doing.
 * The lower-level helpers keep their default because they are given an
 * operation by everything that reaches them; this is the front door.
 *
 * @param {File|Blob} file
 * @param {{ operation: string, sourceWidth?: number|null, sourceHeight?: number|null,
 *           targetWidth?: number|null, targetHeight?: number|null, device?: object }} options
 * @returns {{ ok: boolean, code: string, reason: string|null, suggestion: string|null }}
 */
export function assessJob(file, {
    operation = null,
    sourceWidth = null,
    sourceHeight = null,
    targetWidth = null,
    targetHeight = null,
    device = readDeviceProfile(),
} = {}) {
    if (!device.wasm) return refuse('no-wasm', NO_WASM_REASON, NO_WASM_SUGGESTION, { device });
    if (!operation || !file) return refuse('no-file', NO_FILE_REASON, NO_FILE_SUGGESTION, { device });

    return assessFile(file, {
        operation,
        sourceWidth: positiveOrNull(sourceWidth),
        sourceHeight: positiveOrNull(sourceHeight),
        targetWidth: positiveOrNull(targetWidth),
        targetHeight: positiveOrNull(targetHeight),
        device,
    });
}

/**
 * A measurement, or nothing.
 *
 * A page with no preview to measure (the HEIC tool creates none — no browser
 * decodes HEIC) reports 0 or undefined. The gate treats 0 as "could not be
 * read" and refuses, so absent is the honest answer there: assessFile then
 * defers with `dimensions-unknown`, and the engine re-costs the job the moment
 * the decoder reports the real size.
 */
function positiveOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * The refusal as one thing to show a person.
 *
 * The reason says what is wrong and the suggestion says what to do instead, and
 * a refusal is now the ONLY outcome for a job this device cannot do — there is
 * no quiet second attempt behind it. So both halves are joined into the single
 * string every tool panel already renders, rather than the suggestion being
 * left in a field nothing displays.
 */
export function refusalMessage(assessment) {
    const reason = assessment?.reason || FALLBACK_REASON;
    const suggestion = assessment?.suggestion;
    return suggestion ? `${reason} ${suggestion}` : reason;
}
