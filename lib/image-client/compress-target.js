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
import {
    FIT_MAX_STEPS,
    FIT_MIN_DIMENSION,
    FIT_MIN_QUALITY,
    FIT_SCALE_STEP,
    TARGET_SEARCH_ITERATIONS,
} from '@/lib/limits';
import { encodeImageData } from '@/lib/image-client/encode';
import { resizeImageData } from '@/lib/image-client/resize';
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
 * @param {number} [input.minQuality]     floor for the quality search; 1 unless
 *   the caller has a second lever to pull, which only fitUnderTargetBytes has
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
    minQuality = 1,
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
        minQuality,
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

/**
 * The default resampler for the fit policy. A seam, so the step arithmetic can
 * be proved without waiting on lanczos3.
 */
async function resamplePixels(imageData, { width, height }) {
    const resized = await resizeImageData(imageData, { width, height });
    return resized.data;
}

/**
 * One size's worth of the fit policy: can THIS size reach the target, and if it
 * can, what is the best-looking encode that does.
 *
 * THE FLOOR IS PROBED FIRST, AND THAT IS THE WHOLE POINT OF THIS FUNCTION
 *
 * Output size rises with quality — the monotonicity the search above already
 * assumes — so if the LOWEST quality this policy will accept still misses the
 * target, nothing above it can hit it either. One encode settles that. A binary
 * search reaches the same conclusion in eight, and it spends them at the
 * LARGEST size, before a single pixel has been dropped: on a 12-megapixel phone
 * photo that is eight MozJPEG encodes of a full frame, which can burn the whole
 * TARGET_SEARCH_DEADLINE_MS before the first shrink step ever runs and turn a
 * reachable target into a false refusal. /compress-image-to-20kb defaults to
 * this policy and its typical input is exactly that photo.
 *
 * So a hopeless size costs one encode and a promising one costs the search —
 * and only one size can ever be promising, because the moment a floor fits,
 * this function returns something and the caller stops shrinking.
 *
 * WHEN THE FLOOR FITS, ITS BYTES ARE KEPT. The search then runs from
 * minQuality + 1 upward, so the floor is never encoded twice, and a search that
 * finds nothing leaves the floor probe as the answer. Monotonicity again: any
 * higher quality that still fits is a bigger file than the floor's, which is
 * the better-looking one, so a search hit always beats the floor and a search
 * miss always leaves it standing.
 */
async function attemptAtSize({
    imageData,
    format,
    targetBytes,
    deadline,
    now,
    guard,
    encode,
    maxIterations,
    minQuality,
    onProbe,
}) {
    let floorBytes = null;

    const trackFloor = (bytes) => {
        if (typeof bytes === 'number' && (floorBytes === null || bytes < floorBytes)) floorBytes = bytes;
    };

    const probe = async (options) => {
        guard?.();
        const encoded = await encode(imageData, options);
        onProbe();
        trackFloor(encoded.bytes);
        return encoded;
    };

    // PNG has no quality axis in this build, so one lossless encode is the
    // entire question for this size.
    if (!reachesTargetBytes(format)) {
        const encoded = await probe({ format });
        const met = encoded.bytes <= targetBytes;

        return {
            fit: met ? encoded : null,
            fitBytes: met ? encoded.bytes : null,
            floorBytes,
            strategy: LOSSLESS,
        };
    }

    // WebP's own rate controller still gets the first word, exactly as it does
    // under the keep policy — one encode that often lands on its own.
    if (format === TARGET_FALLBACK_FORMAT) {
        const native = await probe({ format, targetBytes });

        if (native.bytes <= targetBytes) {
            return { fit: native, fitBytes: native.bytes, floorBytes, strategy: NATIVE };
        }
    }

    const atFloor = await probe({ format, quality: minQuality });

    if (atFloor.bytes > targetBytes) {
        return { fit: null, fitBytes: null, floorBytes, strategy: SEARCH };
    }

    // Nothing above the floor to search when the floor IS the top.
    if (minQuality >= 100) {
        return { fit: atFloor, fitBytes: atFloor.bytes, floorBytes, strategy: SEARCH };
    }

    const search = await searchQuality({
        targetBytes,
        maxIterations,
        minQuality: minQuality + 1,
        deadline,
        now,
        probe: async (quality) => {
            const encoded = await probe({ format, quality });
            return { bytes: encoded.bytes, payload: encoded };
        },
    });

    return {
        fit: search.fit ?? atFloor,
        fitBytes: search.fitBytes ?? atFloor.bytes,
        floorBytes,
        strategy: SEARCH,
    };
}

