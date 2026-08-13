/**
 * Engine Limits and Format Allowlists
 *
 * The single source of truth for every upload/processing limit and for which
 * formats each tool accepts and emits. Nothing here may be re-declared in a
 * route, a component or a worker.
 *
 * This is a LEAF: it imports nothing, and it deliberately carries no page copy,
 * no tool titles and no marketing prose. Those live in lib/catalog.js. The two
 * used to be one file, which meant the built chunk the image engine depends on
 * — and the WEB WORKER downloads — also carried every tool description, and
 * editing a description invalidated a chunk the engine reads. Splitting them
 * costs one extra import and buys the worker a dependency it can actually use.
 */

// The per-file cap, and now a published product promise rather than a platform
// one. It was chosen for a serverless function's memory; the binding constraint
// is the visitor's device, which lib/image-client/capability.js costs directly
// from what the browser reports. 20MB is left exactly where it is: it is quoted
// on every drop zone and in the page copy, the capability gate refuses anything
// this device genuinely cannot hold long before the file size becomes the
// reason, and moving a published number is a product decision, not a cleanup.
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const MAX_DIMENSION = 8000;

// Total-pixel budget for a single OUTPUT. 8000x8000 alone is 64MP, so the
// dimension cap on its own does not bound the working set. It is deliberately
// not a decode budget: downscaling a 48MP phone photo is the core job here.
// The SOURCE side is bounded separately and more tightly, by
// HARD_MAX_SOURCE_PIXELS in lib/image-client/capability.js — a tab has no
// equivalent of sharp's 268MP decode headroom and cannot buy it back.
export const MAX_PIXELS = 40_000_000;

export const MAX_SCALE_PERCENT = 400;

export const MAX_BULK_FILES = 20;

export const MAX_BULK_TOTAL_BYTES = 80 * 1024 * 1024;

export const DEFAULT_QUALITY = 80;

// Bounds for the exact-size target on /compress. The floor exists because
// no photograph survives below it and the search would burn eight encodes to
// fail anyway; the ceiling is the upload cap, since a target above it can only
// ever be met by the untouched original.
export const MIN_TARGET_BYTES = 10 * 1024;

export const MAX_TARGET_BYTES = MAX_FILE_SIZE;

// Encode budget for one size-targeting search phase. Binary search over the
// 1-100 quality range needs 7 probes to isolate a single value, so 8 covers it
// with a spare and bounds the worst case at eight encodes per phase.
export const TARGET_SEARCH_ITERATIONS = 8;

export const ALLOWED_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const RASTER_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

// Every allowlist below is the same three formats, and AVIF and GIF are
// deliberately absent from all of them. AVIF used to be a /convert-only format
// in both directions and GIF a /resize-only input; both are gone because the
// image work now happens in the browser, where there is no AVIF decoder and no
// GIF decoder available, and where an AVIF *encode* costs 823 KB of extra
// download and 15-30 seconds per image on a phone.
//
// Recognising the two formats is still correct and still happens:
// lib/image/magic-bytes.js sniffs AVIF and GIF precisely so an upload can be
// refused for what it actually is rather than slipping through as something
// else. Accepting one would be a promise this stack cannot keep.
export const CONVERT_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const CONVERT_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const RESIZE_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

export const HEIC_INPUT_FORMATS = ['heic'];

// What /jpg-to-pdf accepts. The only list here that mixes the raster formats
// with HEIC, because a PDF page is a container rather than an image format:
// every one of these ends up as a JPEG stream inside the document, and the HEIC
// decoder is already shipped for /heic. JPEG is first because it is the only
// input that reaches the page without being decoded at all — see
// lib/image-client/pdf.js.
export const PDF_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'heic'];

// What /merge-pdf accepts, and the only list here with no image in it. A merge
// reads pages rather than pixels, so the one thing it can take is the one
// container that has pages — see lib/image-client/pdf-merge.js.
export const MERGE_PDF_INPUT_FORMATS = ['pdf'];

export const PDF_MIME_TYPE = 'application/pdf';

export const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

export const HEIC_EXTENSIONS = ['.heic', '.heif'];
