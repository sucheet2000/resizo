/**
 * Bulk image converter — the convert-shaped half of the batch platform.
 *
 * The rows, the sequencer, the summary and the archive are lib/upload/batch.js,
 * shared with the bulk compressor. What lives here is the one operation: turn
 * every file in the list into one output format, and prove afterwards that it
 * worked.
 *
 * WHY THERE IS A VERIFICATION STEP AT ALL
 *
 * A conversion hands back a file whose correctness the visitor cannot see. It
 * downloads, it opens, and three separate things about it could still be wrong:
 * the bytes could be a different container from the extension (a `.webp`
 * holding JPEG), the picture could have come back a different size, or the
 * transparency could have been dropped on the way to a format that carries it.
 * Every one of those is readable out of the finished header, so none of them is
 * taken from the code that produced the file: lib/image-client/requirements.js
 * opens the bytes with a parser that never saw the request, and a row is only
 * a success when that parser agrees.
 *
 * A FILE ALREADY IN THE OUTPUT FORMAT IS NOT RE-ENCODED. A JPEG asked to become
 * a JPEG would come back re-compressed and slightly worse for nothing, so it is
 * handed straight back — bytes untouched, metadata and all — and the row says
 * so. That is the one path in this module where the output is the input, and it
 * is why the behaviour registry says transparency here 'depends' rather than
 * naming one answer.
 *
 * AVIF IS AN INPUT HERE AND NEVER AN OUTPUT, so the kept path cannot be reached
 * with one: `source === target` is impossible when no target is ever 'avif'.
 * That used to be load-bearing — a kept file is verified from its header, and
 * readImageSize returned null for an AVIF — and it is not any more:
 * lib/image-client/image-size.js reads an AVIF's `ispe` now, so if the format
 * ever does become a bulk output the kept row is verifiable rather than
 * unverifiable. The narrowing is a memory decision, not a verification one.
 *
 * Pure module: no React, no catalog.
 */
import { assessJob, refusalMessage } from '@/lib/image-client/capability';
import { processImage } from '@/lib/image-client/client';
import { parseBackground } from '@/lib/image-client/flatten';
import { validateOutput } from '@/lib/image-client/requirements';
import { formatLabel } from '@/lib/format/upload-helpers';
import { buildOutputFilename } from '@/lib/image/filename';
import { QUALITY_FORMATS as ENGINE_QUALITY_FORMATS } from '@/lib/image-client/encode';
import { BULK_OUTPUT_FORMATS, DEFAULT_QUALITY as ENGINE_DEFAULT_QUALITY } from '@/lib/limits';
import { STATUS, isCancellation, readBlobHead, readBlobSize, summarize } from '@/lib/upload/batch';

/**
 * What a BATCH can write, which is deliberately narrower than what /convert
 * can. Read from the registry, never re-typed.
 *
 * The gap is AVIF, and the reason is memory rather than capability. libavif's
 * WebAssembly heap never shrinks between encodes — measured at 27.4 MB per
 * megapixel and still resident when the next file starts — so twenty files in
 * a row on a phone are a growing heap with no moment to give it back. One file
 * is different: /convert writes one AVIF and lib/image-client/client.js throws
 * the worker away afterwards. The bulk copy says so and links there.
 */
export const OUTPUT_FORMATS = BULK_OUTPUT_FORMATS;

/**
 * WebP is the default because it is the answer to the question people bring to
 * a bulk converter — a folder of photos that has to get smaller without being
 * cropped — and because it is the only one of the three that carries
 * transparency AND compresses a photograph.
 */
export const DEFAULT_OUTPUT_FORMAT = 'webp';

export const ZIP_FILENAME = 'resizo-converted-images.zip';

export const DEFAULT_QUALITY = ENGINE_DEFAULT_QUALITY;

/**
 * The formats a quality dial means anything for HERE: the engine's own list,
 * narrowed to what this tool can write.
 *
 * It used to be a second hand-typed `['jpeg', 'webp']`, identical to the
 * engine's by coincidence rather than by construction — a trap that only
 * springs when the two diverge, which is exactly what AVIF joining the engine's
 * quality formats did. Deriving it costs no bytes: lib/image-client/encode.js
 * is already in this module's import graph through validateOutput.
 *
 * PNG is absent either way. It is lossless here with no quantiser at all, so a
 * slider on it would be a control that does nothing — the panel says so out
 * loud instead of offering one.
 */
export const QUALITY_FORMATS = ENGINE_QUALITY_FORMATS.filter((format) => OUTPUT_FORMATS.includes(format));

