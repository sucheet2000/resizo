/**
 * THE GOVERNMENT PRESETS, AND WHY EACH ONE IS ALLOWED TO EXIST
 *
 * A chip that says "US passport photo" is a claim about a rule somebody's
 * application will be judged against, and it is the most expensive kind of
 * claim on this site: the person acting on it is about to pay a fee and post
 * a form. A social preset that is out of date costs somebody a re-crop. A
 * passport preset that is out of date costs them the application.
 *
 * So the bar here is higher than it is for lib/catalog/presets.js, and this
 * suite is where the difference is enforced:
 *
 *   - `source: null` is legitimate for an Instagram size and is REFUSED here.
 *     An unsourced government number is not a convention, it is a guess.
 *   - Every physical size states the unit the authority itself used, and the
 *     millimetre figure beside it has to be that number converted. 2 inches is
 *     50.8 mm; a preset that says 2 inches and 51 mm is one of the two wrong,
 *     and at 300 DPI the two disagree by two pixels.
 *   - A declared aspect ratio that contradicts the dimensions beside it is a
 *     contradiction the page would render as two different truths.
 *   - Freshness is measured, not assumed. A source read fourteen months ago is
 *     reported as stale by `staleApplicationPresets` with an injected clock, so
 *     the report itself is provable rather than being a comment nobody reruns.
 *
 * And the arithmetic is checked against lib/format/physical.js rather than
 * being restated: a preset that derives its own pixels is a second
 * implementation of a conversion that already exists.
 */
import { describe, expect, it } from 'vitest';

import {
    APPLICATION_PRESETS,
    applicationPresetToRequirement,
    getApplicationPreset,
} from '@/lib/catalog/application-presets';
import {
    APPLICATION_CHECKS,
    PHYSICAL_UNITS,
    staleApplicationPresets,
    validateApplicationPresets,
} from '@/lib/catalog/application-presets/validate';
import { validateCatalog } from '@/lib/catalog/validate';
import { MM_PER_INCH, pixelsFor } from '@/lib/format/physical';
import { ALLOWED_OUTPUT_FORMATS, MAX_DIMENSION, MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/limits';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A citation has to be the authority talking about itself. A visa agency, a
 * photo shop or a tool blog restating the numbers is exactly what this
 * registry exists to stop repeating, so the host is pinned per preset.
 */
const ALLOWED_HOSTS = {
    'uk-passport-digital': 'www.gov.uk',
    'uk-passport-print': 'www.gov.uk',
    'us-passport-print': 'travel.state.gov',
    'india-passport-print': 'www.passportindia.gov.in',
};

const GOOD_SOURCE = {
    label: 'HM Passport Office, Photos for passports',
    url: 'https://www.gov.uk/photos-for-passports',
    verifiedAt: '2026-09-10',
};

/** A deep, mutable copy, so a test can break one entry without breaking the module. */
const copy = () => structuredClone(APPLICATION_PRESETS);

const codes = (presets) => validateApplicationPresets(presets).map((problem) => problem.code);

/** The shipped registry with one entry patched — the shape every rule test uses. */
function withPreset(id, patch) {
    return copy().map((preset) => (preset.id === id ? { ...preset, ...patch } : preset));
}

const preset = (id) => APPLICATION_PRESETS.find((entry) => entry.id === id);

/* ------------------------------------------------------------------ *
 * The registry itself
 * ------------------------------------------------------------------ */

describe('the shipped registry', () => {
    it('ships the four presets this release verified, and nothing else', () => {
        expect(APPLICATION_PRESETS.map((entry) => entry.id)).toEqual([
            'uk-passport-digital',
            'uk-passport-print',
            'us-passport-print',
            'india-passport-print',
        ]);
    });

    it('finds nothing wrong with itself', () => {
        expect(validateApplicationPresets()).toEqual([]);
        expect(validateApplicationPresets(APPLICATION_PRESETS)).toEqual([]);
    });

    it('keeps ids and names unique, so no two chips read the same', () => {
        for (const key of ['id', 'name']) {
            expect(new Set(APPLICATION_PRESETS.map((entry) => entry[key])).size)
                .toBe(APPLICATION_PRESETS.length);
        }
    });

    it('cites the authority’s own domain over https, dated in the past', () => {
        const today = new Date().toISOString().slice(0, 10);

        for (const entry of APPLICATION_PRESETS) {
            const url = new URL(entry.source.url);
            expect(url.protocol, `${entry.id} is not https`).toBe('https:');
            expect(url.host, `${entry.id} cites a page that is not the authority's own`)
                .toBe(ALLOWED_HOSTS[entry.id]);
            expect(entry.source.verifiedAt, `${entry.id}`).toMatch(ISO_DATE);
            expect(entry.source.verifiedAt <= today, `${entry.id} is dated in the future`).toBe(true);
            expect(entry.source.label.trim().length).toBeGreaterThan(10);
        }
    });

    it('names a jurisdiction, an authority and which of print or digital it is', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(entry.jurisdiction.trim().length, entry.id).toBeGreaterThan(0);
            expect(entry.authority.trim().length, entry.id).toBeGreaterThan(0);
            expect(['print', 'digital'], entry.id).toContain(entry.use);
        }
    });

    it('says what it cannot verify on every entry, because that is the honest half', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(entry.cannotVerify.length, `${entry.id} claims to verify everything`).toBeGreaterThan(0);
            for (const sentence of entry.cannotVerify) expect(sentence.trim().length).toBeGreaterThan(2);
        }
    });

    it('writes only formats the engine can encode, and records whether the authority named one', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(entry.formats.length, entry.id).toBeGreaterThan(0);
            for (const format of entry.formats) expect(ALLOWED_OUTPUT_FORMATS, entry.id).toContain(format);
            expect(typeof entry.formatsStated, entry.id).toBe('boolean');
        }
    });

    it('enforces only checks the output validator can actually run', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(entry.enforces.length, entry.id).toBeGreaterThan(0);
            for (const check of entry.enforces) expect(APPLICATION_CHECKS, entry.id).toContain(check);
        }
    });

    /**
     * Resizo fills transparent areas and the padding a "fit inside" leaves. It
     * does not replace the background behind a person, and no entry may say it
     * does — that is the difference between a tool and a claim of compliance.
     */
    it('never claims to set the background the authority asks for', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(entry.background.stated.trim().length, entry.id).toBeGreaterThan(0);
            expect(entry.background.resizoSets, entry.id).toBe('transparent-only');
        }
    });

    it('promises no outcome anywhere in its copy', () => {
        const text = JSON.stringify(APPLICATION_PRESETS).toLowerCase();
        for (const phrase of ['guaranteed', 'guarantee', '100% compliant', 'government approved', 'approved by']) {
            expect(text, `a preset promises "${phrase}"`).not.toContain(phrase);
        }
    });
});

