/**
 * The requirement contract two pages share.
 *
 * /passport-photo held these helpers privately and /image-size-fitter needs
 * the same ones, so every sentence pinned here is copy a visitor reads: the
 * assertions use the literal string rather than rebuilding it from the
 * constants, because a test that derives the message the same way the module
 * does cannot notice the message changing.
 */
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PHYSICAL_DPI,
    FORMATS,
    GEOMETRIES,
    UNITS,
    centeredCoverRect,
    describeRequested,
    enlargementFor,
    parseDpiValue,
    parseKbToBytes,
    parsePositiveNumber,
    recoveryFor,
    resolveRequirements,
} from '@/lib/format/fit-requirements';

/** A full custom-pixel job, so each case below states only what it changes. */
function ask(overrides = {}) {
    return resolveRequirements({
        width: '600',
        height: '600',
        unit: 'px',
        dpi: '',
        format: 'jpeg',
        maxKb: '',
        minKb: '',
        geometry: 'cover',
        background: 'white',
        allowLowerQuality: false,
        ...overrides,
    });
}

describe('the vocabulary', () => {
    it('defaults a physical size to 300 DPI — Resizo’s own number, not an authority’s', () => {
        expect(DEFAULT_PHYSICAL_DPI).toBe(300);
    });

    it('offers pixels and the three physical units', () => {
        expect(UNITS).toEqual(['px', 'mm', 'cm', 'in']);
    });

    it('offers the engine’s three fill behaviours, cover first', () => {
        expect(GEOMETRIES).toEqual(['cover', 'contain', 'stretch']);
    });

    it('offers the three output formats the engine can write', () => {
        expect(FORMATS).toEqual(['jpeg', 'png', 'webp']);
    });
});

describe('parsePositiveNumber', () => {
    it.each([
        ['600', 600],
        [' 600 ', 600],
        ['35.5', 35.5],
        ['0.5', 0.5],
        [600, 600],
    ])('reads %o as %o', (raw, expected) => {
        expect(parsePositiveNumber(raw)).toBe(expected);
    });

    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['zero', '0'],
        ['a negative number', '-5'],
        ['words', 'abc'],
        ['null', null],
        ['undefined', undefined],
    ])('returns null for %s', (_label, raw) => {
        expect(parsePositiveNumber(raw)).toBeNull();
    });
});

describe('parseDpiValue', () => {
    it.each([
        ['300', 300],
        [' 300 ', 300],
        ['1', 1],
        ['10000', 10000],
    ])('reads %o as %o', (raw, expected) => {
        expect(parseDpiValue(raw)).toBe(expected);
    });

    it.each([
        ['blank', ''],
        ['zero, below the floor', '0'],
        ['past the ceiling', '10001'],
        ['a fraction', '300.5'],
        ['words', 'abc'],
        ['null', null],
    ])('returns null for %s', (_label, raw) => {
        expect(parseDpiValue(raw)).toBeNull();
    });
});

describe('parseKbToBytes', () => {
    it('reads whole kilobytes as 1024 bytes each', () => {
        expect(parseKbToBytes('100')).toBe(102400);
    });

    it('rounds a fractional kilobyte to whole bytes', () => {
        expect(parseKbToBytes('0.5')).toBe(512);
        expect(parseKbToBytes('100.4')).toBe(102810);
    });

    it('returns null for a field nobody filled in', () => {
        expect(parseKbToBytes('')).toBeNull();
        expect(parseKbToBytes(null)).toBeNull();
    });

    /**
     * Zero, not null: "typed and wrong" must stay distinguishable from "left
     * empty", or a mistyped ceiling silently becomes no ceiling at all.
     */
    it.each([
        ['zero', '0'],
        ['a negative number', '-5'],
        ['words', 'abc'],
    ])('returns 0 for %s, which is typed-and-wrong rather than absent', (_label, raw) => {
        expect(parseKbToBytes(raw)).toBe(0);
    });
});