/**
 * Encodes `imageData` under `targetBytes`, dropping pixels when quality alone
 * cannot get there.
 *
 * THE SECOND POLICY, AND WHY IT IS OPT-IN
 *
 * compressToTargetBytes above answers "hit this size and do not touch my
 * dimensions", and when no quality reaches the number it says so. That is the
 * right default: nobody asking for a smaller FILE asked for a smaller PICTURE,
 * and the naive port answering a 20 KB request with a 104x78 thumbnail is the
 * bug that rule exists to prevent.
 *
 * But a portal with a hard 50 KB ceiling does not care about the dimensions,
 * and a refusal helps that person not at all. So this is the same request with
 * the other trade made — and it is chosen by the visitor, reported back in
 * `resized`, `scalePercent` and `steps`, and never taken silently.
 *
 * HOW IT SPENDS ITS TWO LEVERS, IN ORDER
 *
 *  1. QUALITY FIRST, down to `minQuality` and no further. FIT_MIN_QUALITY is 50
 *     because that is where /compress's own copy says the artefacts start to
 *     show; below it the smaller picture is the better answer, so the search
 *     stops turning that dial rather than turning it into mush.
 *  2. THEN PIXELS, `scaleStep` off each side per step, and EVERY STEP RESAMPLES
 *     FROM THE ORIGINAL. Resampling the previous step's output would compound
 *     the filter — eight rounds of lanczos3 on top of each other is visibly
 *     softer than one round at the same final size, for identical dimensions
 *     and identical bytes. The step's size is `round(source * step ** n)`,
 *     rounded once from the source, for the same reason.
 *
 * It stops at `maxSteps`, at the deadline, or when the short side would fall
 * under `minDimension` — whichever comes first. Eight steps of 0.8 reach 17% of
 * the original, which turns a 12 MP photo into a 700-pixel one; past that the
 * honest answer is that the target is out of reach.
 *
 * @param {object} input  as compressToTargetBytes, plus:
 * @param {function} [input.resize]       seam for tests; (pixels, { width, height }) => pixels
 * @param {number} [input.minQuality]     quality floor before pixels are spent
 * @param {number} [input.scaleStep]      the factor each side shrinks by per step
 * @param {number} [input.maxSteps]       how many shrink steps are allowed
 * @param {number} [input.minDimension]   smallest short side worth handing back
 * @returns {Promise<{ fit: object|null, fitBytes: number|null, floorBytes: number|null,
 *                     targetMet: boolean, iterations: number, steps: number,
 *                     strategy: string|null, resized: boolean, width: number,
 *                     height: number, scalePercent: number, quality: number|null }>}
 *   `iterations` counts every real encode across every step. When nothing fits,
 *   `fit` is null and `floorBytes`/`width`/`height` describe the smallest
 *   attempt, which is what the refusal quotes back.
 */
export async function fitUnderTargetBytes({
    imageData,
    format,
    targetBytes,
    deadline,
    now = Date.now,
    onIteration = null,
    guard = null,
    encode = encodeImageData,
    resize = resamplePixels,
    minQuality = FIT_MIN_QUALITY,
    scaleStep = FIT_SCALE_STEP,
    maxSteps = FIT_MAX_STEPS,
    minDimension = FIT_MIN_DIMENSION,
    maxIterations = TARGET_SEARCH_ITERATIONS,
}) {
    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;

    /**
     * The worst case, stated up front, because a total that grew as the steps
     * did would walk the progress bar backwards and a bar that goes backwards
     * reads as a bug to the person watching it.
     *
     * Every step pays its floor probe — plus WebP's native attempt, which comes
     * first — and exactly ONE step can ever pay the quality search, because a
     * floor that fits ends the walk. So the ceiling is every step's floor plus
     * one search: 17 encodes for a JPEG at the shipped constants, where the
     * un-probed version's ceiling was 72.
     */
    const perStepFloor = 1 + (format === TARGET_FALLBACK_FORMAT ? 1 : 0);
    const totalProbes = (maxSteps + 1) * perStepFloor + maxIterations;

    const scalePercentOf = (width) => Math.round((width / sourceWidth) * 100);

    const sizeAtStep = (step) => ({
        width: Math.max(1, Math.round(sourceWidth * scaleStep ** step)),
        height: Math.max(1, Math.round(sourceHeight * scaleStep ** step)),
    });

    let iterations = 0;
    let steps = 0;
    let strategy = null;
    let floorBytes = null;
    let floor = null;

    let pixels = imageData;
    let width = sourceWidth;
    let height = sourceHeight;

    for (let step = 0; ; step += 1) {
        guard?.();
        steps = step;

        const attempt = await attemptAtSize({
            imageData: pixels,
            format,
            targetBytes,
            deadline,
            now,
            guard,
            encode,
            maxIterations,
            minQuality,
            // Counted here rather than read off the result, because this is the
            // number the bar is already reporting and two counters that have to
            // agree is one counter too many.
            onProbe: () => {
                iterations += 1;
                onIteration?.(iterations, totalProbes);
            },
        });

        strategy = attempt.strategy;

        // `<=` rather than `<` so a TIE is broken toward the smaller picture.
        // This is the number the refusal quotes back — "the smallest this could
        // try was W x H" — and quoting the source size after having tried six
        // smaller ones would be a lie about what the tool did.
        if (attempt.floorBytes !== null && (floorBytes === null || attempt.floorBytes <= floorBytes)) {
            floorBytes = attempt.floorBytes;
            floor = { width, height, scalePercent: scalePercentOf(width) };
        }

        if (attempt.fit) {
            const scalePercent = scalePercentOf(width);
            // `targetMet` rides on the payload as well as the result because
            // runOperation spreads the payload and reads the flag off it.
            const fit = { ...attempt.fit, width, height, scalePercent, targetMet: true };

            return {
                fit,
                fitBytes: attempt.fitBytes,
                floorBytes,
                targetMet: true,
                iterations,
                steps: step,
                strategy,
                resized: step > 0,
                width,
                height,
                scalePercent,
                quality: fit.quality ?? null,
            };
        }

        if (step >= maxSteps) break;
        if (now() >= deadline) break;

        const next = sizeAtStep(step + 1);

        // Below the floor the result is a stamp rather than a picture, and a
        // step that shrinks nothing would re-run the same search for nothing.
        if (Math.min(next.width, next.height) < minDimension) break;
        if (next.width >= width && next.height >= height) break;

        pixels = await resize(imageData, next);
        width = next.width;
        height = next.height;
    }

    return {
        fit: null,
        fitBytes: null,
        floorBytes,
        targetMet: false,
        iterations,
        steps,
        strategy,
        resized: false,
        width: floor?.width ?? width,
        height: floor?.height ?? height,
        scalePercent: floor?.scalePercent ?? scalePercentOf(width),
        quality: null,
    };
}

export default compressToTargetBytes;
