/**
 * Reaching an exact byte count, in the browser
 *
 * /compress-image-to-100kb and its siblings are the highest-traffic pages on
 * the site, so "make this exactly 100 KB" has to be answered honestly by the
 * browser build or it must not ship at all. This module is where that decision
 * is made, once, for all three formats — and the three answers are genuinely
 * different because the three encoders are.
 *
 * WEBP: ONE ENCODE, NOT EIGHT
 *
 * libwebp has a native rate controller. `WebPConfig.target_size` is "if
 * non-zero, set the desired target size in bytes", and it takes precedence over
 * `quality`; `pass` is the number of entropy-analysis passes the internal
 * dichotomy is allowed. Both are exposed verbatim by @jsquash/webp — see its
 * meta.js, which lists the whole WebPConfig struct as `defaultOptions`, and its
 * encode.js, which merges the caller's options over them. So one call to the
 * encoder does what the server's binary search needed up to eight round trips
 * to do. Measured over 84 image/target pairs (400x300 to 1600x1200, 20 KB to
 * 500 KB): 47.8 s of native encodes against 66.6 s of eight-probe searches.
 *
 * TWO THINGS THE MEASUREMENTS FORCED, AND THEY ARE NOT OPTIONAL
 *
 *  1. `pass` MUST BE RAISED. @jsquash defaults it to 1, and at 1 the rate
 *     controller barely engages: a 1600x1200 frame asked for 20 KB came back at
 *     435 KB — 21x over. cwebp itself silently uses 6 passes whenever `-size`
 *     is given, and 6 is what WEBP_TARGET_PASSES is set to in encode.js. At 6
 *     the same case lands at 17.3 KB.
 *
 *  2. `target_size` IS A GOAL, NOT A GUARANTEE. Even at 6 passes, 16 of those
 *     84 pairs came back ABOVE the number asked for, the worst by 31%
 *     (1600x1200 asked for 40 KB, delivered 52.6 KB). Shipping the first encode
 *     unchecked would therefore hand people a file that misses the size they
 *     typed. So every native encode is MEASURED, and a miss falls through to
 *     the same bounded quality search JPEG uses. Fast in the common case,
 *     correct in every case.
 *
 * The fallback is also not a pure loss: the native controller works in float
 * quality where the search can only try the 100 integers, and in three of the
 * 84 pairs it reached a target that no integer quality could
 * (1600x1200 at 20 KB: native 19.0 KB, search found nothing at all).
 *
 * JPEG: THE HONEST BOUNDED SEARCH, AT FULL RESOLUTION
 *
 * MozJPEG has no target-size mode, so the search stays. It runs at FULL
 * RESOLUTION and it is not shortened. A spike ran the search on a downscaled
 * proxy and extrapolated: 9 of 35 cases undershot by more than 5%, the worst by
 * 82%, and 100 KB — the landing page everybody arrives on — failed on 2 of 5
 * images. Cutting the probe budget instead is just as bad: at 5 probes rather
 * than TARGET_SEARCH_ITERATIONS' 8, measured output fell up to 16.2% further
 * below the target than it had to, which is quality thrown away for a second of
 * wall clock. It stays correct and slow, and the tool reports every probe.
 *
 * PNG: NO QUANTISER, SO NO PRETENDING
 *
 * The server shrank a PNG by quantising its palette. @jsquash/png is a lossless
 * encoder with no such knob, so a quality search would return eight identical
 * files. The lever the naive port reached for instead was pixels — and it is
 * the wrong lever: a 499 KB PNG asked for 20 KB came back at 13% scale,
 * 800x600 turned into 104x78. Nobody asking for a smaller FILE asked for a
 * smaller PICTURE.
 *
 * So PNG gets exactly one lossless encode at full resolution here. If that fits
 * the target, the request is met. If it does not, `targetMet` comes back false
 * and the caller says so out loud — /compress offers WebP, which does reach the
 * size at full resolution, and never silently returns a thumbnail.
 */
import { TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import { encodeImageData } from '@/lib/image-client/encode';
import { searchQuality } from '@/lib/image-client/target-bytes';

/** How the fitting encode was arrived at. Reported for tests and telemetry. */
export const NATIVE = 'native';
export const SEARCH = 'search';
export const LOSSLESS = 'lossless';

/**
 * Formats whose bytes can be steered to a target without touching the pixel
 * dimensions. PNG is absent for the reason in the header, and that absence is
 * what /compress reads when it decides to offer WebP.
 */
export const TARGET_CAPABLE_FORMATS = ['jpeg', 'webp'];

/** True when this format can be driven to a byte target at full resolution. */
export function reachesTargetBytes(format) {
    return TARGET_CAPABLE_FORMATS.includes(format);
}

/**
 * The format to offer when the source cannot reach a byte target on its own.
 * WebP rather than JPEG because it keeps transparency, which a PNG is quite
 * likely to be carrying and which a JPEG would flatten onto black.
 */
export const TARGET_FALLBACK_FORMAT = 'webp';

/**
 * Encodes `imageData` as close to `targetBytes` as the format allows, never
 * changing its dimensions.
 *
 * @param {object} input
 * @param {ImageData} input.imageData     decoded once by the caller; only the encode repeats
 * @param {string} input.format           'jpeg' | 'png' | 'webp'
 * @param {number} input.targetBytes
 * @param {number} input.deadline         wall-clock stop, compared against now()
 * @param {function} [input.now]
 * @param {(index: number, total: number) => void} [input.onIteration]  fires once per real encode
 * @param {function} [input.guard]        throws to abort a cancelled job
 * @param {function} [input.encode]       seam for tests; defaults to encodeImageData
 * @param {number} [input.maxIterations]
 * @returns {Promise<{ fit: object|null, fitBytes: number|null, floorBytes: number|null,
 *                     targetMet: boolean, iterations: number, strategy: string }>}
 *   `fit` is the payload to hand back. It is null only when the format could
 *   have hit the target and did not — PNG always returns its one encode, with
 *   `targetMet` telling the truth about it.
 */
export async function compressToTargetBytes({
    imageData,
    format,
    targetBytes,
    deadline,
    now = Date.now,
    onIteration = null,
    guard = null,
    encode = encodeImageData,
    maxIterations = TARGET_SEARCH_ITERATIONS,
}) {
    const { width, height } = imageData;

    // scalePercent is stated rather than computed because it is the guarantee:
    // nothing in this module resizes anything.
    const decorate = (encoded, targetMet) => ({
        ...encoded,
        width,
        height,
        scalePercent: 100,
        targetMet,
    });

    let floorBytes = null;
    const trackFloor = (bytes) => {
        if (typeof bytes === 'number' && (floorBytes === null || bytes < floorBytes)) floorBytes = bytes;
    };

    if (!reachesTargetBytes(format)) {
        guard?.();
        onIteration?.(1, 1);

        const encoded = await encode(imageData, { format });
        const targetMet = encoded.bytes <= targetBytes;

        return {
            fit: decorate(encoded, targetMet),
            fitBytes: encoded.bytes,
            floorBytes: encoded.bytes,
            targetMet,
            iterations: 1,
            strategy: LOSSLESS,
        };
    }

    // WebP gets one shot at the native controller before the search is paid
    // for, so the search budget is the ceiling rather than the expectation.
    const nativeProbes = format === TARGET_FALLBACK_FORMAT ? 1 : 0;
    const totalProbes = maxIterations + nativeProbes;
    let iterations = 0;

    if (nativeProbes) {
        guard?.();

        const native = await encode(imageData, { format, targetBytes });
        iterations += 1;
        onIteration?.(iterations, totalProbes);
        trackFloor(native.bytes);

        if (native.bytes <= targetBytes) {
            return {
                fit: decorate(native, true),
                fitBytes: native.bytes,
                floorBytes,
                targetMet: true,
                iterations,
                strategy: NATIVE,
            };
        }
    }

    const nativeIterations = iterations;

    const search = await searchQuality({
        targetBytes,
        maxIterations,
        deadline,
        now,
        onIteration: (index) => onIteration?.(nativeIterations + index, totalProbes),
        probe: async (quality) => {
            guard?.();
            const encoded = await encode(imageData, { format, quality });
            return { bytes: encoded.bytes, payload: decorate(encoded, true) };
        },
    });

    iterations += search.iterations;
    trackFloor(search.floorBytes);

    return {
        fit: search.fit,
        fitBytes: search.fitBytes,
        floorBytes,
        targetMet: Boolean(search.fit),
        iterations,
        strategy: SEARCH,
    };
}

export default compressToTargetBytes;