/* ------------------------------------------------------------------ *
 * The numbers, against the sources quoted in the plan
 * ------------------------------------------------------------------ */

describe('the four sets of numbers', () => {
    it('states the UK digital minimum and its byte window', () => {
        const entry = preset('uk-passport-digital');
        expect(entry.digital).toEqual({ minWidth: 600, minHeight: 750, maxWidth: null, maxHeight: null });
        expect(entry.physical).toBeNull();
        expect(entry.bytes).toEqual({ min: 50 * 1024, max: 10 * 1024 * 1024 });
        expect(entry.aspect).toEqual([4, 5]);
    });

    it('states the UK printed size in the millimetres the page uses', () => {
        const entry = preset('uk-passport-print');
        expect(entry.physical.unit).toBe('mm');
        expect([entry.physical.width, entry.physical.height]).toEqual([35, 45]);
        expect([entry.physical.widthMm, entry.physical.heightMm]).toEqual([35, 45]);
        expect(entry.head).toMatchObject({ minMm: 29, maxMm: 34 });
        expect(entry.aspect).toEqual([7, 9]);
    });

    /**
     * The State Department states 2 inches first and 51 mm as the rounded
     * metric equivalent. 2 inches is 50.8 mm exactly, and the difference is
     * two pixels at 300 DPI — so the inch figure is the one the arithmetic
     * runs on and the rounded quote lives in `statedAs`.
     */
    it('derives the US size from the inches stated, not from the rounded millimetres', () => {
        const entry = preset('us-passport-print');
        expect(entry.physical.unit).toBe('in');
        expect([entry.physical.width, entry.physical.height]).toEqual([2, 2]);
        expect(entry.physical.widthMm).toBeCloseTo(2 * MM_PER_INCH, 10);
        expect(entry.physical.statedAs).toContain('51 x 51 mm');
        expect(entry.aspect).toEqual([1, 1]);
        expect(entry.head).toMatchObject({ minMm: 25, maxMm: 35 });
    });

    it('states the Indian size in the centimetres the booklet uses', () => {
        const entry = preset('india-passport-print');
        expect(entry.physical.unit).toBe('cm');
        expect([entry.physical.width, entry.physical.height]).toEqual([3.5, 4.5]);
        expect([entry.physical.widthMm, entry.physical.heightMm]).toEqual([35, 45]);
        expect(entry.aspect).toEqual([7, 9]);
        // No numeric head-height rule is published, so none is invented.
        expect(entry.head).toBeNull();
    });

    it('carries the caveat that would sink an application, on the two entries that have one', () => {
        expect(preset('us-passport-print').notes.join(' ')).toContain('Submit the original, unchanged photo');
        expect(preset('india-passport-print').notes.join(' ')).toContain('computer print will not be accepted');
        expect(preset('india-passport-print').notes.join(' ')).toContain('NOT REQUIRED');
    });

    it('keeps every byte figure inside the range the compressor can honour', () => {
        for (const entry of APPLICATION_PRESETS) {
            for (const side of ['min', 'max']) {
                const value = entry.bytes[side];
                if (value === null) continue;
                expect(value, `${entry.id} ${side}`).toBeGreaterThanOrEqual(MIN_TARGET_BYTES);
                expect(value, `${entry.id} ${side}`).toBeLessThanOrEqual(MAX_TARGET_BYTES);
            }
        }
    });
});

