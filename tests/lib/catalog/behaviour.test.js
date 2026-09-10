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
import { TOOLS } from '@/lib/catalog/tools';
import { validateCatalog } from '@/lib/catalog/validate';
import { MERGE_PDF_INPUT_FORMATS } from '@/lib/limits';
import { encodeImageData } from '@/lib/image-client/encode';
import { formatKeepsAlpha } from '@/lib/image-client/flatten';
import { readResolution, writeResolution } from '@/lib/image-client/dpi';
import { inspectMetadata, stripMetadata } from '@/lib/image-client/metadata-strip';
import { canEmbedWithoutDecoding, stripJpegMetadata } from '@/lib/image-client/pdf';

const OWN_PAGE_TOOLS = TOOLS.filter((tool) => tool.hasOwnPage).map((tool) => tool.slug);

/** The six operations that run decode → transform → encode. */
const REENCODING_TOOLS = ['resize', 'crop', 'compress', 'convert', 'heic', 'signature-resizer'];

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

describe('the six re-encoding tools', () => {
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
     * /crop is the exception and it is not an oversight: runCrop encodes in
     * `sourceFormat` and never calls flattenImageData, so there is no output
     * format for a "depends" to depend on.
     */
    it('leaves crop out of the depends, because a crop cannot change format', () => {
        expect(BEHAVIOUR.crop.transparency).toBe('kept');
        for (const slug of REENCODING_TOOLS.filter((name) => name !== 'crop')) {
            expect(BEHAVIOUR[slug].transparency).toBe('depends');
        }
    });
});

/**
 * THE SEVENTH RE-ENCODER, AND THE ONE ROW THAT MAKES IT DIFFERENT
 *
 * /passport-photo runs the same decode → transform → encode path as the six
 * above, so its five metadata rows say the same thing for the same reason. It
 * is split out because of the DPI row: a printed preset is converted at a
 * resolution and that resolution is written back into the finished file, the
 * way /change-image-dpi writes one, while a preset published in pixels carries
 * no print size at all. "removed" would be false on one half of the page and
 * "changed" false on the other, which is what `optional` exists to say.
 */
describe('the passport photo tool', () => {
    it('says it re-encodes and carries no metadata across, like the six above it', () => {
        expect(BEHAVIOUR['passport-photo'].pixels).toBe('reencoded');
        for (const key of ['exif', 'gps', 'xmp', 'icc']) {
            expect(BEHAVIOUR['passport-photo'][key], key).toBe('removed');
        }
    });

    it('is the only entry whose DPI record is optional, and says both halves of why', () => {
        expect(BEHAVIOUR['passport-photo'].dpi).toBe('optional');

        const optional = Object.entries(BEHAVIOUR).filter(([, entry]) => entry.dpi === 'optional');
        expect(optional.map(([slug]) => slug)).toEqual(['passport-photo']);

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