describe('centeredCoverRect', () => {
    it('takes the full height of a landscape source for a square target', () => {
        expect(centeredCoverRect(1600, 1067, 1)).toEqual({ x: 267, y: 0, width: 1067, height: 1067 });
    });

    it('takes the full width of a square source for a wide target', () => {
        expect(centeredCoverRect(1000, 1000, 2)).toEqual({ x: 0, y: 250, width: 1000, height: 500 });
    });

    it('returns the whole source when the shapes already match', () => {
        expect(centeredCoverRect(600, 400, 1.5)).toEqual({ x: 0, y: 0, width: 600, height: 400 });
    });

    it.each([
        ['a zero width', 0, 100, 1],
        ['a zero height', 100, 0, 1],
        ['a zero aspect', 100, 100, 0],
        ['a negative aspect', 100, 100, -1],
        ['NaN', NaN, 100, 1],
    ])('returns null for %s', (_label, width, height, aspect) => {
        expect(centeredCoverRect(width, height, aspect)).toBeNull();
    });
});

describe('resolveRequirements, in pixels', () => {
    it('turns a plain square request into exactly the fit op’s fields', () => {
        expect(ask({ maxKb: '100' })).toEqual({
            ok: true,
            pixels: { width: 600, height: 600 },
            dpi: null,
            dpiDropped: false,
            fields: {
                width: 600,
                height: 600,
                geometry: 'cover',
                format: 'jpeg',
                background: 'white',
                targetBytes: 102400,
            },
            errors: {},
        });
    });

    it('sends no DPI when none was typed in pixels', () => {
        expect(ask().fields).not.toHaveProperty('dpi');
        expect(ask().dpi).toBeNull();
    });

    it('sends a DPI that was typed in pixels', () => {
        const result = ask({ dpi: '300' });
        expect(result.dpi).toBe(300);
        expect(result.fields.dpi).toBe(300);
    });

    it('sends minQuality 1 only when lower quality is allowed', () => {
        expect(ask({ allowLowerQuality: true }).fields.minQuality).toBe(1);
        expect(ask({ allowLowerQuality: false }).fields).not.toHaveProperty('minQuality');
    });

    it('defaults an absent geometry, format and background', () => {
        const result = resolveRequirements({ width: '600', height: '600' });
        expect(result.ok).toBe(true);
        expect(result.fields).toEqual({
            width: 600,
            height: 600,
            geometry: 'cover',
            format: 'jpeg',
            background: 'white',
        });
    });

    it('passes a custom background colour straight through', () => {
        expect(ask({ background: '#2f6fed' }).fields.background).toBe('#2f6fed');
    });
});

describe('resolveRequirements, from a physical size', () => {
    it('converts 35 × 45 mm at 300 DPI to 413 × 531 px', () => {
        const result = ask({ width: '35', height: '45', unit: 'mm', dpi: '300' });
        expect(result.ok).toBe(true);
        expect(result.pixels).toEqual({ width: 413, height: 531 });
        expect(result.fields.width).toBe(413);
        expect(result.fields.height).toBe(531);
        expect(result.fields.dpi).toBe(300);
    });

    it('falls back to Resizo’s own 300 DPI when a physical size has none typed', () => {
        const result = ask({ width: '35', height: '45', unit: 'mm', dpi: '' });
        expect(result.ok).toBe(true);
        expect(result.dpi).toBe(DEFAULT_PHYSICAL_DPI);
        expect(result.pixels).toEqual({ width: 413, height: 531 });
        expect(result.fields.dpi).toBe(300);
    });

    it('accepts a fractional physical size, which a fractional pixel count is not', () => {
        const result = ask({ width: '3.5', height: '4.5', unit: 'cm', dpi: '300' });
        expect(result.ok).toBe(true);
        expect(result.pixels).toEqual({ width: 413, height: 531 });
    });

    it('converts inches, where 2 in at 300 DPI is exactly 600 px', () => {
        const result = ask({ width: '2', height: '2', unit: 'in', dpi: '300' });
        expect(result.pixels).toEqual({ width: 600, height: 600 });
    });

    it('refuses a physical size whose typed DPI is unusable, and says why it matters', () => {
        const result = ask({ width: '35', height: '45', unit: 'mm', dpi: '0' });
        expect(result.ok).toBe(false);
        expect(result.errors.dpi).toBe('A size in mm, cm or in needs a DPI to become pixels.');
        expect(result.pixels).toBeNull();
        expect(result.dpi).toBeNull();
    });

    it('refuses a physical size that rounds away to nothing', () => {
        const result = ask({ width: '0.01', height: '0.01', unit: 'mm', dpi: '1' });
        expect(result.ok).toBe(false);
        expect(result.errors.size).toBe('That size is smaller than one pixel — raise the size or the DPI.');
    });

    it('refuses a unit it does not know', () => {
        const result = ask({ width: '35', height: '45', unit: 'ft', dpi: '300' });
        expect(result.ok).toBe(false);
        expect(result.errors.size).toBe('Unit must be px, mm, cm or in.');
    });
});

