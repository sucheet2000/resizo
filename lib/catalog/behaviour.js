/**
 * What each tool changes about a file.
 *
 * Every tool on this site answers the same unasked question — "what will come
 * back, and what will be missing from it" — and until now each page answered it
 * in its own prose, or not at all. A visitor stripping GPS out of a holiday
 * photo needs to know the colour profile survived; a print shop needs to know a
 * DPI change did not re-encode the picture; anyone converting a logo needs to
 * know where the transparency went. Those are facts about the ENGINE, so they
 * are stated once here, validated with the registry, and rendered by
 * components/tools/BehaviourSpec.js on every tool and intent page.
 *
 * WHY THE VALUES ARE WHAT THEY ARE — read against lib/image-client/:
 *
 *   Six tools re-encode.  resize, crop, compress, convert, heic and the
 *     signature resizer all run decode → (transform) → encode, and
 *     lib/image-client/encode.js writes a file from an ImageData and nothing
 *     else. There is no path by which an EXIF block, a GPS tag, an XMP packet,
 *     an ICC profile or a density record reaches an encoder: none of them is a
 *     pixel. So all five metadata rows are "removed" for all six, and that is a
 *     consequence of the architecture rather than a promise someone made.
 *
 *   Two tools never open the picture.  lib/image-client/dpi.js rewrites a
 *     resolution field and copies every other byte; lib/image-client/
 *     metadata-strip.js drops the metadata segments and copies the scan. Their
 *     rows differ from each other and from everything above, which is exactly
 *     why one shared sentence could never have covered the site.
 *
 *   Two tools produce documents.  /jpg-to-pdf embeds a JPEG untouched when
 *     `canEmbedWithoutDecoding` allows it and re-encodes anything else, and the
 *     copy lane runs pdf.js's own `stripJpegMetadata` first — which drops APP1
 *     through APP15 apart from the JFIF and Adobe segments, the ICC profile
 *     included. /merge-pdf decodes nothing at all, so the six image rows have
 *     no answer for it and it says so rather than inventing one.
 *
 * THIS IS COPY, AND IT LIVES IN THE COPY PACKAGE. lib/image-client/ must never
 * import it (CLAUDE.md rule 3): the engine's job is to be true, not to describe
 * itself. The tests in tests/lib/catalog/behaviour.test.js read the ENGINE and
 * assert these values against it, so a change in lib/image-client/ that makes a
 * row here false fails the suite rather than quietly shipping a lie.
 */

/** The rows a spec block can carry, in the order it renders them. */
export const BEHAVIOUR_FIELDS = ['pixels', 'exif', 'gps', 'xmp', 'icc', 'dpi', 'transparency'];

/**
 * The value a field may hold, and what each one reads as on a page.
 *
 * `detail` is what the row's `<dd>` shows, under a `<dt>` that already carries
 * the label. `text` is the same fact as a standalone phrase, which is what a
 * test asserts on and what any caller quoting one row outside the list should
 * use. Both live here, side by side, so the two can never drift.
 *
 * 'not-applicable' is a real value rather than a hole: a document tool has to
 * be in the registry — otherwise nothing stops the next one arriving with no
 * entry at all — and it must not answer a question about EXIF that a PDF does
 * not have. A row with this value is left out of the rendered list, and the
 * entry's note says what actually happens instead.
 */
