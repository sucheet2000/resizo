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

// Every format this build can WRITE. AVIF is here because
// lib/image-client/encode.js has an encoder for it — @jsquash/avif 2.1.1,
// fetched only when a job actually asks for one — and for no other reason.
// Narrower lists below name the tools that still cannot offer it.
export const ALLOWED_OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

// The list most consumers read: /crop, /compress, the signature resizer, the
// print sheet, the requirement fitter, the icon package, /jpg-to-pdf and the
// bulk compressor. AVIF is deliberately NOT here. Every one of those tools ends
// at a form, a printer or a favicon, and widening the shared list would put
// AVIF into all of them at once for the sake of the few that can use it. The
// two lanes that do read AVIF in a batch — /bulk-image-converter and the bulk
// tab on /resize — take CONVERT_INPUT_FORMATS and RESIZE_INPUT_FORMATS, and
// write BULK_OUTPUT_FORMATS.
export const RASTER_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

// GIF is the one format lib/image/magic-bytes.js still sniffs only in order to
// refuse it: no browser exposes a GIF decoder to this engine, and an animation
// is not a still picture. Recognising it is what lets an upload be refused for
// what it actually is rather than slipping through as something else.
//
// AVIF has crossed that line and is now accepted in both directions on
// /convert, and as an input on /resize:
//
//   IN costs nothing. The decode is the browser's own — `createImageBitmap` on
//   an AVIF blob, no WASM shipped at all — and it is present in Chrome 85+,
//   Firefox 93+ and Safari 16+. A browser without it is refused by name
//   (lib/image-client/capability.js canDecodeAvif) rather than handed 267 KB of
//   decoder that would run 34x slower.
//
//   OUT costs 842 KB brotli, fetched the first time a job writes an AVIF and
//   never on a page load. Measured 2026-09-11: 135 ms for a 1.7 MP photo at
//   speed 9, 981 ms at 12 MP.
//
// Animated AVIF is refused before any decode (see lib/image-client/avif.js),
// and the 10- and 12-bit variants decode to 8-bit because every browser's
// decoder does that too.
export const CONVERT_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

export const CONVERT_OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

export const RESIZE_INPUT_FORMATS = ['jpeg', 'png', 'webp', 'avif'];

// What /compress can write. AVIF is absent, and the reason is the search rather
// than the encoder: hitting an exact byte target means up to eight encodes
// inside TARGET_SEARCH_DEADLINE_MS, and libavif exposes no rate controller of
// its own the way libwebp's `target_size` does. Eight encodes of a 12 MP photo
// measured about eight seconds on a laptop at speed 9 and minutes on a phone,
// against a 20 s deadline. (Quality IS monotonic — zero inversions over 20
// steps on both bench sources — so a search would be correct; it would just not
// finish.)
export const COMPRESS_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

// What /passport-photo and /image-size-fitter can write. Same search argument
// as /compress, plus a product one that outranks it: these tools exist to meet
// a government form or a portal upload, and no authority in
// lib/catalog/application-presets/ accepts an AVIF.
export const FIT_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

// What a BATCH can write — /bulk-image-converter and the bulk tab on /resize —
// and the one list that is narrower than CONVERT_OUTPUT_FORMATS and
// ALLOWED_OUTPUT_FORMATS purely for memory. One AVIF encode is fine; twenty in
// a row are not proven safe under MAX_BULK_FILES and MAX_BULK_TOTAL_BYTES on a
// phone, because the WASM heap never shrinks between files — measured at 27.4
// MB per megapixel and still resident afterwards. AVIF output is offered on
// /convert and the one-image panel of /resize, where one file is one encode
// and the worker is recycled after it. lib/upload/process-file.js refuses a
// batch row that would need it ("Same as the original" on an AVIF source), in
// words, before the engine is asked.
export const BULK_OUTPUT_FORMATS = ['jpeg', 'png', 'webp'];

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

// What /heic can write. JPEG stays the default and what /heic-to-jpg promises;
// PNG is the lossless option for the /heic-to-png intent, with no quality dial
// because the encoder has none.
export const HEIC_OUTPUT_FORMATS = ['jpeg', 'png'];

// What /signature-resizer can write. WebP is deliberately absent: a signature
// is going onto a form, and the forms that take one list JPG and PNG.
export const SIGNATURE_OUTPUT_FORMATS = ['jpeg', 'png'];

// The formats whose resolution metadata can be rewritten without decoding a
// pixel: a JFIF/EXIF field in a JPEG, a pHYs chunk in a PNG. WebP carries no
// density field at all, so it is not here and the tool says so.
export const DPI_INPUT_FORMATS = ['jpeg', 'png'];

// The formats whose metadata can be removed by rewriting the container and
// leaving the compressed image data byte for byte where it was. HEIC is
// absent: rewriting an ISOBMFF container is a different job, and pretending a
// decode-and-re-encode is "lossless" is exactly what this list exists to stop.
export const METADATA_INPUT_FORMATS = ['jpeg', 'png', 'webp'];

// Density bounds for /change-image-dpi. JFIF stores density in 16 bits and no
// printer or portal asks for more than a few thousand.
export const MIN_DPI = 1;

export const MAX_DPI = 10000;

// "Fit under the target": the quality floor the byte-target search may not go
// below before it starts shrinking the picture instead (the compress page says
// artefacts show below 50, so 50 is where the trade changes), the factor each
// side shrinks by per step, how many steps are allowed, and the smallest short
// side the search will still hand back. Eight steps of 0.8 reach 17% of the
// original size, which is where a 12-megapixel photo becomes a 700-pixel one.
export const FIT_MIN_QUALITY = 50;

export const FIT_SCALE_STEP = 0.8;

export const FIT_MAX_STEPS = 8;

export const FIT_MIN_DIMENSION = 32;
