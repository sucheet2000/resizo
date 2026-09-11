/**
 * The FormData → engine-options table: lib/image-client/form-options.js.
 *
 * Nothing tested this module. Nothing at all — not the field names, not the
 * absent-versus-empty distinction, not the file extraction. It is two exported
 * functions and a lookup table, and every tool page's options pass through it
 * on the way from the form the page builds to the job the engine runs.
 *
 * WHY A LOOKUP TABLE OF STRINGS DESERVES ITS OWN SUITE
 *
 * A wrong field name here does not throw. It silently drops the option, and the
 * job runs with a default that looks plausible: a crop that ignores its
 * rectangle, a compress that ignores its target, a bulk resize that converts
 * every PNG to JPEG because the format sentinel was read from the wrong key.
 * That last one is not hypothetical — it is the bug the module's own docblock
 * records. A silent default is exactly the failure a unit test catches and a
 * screenshot does not.
 *
 * The values are asserted RAW. The strict parsers downstream need to see '' and
 * '10.9' and 'abc' as they arrived to tell "not supplied" apart from "supplied
 * and wrong", so any coercion here would destroy information the engine needs.
 */
import { describe, expect, it } from 'vitest';

import { fileFromFormData, optionsFromFormData, FILE_FIELD } from '@/lib/image-client/form-options';