export const BEHAVIOUR_VALUES = {
    pixels: {
        label: 'Pixels',
        values: {
            reencoded: { detail: 'Decoded and written again', text: 'Pixels re-encoded' },
            copied: { detail: 'Copied byte for byte — nothing is decoded', text: 'Pixels copied' },
            pages: { detail: 'Pages copied as they are — no picture inside them is decoded or re-encoded', text: 'Pages copied' },
            'embedded-or-reencoded': {
                detail: 'Embedded as they are where the file allows it, decoded and written again where it does not',
                text: 'Pixels embedded or re-encoded',
            },
            'not-applicable': { detail: null, text: 'Pixels not applicable' },
        },
    },
    exif: {
        label: 'EXIF',
        values: {
            removed: { detail: 'Removed', text: 'EXIF removed' },
            kept: { detail: 'Kept', text: 'EXIF kept' },
            rewritten: { detail: 'Resolution fields rewritten, everything else kept', text: 'EXIF rewritten' },
            'not-applicable': { detail: null, text: 'EXIF not applicable' },
        },
    },
    gps: {
        label: 'GPS',
        values: {
            removed: { detail: 'Removed', text: 'GPS removed' },
            kept: { detail: 'Kept', text: 'GPS kept' },
            'not-applicable': { detail: null, text: 'GPS not applicable' },
        },
    },
    xmp: {
        label: 'XMP',
        values: {
            removed: { detail: 'Removed', text: 'XMP removed' },
            kept: { detail: 'Kept', text: 'XMP kept' },
            'not-applicable': { detail: null, text: 'XMP not applicable' },
        },
    },
    icc: {
        label: 'ICC profile',
        values: {
            removed: { detail: 'Removed', text: 'ICC profile removed' },
            kept: { detail: 'Kept, so the colours do not shift', text: 'ICC profile kept' },
            'not-applicable': { detail: null, text: 'ICC profile not applicable' },
        },
    },
    dpi: {
        label: 'DPI record',
        values: {
            removed: { detail: 'Removed — the new file claims no print size', text: 'DPI record removed' },
            kept: { detail: 'Kept', text: 'DPI record kept' },
            native: {
                detail: 'Kept where the file records it natively — a JPEG’s JFIF header or a PNG’s pHYs chunk. A JPEG or WebP that records its print size only inside EXIF loses it with the EXIF block',
                text: 'DPI record kept where the file stores it natively',
            },
            changed: { detail: 'Set to the number you choose', text: 'DPI record changed' },
            'not-applicable': { detail: null, text: 'DPI record not applicable' },
        },
    },
    transparency: {
        label: 'Transparency',
        values: {
            kept: { detail: 'Kept', text: 'Transparency kept' },
            flattened: {
                detail: 'Flattened onto the background colour',
                text: 'Transparency flattened',
            },
            /**
             * The honest answer for a tool whose output format the visitor
             * picks in the panel. /resize offers JPEG for any source and
             * /compress offers it for a PNG, so "kept" would be an over-claim
             * on either page — and `behaviourFor` resolves this to one of the
             * two above the moment an intent's preset pins the format.
             */
            depends: {
                detail: 'Depends on the format you save — PNG and WebP keep it, JPEG is flattened onto the background colour',
                text: 'Transparency depends on the output format',
            },
            'not-applicable': { detail: null, text: 'Transparency not applicable' },
        },
    },
};

/**
 * One entry per tool with a page of its own. `validateBehaviour` refuses a tool
 * with no entry, so a new tool cannot ship without saying what it changes.
 */
export const BEHAVIOUR = {
    resize: {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'depends',
    },
    /**
     * The one re-encoding tool whose transparency is not a question: runCrop
     * encodes in `sourceFormat` and never calls flattenImageData, so a PNG in
     * is a PNG out and the alpha channel comes through untouched.
     */
    crop: {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'kept',
        note: 'A crop is saved in the format it arrived in, so a transparent PNG stays a transparent PNG.',
    },
    compress: {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'depends',
    },
    convert: {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'depends',
    },
    heic: {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'depends',
        note: 'An iPhone photo carries the date, the camera and the coordinates of where it was taken. None of it survives the conversion.',
    },
    'signature-resizer': {
        pixels: 'reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'depends',
    },
    'change-image-dpi': {
        pixels: 'copied',
        exif: 'rewritten',
        gps: 'kept',
        xmp: 'kept',
        icc: 'kept',
        dpi: 'changed',
        transparency: 'kept',
        note: 'Only the number the file claims about print size changes. Nothing is decoded, so the picture is the same picture — this tool removes no metadata, and /remove-image-metadata is the one that does.',
    },
    'remove-image-metadata': {
        pixels: 'copied',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'kept',
        dpi: 'native',
        transparency: 'kept',
        note: 'The colour profile stays, because dropping it shifts every colour a viewer draws while telling you your privacy improved. A JPEG’s JFIF header and a PNG’s pHYs chunk stay too; a print size recorded only inside EXIF goes with the EXIF block, and /change-image-dpi writes it back. IPTC captions, comments, embedded thumbnails and anything stapled on after the picture ends are removed alongside the EXIF block.',
    },
    'jpg-to-pdf': {
        pixels: 'embedded-or-reencoded',
        exif: 'removed',
        gps: 'removed',
        xmp: 'removed',
        icc: 'removed',
        dpi: 'removed',
        transparency: 'flattened',
        note: 'A JPEG that needs no turning is copied into the page exactly as it is, with its metadata segments dropped on the way. Every other file is decoded and written as a JPEG. A PDF page has no print-resolution record of its own — the picture is placed to fill the page size you pick.',
    },
    /**
     * Not an image tool. pdf-merge.js copies pages across as an object graph:
     * no decoder is loaded, no geometry is computed and no image is opened, so
     * the six image rows have no answer here and say so rather than guessing.
     * What is true about the merged document is in the note.
     */
    'merge-pdf': {
        pixels: 'pages',
        exif: 'not-applicable',
        gps: 'not-applicable',
        xmp: 'not-applicable',
        icc: 'not-applicable',
        dpi: 'not-applicable',
        transparency: 'not-applicable',
        note: 'Pages are copied from each PDF as they are — nothing is decoded and nothing is re-encoded. The merged file carries no title or author from the originals, and whatever sits inside a page comes across untouched.',
    },
};