describe('resolveRequirements refuses a size no browser tab can hold', () => {
    it('names the pixel ceiling for a request typed in pixels', () => {
        const result = ask({ width: '9000', height: '600' });
        expect(result.ok).toBe(false);
        expect(result.errors.size).toBe('Width and height cannot be more than 8000 pixels.');
        expect(result.pixels).toBeNull();
    });

    it('names the DPI as the lever for a request typed in millimetres', () => {
        const result = ask({ width: '1000', height: '1000', unit: 'mm', dpi: '300' });
        expect(result.ok).toBe(false);
        expect(result.errors.size)
            .toBe('At 300 DPI that is larger than 8000 pixels on a side — lower the DPI or the size.');
    });

    it('allows exactly the ceiling', () => {
        expect(ask({ width: '8000', height: '8000' }).ok).toBe(true);
    });
});

describe('resolveRequirements reads each side of the size on its own', () => {
    it('names the width when the width is missing', () => {
        const result = ask({ width: '' });
        expect(result.errors.width).toBe('Width must be a whole number greater than 0.');
        expect(result.errors).not.toHaveProperty('height');
    });

    it('names the height when the height is missing', () => {
        const result = ask({ height: '' });
        expect(result.errors.height).toBe('Height must be a whole number greater than 0.');
        expect(result.errors).not.toHaveProperty('width');
    });

    it('refuses a fractional pixel count', () => {
        expect(ask({ width: '600.5' }).errors.width).toBe('Width must be a whole number greater than 0.');
    });

    it('asks a physical size for a number rather than a whole number', () => {
        const result = ask({ width: '', height: '45', unit: 'mm', dpi: '300' });
        expect(result.errors.width).toBe('Width must be a number greater than 0.');
    });

    it('reports every bad field at once rather than one at a time', () => {
        const result = ask({ width: '', height: '', maxKb: '0' });
        expect(Object.keys(result.errors).sort()).toEqual(['height', 'maxKb', 'width']);
    });
});