function formOf(entries) {
    const form = new FormData();
    for (const [key, value] of Object.entries(entries)) form.append(key, value);
    return form;
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

describe('pulling the upload out of a form body', () => {
    it('reads it from the one field every tool posts under', () => {
        expect(FILE_FIELD).toBe('file');

        const file = new File([new Uint8Array([1, 2])], 'photo.jpg', { type: 'image/jpeg' });
        const form = new FormData();
        form.append(FILE_FIELD, file);

        expect(fileFromFormData(form)).toBe(file);
    });

    it('answers null when the body carries no file at all', () => {
        expect(fileFromFormData(formOf({ width: '100' }))).toBeNull();
    });

    /** A plain text field under the file name is not a file, however it looks. */
    it('answers null when the field holds a string rather than a file', () => {
        expect(fileFromFormData(formOf({ file: 'photo.jpg' }))).toBeNull();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a plain object', { file: 'x' }],
        ['a string', 'file=photo.jpg'],
        ['an array', []],
    ])('answers null for %s rather than throwing', (_label, input) => {
        expect(fileFromFormData(input)).toBeNull();
    });

    it('takes a Blob, since a worker source arrives without a name', () => {
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        const form = new FormData();
        form.append(FILE_FIELD, blob);

        expect(fileFromFormData(form)).toBeInstanceOf(Blob);
    });
});

/* ------------------------------------------------------------------ *
 * The field names, one op at a time
 * ------------------------------------------------------------------ */

describe('the field names each op reads', () => {
    it('maps /resize to width, height, scale and format', () => {
        const options = optionsFromFormData('resize', formOf({
            width: '1920', height: '1080', scale: '50', format: 'webp',
        }));

        expect(options).toEqual({ width: '1920', height: '1080', scale: '50', format: 'webp' });
    });

    /** The crop route prefixed every one of its four, and the engine still does. */
    it('maps /crop to the four crop_ prefixed fields', () => {
        const options = optionsFromFormData('crop', formOf({
            crop_x: '10', crop_y: '20', crop_width: '300', crop_height: '400',
        }));

        expect(options).toEqual({ x: '10', y: '20', width: '300', height: '400' });
    });

    it('ignores unprefixed crop fields, which belong to a different op', () => {
        const options = optionsFromFormData('crop', formOf({
            x: '10', y: '20', width: '300', height: '400',
        }));

        expect(options).toEqual({});
    });

    /**
     * `output_format` is this build's one added field. /compress always answered
     * in the source format on the server; here it can offer WebP to a PNG that
     * has been asked for a byte target, because PNG cannot reach one without
     * shrinking the picture.
     */
    it('maps /compress to quality, targetBytes and output_format', () => {
        const options = optionsFromFormData('compress', formOf({
            quality: '65', targetBytes: '102400', output_format: 'webp',
        }));

        expect(options).toEqual({ quality: '65', targetBytes: '102400', format: 'webp' });
    });

    it('maps /convert to target_format, not to format', () => {
        expect(optionsFromFormData('convert', formOf({ target_format: 'png' })))
            .toEqual({ format: 'png' });
        expect(optionsFromFormData('convert', formOf({ format: 'png' })))
            .toEqual({});
    });

    it('reads a quality for /convert, which the bulk converter sets and the page does not', () => {
        expect(optionsFromFormData('convert', formOf({ target_format: 'webp', quality: '30' })))
            .toEqual({ format: 'webp', quality: '30' });
        // Absent stays absent: the single-file page sends no quality field and
        // must still get the engine default rather than an empty string.
        expect(optionsFromFormData('convert', formOf({ target_format: 'webp' })))
            .not.toHaveProperty('quality');
    });

    it('reads only the output format and the background for /heic — never a quality', () => {
        expect(optionsFromFormData('heic', formOf({ quality: '90', format: 'jpeg' })))
            .toEqual({ format: 'jpeg' });
    });

    it('answers an empty object for an op the table has never heard of', () => {
        expect(optionsFromFormData('rotate', formOf({ angle: '90' }))).toEqual({});
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a plain object', { width: '10' }],
        ['a string', 'width=10'],
    ])('answers an empty object when the body is %s', (_label, input) => {
        expect(optionsFromFormData('resize', input)).toEqual({});
    });
});

/* ------------------------------------------------------------------ *
 * Absent is not empty, and neither is coerced
 * ------------------------------------------------------------------ */

describe('what happens to a field that was not filled in', () => {
    /**
     * The distinction the strict parsers are built on. An absent width means "no
     * explicit target"; an EMPTY width means the same thing — but an absent
     * quality means "use the default" while an empty one is a user error. Only
     * the parsers can tell those apart, and only if this module hands them the
     * value exactly as it arrived.
     */
    it('leaves an absent field absent rather than turning it into an empty string', () => {
        const options = optionsFromFormData('resize', formOf({ width: '1920' }));

        expect(options).toEqual({ width: '1920' });
        expect('height' in options).toBe(false);
        expect('scale' in options).toBe(false);
        expect('format' in options).toBe(false);
    });

    it('keeps an empty string when the field was present and blank', () => {
        const options = optionsFromFormData('resize', formOf({ width: '', height: '1080' }));

        expect(options.width).toBe('');
        expect('width' in options).toBe(true);
    });

    it.each([
        ['a decimal', '10.9'],
        ['words', 'abc'],
        ['a negative', '-40'],
        ['padding', '  200  '],
    ])('passes %s through untouched for the parser to judge', (_label, raw) => {
        expect(optionsFromFormData('resize', formOf({ width: raw })).width).toBe(raw);
    });

    it('does not coerce a numeric-looking value into a number', () => {
        expect(typeof optionsFromFormData('compress', formOf({ quality: '80' })).quality).toBe('string');
    });
});

/**
 * The background travels as a form field like every other option, so it has to
 * be in the map for each op that can drop alpha. A field missing from the map
 * is silently discarded — optionsFromFormData only copies what it is told
 * about — which is exactly the failure that looks like a working control.
 *
 * /crop is deliberately absent: it re-encodes in the SOURCE format, so it can
 * never be the step that drops an alpha channel.
 */
describe('the transparency background is carried for every op that can drop alpha', () => {
    it.each([
        ['convert', 'target_format'],
        ['compress', 'output_format'],
        ['resize', 'format'],
    ])('%s carries it alongside its format field', (op, formatField) => {
        const form = new FormData();
        form.append(formatField, 'jpeg');
        form.append('background', 'white');

        expect(optionsFromFormData(op, form)).toMatchObject({ background: 'white' });
    });

    it('heic carries it, since its output is always JPEG', () => {
        const form = new FormData();
        form.append('background', '#ffffff');

        expect(optionsFromFormData('heic', form)).toEqual({ background: '#ffffff' });
    });

    it('leaves it absent when the page did not send one', () => {
        const form = new FormData();
        form.append('target_format', 'jpeg');

        expect(optionsFromFormData('convert', form)).not.toHaveProperty('background');
    });

    it('is not offered on crop, which re-encodes in the source format', () => {
        const form = new FormData();
        form.append('background', 'white');

        expect(optionsFromFormData('crop', form)).not.toHaveProperty('background');
    });
});

/* ------------------------------------------------------------------ *
 * The expansion's fields
 * ------------------------------------------------------------------ */

describe('the fields the expansion added', () => {
    it('reads the compress policy alongside the target', () => {
        expect(optionsFromFormData('compress', formOf({ targetBytes: '20480', policy: 'fit' })))
            .toEqual({ targetBytes: '20480', policy: 'fit' });
    });

    it('reads every signature field under the names the tool posts', () => {
        expect(optionsFromFormData('signature', formOf({
            crop_x: '10', crop_y: '20', crop_width: '300', crop_height: '100',
            width: '150', height: '50', fit: 'cover', format: 'png', background: 'white', targetBytes: '20480',
        }))).toEqual({
            x: '10', y: '20', cropWidth: '300', cropHeight: '100',
            width: '150', height: '50', fit: 'cover', format: 'png', background: 'white', targetBytes: '20480',
        });
    });

    it('reads the requested density for a DPI change', () => {
        expect(optionsFromFormData('dpi', formOf({ dpi: '300' }))).toEqual({ dpi: '300' });
    });

    /**
     * The favicon package posts the same four crop_ fields every other tool
     * posts a rectangle under, plus its own shape field. A missing one there is
     * the silent failure this suite is for: the icons come out square either
     * way, made of the wrong part of the picture.
     */
    it('reads every favicon field under the names the icon tool posts', () => {
        expect(optionsFromFormData('icons', formOf({
            geometry: 'contain',
            crop_x: '0', crop_y: '0', crop_width: '400', crop_height: '400',
            background: 'transparent',
        }))).toEqual({
            geometry: 'contain',
            x: '0', y: '0', cropWidth: '400', cropHeight: '400',
            background: 'transparent',
        });
    });

    it('leaves the favicon fields absent when the form carried none of them', () => {
        expect(optionsFromFormData('icons', formOf({ format: 'png', width: '512' }))).toEqual({});
    });

    /**
     * The requirement fitter reads more fields than any other op, and a field
     * missing from its map is the failure this whole suite exists for: the job
     * runs, the picture comes out at the right size, and the byte floor or the
     * DPI the form actually demanded was silently never applied.
     */
    it('reads every requirement field under the names the passport tool posts', () => {
        expect(optionsFromFormData('fit', formOf({
            width: '600', height: '750', geometry: 'contain',
            crop_x: '10', crop_y: '20', crop_width: '300', crop_height: '400',
            format: 'jpeg', background: '#ffffff',
            targetBytes: '51200', minBytes: '10240', minQuality: '1', dpi: '300',
        }))).toEqual({
            width: '600', height: '750', geometry: 'contain',
            x: '10', y: '20', cropWidth: '300', cropHeight: '400',
            format: 'jpeg', background: '#ffffff',
            targetBytes: '51200', minBytes: '10240', minQuality: '1', dpi: '300',
        });
    });

    /**
     * `geometry` and `fit` are different fields with different value sets —
     * signature's 'fit' means fit-inside, where the fitter's 'contain' does.
     * Reading one for the other would silently pick the wrong default.
     */
    it('does not read the signature op’s fit field as its own geometry', () => {
        expect(optionsFromFormData('fit', formOf({ width: '600', height: '750', fit: 'cover' })))
            .toEqual({ width: '600', height: '750' });
    });

    it('leaves every optional requirement absent when the form did not carry it', () => {
        const options = optionsFromFormData('fit', formOf({ width: '600', height: '750' }));

        expect(options).toEqual({ width: '600', height: '750' });
        for (const field of ['geometry', 'format', 'background', 'targetBytes', 'minBytes', 'minQuality', 'dpi']) {
            expect(field in options).toBe(false);
        }
    });

    it('reads nothing for a metadata strip, which has no options', () => {
        expect(optionsFromFormData('strip', formOf({ dpi: '300', quality: '80' }))).toEqual({});
    });

    it('reads the output format for a HEIC conversion', () => {
        expect(optionsFromFormData('heic', formOf({ format: 'png', background: 'white' })))
            .toEqual({ format: 'png', background: 'white' });
    });
});
