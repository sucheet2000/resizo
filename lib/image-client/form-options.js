/**
 * FormData → Engine Options
 *
 * The tool pages build a FormData today because they POST it. Nothing about a
 * local job needs one, but keeping the translation in a single readable table
 * means a page can move from the server to the browser by changing the hook it
 * imports and nothing else — no rewriting how it collects its fields, and no
 * chance of a field name drifting apart between the two builds mid-migration.
 *
 * The field names below are the exact strings the route handlers read. If one
 * of them is wrong the local build silently ignores an option the server
 * honoured — which is precisely how the bulk `'original'` / `'same'` sentinel
 * once converted every PNG to JPEG without a single error.
 *
 * Values are passed through RAW, never coerced. The strict parsers in
 * lib/image/dimensions.js and lib/image/quality.js are the same ones the routes
 * use, and they need to see '' and '10.9' and 'abc' exactly as they arrived to
 * tell "not supplied" apart from "supplied and wrong".
 */

/** The form field every tool posts its file under. */
export const FILE_FIELD = 'file';

const FIELD_MAPS = {
    resize: { width: 'width', height: 'height', scale: 'scale', format: 'format', background: 'background' },
    crop: { x: 'crop_x', y: 'crop_y', width: 'crop_width', height: 'crop_height' },
    // `output_format` had no counterpart on the compress route, which always
    // answered in the source format. It is this build's one added field, and it
    // exists because PNG cannot reach a byte target here without shrinking the
    // picture — see lib/image-client/compress-target.js.
    compress: { quality: 'quality', targetBytes: 'targetBytes', format: 'output_format', background: 'background', policy: 'policy' },
    convert: { format: 'target_format', background: 'background' },
    heic: { background: 'background', format: 'format' },
    // /signature-resizer: a crop rectangle in source pixels, the size the
    // signature should come out at, how to reach that size without distorting
    // it, the format, the colour behind it and an optional byte ceiling.
    signature: {
        x: 'crop_x',
        y: 'crop_y',
        cropWidth: 'crop_width',
        cropHeight: 'crop_height',
        width: 'width',
        height: 'height',
        fit: 'fit',
        format: 'format',
        background: 'background',
        targetBytes: 'targetBytes',
    },
    // /passport-photo: the whole list of output requirements a form states, in
    // one submission. The four crop_ fields are the same names /crop and
    // /signature-resizer post under, because it is the same rectangle in the
    // same source pixels; `geometry` is this op's own field and must not be
    // confused with signature's `fit`, whose three values mean different things.
    fit: {
        width: 'width',
        height: 'height',
        geometry: 'geometry',
        x: 'crop_x',
        y: 'crop_y',
        cropWidth: 'crop_width',
        cropHeight: 'crop_height',
        format: 'format',
        background: 'background',
        targetBytes: 'targetBytes',
        minBytes: 'minBytes',
        minQuality: 'minQuality',
        dpi: 'dpi',
    },
    dpi: { dpi: 'dpi' },
    // A metadata strip takes no options: everything removable is removed.
    strip: {},
};

function isFormDataLike(value) {
    return Boolean(value) && typeof value.get === 'function' && typeof value.has === 'function';
}

/** The uploaded file out of a FormData, or null when the body carries none. */
export function fileFromFormData(formData) {
    if (!isFormDataLike(formData)) return null;
    const file = formData.get(FILE_FIELD);
    return typeof file?.arrayBuffer === 'function' ? file : null;
}

/**
 * The engine options for one op, read out of the FormData its route would have
 * received.
 *
 * A field that is absent stays absent (null) rather than becoming '' — the
 * parsers treat those differently, and so did the routes: an absent width means
 * "no explicit target", an empty one means the same, but an absent quality
 * means "use the default" while a malformed one is an error.
 *
 * @param {string} op
 * @param {FormData} formData
 * @returns {object}
 */
export function optionsFromFormData(op, formData) {
    const map = FIELD_MAPS[op];
    if (!map || !isFormDataLike(formData)) return {};

    const options = {};

    for (const [option, field] of Object.entries(map)) {
        if (!formData.has(field)) continue;
        options[option] = formData.get(field);
    }

    return options;
}