describe('resolveRequirements reads the byte limits', () => {
    it('sends a maximum through as whole bytes', () => {
        expect(ask({ maxKb: '20' }).fields.targetBytes).toBe(20480);
    });

    /**
     * The engine refuses a ceiling under 10 KB with its own wording, which
     * bypasses the recovery buttons; the form says it first, in the field.
     */
    it('never hands a maximum below the engine’s floor to the engine — the form says so first', () => {
        const result = ask({ maxKb: '9' });
        expect(result.ok).toBe(false);
        expect(result.fields).toBeNull();
        expect(result.errors.maxKb).toBe('Maximum file size cannot be less than 10 KB.');
    });

    it('refuses a maximum that is not a positive number of kilobytes', () => {
        expect(ask({ maxKb: '0' }).errors.maxKb).toBe('Maximum file size must be greater than 0 KB.');
        expect(ask({ maxKb: 'abc' }).errors.maxKb).toBe('Maximum file size must be greater than 0 KB.');
    });

    it('refuses a maximum past the upload cap', () => {
        expect(ask({ maxKb: '30000' }).errors.maxKb).toBe('Maximum file size cannot be more than 20,480 KB.');
    });

    it('refuses a minimum that is not a positive number of kilobytes', () => {
        expect(ask({ minKb: '0' }).errors.minKb).toBe('Minimum file size must be greater than 0 KB.');
    });

    it('refuses a minimum past the upload cap', () => {
        expect(ask({ minKb: '30000' }).errors.minKb).toBe('Minimum file size cannot be more than 20,480 KB.');
    });

    /**
     * The engine refuses `min >= max`, so a panel that green-lit an equal pair
     * would hand the visitor an engine refusal instead of a field message.
     */
    it('refuses a minimum equal to the maximum, which the engine also refuses', () => {
        const result = ask({ maxKb: '50', minKb: '50' });
        expect(result.ok).toBe(false);
        expect(result.errors.minKb).toBe('Minimum file size must be smaller than the maximum.');
    });

    it('refuses a minimum above the maximum', () => {
        expect(ask({ maxKb: '50', minKb: '60' }).errors.minKb)
            .toBe('Minimum file size must be smaller than the maximum.');
    });

    it('accepts a minimum below the maximum and sends both', () => {
        const result = ask({ maxKb: '100', minKb: '20' });
        expect(result.ok).toBe(true);
        expect(result.fields.targetBytes).toBe(102400);
        expect(result.fields.minBytes).toBe(20480);
    });

    it('sends neither limit when neither was typed', () => {
        expect(ask().fields).not.toHaveProperty('targetBytes');
        expect(ask().fields).not.toHaveProperty('minBytes');
    });
});

describe('resolveRequirements and WebP, which records no resolution', () => {
    it('keeps the DPI out of the fields and says it was dropped', () => {
        const result = ask({ format: 'webp', dpi: '300' });
        expect(result.ok).toBe(true);
        expect(result.dpi).toBe(300);
        expect(result.dpiDropped).toBe(true);
        expect(result.fields).not.toHaveProperty('dpi');
    });

    it('still derives pixels from the DPI a physical size needs', () => {
        const result = ask({ width: '35', height: '45', unit: 'mm', dpi: '300', format: 'webp' });
        expect(result.pixels).toEqual({ width: 413, height: 531 });
        expect(result.dpiDropped).toBe(true);
        expect(result.fields).not.toHaveProperty('dpi');
    });

    it('drops nothing when no DPI applies', () => {
        expect(ask({ format: 'webp' }).dpiDropped).toBe(false);
    });

    it('drops nothing for a format that can record one', () => {
        expect(ask({ format: 'png', dpi: '300' }).dpiDropped).toBe(false);
        expect(ask({ format: 'png', dpi: '300' }).fields.dpi).toBe(300);
    });
});

describe('resolveRequirements guards the two list fields', () => {
    it('names the DPI bounds when a pixel job types an impossible one', () => {
        expect(ask({ dpi: '0' }).errors.dpi).toBe('DPI must be a whole number between 1 and 10000.');
        expect(ask({ dpi: '10001' }).errors.dpi).toBe('DPI must be a whole number between 1 and 10000.');
    });

    it('refuses a fill behaviour that is not one of the three', () => {
        expect(ask({ geometry: 'squish' }).errors.geometry).toBe('Fill behaviour must be cover, contain or stretch.');
    });

    it('refuses an output format the engine cannot write', () => {
        expect(ask({ format: 'gif' }).errors.format).toBe('Output format must be JPEG, PNG or WebP.');
    });

    it.each(GEOMETRIES)('accepts %s', (geometry) => {
        expect(ask({ geometry }).fields.geometry).toBe(geometry);
    });

    it.each(FORMATS)('accepts %s', (format) => {
        expect(ask({ format }).fields.format).toBe(format);
    });
});

