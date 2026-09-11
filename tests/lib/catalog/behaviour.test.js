/**
 * WHAT EACH TOOL CHANGES — CHECKED AGAINST THE ENGINE, NOT AGAINST PROSE
 *
 * lib/catalog/behaviour.js is a page making a specific, falsifiable claim about
 * somebody's file: their GPS coordinates are gone, their colour profile is not,
 * their pixels were never opened. A registry of sentences is the easiest kind of
 * copy to leave behind — nothing breaks when the engine changes underneath it,
 * the page simply starts lying — and the lie is the expensive kind, because the
 * person acting on it is about to email the file to a bank or a passport office.
 *
 * So almost nothing below asserts that a string equals a string. Each claim is
 * put to the module that actually decides it:
 *
 *   "re-encoded, metadata removed"   encodeImageData accepts an ImageData and
 *                                    refuses anything else, so there is no path
 *                                    by which a file's EXIF, ICC or density
 *                                    record can reach an encoder — it is not a
 *                                    pixel and the encoder takes nothing else.
 *   "transparency depends"           formatKeepsAlpha decides it, and the row
 *                                    resolves the same way the engine does.
 *   "pixels copied" (DPI)            writeResolution's output is compared to
 *                                    its input from the start-of-scan marker
 *                                    onwards. A re-encode cannot survive it.
 *   "ICC kept" (metadata strip)      stripMetadata is run on a JPEG carrying a
 *                                    real sRGB profile and sharp reads the
 *                                    profile back out of the result.
 *   "ICC removed" (jpg-to-pdf)       the same file through pdf.js's own
 *                                    stripJpegMetadata, where sharp finds none.
 *
 * sharp is a fixture tool and an independent reader here, never on the path
 * under test — the same rule the rest of the engine suite follows.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { BEHAVIOUR, BEHAVIOUR_FIELDS, BEHAVIOUR_VALUES, behaviourFor, validateBehaviour } from '@/lib/catalog/behaviour';
import { TOOLS, getTool } from '@/lib/catalog/tools';
import { validateCatalog } from '@/lib/catalog/validate';
import {
    BULK_CONVERT_OUTPUT_FORMATS,
    DPI_INPUT_FORMATS,
    FIT_OUTPUT_FORMATS,
    MERGE_PDF_INPUT_FORMATS,
} from '@/lib/limits';
import { encodeImageData } from '@/lib/image-client/encode';
import { ALPHA_OUTPUT_FORMATS, formatKeepsAlpha } from '@/lib/image-client/flatten';
import { readResolution, writeResolution } from '@/lib/image-client/dpi';
import { inspectMetadata, stripMetadata } from '@/lib/image-client/metadata-strip';
import { canEmbedWithoutDecoding, stripJpegMetadata } from '@/lib/image-client/pdf';

const OWN_PAGE_TOOLS = TOOLS.filter((tool) => tool.hasOwnPage).map((tool) => tool.slug);

/**
 * The eight tools whose pages run decode → transform → encode. The two batch
 * tools are the compress and convert operations run once per file, so they
 * belong here for the same reason /compress and /convert do.
 */
const REENCODING_TOOLS = [
    'resize', 'crop', 'compress', 'bulk-image-compressor', 'convert', 'bulk-image-converter',
    'heic', 'signature-resizer',
];

/**
 * The two of them whose output format is the input's, decided by the engine
 * rather than by the visitor. runCrop encodes in `sourceFormat`; every batch
 * job is submitted with the `'original'` sentinel, which resolveCompressFormat
 * in lib/image-client/operations.js turns into the source format — and
 * lib/upload/compress-batch.js refuses a result whose format is not the
 * source's, so no job can quietly convert. Neither panel offers a format, so
 * neither row has anything for a "depends" to depend on.
 */
const FORMAT_PINNED = ['crop', 'bulk-image-compressor'];

/** The two that rewrite a container and never open the picture. */
const BYTE_REWRITE_TOOLS = ['change-image-dpi', 'remove-image-metadata'];

const canvas = () => sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 40, b: 40 } },
});

/* ------------------------------------------------------------------ *
 * The table itself
 * ------------------------------------------------------------------ */

