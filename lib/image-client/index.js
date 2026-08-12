/**
 * Browser Image Engine — public surface
 *
 * Everything the worker and the tool hooks are allowed to reach for. Import
 * from here, not from the individual modules: the split between decode, resize
 * and encode is an implementation detail and the native-versus-WASM routing is
 * expected to keep moving between them.
 *
 * The one thing every caller must do first is assessFile(). Nothing in this
 * engine allocates a pixel buffer before the job has been costed against the
 * device — see lib/image-client/capability.js for why that is not optional.
 *
 * Nothing here runs on the server. Every module needs createImageBitmap,
 * OffscreenCanvas, Blob or WebAssembly, and none of them is imported at module
 * scope by anything the server renders.
 */

export {
    assessFile,
    assessPixels,
    deviceBudgetBytes,
    estimatePeakBytes,
    nativeDownscaleSupported,
    readDeviceProfile,
    wasmSupported,
    BYTES_PER_PIXEL,
    COMFORTABLE_ENCODE_PIXELS,
    HARD_MAX_SOURCE_PIXELS,
    MAX_TAB_BUDGET_BYTES,
    MIN_TAB_BUDGET_BYTES,
} from '@/lib/image-client/capability';

export { decodeAndDownscale, decodeToImageData } from '@/lib/image-client/decode';

export {
    encodeImageData,
    formatSupportsQuality,
    normaliseFormat,
    BROWSER_OUTPUT_FORMATS,
    QUALITY_FORMATS,
} from '@/lib/image-client/encode';

export {
    canUseNativeDownscale,
    fitWithin,
    resizeImageData,
    targetDimensions,
    RESIZE_METHOD,
} from '@/lib/image-client/resize';

export { cropImageData, resolveCropRect } from '@/lib/image-client/crop';

export {
    impossibleTargetMessage,
    parseTargetBytes,
    searchQuality,
    searchScale,
    TARGET_SEARCH_DEADLINE_MS,
} from '@/lib/image-client/target-bytes';

export {
    runOperation,
    CLIENT_OPS,
    HEIC_JPEG_QUALITY,
    JobError,
    PROGRESS,
} from '@/lib/image-client/operations';

export { fileFromFormData, optionsFromFormData, FILE_FIELD } from '@/lib/image-client/form-options';

/**
 * The worker wrapper is NOT re-exported here. index.js is the engine's surface
 * and is imported by the worker itself; pulling client.js in would make the
 * worker import a module that constructs a worker. Reach for
 * lib/image-client/client.js directly, or use lib/hooks/useLocalProcess.js.
 */

export {
    loadHeifDecoder,
    loadJpegDecoder,
    loadJpegEncoder,
    loadPngDecoder,
    loadPngEncoder,
    loadResizer,
    loadWebpDecoder,
    loadWebpEncoder,
    resetCodecs,
    WASM_BASE_PATH,
} from '@/lib/image-client/codecs';