/* ------------------------------------------------------------------ *
 * getApplicationPreset
 * ------------------------------------------------------------------ */

describe('getApplicationPreset', () => {
    it('finds an entry by id', () => {
        expect(getApplicationPreset('us-passport-print')).toBe(preset('us-passport-print'));
    });

    it.each([['an unknown id', 'fr-passport'], ['an empty string', ''], ['null', null], ['undefined', undefined]])(
        'returns null for %s',
        (_label, id) => {
            expect(getApplicationPreset(id)).toBeNull();
        },
    );
});

/* ------------------------------------------------------------------ *
 * applicationPresetToRequirement
 * ------------------------------------------------------------------ */

describe('applicationPresetToRequirement', () => {
    it('turns the UK printed millimetres into pixels at 300 DPI', () => {
        expect(applicationPresetToRequirement(preset('uk-passport-print'), { dpi: 300 })).toEqual({
            width: 413,
            height: 531,
            geometry: 'cover',
            format: 'jpeg',
            targetBytes: null,
            minBytes: null,
            dpi: 300,
        });
    });

    it('turns two inches into exactly 600 pixels, not 602', () => {
        const requirement = applicationPresetToRequirement(preset('us-passport-print'), { dpi: 300 });
        expect([requirement.width, requirement.height]).toEqual([600, 600]);
    });

    it('gives the Indian centimetres the same pixels as the UK millimetres, because the size is the same', () => {
        const india = applicationPresetToRequirement(preset('india-passport-print'), { dpi: 300 });
        const uk = applicationPresetToRequirement(preset('uk-passport-print'), { dpi: 300 });
        expect([india.width, india.height]).toEqual([uk.width, uk.height]);
    });

    it('reads a digital preset straight off its published minimums, with no DPI', () => {
        expect(applicationPresetToRequirement(preset('uk-passport-digital'))).toEqual({
            width: 600,
            height: 750,
            geometry: 'cover',
            format: 'jpeg',
            targetBytes: 10 * 1024 * 1024,
            minBytes: 50 * 1024,
            dpi: null,
        });
    });

    it('ignores a DPI handed to a digital preset, because pixels are the published rule there', () => {
        const at600 = applicationPresetToRequirement(preset('uk-passport-digital'), { dpi: 600 });
        expect([at600.width, at600.height, at600.dpi]).toEqual([600, 750, null]);
    });

    it('honours a DPI other than the default', () => {
        const at600 = applicationPresetToRequirement(preset('uk-passport-print'), { dpi: 600 });
        expect(at600.dpi).toBe(600);
        expect([at600.width, at600.height]).toEqual([pixelsFor(35, 'mm', 600), pixelsFor(45, 'mm', 600)]);
    });

    it('falls back to the preset’s own default DPI when none is asked for', () => {
        const entry = preset('uk-passport-print');
        expect(applicationPresetToRequirement(entry).dpi).toBe(entry.dpi.default);
    });

    /**
     * The conversion is lib/format/physical.js's job and this must not be a
     * second implementation of it — a preset that rounds differently from the
     * tool would print a size the summary then calls wrong.
     */
    it('agrees with pixelsFor on every physical preset, at three resolutions', () => {
        for (const entry of APPLICATION_PRESETS.filter((candidate) => candidate.physical)) {
            for (const dpi of [200, 300, 600]) {
                const requirement = applicationPresetToRequirement(entry, { dpi });
                expect([requirement.width, requirement.height], `${entry.id} at ${dpi}`).toEqual([
                    pixelsFor(entry.physical.width, entry.physical.unit, dpi),
                    pixelsFor(entry.physical.height, entry.physical.unit, dpi),
                ]);
            }
        }
    });

    it('never asks for more pixels than the engine will resize to', () => {
        for (const entry of APPLICATION_PRESETS) {
            const requirement = applicationPresetToRequirement(entry, { dpi: 600 });
            expect(requirement.width, entry.id).toBeLessThanOrEqual(MAX_DIMENSION);
            expect(requirement.height, entry.id).toBeLessThanOrEqual(MAX_DIMENSION);
        }
    });

    it('always crops to fill, because a passport frame is a shape and not a fit', () => {
        for (const entry of APPLICATION_PRESETS) {
            expect(applicationPresetToRequirement(entry).geometry, entry.id).toBe('cover');
        }
    });

    it.each([['an unknown preset', null], ['a string', 'us-passport-print'], ['nothing', undefined]])(
        'returns null for %s',
        (_label, value) => {
            expect(applicationPresetToRequirement(value)).toBeNull();
        },
    );
});