/** photo.png → photo.webp. No prefix and no suffix: it is the same picture. */
export function outputName(name, format) {
    return buildOutputFilename({ name, format });
}

/**
 * What the panel says about a file that was already in the output format.
 *
 * It has to answer the question the row otherwise raises — why is the result
 * byte for byte the original? — and it has to be true about what did NOT happen
 * to it, which is that nothing was taken out. Unlike the compressor's kept path
 * there is no metadata strip here: a conversion that was not needed is a file
 * that was not touched.
 */
export function keptNote(format) {
    return `Already ${formatLabel(format)} — kept unchanged, metadata included.`;
}

const HEX_NAMES = {
    '#ffffff': 'white',
    '#000000': 'black',
};

/**
 * The colour the flatten ACTUALLY used, named the way a person would.
 *
 * Derived through parseBackground rather than from the raw string, because that
 * is the parser the engine composites with and it falls back to white for
 * anything it cannot read. A sentence built from the input would happily
 * announce a colour the pixels never got.
 */
function describeBackground(background) {
    const { r, g, b } = parseBackground(background);
    const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

    return HEX_NAMES[hex] ?? `the colour ${hex}`;
}

/** Where the see-through areas went, for a transparent source going out as JPEG. */
export function flattenNote(background) {
    return `Transparent areas were placed on ${describeBackground(background)}.`;
}

/**
 * The engine fell over on this file. Says nothing about why: the thrown error
 * belongs to a codec, its text is written for a developer, and a visitor can do
 * nothing with it.
 */
export function failedMessage(name, format) {
    return `Resizo couldn’t convert ${name} to ${formatLabel(format)} on this device.`;
}

/**
 * The engine answered, and the answer did not check out.
 *
 * A separate sentence from failedMessage on purpose. "It could not be done" and
 * "it was done and the result was wrong" are different events, and the second
 * one is the one worth the visitor knowing about — it is the row that would
 * otherwise have handed them a broken file.
 */
export function unverifiedMessage(name, format) {
    return `Resizo couldn’t verify ${name} as a ${formatLabel(format)} after converting it, so it was left out.`;
}

/** 'jpg' and 'jpeg' are one format wearing two names. */
function normalise(format) {
    if (typeof format !== 'string') return null;
    const value = format.trim().toLowerCase();
    return value === 'jpg' ? 'jpeg' : value;
}

/**
 * Builds the per-file processor the batch runner calls.
 *
 * The engine, the header reader, the verifier and the memory gate are all
 * injectable, which is what lets the bookkeeping be tested without encoding a
 * pixel — and what lets the verification be tested with bytes that lie.
 *
 * @param {object}   [seams]
 * @param {function} [seams.process]   the engine
 * @param {function} [seams.readSize]  the independent header reader
 * @param {function} [seams.validate]  the independent verifier
 * @param {function} [seams.assess]    the memory gate
 */