describe('the registry covers the site', () => {
    it('describes every tool with a page of its own, and nothing else', () => {
        expect(Object.keys(BEHAVIOUR).sort()).toEqual([...OWN_PAGE_TOOLS].sort());
    });

    it('gives every entry all seven fields, each holding a value the renderer knows', () => {
        for (const [slug, entry] of Object.entries(BEHAVIOUR)) {
            for (const key of BEHAVIOUR_FIELDS) {
                expect(Object.keys(BEHAVIOUR_VALUES[key].values), `${slug}.${key}`).toContain(entry[key]);
            }
        }
    });

    it('is clean against the shipped tool registry', () => {
        expect(validateBehaviour(TOOLS)).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The claims, against the engine that decides them
 * ------------------------------------------------------------------ */

describe('the eight re-encoding tools', () => {
    it.each(REENCODING_TOOLS)('%s says it re-encodes and carries no metadata across', (slug) => {
        expect(BEHAVIOUR[slug].pixels).toBe('reencoded');
        expect(BEHAVIOUR[slug].exif).toBe('removed');
        expect(BEHAVIOUR[slug].gps).toBe('removed');
        expect(BEHAVIOUR[slug].xmp).toBe('removed');
        expect(BEHAVIOUR[slug].icc).toBe('removed');
        expect(BEHAVIOUR[slug].dpi).toBe('removed');
    });

    /**
     * The whole argument for those five "removed" rows in one assertion. The
     * encoder's only input is an ImageData — a width, a height and a buffer of
     * samples. A file's metadata is none of those things, so it cannot travel
     * through: not because anything strips it, but because there is nowhere to
     * put it. Hand the encoder the file's bytes instead and it refuses them.
     */
    it('is true because the encoder takes pixels and nothing else', async () => {
        const jpeg = await canvas().jpeg().toBuffer();

        for (const notPixels of [new Uint8Array(jpeg), jpeg.buffer, { width: 4, height: 4 }, null]) {
            await expect(encodeImageData(notPixels, { format: 'jpeg' })).rejects.toThrow(/no pixels to encode/i);
        }
    });

    /**
     * A file re-encoded to JPEG cannot keep an alpha channel and a file
     * re-encoded to PNG or WebP does — which is the whole of the "depends" row,
     * and lib/image-client/flatten.js is what decides it. If this list ever
     * changes, the rows resolve differently and this assertion is what says so.
     */
    it('resolves transparency the way formatKeepsAlpha does', () => {
        expect(formatKeepsAlpha('jpeg')).toBe(false);
        expect(formatKeepsAlpha('jpg')).toBe(false);
        expect(formatKeepsAlpha('png')).toBe(true);
        expect(formatKeepsAlpha('webp')).toBe(true);

        for (const format of ['png', 'webp']) {
            expect(row(behaviourFor('convert', { from: 'jpeg', to: format }), 'transparency').value).toBe('kept');
        }
        expect(row(behaviourFor('convert', { from: 'png', to: 'jpeg' }), 'transparency').value).toBe('flattened');
    });

    /**
     * The two exceptions are not oversights — see FORMAT_PINNED above. A page
     * that cannot change the output format cannot make transparency a question
     * about it, and saying "depends on the format you save" beside a panel with
     * no format control would describe a choice the visitor never gets.
     */
    it('leaves the format-pinned tools out of the depends', () => {
        for (const slug of FORMAT_PINNED) {
            expect(BEHAVIOUR[slug].transparency, `${slug} pins its output format`).toBe('kept');
        }
        for (const slug of REENCODING_TOOLS.filter((name) => !FORMAT_PINNED.includes(name))) {
            expect(BEHAVIOUR[slug].transparency, `${slug} lets the visitor pick a format`).toBe('depends');
        }
    });
});

/**
 * THE OTHER BATCH TOOL, AND WHY ITS TRANSPARENCY ROW IS NOT THE COMPRESSOR'S
 *
 * /bulk-image-converter and /bulk-image-compressor run the same queue over the
 * same platform, so it would be easy to give them the same seven rows. Six of
 * them are the same and the seventh is not, for the one reason FORMAT_PINNED
 * exists: the compressor's panel has no format control and submits every job
 * with the `'original'` sentinel, while the converter's panel asks for an
 * output format for the whole batch and applies it to every file. There IS a
 * choice here for a "depends" to depend on, and the three formats the panel
 * offers are checked below against lib/image-client/flatten.js rather than
 * against the sentence describing them.
 *
 * The note carries the one thing no row can: a file already in the output
 * format is handed back untouched, so everything the five metadata rows call
 * removed is still in it. The engine side of that — the kept row's blob being
 * the visitor's own File — is proved in tests/lib/upload/convert-batch.test.js,
 * where the lane lives; what is held here is that the page says so.
 */
describe('the batch converter', () => {
    it('re-encodes and carries no metadata across, whichever format the batch is written as', async () => {
        const jpeg = await canvas().jpeg().toBuffer();

        for (const format of BULK_CONVERT_OUTPUT_FORMATS) {
            await expect(encodeImageData(new Uint8Array(jpeg), { format }))
                .rejects.toThrow(/no pixels to encode/i);
        }

        expect(BEHAVIOUR['bulk-image-converter'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc', 'dpi']) {
            expect(BEHAVIOUR['bulk-image-converter'][key], key).toBe('removed');
        }
    });

    /**
     * The row's sentence, split at its own comma and put to formatKeepsAlpha
     * one output format at a time. A format named on the wrong side of it — or
     * left out of it entirely — fails here rather than on somebody's logo.
     */
    it('splits the three output formats the panel offers the way flatten.js does', () => {
        // The panel's list and the site's alpha list stopped being the same set
        // when AVIF arrived: AVIF carries an alpha channel, so it is in
        // ALPHA_OUTPUT_FORMATS, and it is deliberately not a batch output — see
        // BULK_CONVERT_OUTPUT_FORMATS in lib/limits.js. What the row has to be
        // right about is the three this panel does offer, so that is what is
        // split here, and flatten.js still decides which side each one is on.
        expect(BULK_CONVERT_OUTPUT_FORMATS).toEqual(['jpeg', 'png', 'webp']);
        expect(BULK_CONVERT_OUTPUT_FORMATS.filter((format) => formatKeepsAlpha(format)))
            .toEqual(ALPHA_OUTPUT_FORMATS.filter((format) => BULK_CONVERT_OUTPUT_FORMATS.includes(format)));

        const { detail } = row(behaviourFor('bulk-image-converter'), 'transparency');
        const halves = detail.split(/,\s*/);
        expect(halves, 'the transparency row no longer has a keeps half and a flattens half').toHaveLength(2);

        const [keeps, flattens] = halves;
        for (const format of BULK_CONVERT_OUTPUT_FORMATS) {
            const label = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' }[format];
            const [named, other] = formatKeepsAlpha(format) ? [keeps, flattens] : [flattens, keeps];

            expect(named, `the row never says what a ${label} output does with transparency`).toContain(label);
            expect(other, `the row puts ${label} on the wrong side of the comma`).not.toContain(label);
        }
    });

    /**
     * Nothing preconfigures this page — there is no intent whose preset names a
     * format for it, and pinnedFormat answers for /convert, /heic and the
     * signature resizer only — so the row stays on the honest answer whatever
     * it is handed. The compressor's "kept" would be a lie here and this one's
     * "depends" would be a lie there.
     */
    it('never resolves the depends, because the format is picked in the panel and not by a preset', () => {
        for (const preset of [undefined, null, {}, { to: 'png' }, { format: 'jpeg' }, { from: 'png', to: 'jpeg' }]) {
            expect(row(behaviourFor('bulk-image-converter', preset), 'transparency').value).toBe('depends');
        }

        expect(FORMAT_PINNED).not.toContain('bulk-image-converter');
        expect(BEHAVIOUR['bulk-image-compressor'].transparency).toBe('kept');
    });

    it('states the one file it does not convert, and what is still inside it', () => {
        const { note } = behaviourFor('bulk-image-converter');

        expect(note, 'the kept file is the exception to all five metadata rows').toMatch(
            /already in the format you asked for/i,
        );
        expect(note).toMatch(/not converted at all/i);
        for (const kept of ['metadata', 'colour profile', 'DPI record']) {
            expect(note, `the note never says the kept file still carries its ${kept}`).toContain(kept);
        }
    });

    it('renders every row, note included', () => {
        const spec = behaviourFor('bulk-image-converter');

        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(row(spec, 'transparency').text).toBe('Transparency depends on the output format');
        expect(spec.note.length).toBeGreaterThan(80);
    });
});

/**
 * THE NINTH RE-ENCODER, AND THE ONE ROW THAT MAKES IT DIFFERENT
 *
 * /passport-photo runs the same decode → transform → encode path as the eight
 * above, so its five metadata rows say the same thing for the same reason. It
 * is split out because of the DPI row: a printed preset is converted at a
 * resolution and that resolution is written back into the finished file, the
 * way /change-image-dpi writes one, while a preset published in pixels carries
 * no print size at all. "removed" would be false on one half of the page and
 * "changed" false on the other, which is what `optional` exists to say.
 */
describe('the passport photo tool', () => {
    it('says it re-encodes and carries no metadata across, like the eight above it', () => {
        expect(BEHAVIOUR['passport-photo'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc']) {
            expect(BEHAVIOUR['passport-photo'][key], key).toBe('removed');
        }
    });

    it('shares the optional DPI record with the size fitter and the print sheet, and says both halves of why', () => {
        expect(BEHAVIOUR['passport-photo'].dpi).toBe('optional');

        const optional = Object.entries(BEHAVIOUR).filter(([, entry]) => entry.dpi === 'optional');
        expect(optional.map(([slug]) => slug)).toEqual(['passport-photo', 'image-size-fitter', 'passport-photo-print']);

        const { detail } = BEHAVIOUR_VALUES.dpi.values.optional;
        expect(detail).toMatch(/when you ask for one/i);
        expect(detail).toMatch(/otherwise no print size is written/i);
    });

    /**
     * The mechanism behind "set to the number you choose": the same writer
     * /change-image-dpi uses, run after the encode. sharp reads the record
     * back, so the row is checked against a file rather than against a claim.
     */
    it('proves a resolution can be written into the encoded file at all', async () => {
        const encoded = new Uint8Array(await canvas().jpeg().toBuffer());
        const { bytes } = writeResolution(encoded, 300);

        expect((await sharp(Buffer.from(bytes)).metadata()).density).toBe(300);
    });

    /**
     * The panel offers JPEG, PNG and WebP and no preset can pin one — the
     * passport presets choose a format for the REQUIREMENT, not for the page —
     * so the transparency row stays on the honest answer whatever it is handed.
     */
    it('leaves transparency on depends, because nothing on this page pins a format', () => {
        expect(BEHAVIOUR['passport-photo'].transparency).toBe('depends');
        for (const preset of [undefined, null, { format: 'png' }, { to: 'png' }, { format: 'jpeg' }]) {
            expect(row(behaviourFor('passport-photo', preset), 'transparency').value).toBe('depends');
        }
    });

    it('renders every row, note included', () => {
        const spec = behaviourFor('passport-photo');
        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(row(spec, 'dpi').text).toBe('DPI record set on request');
        expect(spec.note).toMatch(/300 DPI/);
    });
});

/**
 * THE TENTH RE-ENCODER, PINNED ONE OUTPUT FORMAT AT A TIME
 *
 * /image-size-fitter takes the same decode → transform → encode path as the
 * nine above it, so its five metadata rows say the same thing for the same
 * reason. Two rows are answered by the output format the visitor picks rather
 * than by the tool, and both are put to the engine here per format rather than
 * read as a sentence: the DPI record, which only two of the three containers
 * can hold, and transparency, which lib/image-client/flatten.js decides.
 *
 * The difference from /passport-photo is only where the number comes from — a
 * published preset there, the visitor's own typing here — which is why the two
 * share the `optional` row and nothing else does.
 */
describe('the image size fitter', () => {
    it('re-encodes and carries no metadata across, whichever of the three formats it writes', async () => {
        const jpeg = await canvas().jpeg().toBuffer();

        for (const format of FIT_OUTPUT_FORMATS) {
            await expect(encodeImageData(new Uint8Array(jpeg), { format }))
                .rejects.toThrow(/no pixels to encode/i);
        }

        expect(BEHAVIOUR['image-size-fitter'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc']) {
            expect(BEHAVIOUR['image-size-fitter'][key], key).toBe('removed');
        }
    });

    it('carries the optional DPI row, the one row it shares with the passport tool', () => {
        expect(BEHAVIOUR['image-size-fitter'].dpi).toBe('optional');
        expect(row(behaviourFor('image-size-fitter'), 'dpi').text).toBe('DPI record set on request');
    });

    /**
     * The note's "only into a JPEG or a PNG", put to the writer rather than
     * believed: sharp reads 300 back out of the two containers that hold a
     * density field, and the same call on a WebP is refused in words a visitor
     * can act on. A format that changed sides in lib/limits.js would fail here
     * rather than on somebody's print shop order.
     */
    it('proves per output format which containers a resolution can be written into', async () => {
        expect(DPI_INPUT_FORMATS).toEqual(['jpeg', 'png']);

        for (const format of FIT_OUTPUT_FORMATS.filter((name) => DPI_INPUT_FORMATS.includes(name))) {
            const encoded = new Uint8Array(await canvas()[format]().toBuffer());
            const { bytes } = writeResolution(encoded, 300);

            expect((await sharp(Buffer.from(bytes)).metadata()).density, format).toBe(300);
        }

        for (const format of FIT_OUTPUT_FORMATS.filter((name) => !DPI_INPUT_FORMATS.includes(name))) {
            const encoded = new Uint8Array(await canvas()[format]().toBuffer());
            let refused = null;

            try {
                writeResolution(encoded, 300);
            } catch (error) {
                refused = error;
            }

            expect(refused, `${format} was not refused a resolution`).not.toBeNull();
            expect(refused.code).toBe('unsupported-format');
            expect(refused.message).toMatch(/only jpg and png files store a resolution/i);
        }

        const { note } = behaviourFor('image-size-fitter');
        expect(note, 'the note never says which two containers take a resolution')
            .toMatch(/only into a JPEG or a PNG/i);
        expect(note).toMatch(/WebP carries no density field/i);
        expect(note, 'the note never says the record is written on request')
            .toMatch(/only when you ask for one/i);
    });

    /**
     * The transparency half of the same sentence, split at its own comma and
     * put to formatKeepsAlpha one output format at a time — the treatment the
     * batch converter's row gets above, because this panel offers the same
     * choice and the row would be a lie on one of the three otherwise.
     */
    it('puts each output format on the side of the note flatten.js puts it on', () => {
        expect(BEHAVIOUR['image-size-fitter'].transparency).toBe('depends');

        const sentence = behaviourFor('image-size-fitter').note.match(/decides transparency: ([^.]+)\./);
        expect(sentence, 'the note no longer says the format decides transparency').not.toBeNull();

        const halves = sentence[1].split(', and ');
        expect(halves, 'the transparency sentence no longer has a keeps half and a flattens half').toHaveLength(2);

        const [keeps, flattens] = halves;
        for (const format of FIT_OUTPUT_FORMATS) {
            const label = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP' }[format];
            const [named, other] = formatKeepsAlpha(format) ? [keeps, flattens] : [flattens, keeps];

            expect(named, `the note never says what a ${label} output does with transparency`).toContain(label);
            expect(other, `the note puts ${label} on the wrong side`).not.toContain(label);
        }
    });

    /**
     * Nothing preconfigures this page: it hosts no intent, and pinnedFormat
     * answers for /convert, /heic and the signature resizer only. The row
     * stays on the honest answer whatever it is handed.
     */
    it('never resolves the depends, because the format is picked in the panel', () => {
        for (const preset of [undefined, null, {}, { to: 'png' }, { format: 'jpeg' }]) {
            expect(row(behaviourFor('image-size-fitter', preset), 'transparency').value).toBe('depends');
        }
    });

    it('renders every row, note included', () => {
        const spec = behaviourFor('image-size-fitter');

        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(spec.note.length).toBeGreaterThan(80);
    });
});

/**
 * THE ELEVENTH RE-ENCODER, AND THE ONE WHOSE OUTPUT IS A SHEET
 *
 * /passport-photo-print takes the same decode → fit → resample → encode path
 * as the ten above it, so its four metadata rows say the same thing for the
 * same reason. Two rows are its own, and both are pinned here with the
 * reasoning attached rather than left to the note:
 *
 *   dpi 'optional'        A JPEG sheet is written at the resolution the layout
 *                         was computed at, because that number is the only
 *                         thing that turns its pixels into a size on paper. A
 *                         PDF states its page size in points on the page and
 *                         has no resolution record to write. "changed" would
 *                         be false of every PDF and "removed" of every JPEG,
 *                         which is exactly the fork `optional` exists for.
 *
 *   transparency 'removed'  Not 'flattened', and not 'depends'. The paper is
 *                         opaque white and both outputs are formats without an
 *                         alpha channel, so no choice on the page can keep one.
 *                         Nothing preconfigures this page either, so
 *                         behaviourFor must return the same answer whatever
 *                         preset it is handed.
 */
describe('the passport photo print sheet', () => {
    it('says it re-encodes and carries no metadata across, like the ten above it', () => {
        expect(BEHAVIOUR['passport-photo-print'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc']) {
            expect(BEHAVIOUR['passport-photo-print'][key], key).toBe('removed');
        }
    });

    it('leaves the DPI record optional, because only one of its two outputs can hold one', () => {
        expect(BEHAVIOUR['passport-photo-print'].dpi).toBe('optional');
        expect(row(behaviourFor('passport-photo-print'), 'dpi').text).toBe('DPI record set on request');

        const { note } = behaviourFor('passport-photo-print');
        expect(note, 'the note never says the JPEG carries the chosen resolution').toMatch(/JPEG sheet is written at the resolution you choose/i);
        expect(note, 'the note never says a PDF carries its page size instead').toMatch(/PDF states its page size/i);
        expect(note).toMatch(/carries no resolution record at all/i);
    });

    /**
     * The paper is the reason. A sheet is composited onto an opaque white
     * canvas and written as a JPEG or placed in a PDF page, and neither format
     * has an alpha channel — so unlike the eight "depends" tools there is no
     * output format for the answer to depend on, and unlike /crop there is no
     * source format it could be inherited from.
     */
    it('removes transparency whatever it is handed, because the paper is opaque', () => {
        expect(BEHAVIOUR['passport-photo-print'].transparency).toBe('removed');

        for (const preset of [undefined, null, {}, { to: 'png' }, { format: 'png' }]) {
            expect(row(behaviourFor('passport-photo-print', preset), 'transparency').value).toBe('removed');
        }

        const { detail, text } = BEHAVIOUR_VALUES.transparency.values.removed;
        expect(text).toBe('Transparency removed');
        expect(detail).toMatch(/opaque/i);
    });

    /**
     * The one thing on the page that does place pixels on a chosen colour, and
     * the reason the row above is not 'flattened': it is the spare edges of a
     * photo fitted inside its cell, not the sheet.
     */
    it('says in the note where a background colour actually applies', () => {
        expect(behaviourFor('passport-photo-print').note).toMatch(/background colour you pick/i);
    });

    it('renders every row, note included', () => {
        const spec = behaviourFor('passport-photo-print');

        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(spec.note.length).toBeGreaterThan(80);
    });
});

/**
 * THE FAVICON PACKAGE, AND THE ONE ROW THAT COULD NOT BE COPIED
 *
 * Everything up to the encode is the path the re-encoding tools take — decode
 * once, crop or fit to a square, resample to each size, encode — so the five
 * metadata rows read the same and for the same reason: encodeImageData takes an
 * ImageData and nothing else.
 *
 * The transparency row is the interesting one, and it is deliberately NOT
 * 'depends'. That value renders "Depends on the format you save — PNG and WebP
 * keep it, JPEG is flattened onto the background colour", which is a sentence
 * about a format control. This page has none: every raster it writes is a PNG,
 * including the three inside favicon.ico, so JPEG is named on a page that
 * cannot produce one and "the format you save" points at a choice the visitor
 * is never offered. What actually decides the answer here is the background
 * control — leave it transparent and the alpha survives every file; pick a
 * colour and every icon is composited onto it — which is the same shape of fork
 * `dpi: 'optional'` exists for on the two fitters, and it gets the same name.
 */
describe('the favicon generator', () => {
    it('says it re-encodes and carries no metadata across', () => {
        expect(BEHAVIOUR['favicon-generator'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc', 'dpi']) {
            expect(BEHAVIOUR['favicon-generator'][key], key).toBe('removed');
        }
    });

    /**
     * The same argument the re-encoding block makes, put to the same module:
     * a PNG comes out of encodeImageData, whose only input is a width, a height
     * and a buffer of samples. An EXIF block, a colour profile and a pHYs
     * density record are none of those, so none of them can travel.
     */
    it('is true because the encoder takes pixels and nothing else', async () => {
        const png = await sharp({
            create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
        }).png().toBuffer();

        for (const notPixels of [new Uint8Array(png), png.buffer, { width: 16, height: 16 }]) {
            await expect(encodeImageData(notPixels, { format: 'png' })).rejects.toThrow(/no pixels to encode/i);
        }
    });

    /**
     * The refusal at the top of this block, as an assertion. If someone moves
     * this row to 'depends' the page starts naming JPEG, and a reader comparing
     * the spec with the panel finds a control that is not there.
     */
    it('never claims the answer depends on an output format it does not offer', () => {
        expect(BEHAVIOUR['favicon-generator'].transparency).not.toBe('depends');
        expect(BEHAVIOUR_VALUES.transparency.values.depends.detail).toMatch(/JPEG/);

        const { detail } = row(behaviourFor('favicon-generator'), 'transparency');
        expect(detail, 'the favicon spec names a format the tool never writes').not.toMatch(/JPEG|WebP/);
    });

    it('makes the background the fork, and says so in both halves of the row', () => {
        expect(BEHAVIOUR['favicon-generator'].transparency).toBe('optional');

        const { detail, text } = row(behaviourFor('favicon-generator'), 'transparency');
        expect(text).toBe('Transparency kept unless you choose a background');
        expect(detail).toMatch(/kept/i);
        expect(detail).toMatch(/background/i);
        expect(detail).toMatch(/favicon\.ico/);
    });

    /** Nothing preconfigures this page, so no preset may change the answer. */
    it('answers the same whatever preset it is handed', () => {
        for (const preset of [undefined, null, {}, { to: 'jpeg' }, { format: 'jpeg' }]) {
            expect(row(behaviourFor('favicon-generator', preset), 'transparency').value).toBe('optional');
        }
    });

    it('renders every row, note included', () => {
        const spec = behaviourFor('favicon-generator');

        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(spec.note.length).toBeGreaterThan(80);
        expect(spec.note).toMatch(/Nothing else from the source survives the encode/i);
    });
});

describe('the two tools that never open the picture', () => {
    it.each(BYTE_REWRITE_TOOLS)('%s says the pixels are copied', (slug) => {
        expect(BEHAVIOUR[slug].pixels).toBe('copied');
    });

    /**
     * The claim behind /change-image-dpi's entire existence. A JPEG re-encoded
     * at quality 100 looks identical and is not identical, so the compressed
     * scan is compared byte for byte from the first SOS marker to the end of
     * the file. Nothing that decoded the picture could survive this.
     */
    it('proves the DPI rewrite copies the scan, byte for byte', async () => {
        const input = new Uint8Array(await canvas().jpeg().toBuffer());
        const { bytes: output } = writeResolution(input, 300);

        expect(scanOf(output)).toEqual(scanOf(input));
        expect((await sharp(Buffer.from(output)).metadata()).density).toBe(300);
    });

    it('proves the metadata strip keeps the colour profile and drops the coordinates', async () => {
        const withProfile = new Uint8Array(await canvas().withIccProfile('srgb').jpeg().toBuffer());
        const result = stripMetadata(withProfile);

        expect(BEHAVIOUR['remove-image-metadata'].icc).toBe('kept');
        expect(result.kept.map((entry) => entry.id)).toContain('icc');
        expect((await sharp(Buffer.from(result.bytes)).metadata()).icc).toBeDefined();

        expect(BEHAVIOUR['remove-image-metadata'].exif).toBe('removed');
        expect(BEHAVIOUR['remove-image-metadata'].gps).toBe('removed');
        expect(result.kept.map((entry) => entry.id)).not.toContain('exif');

        // The picture is untouched, which is the other half of "pixels copied".
        expect(scanOf(result.bytes)).toEqual(scanOf(withProfile));
    });

    /**
     * The DPI row of the metadata strip, proved per format. The strip keeps
     * the native record — a JPEG's JFIF header, a PNG's pHYs chunk — and
     * drops EXIF, so a JPEG or WebP whose print size lives only in EXIF loses
     * it. sharp writes JPEG density into EXIF alone, which is exactly the file
     * the row once described as "kept".
     */
    it('proves the DPI row of the metadata strip: native records stay, an EXIF-only print size goes', async () => {
        const density = async (bytes) => (await sharp(Buffer.from(bytes)).metadata()).density;
        const stamped = async (encode) => new Uint8Array(await canvas().withMetadata({ density: 300 })[encode]().toBuffer());

        expect(BEHAVIOUR['remove-image-metadata'].dpi).toBe('native');
        expect(BEHAVIOUR_VALUES.dpi.values.native.detail).toMatch(/JFIF/);
        expect(BEHAVIOUR_VALUES.dpi.values.native.detail).toMatch(/pHYs/);
        expect(BEHAVIOUR_VALUES.dpi.values.native.detail).toMatch(/only inside EXIF/);

        const png = await stamped('png');
        expect(await density(png)).toBe(300);
        expect(await density(stripMetadata(png).bytes)).toBe(300);

        const exifOnlyJpeg = await stamped('jpeg');
        expect(readResolution(exifOnlyJpeg).source).toBe('exif');
        expect(await density(stripMetadata(exifOnlyJpeg).bytes)).not.toBe(300);

        const jfifJpeg = writeResolution(exifOnlyJpeg, 300).bytes;
        expect(readResolution(jfifJpeg).source).toBe('jfif');
        expect(await density(stripMetadata(jfifJpeg).bytes)).toBe(300);

        // A WebP has no native print-size record: whatever it carries lives in
        // its EXIF chunk, and that chunk is what the strip removes. sharp
        // reads no density back from a WebP, so the chunk itself is the witness.
        const webp = await stamped('webp');
        const blocks = (bytes) => inspectMetadata(bytes).found.map((entry) => entry.id);
        expect(blocks(webp)).toContain('exif');
        expect(blocks(stripMetadata(webp).bytes)).not.toContain('exif');
    });
});

/**
 * THE ONE TOOL THAT WRITES NOTHING.
 *
 * Every entry above describes a file coming back. This one describes a
 * reading: /image-metadata-viewer takes bytes, walks the container and prints
 * what is inside it, and there is no output file for a row to be true of. So
 * its seven rows are all the same shape — read, shown, unchanged — and the
 * claim underneath them is that the read path returns a description and never
 * a buffer.
 *
 * lib/image-client/metadata-strip.js is where that is decided, and its two
 * exports are the contrast the rows are pinned against: inspectMetadata hands
 * back a report, stripMetadata hands back bytes. The viewer reads; the remover
 * writes.
 */
describe('the tool that only reads', () => {
    it('says the pixels are untouched and every block is read rather than changed', () => {
        expect(BEHAVIOUR['image-metadata-viewer'].pixels).toBe('untouched');

        for (const key of BEHAVIOUR_FIELDS.filter((field) => field !== 'pixels')) {
            expect(BEHAVIOUR['image-metadata-viewer'][key], key).toBe('read');
        }
    });

    /**
     * The whole entry in one assertion. The read path cannot produce a file —
     * it returns a description, and the bytes handed to it are the bytes left
     * behind. stripMetadata beside it is the control: same module, same walk,
     * and it does return a buffer.
     */
    it('is true because inspecting returns a report and never a file', async () => {
        const withProfile = new Uint8Array(await canvas().withIccProfile('srgb').jpeg().toBuffer());
        const before = Uint8Array.from(withProfile);

        const report = inspectMetadata(withProfile);

        expect(report.bytes).toBeUndefined();
        expect(report.found.map((entry) => entry.id)).toContain('icc');
        expect(withProfile).toEqual(before);

        expect(stripMetadata(withProfile).bytes).toBeInstanceOf(Uint8Array);
    });

    it('renders all seven rows, because a read has an answer for every one of them', () => {
        const spec = behaviourFor('image-metadata-viewer');

        expect(spec.rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        expect(spec.rows.map((entry) => entry.detail)).toEqual([
            'Not decoded and not written — the file is only read',
            ...Array(BEHAVIOUR_FIELDS.length - 1).fill('Read and shown, never changed'),
        ]);
    });

    it('gives every read row a standalone phrase that names its own label', () => {
        for (const key of BEHAVIOUR_FIELDS.filter((field) => field !== 'pixels')) {
            expect(BEHAVIOUR_VALUES[key].values.read.text, key)
                .toBe(`${BEHAVIOUR_VALUES[key].label} read only`);
        }
        expect(BEHAVIOUR_VALUES.pixels.values.untouched.text).toBe('Pixels untouched');
    });

    /**
     * The one thing the rows cannot say. Somebody who has just seen their own
     * coordinates on screen wants them gone, and this is not the page that
     * does that — so the note names the page that does.
     */
    it('sends a reader who wants the metadata gone to the tool that removes it', () => {
        const { note } = BEHAVIOUR['image-metadata-viewer'];

        expect(note).toMatch(/produces no image/);
        expect(note).toContain(getTool('remove-image-metadata').title);
    });
});

describe('the two document tools', () => {
    it('says a JPG-to-PDF page is embedded when it can be and re-encoded when it cannot', () => {
        expect(BEHAVIOUR['jpg-to-pdf'].pixels).toBe('embedded-or-reencoded');
        expect(canEmbedWithoutDecoding({ format: 'jpeg' })).toBe(true);
        expect(canEmbedWithoutDecoding({ format: 'png' })).toBe(false);
        // A photo that needs turning has to be turned in the pixels, so the
        // cheap lane is off and the file is decoded like any other.
        expect(canEmbedWithoutDecoding({ format: 'jpeg', orientation: 6 })).toBe(false);
    });

    /**
     * The copy lane is the only way a source's own bytes reach a PDF page, and
     * it runs pdf.js's stripJpegMetadata first — which drops APP1 through APP15
     * apart from the JFIF and Adobe segments. The ICC profile is APP2, so it
     * goes, and /jpg-to-pdf's row says so where /remove-image-metadata's says
     * the opposite about the same kind of file.
     */
    it('proves the PDF copy lane drops the colour profile it keeps elsewhere', async () => {
        const withProfile = new Uint8Array(await canvas().withIccProfile('srgb').jpeg().toBuffer());
        const embedded = stripJpegMetadata(withProfile);

        expect(BEHAVIOUR['jpg-to-pdf'].icc).toBe('removed');
        expect((await sharp(Buffer.from(embedded)).metadata()).icc).toBeUndefined();
        expect(scanOf(embedded)).toEqual(scanOf(withProfile));
    });

    /**
     * /merge-pdf answers none of the six image questions, and the reason is in
     * lib/limits.js: the only thing it accepts is a PDF, so no image ever
     * reaches it to have its EXIF removed or kept.
     */
    it('leaves the image rows out of merge-pdf entirely', () => {
        expect(MERGE_PDF_INPUT_FORMATS).toEqual(['pdf']);
        // Pages, not pixels: pdf-merge.js copies an object graph, and a
        // text-only PDF has no picture to copy byte for byte.
        expect(BEHAVIOUR['merge-pdf'].pixels).toBe('pages');
        for (const key of BEHAVIOUR_FIELDS.filter((field) => field !== 'pixels')) {
            expect(BEHAVIOUR['merge-pdf'][key]).toBe('not-applicable');
        }

        const spec = behaviourFor('merge-pdf');
        expect(spec.rows.map((entry) => entry.key)).toEqual(['pixels']);
        expect(spec.rows[0].detail).toMatch(/^Pages copied/);
        expect(spec.note).toMatch(/copied/i);
    });
});

/* ------------------------------------------------------------------ *
 * behaviourFor
 * ------------------------------------------------------------------ */

describe('behaviourFor', () => {
    it('returns null for a slug it does not describe, so a page renders nothing', () => {
        expect(behaviourFor('nowhere')).toBeNull();
        expect(behaviourFor(undefined)).toBeNull();
    });

    it('gives every row a label and a sentence a person can read', () => {
        const { rows } = behaviourFor('resize');

        expect(rows.map((entry) => entry.key)).toEqual(BEHAVIOUR_FIELDS);
        for (const entry of rows) {
            expect(entry.label.length).toBeGreaterThan(2);
            expect(entry.detail.length).toBeGreaterThan(2);
            expect(entry.text.length).toBeGreaterThan(2);
        }
        expect(rows.map((entry) => entry.text)).toEqual([
            'Pixels re-encoded',
            'EXIF removed',
            'GPS removed',
            'XMP removed',
            'ICC profile removed',
            'DPI record removed',
            'Transparency depends on the output format',
        ]);
    });

    it('resolves a HEIC page from its preset and leaves the bare tool page open', () => {
        expect(row(behaviourFor('heic'), 'transparency').value).toBe('depends');
        expect(row(behaviourFor('heic', { format: 'png' }), 'transparency').value).toBe('kept');
    });

    it('resolves a signature page the same way, from the same field', () => {
        expect(row(behaviourFor('signature-resizer', { format: 'png' }), 'transparency').value).toBe('kept');
        expect(row(behaviourFor('signature-resizer', { format: 'jpeg' }), 'transparency').value).toBe('flattened');
    });

    /**
     * Neither preset can name an output format — see PRESET_RULES — and both
     * panels offer JPEG, so "kept" would be an over-claim on either page.
     */
    it('leaves resize and compress on the honest answer, because their presets pin no format', () => {
        expect(row(behaviourFor('resize', null), 'transparency').value).toBe('depends');
        expect(row(behaviourFor('compress', { targetKb: 100 }), 'transparency').value).toBe('depends');
        expect(row(behaviourFor('compress', { targetKb: 100 }), 'transparency').detail)
            .toMatch(/png and webp keep it/i);
    });

    it('ignores a preset that names nothing useful', () => {
        for (const preset of [undefined, null, {}, 'jpeg', { to: '' }]) {
            expect(row(behaviourFor('convert', preset), 'transparency').value).toBe('depends');
        }
    });

    /**
     * The one source format whose decode changes the picture before any tool
     * here touches it. An AVIF may store 10 or 12 bits a channel, a wide gamut
     * or an HDR transfer curve; the browser's decoder returns 8-bit sRGB in
     * every case, so the reduction has already happened by the time the
     * encoder is handed anything. That is a fact about the INPUT, which no row
     * in BEHAVIOUR_FIELDS asks about, so it resolves from `preset.from` and
     * reaches the two AVIF pages only — a note on the convert entry itself
     * would print it on /png-to-jpg, where it is not true of anything.
     */
    it('adds the AVIF decode note to a page whose preset names AVIF as the source', () => {
        const { note } = behaviourFor('convert', { from: 'avif', to: 'jpeg' });

        expect(note).toMatch(/8-bit/);
        expect(note).toMatch(/sRGB/);
        expect(note).toBe(behaviourFor('convert', { from: 'avif', to: 'png' }).note);
    });

    it('leaves every other convert page without one', () => {
        for (const preset of [undefined, null, { from: 'png', to: 'jpeg' }, { from: 'webp', to: 'png' }]) {
            expect(behaviourFor('convert', preset).note, JSON.stringify(preset)).toBeNull();
        }
    });
});

/* ------------------------------------------------------------------ *
 * validateBehaviour — the build gate
 * ------------------------------------------------------------------ */

describe('validateBehaviour', () => {
    it('reports a tool that ships a page without saying what it changes', () => {
        const problems = validateBehaviour([
            ...TOOLS,
            { slug: 'invert-image', href: '/invert-image', hasOwnPage: true, category: 'convert' },
        ]);

        expect(problems.map((entry) => entry.code)).toEqual(['behaviour-missing']);
        expect(problems[0].subject).toBe('invert-image');
        expect(problems[0].message).toMatch(/invert-image/);
    });

    it('reports an entry whose tool has gone, or never had a page', () => {
        const codes = validateBehaviour(TOOLS.filter((tool) => tool.slug !== 'crop')).map((entry) => entry.code);
        expect(codes).toContain('behaviour-unknown-tool');
    });

    it('reports a value outside the enum, and a note that is not a sentence', () => {
        const original = { ...BEHAVIOUR.convert };

        try {
            BEHAVIOUR.convert.icc = 'maybe';
            expect(validateBehaviour(TOOLS).map((entry) => entry.code)).toEqual(['behaviour-value-invalid']);

            BEHAVIOUR.convert.icc = original.icc;
            BEHAVIOUR.convert.note = '   ';
            expect(validateBehaviour(TOOLS).map((entry) => entry.code)).toEqual(['behaviour-value-invalid']);
        } finally {
            delete BEHAVIOUR.convert.note;
            Object.assign(BEHAVIOUR.convert, original);
        }
    });

    /**
     * The rule is only a rule if the build runs it. assertCatalogValid() is
     * called from generateStaticParams, so a missing entry stops `next build`
     * rather than rendering an empty block on ten pages.
     */
    it('is wired into validateCatalog, so a missing entry fails the build', () => {
        const problems = validateCatalog({
            tools: [...TOOLS, { slug: 'invert-image', href: '/invert-image', hasOwnPage: true, category: 'convert' }],
        });

        expect(problems.map((entry) => entry.code)).toContain('behaviour-missing');
        expect(validateCatalog()).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The scan comparison, written here rather than imported
 * ------------------------------------------------------------------ */

/**
 * A JPEG's compressed picture: everything from the first start-of-scan marker
 * to the end of the file. Written from the specification rather than taken from
 * the module under test — checking a writer with its own reader proves only
 * that it agrees with itself.
 */
function scanOf(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    for (let at = 2; at + 1 < data.length;) {
        if (data[at] !== 0xFF) throw new Error(`not a JPEG segment at ${at}`);

        let markerAt = at + 1;
        while (data[markerAt] === 0xFF && markerAt + 1 < data.length) markerAt += 1;

        const marker = data[markerAt];
        if (marker === 0xDA) return Array.from(data.subarray(at));

        const length = (data[markerAt + 1] << 8) | data[markerAt + 2];
        at = markerAt + 1 + length;
    }

    throw new Error('this JPEG has no scan');
}

const row = (behaviour, key) => behaviour.rows.find((entry) => entry.key === key);