/* ------------------------------------------------------------------ *
 * validateApplicationPresets — every rule fires
 * ------------------------------------------------------------------ */

describe('validateApplicationPresets', () => {
    it('survives an entry that is not an object at all', () => {
        expect(() => validateApplicationPresets([null])).not.toThrow();
        expect(codes([null])).toContain('app-preset-malformed');
    });

    it('reports the same id declared twice', () => {
        const presets = copy();
        presets.push({ ...presets[0], name: 'UK passport photo again' });
        expect(codes(presets)).toContain('app-preset-id-duplicate');
    });

    /**
     * The rule that separates this registry from the social one: a government
     * number with no citation is a guess, so `null` is refused where
     * lib/catalog/presets.js accepts it.
     */
    it.each([
        ['no source at all', null],
        ['an http url', { ...GOOD_SOURCE, url: 'http://www.gov.uk/photos-for-passports' }],
        ['a bare host', { ...GOOD_SOURCE, url: 'www.gov.uk' }],
        ['no label', { ...GOOD_SOURCE, label: '  ' }],
        ['a verifiedAt that has not happened', { ...GOOD_SOURCE, verifiedAt: '2099-01-01' }],
        ['a verifiedAt that is not a calendar day', { ...GOOD_SOURCE, verifiedAt: 'September 2026' }],
        ['no verifiedAt at all', { label: GOOD_SOURCE.label, url: GOOD_SOURCE.url }],
    ])('reports %s', (_label, source) => {
        expect(codes(withPreset('uk-passport-print', { source }))).toContain('app-preset-source-invalid');
    });

    it('reports a preset with no source key at all', () => {
        const presets = copy();
        const { source: _dropped, ...bare } = presets[1];
        presets[1] = bare;
        expect(codes(presets)).toContain('app-preset-source-invalid');
    });

    it('reports a preset that states neither a physical size nor a pixel minimum', () => {
        expect(codes(withPreset('uk-passport-print', { physical: null, digital: null })))
            .toContain('app-preset-dimensions-invalid');
    });

    it.each([
        ['zero', { width: 0, height: 45, unit: 'mm', widthMm: 0, heightMm: 45, statedAs: 'x' }],
        ['negative', { width: 35, height: -45, unit: 'mm', widthMm: 35, heightMm: -45, statedAs: 'x' }],
        ['a string', { width: '35', height: 45, unit: 'mm', widthMm: 35, heightMm: 45, statedAs: 'x' }],
    ])('reports a physical side that is %s', (_label, physical) => {
        expect(codes(withPreset('uk-passport-print', { physical }))).toContain('app-preset-dimensions-invalid');
    });

    it.each([
        ['zero', { minWidth: 0, minHeight: 750, maxWidth: null, maxHeight: null }],
        ['fractional', { minWidth: 600.5, minHeight: 750, maxWidth: null, maxHeight: null }],
        ['above the engine’s ceiling', { minWidth: MAX_DIMENSION + 1, minHeight: 750, maxWidth: null, maxHeight: null }],
        ['a maximum below the minimum', { minWidth: 600, minHeight: 750, maxWidth: 400, maxHeight: null }],
    ])('reports a digital minimum that is %s', (_label, digital) => {
        expect(codes(withPreset('uk-passport-digital', { digital, aspect: [4, 5] })))
            .toContain('app-preset-dimensions-invalid');
    });

    it.each([
        ['a unit nobody publishes', 'px'],
        ['an empty unit', ''],
        ['no unit at all', undefined],
    ])('reports %s on a physical size', (_label, unit) => {
        const physical = { ...preset('uk-passport-print').physical, unit };
        expect(codes(withPreset('uk-passport-print', { physical }))).toContain('app-preset-unit-invalid');
    });

    /**
     * The 2-inch trap, as a rule. A preset that says "2 in" and "51 mm" is one
     * of the two wrong, and nothing downstream could tell which.
     */
    it('reports millimetres that are not the stated size converted', () => {
        const physical = { ...preset('us-passport-print').physical, widthMm: 51, heightMm: 51 };
        expect(codes(withPreset('us-passport-print', { physical }))).toContain('app-preset-unit-invalid');
    });

    it('accepts every unit lib/format/physical.js can convert', () => {
        for (const unit of PHYSICAL_UNITS) {
            const size = unit === 'in' ? 2 : unit === 'cm' ? 5.08 : 50.8;
            const physical = { width: size, height: size, unit, widthMm: 50.8, heightMm: 50.8, statedAs: 'x' };
            const problems = validateApplicationPresets(
                withPreset('us-passport-print', { physical, aspect: [1, 1] }),
            );
            expect(problems.map((entry) => entry.code), unit).not.toContain('app-preset-unit-invalid');
        }
    });

    it('reports a declared aspect the physical size contradicts', () => {
        expect(codes(withPreset('uk-passport-print', { aspect: [1, 1] }))).toContain('app-preset-contradiction');
    });

    it('reports a declared aspect the pixel minimums contradict', () => {
        expect(codes(withPreset('uk-passport-digital', { aspect: [1, 1] }))).toContain('app-preset-contradiction');
    });

    it('reports a physical size and a pixel minimum that disagree with each other', () => {
        const patched = withPreset('uk-passport-print', {
            digital: { minWidth: 600, minHeight: 600, maxWidth: null, maxHeight: null },
        });
        expect(codes(patched)).toContain('app-preset-contradiction');
    });

    it.each([
        ['no jurisdiction', { jurisdiction: '' }],
        ['no authority', { authority: '   ' }],
        ['no name', { name: '' }],
        ['a use nobody asked for', { use: 'framed' }],
        ['no formats', { formats: [] }],
        ['a format the engine cannot write', { formats: ['tiff'] }],
        ['an unknown check in enforces', { enforces: ['vibes'] }],
        ['nothing it cannot verify', { cannotVerify: [] }],
        ['notes that are not sentences', { notes: [''] }],
        ['no background', { background: null }],
        ['a background Resizo claims to set', { background: { stated: 'plain white', resizoSets: 'whatever-you-like' } }],
        ['bytes that are not a window', { bytes: { min: 10 * 1024 * 1024, max: 50 * 1024 } }],
        ['a byte figure the compressor would refuse', { bytes: { min: null, max: 1 } }],
        ['no dpi block', { dpi: null }],
        ['a print preset with no default DPI', { dpi: { required: false, default: null } }],
        ['a formatsStated that is not a decision', { formatsStated: 'no' }],
    ])('reports %s', (_label, patch) => {
        expect(codes(withPreset('uk-passport-print', patch))).toContain('app-preset-fields-missing');
    });

    it('names the preset it is complaining about', () => {
        const [problem] = validateApplicationPresets(withPreset('us-passport-print', { authority: '' }));
        expect(problem.subject).toBe('us-passport-print');
        expect(problem.message).toContain('us-passport-print');
    });
});