/**
 * The output format an intent's preset pins, or null when the visitor still
 * chooses it in the panel.
 *
 * The field differs per tool because the preset shapes do — lib/catalog/
 * validate.js PRESET_RULES is the authority on what each one may set. /resize
 * and /compress are absent on purpose: neither preset can name a format, so
 * neither can resolve a "depends".
 */
function pinnedFormat(toolSlug, preset) {
    if (!preset || typeof preset !== 'object') return null;

    const named = toolSlug === 'convert' ? preset.to
        : (toolSlug === 'heic' || toolSlug === 'signature-resizer') ? preset.format
            : null;

    if (typeof named !== 'string' || named.trim() === '') return null;

    const value = named.trim().toLowerCase();
    return value === 'jpg' ? 'jpeg' : value;
}

/**
 * JPEG is the one output format in this build with no alpha channel — see
 * lib/image-client/flatten.js ALPHA_OUTPUT_FORMATS, which the test suite
 * asserts this against rather than trusting the list twice.
 */
const FORMATS_WITHOUT_ALPHA = ['jpeg'];

/**
 * What a tool changes, as rows a page can render.
 *
 * @param {string} toolSlug   a tool with a page of its own
 * @param {object} [preset]   the intent's preset, where the page has one
 * @returns {{ rows: Array<{ key: string, label: string, value: string, detail: string, text: string }>, note: string|null }|null}
 */
export function behaviourFor(toolSlug, preset = undefined) {
    const entry = BEHAVIOUR[toolSlug];
    if (!entry) return null;

    const rows = [];

    for (const key of BEHAVIOUR_FIELDS) {
        let value = entry[key];

        if (key === 'transparency' && value === 'depends') {
            const format = pinnedFormat(toolSlug, preset);
            if (format) value = FORMATS_WITHOUT_ALPHA.includes(format) ? 'flattened' : 'kept';
        }

        const field = BEHAVIOUR_VALUES[key];
        const shown = field?.values?.[value];
        if (!shown || shown.detail === null) continue;

        rows.push({ key, label: field.label, value, detail: shown.detail, text: shown.text });
    }

    return { rows, note: entry.note ?? null };
}

/**
 * Every way the table above and the tool registry can disagree.
 *
 * `tools` is required rather than defaulted so this module imports nothing from
 * the rest of the package: components/tools/ToolShell.js reads `behaviourFor`
 * and ships in every tool's client chunk, and an import of ./tools here would
 * put the whole tool registry in that chunk behind it.
 */
export function validateBehaviour(tools = []) {
    const problems = [];
    const problem = (code, subject, message) => problems.push({ code, subject, message });

    const withPages = tools.filter((tool) => tool?.hasOwnPage);
    const slugs = new Set(withPages.map((tool) => tool.slug));

    for (const tool of withPages) {
        if (!BEHAVIOUR[tool.slug]) {
            problem(
                'behaviour-missing',
                tool.slug,
                `tool "${tool.slug}" has a page and no entry in lib/catalog/behaviour.js — every tool has to state what it changes about a file`,
            );
        }
    }

    for (const [slug, entry] of Object.entries(BEHAVIOUR)) {
        if (!slugs.has(slug)) {
            problem(
                'behaviour-unknown-tool',
                slug,
                `lib/catalog/behaviour.js describes "${slug}", which is not a tool with a page of its own`,
            );
            continue;
        }

        for (const key of BEHAVIOUR_FIELDS) {
            const value = entry[key];
            const allowed = Object.keys(BEHAVIOUR_VALUES[key].values);
            if (!allowed.includes(value)) {
                problem(
                    'behaviour-value-invalid',
                    slug,
                    `behaviour "${slug}" gives ${key} the value ${JSON.stringify(value)}; use one of ${allowed.join(', ')}`,
                );
            }
        }

        if (entry.note !== undefined && (typeof entry.note !== 'string' || entry.note.trim() === '')) {
            problem(
                'behaviour-value-invalid',
                slug,
                `behaviour "${slug}" has a note that is not a sentence`,
            );
        }
    }

    return problems;
}
