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
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
} from '@/lib/constants';
import { withinPixelBudget } from '@/lib/image/dimensions';
import { validateUpload } from '@/lib/image/validate';

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
 * MAX_PIXELS in lib/constants).
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
 * something near 100 MP — the same reasoning that put a header probe in
 * lib/image/heic-probe.js on the server. 80 MP is 320 MB of RGBA before a
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
 * @param {number} [input.fileBytes]     encoded input, resident during decode
 * @param {string} [input.operation]
 * @param {boolean} [input.nativeDownscale]
 */
export function estimatePeakBytes({
    sourceWidth,
    sourceHeight,
    targetWidth = null,
    targetHeight = null,
    fileBytes = 0,
    operation = DEFAULT_OPERATION,
    nativeDownscale = nativeDownscaleSupported(),
} = {}) {
    const profile = profileFor(operation);

    const source = surfaceBytes(sourceWidth, sourceHeight);
    const destination = surfaceBytes(
        targetWidth ?? sourceWidth,
        targetHeight ?? sourceHeight,
    );

    const decodeStage = source * DECODE_SURFACE_COPIES + fileBytes;

    const resizeStage = profile.resizes
        ? (nativeDownscale
            ? source * NATIVE_RESIZE_SOURCE_COPIES + destination * NATIVE_RESIZE_DEST_COPIES
            : source * WASM_RESIZE_SOURCE_COPIES + destination * WASM_RESIZE_DEST_COPIES)
        : 0;

    const encodeStage = profile.encodes
        ? destination * (ENCODE_INPUT_COPIES + ENCODE_WORKING_SET_FACTOR)
        : 0;

    return Math.round(Math.max(decodeStage, resizeStage, encodeStage) + WASM_BASELINE_BYTES);
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
 */
export function assessPixels({
    sourceWidth,
    sourceHeight,
    targetWidth = null,
    targetHeight = null,
    fileBytes = 0,
    operation = DEFAULT_OPERATION,
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

    if (sourceWidth * sourceHeight > HARD_MAX_SOURCE_PIXELS) {
        return refuse(
            'source-too-large',
            `This image is ${megapixels} megapixels, which is past the ${Math.round(HARD_MAX_SOURCE_PIXELS / 1_000_000)} megapixel limit for processing in a browser tab.`,
            'Scale it down in a desktop app first, then bring it back here.',
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    const outputWidth = targetWidth ?? sourceWidth;
    const outputHeight = targetHeight ?? sourceHeight;

    if (outputWidth > MAX_DIMENSION || outputHeight > MAX_DIMENSION) {
        return refuse(
            'output-too-large',
            `The output cannot be wider or taller than ${MAX_DIMENSION} pixels.`,
            `Pick a size at or under ${MAX_DIMENSION} pixels on the long side.`,
            { megapixels, estimatedPeakBytes: null, budgetBytes, device },
        );
    }

    if (!withinPixelBudget(outputWidth, outputHeight, MAX_PIXELS)) {
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
        fileBytes,
        operation,
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
        suggestion: (outputWidth * outputHeight) > COMFORTABLE_ENCODE_PIXELS
            ? 'This is a large image, so it may take a few seconds.'
            : null,
        megapixels,
        estimatedPeakBytes,
        budgetBytes,
        device,
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
 * @param {object} [options.device]        injected for tests
 */
export function assessFile(file, {
    operation = DEFAULT_OPERATION,
    sourceWidth = null,
    sourceHeight = null,
    targetWidth = null,
    targetHeight = null,
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
        device,
    });

    return { ...pixels, dimensionsKnown: true };
}