/* ------------------------------------------------------------------ *
 * staleApplicationPresets — freshness, on an injected clock
 * ------------------------------------------------------------------ */

describe('staleApplicationPresets', () => {
    const dated = (verifiedAt) => [{
        ...structuredClone(preset('uk-passport-print')),
        source: { ...GOOD_SOURCE, verifiedAt },
    }];

    const NOW = new Date('2026-09-10T00:00:00Z');

    it('says nothing about a source read three months ago', () => {
        expect(staleApplicationPresets(dated('2026-06-10'), { now: NOW })).toEqual([]);
    });

    it('warns about a source read seven months ago', () => {
        const [report] = staleApplicationPresets(dated('2026-02-10'), { now: NOW });
        expect(report).toEqual({
            id: 'uk-passport-print',
            verifiedAt: '2026-02-10',
            ageMonths: 7,
            level: 'warn',
        });
    });

    it('fails a source read thirteen months ago', () => {
        const [report] = staleApplicationPresets(dated('2025-08-10'), { now: NOW });
        expect(report.ageMonths).toBe(13);
        expect(report.level).toBe('fail');
    });

    it('turns over from warn to fail exactly at the twelve-month boundary', () => {
        expect(staleApplicationPresets(dated('2025-09-11'), { now: NOW })[0].level).toBe('warn');
        expect(staleApplicationPresets(dated('2025-09-10'), { now: NOW })[0].level).toBe('fail');
    });

    it('turns over from silent to warn exactly at the six-month boundary', () => {
        expect(staleApplicationPresets(dated('2026-03-11'), { now: NOW })).toEqual([]);
        expect(staleApplicationPresets(dated('2026-03-10'), { now: NOW })[0].level).toBe('warn');
    });

    it('takes the thresholds as arguments, so a caller can be stricter', () => {
        expect(staleApplicationPresets(dated('2026-06-10'), { now: NOW, warnAfterMonths: 1, failAfterMonths: 2 }))
            .toEqual([{ id: 'uk-passport-print', verifiedAt: '2026-06-10', ageMonths: 3, level: 'fail' }]);
    });

    it('reports every stale entry, not just the first', () => {
        const presets = copy().map((entry) => ({ ...entry, source: { ...entry.source, verifiedAt: '2024-01-01' } }));
        expect(staleApplicationPresets(presets, { now: NOW }).map((entry) => entry.level))
            .toEqual(presets.map(() => 'fail'));
    });

    /**
     * The freshness policy, applied to the registry as it ships, on the real
     * clock: a source read more than six months ago is printed here as a
     * warning and the suite stays green, so the reminder lands on every run
     * without breaking anyone's build on a calendar date; a source more than
     * twelve months old fails, because a year-old citation of a government
     * page is a claim nobody has checked.
     */
    it('the shipped registry has no source older than a year, and prints any older than six months', () => {
        const report = staleApplicationPresets();
        for (const entry of report.filter((item) => item.level === 'warn')) {
            console.warn(`application preset "${entry.id}" was last verified ${entry.verifiedAt}, ${entry.ageMonths} months ago — re-read its source and update verifiedAt`);
        }
        expect(report.filter((item) => item.level === 'fail')).toEqual([]);
        expect(staleApplicationPresets(APPLICATION_PRESETS, { now: new Date() })).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The build gate
 * ------------------------------------------------------------------ */

describe('the catalog build refuses a bad application preset', () => {
    it('is clean on the shipped registry', () => {
        expect(validateCatalog()).toEqual([]);
    });

    it.each([
        ['a preset with no source', { source: null }, 'app-preset-source-invalid'],
        ['a source dated in the future', { source: { ...GOOD_SOURCE, verifiedAt: '2099-01-01' } }, 'app-preset-source-invalid'],
        ['an aspect the size contradicts', { aspect: [1, 1] }, 'app-preset-contradiction'],
    ])('surfaces %s through validateCatalog', (_label, patch, code) => {
        const problems = validateCatalog({ applicationPresets: withPreset('uk-passport-print', patch) });
        expect(problems.map((entry) => entry.code)).toContain(code);
    });
});