describe('enlargementFor', () => {
    it('reports the crop rectangle a cover job would grow from', () => {
        expect(enlargementFor({
            sourceWidth: 1000,
            sourceHeight: 1000,
            keptRect: { x: 0, y: 0, width: 800, height: 800 },
            pixels: { width: 1600, height: 1600 },
        })).toEqual({ from: { width: 800, height: 800 }, to: { width: 1600, height: 1600 } });
    });

    it('falls back to the whole source when no rectangle was chosen', () => {
        expect(enlargementFor({
            sourceWidth: 800,
            sourceHeight: 800,
            keptRect: null,
            pixels: { width: 1600, height: 1600 },
        })).toEqual({ from: { width: 800, height: 800 }, to: { width: 1600, height: 1600 } });
    });

    it('reports an enlargement on one side alone', () => {
        expect(enlargementFor({
            sourceWidth: 2000,
            sourceHeight: 400,
            keptRect: null,
            pixels: { width: 600, height: 600 },
        })).toEqual({ from: { width: 2000, height: 400 }, to: { width: 600, height: 600 } });
    });

    it('returns null when the kept area covers the target', () => {
        expect(enlargementFor({
            sourceWidth: 2000,
            sourceHeight: 2000,
            keptRect: null,
            pixels: { width: 600, height: 600 },
        })).toBeNull();
    });

    it('returns null when the kept area is exactly the target', () => {
        expect(enlargementFor({
            sourceWidth: 600,
            sourceHeight: 600,
            keptRect: null,
            pixels: { width: 600, height: 600 },
        })).toBeNull();
    });

    it.each([
        ['no target', { sourceWidth: 800, sourceHeight: 800, keptRect: null, pixels: null }],
        ['no source', { sourceWidth: null, sourceHeight: null, keptRect: null, pixels: { width: 600, height: 600 } }],
        ['nothing at all', {}],
    ])('returns null with %s', (_label, input) => {
        expect(enlargementFor(input)).toBeNull();
    });
});

describe('recoveryFor', () => {
    it('offers quality, WebP and the limit when a ceiling could not be reached', () => {
        expect(recoveryFor('target-unreachable', { format: 'jpeg' })).toEqual(['lower-quality', 'webp', 'limit']);
    });

    it('does not offer WebP to a job already writing WebP', () => {
        expect(recoveryFor('target-unreachable', { format: 'webp' })).toEqual(['lower-quality', 'limit']);
    });

    it('does not offer a lower quality to PNG, which has no quality dial here', () => {
        expect(recoveryFor('target-unreachable', { format: 'png' })).toEqual(['webp', 'limit']);
    });

    it('offers PNG, the size and the minimum when a floor could not be reached', () => {
        expect(recoveryFor('minimum-unreachable', { format: 'jpeg' })).toEqual(['png', 'size', 'minimum']);
    });

    it('does not offer PNG to a job already writing PNG', () => {
        expect(recoveryFor('minimum-unreachable', { format: 'png' })).toEqual(['size', 'minimum']);
    });

    /**
     * A preset's minimum and format are the authority's, not the visitor's, so
     * neither is a lever /passport-photo can offer under one.
     */
    it('offers no minimum and no WebP when the numbers are not the visitor’s to change', () => {
        expect(recoveryFor('minimum-unreachable', { format: 'jpeg', isCustom: false })).toEqual(['png', 'size']);
        expect(recoveryFor('target-unreachable', { format: 'jpeg', isCustom: false })).toEqual(['lower-quality', 'limit']);
    });

    it('reads the code off a failure object as readily as off a string', () => {
        expect(recoveryFor({ code: 'minimum-unreachable' }, { format: 'png' })).toEqual(['size', 'minimum']);
    });

    it.each([
        ['no failure', null],
        ['a failure with no code', {}],
        ['a memory refusal, which no button here can fix', 'memory-refusal'],
    ])('offers nothing for %s', (_label, error) => {
        expect(recoveryFor(error, { format: 'jpeg' })).toEqual([]);
    });
});