export function createConvertProcessor({
    process = processImage,
    readSize = readBlobSize,
    validate = validateOutput,
    assess = assessJob,
} = {}) {
    return async function processOne({
        file,
        name,
        outputFormat,
        quality,
        background,
        sourceWidth = null,
        sourceHeight = null,
        format,
        signal,
    } = {}) {
        const target = normalise(outputFormat);
        const source = normalise(format);
        const measured = Boolean(sourceWidth) && Boolean(sourceHeight);
        const unverified = () => ({ status: STATUS.failed, error: unverifiedMessage(name, target) });

        // ALREADY IN THE OUTPUT FORMAT: the file itself is the answer.
        //
        // No engine call, no memory gate — nothing decodes, so there is no
        // working set to cost — and no metadata strip either. Re-encoding a
        // JPEG as a JPEG would spend quality to produce a file nobody asked
        // for, and the row says in as many words that this one was left alone.
        if (source !== null && source === target) {
            return {
                status: STATUS.success,
                kept: true,
                blob: file,
                filename: outputName(name, source),
                originalBytes: file?.size ?? null,
                resultBytes: file?.size ?? null,
                width: sourceWidth,
                height: sourceHeight,
                sourceWidth,
                sourceHeight,
                format: source,
                outputFormat: target,
                flattened: false,
                flattenedOn: null,
                note: keptNote(source),
                resized: false,
            };
        }

        const assessment = assess(file, { operation: 'convert', sourceWidth, sourceHeight });
        if (!assessment.ok) return { status: STATUS.unsafe, error: refusalMessage(assessment) };

        // WHETHER THE SOURCE HAD TRANSPARENCY, read before anything is done to
        // it. It decides two things afterwards: whether a JPEG row has to say
        // where the see-through areas went, and whether a PNG or WebP row is
        // allowed to come back without an alpha channel. A header read only —
        // no decode, no surface, no cost.

        let outcome;
        try {
            outcome = await process('convert', file, {
                format: target,
                quality,
                background,
                sourceWidth,
                sourceHeight,
            }, { signal });
        } catch (error) {
            if (isCancellation(error, signal)) throw error;
            return { status: STATUS.failed, error: failedMessage(name, target) };
        }

        let row;
        try {
            row = await verify(outcome);
        } catch (error) {
            if (isCancellation(error, signal)) throw error;
            return unverified();
        }

        return row ?? unverified();

        /**
         * THE ENGINE'S ANSWER IS NOT EVIDENCE FOR ITSELF.
         *
         * `outcome.format`, `outcome.width` and `outcome.height` all come from
         * the code that made the file, so none of them is read. The blob's own
         * header is parsed instead, by validateOutput — the same verifier
         * /passport-photo hands its finished file to — and the row is a success
         * only when every check that was asked for passed.
         *
         * One engine field IS read: `transparent`, whether the decoder met a
         * see-through pixel. No header read of the source can tell a
         * transparent logo from a screenshot saved as RGBA, and it is used in
         * one direction only — to ADD a requirement (an alpha channel in a PNG
         * or WebP output, a flatten note on a JPEG), never to wave a file
         * through. The alpha arm reads the output's container: it catches an
         * encoder that dropped the channel (a WebP written without alpha, a
         * PNG written as RGB); whether the pixels inside are still see-through
         * is measured by the E2E suite with sharp, not here.
         *
         * Returns null for anything that does not check out.
         */
        async function verify(result) {
            const blob = result?.blob ?? null;
            if (!blob || !Number.isFinite(blob.size)) return null;
            // The decoder saw a see-through pixel. Trusted in one direction
            // only: it can make a check stricter, never wave a file through —
            // a screenshot saved as RGBA is fully opaque and its container
            // would have demanded an alpha channel the encoder rightly dropped.
            const sawTransparency = result?.transparent === true;

            const bytes = await readBlobHead(blob);
            if (!bytes) return null;

            const size = await readSize(blob);
            if (!size) return null;

            const report = validate(bytes, {
                width: sourceWidth,
                height: sourceHeight,
                format: target,
                maxBytes: null,
                minBytes: null,
                dpi: null,
                // 'removed' is the only direction this verifier can assert, and
                // it is the one that matters: a JPEG still declaring an alpha
                // channel means the encoder fell back to something else. The
                // other direction is checked below, where the SOURCE's alpha is
                // known — validateOutput's 'kept' row passes an opaque file,
                // which is correct for it and not enough for us.
                transparency: target === 'jpeg' ? 'removed' : (sawTransparency ? 'kept' : null),
            });

            // A page that could not measure the source has nothing to hold the
            // dimensions to, so that one row is skipped rather than failed.
            // Every other row still applies, which is what keeps a `.webp` full
            // of JPEG bytes catchable on a batch with no measurements.
            const failedCheck = report.checks.find(
                (check) => check.ok === false && (measured || check.key !== 'dimensions'),
            );
            if (failedCheck) return null;

            // TRANSPARENCY, IN THE DIRECTION THE VERIFIER CANNOT ASSERT.
            // A transparent logo converted to PNG or WebP must still be
            // transparent; an encoder that quietly composited it has thrown
            // away information the visitor cannot get back.
            if (target !== 'jpeg' && sawTransparency && size.hasAlpha !== true) return null;

            const flattened = target === 'jpeg' && sawTransparency;

            return {
                status: STATUS.success,
                kept: false,
                blob,
                filename: outputName(name, target),
                originalBytes: file?.size ?? null,
                resultBytes: blob.size,
                width: size.width,
                height: size.height,
                sourceWidth,
                sourceHeight,
                format: source,
                outputFormat: target,
                flattened,
                flattenedOn: flattened ? background : null,
                note: flattened ? flattenNote(background) : null,
                // A conversion changes the container, never the picture's size.
                resized: false,
            };
        }
    };
}

/**
 * The batch as one set of numbers, with the one count this tool needs that the
 * platform does not: how many files were actually converted.
 *
 * A kept file is a success — the visitor gets a download and the ZIP holds it —
 * but it is not a conversion, and a summary that counted it as one would claim
 * work that never happened.
 */
export function summarizeConversion(rows) {
    const summary = summarize(rows);

    return { ...summary, converted: summary.successful - summary.kept };
}