describe('describeRequested', () => {
    const fields = {
        width: 600,
        height: 600,
        geometry: 'cover',
        format: 'jpeg',
        background: 'white',
        targetBytes: 102400,
        minBytes: 20480,
        dpi: 300,
    };

    it('lists the six rows in the order the validator reports them', () => {
        const rows = describeRequested(fields, { unit: 'px', physical: null, dpi: 300 });
        expect(rows.map((row) => row.key))
            .toEqual(['dimensions', 'format', 'maxBytes', 'minBytes', 'dpi', 'transparency']);
    });

    it('labels each row the way the validator labels its answer', () => {
        const rows = describeRequested(fields, { unit: 'px', physical: null, dpi: 300 });
        expect(rows.map((row) => row.label)).toEqual([
            'Dimensions',
            'Format',
            'Maximum file size',
            'Minimum file size',
            'Resolution',
            'Transparency',
        ]);
    });

    it('writes every requested value as a person would read it', () => {
        const rows = describeRequested(fields, { unit: 'px', physical: null, dpi: 300 });
        expect(rows.map((row) => row.requested)).toEqual([
            '600 × 600 px',
            'JPEG',
            '≤ 100 KB',
            '≥ 20 KB',
            '300 DPI',
            'No transparency',
        ]);
    });

    it('shows the physical size, the DPI and the pixels it became', () => {
        const rows = describeRequested(
            { ...fields, width: 413, height: 531 },
            { unit: 'mm', physical: { width: 35, height: 45 }, dpi: 300 },
        );
        expect(rows[0].requested).toBe('35 × 45 mm at 300 DPI = 413 × 531 px');
    });

    it('keeps a fractional physical size exactly as it was typed', () => {
        const rows = describeRequested(
            { ...fields, width: 413, height: 531 },
            { unit: 'cm', physical: { width: 3.5, height: 4.5 }, dpi: 300 },
        );
        expect(rows[0].requested).toBe('3.5 × 4.5 cm at 300 DPI = 413 × 531 px');
    });

    it('says a row was not required rather than inventing one', () => {
        const rows = describeRequested(
            { width: 600, height: 600, geometry: 'cover', format: 'png', background: 'white' },
            { unit: 'px', physical: null, dpi: null },
        );
        expect(rows.map((row) => row.requested)).toEqual([
            '600 × 600 px',
            'PNG',
            'Not required',
            'Not required',
            'Not required',
            'Kept where the format allows',
        ]);
    });

    it('reports no resolution for WebP even when one was asked for', () => {
        const rows = describeRequested(
            { width: 600, height: 600, geometry: 'cover', format: 'webp', background: 'white' },
            { unit: 'px', physical: null, dpi: 300 },
        );
        expect(rows[1].requested).toBe('WebP');
        expect(rows[4].requested).toBe('Not required');
        expect(rows[5].requested).toBe('Kept where the format allows');
    });
});

describe('the maximum file size respects the engine’s own floor', () => {
    it('refuses a maximum under 10 KB with a sentence naming the floor', () => {
        const result = resolveRequirements({ width: '600', height: '600', unit: 'px', dpi: '', format: 'jpeg', maxKb: '5', minKb: '', geometry: 'cover', background: 'white', allowLowerQuality: false });
        expect(result.ok).toBe(false);
        expect(result.errors.maxKb).toBe('Maximum file size cannot be less than 10 KB.');
    });

    it('accepts exactly 10 KB', () => {
        const result = resolveRequirements({ width: '600', height: '600', unit: 'px', dpi: '', format: 'jpeg', maxKb: '10', minKb: '', geometry: 'cover', background: 'white', allowLowerQuality: false });
        expect(result.ok).toBe(true);
        expect(result.fields.targetBytes).toBe(10 * 1024);
    });
});

