/**
 * THE PAPER REGISTRY
 *
 * Four sheet sizes, and every millimetre on them is a conversion rather than a
 * number somebody typed. That distinction is the whole point of the file: a
 * 4 × 6 photo sheet is four inches by six, and six inches is 152.4 mm exactly,
 * so a registry that stated "152" beside "6 in" would be a tenth of a
 * millimetre wrong and one pixel out at 300 DPI on every sheet laid out on it.
 * The same lesson lib/catalog/application-presets/ learned from "2 x 2 inches
 * (51 x 51 mm)", applied one file over.
 *
 * So the pins below are of two kinds. The four exact conversions are what the
 * print sheet is laid out from, and they are stated here rather than derived,
 * because a test that re-runs the module's own arithmetic proves only that the
 * arithmetic is repeatable. The validator pins are the other half: a duplicate
 * id and a millimetre figure that contradicts the unit beside it are the two
 * ways this registry can be wrong without anything else in the build noticing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PAPER_SIZES, paperSize } from '@/lib/catalog/paper-sizes';
import { validateCatalog, validatePaperSizes } from '@/lib/catalog/validate';
import { toMillimetres } from '@/lib/format/physical';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SOURCE = fs.readFileSync(path.join(ROOT, 'lib', 'catalog', 'paper-sizes.js'), 'utf8');

/** A paper entry with everything right, which each case below breaks one way. */
const valid = (overrides = {}) => ({
    id: 'test-sheet',
    label: '4 × 6 in',
    width: 4,
    height: 6,
    unit: 'in',
    widthMm: 101.6,
    heightMm: 152.4,
    ...overrides,
});

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

describe('the paper registry', () => {
    it('lists the four sheets a photo print goes on, in the order the select offers them', () => {
        expect(PAPER_SIZES.map((paper) => paper.id)).toEqual(['4x6', '5x7', 'letter', 'a4']);
        expect(PAPER_SIZES.map((paper) => paper.label)).toEqual([
            '4 × 6 in',
            '5 × 7 in',
            'Letter (8.5 × 11 in)',
            'A4 (210 × 297 mm)',
        ]);
    });

    it('keeps every id unique', () => {
        expect(new Set(PAPER_SIZES.map((paper) => paper.id)).size).toBe(PAPER_SIZES.length);
    });

    it('gives every entry a positive size in a unit the conversion knows', () => {
        for (const paper of PAPER_SIZES) {
            expect(paper.width, paper.id).toBeGreaterThan(0);
            expect(paper.height, paper.id).toBeGreaterThan(0);
            expect(['mm', 'cm', 'in'], paper.id).toContain(paper.unit);
        }
    });

    /**
     * The four conversions, stated rather than computed. 6 in is 152.4 mm and
     * 11 in is 279.4 mm, and a build that quietly started saying 152 or 279
     * would lay every sheet out a pixel short.
     */
    it.each([
        ['4x6', 101.6, 152.4],
        ['5x7', 127, 177.8],
        ['letter', 215.9, 279.4],
        ['a4', 210, 297],
    ])('converts %s to %s × %s mm', (id, widthMm, heightMm) => {
        expect(paperSize(id)).toMatchObject({ widthMm, heightMm });
    });

    it('derives both millimetre figures from the unit beside them', () => {
        for (const paper of PAPER_SIZES) {
            expect(paper.widthMm, `${paper.id} width`).toBeCloseTo(toMillimetres(paper.width, paper.unit), 6);
            expect(paper.heightMm, `${paper.id} height`).toBeCloseTo(toMillimetres(paper.height, paper.unit), 6);
        }
    });

    it('is taller than it is wide, so orientation is the layout’s decision and not the registry’s', () => {
        for (const paper of PAPER_SIZES) {
            expect(paper.heightMm, paper.id).toBeGreaterThan(paper.widthMm);
        }
    });
});

describe('paperSize', () => {
    it('finds a sheet by id', () => {
        expect(paperSize('a4')).toMatchObject({ id: 'a4', width: 210, unit: 'mm' });
    });

    it.each([
        ['an unknown id', 'a3'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 4],
        ['an object', {}],
    ])('returns null for %s', (_label, id) => {
        expect(paperSize(id)).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * The leaf rule
 * ------------------------------------------------------------------ */

/**
 * CLAUDE.md rule 6. The print sheet's panel is a client component and reads
 * this list for its paper select, so it imports the module directly. If this
 * file ever reached lib/catalog/index.js, that one import would pull the whole
 * registry — every intent page's copy included — into the page's client chunk.
 */
describe('the module a client component imports', () => {
    it('reads the one conversion helper and nothing else in the catalogue', () => {
        const imports = [...SOURCE.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

        expect(imports).toEqual(['@/lib/format/physical']);
    });
});

/* ------------------------------------------------------------------ *
 * The validator
 * ------------------------------------------------------------------ */

describe('validatePaperSizes', () => {
    it('passes the shipped registry', () => {
        expect(validatePaperSizes()).toEqual([]);
        expect(validateCatalog().filter((problem) => problem.code.startsWith('paper-size-'))).toEqual([]);
    });

    it('refuses a duplicate id', () => {
        const problems = validatePaperSizes([valid(), valid({ label: '5 × 7 in', width: 5, height: 7, widthMm: 127, heightMm: 177.8 })]);

        expect(problems.map((problem) => problem.code)).toContain('paper-size-id-duplicate');
        expect(problems[0].subject).toBe('test-sheet');
    });

    /**
     * The failure this registry exists to prevent: an inch size restated in
     * round millimetres. 6 in is 152.4 mm, not 152, and a page laid out on the
     * shorter figure is a pixel short of the paper it claims to describe.
     */
    it('refuses a millimetre figure that contradicts the unit beside it', () => {
        const problems = validatePaperSizes([valid({ heightMm: 152 })]);

        expect(problems.map((problem) => problem.code)).toContain('paper-size-unit-invalid');
        expect(problems[0].message).toContain('152.4');
    });

    it('refuses a unit no conversion knows', () => {
        const problems = validatePaperSizes([valid({ unit: 'pt' })]);

        expect(problems.map((problem) => problem.code)).toContain('paper-size-unit-invalid');
    });

    it.each([
        ['a width of zero', { width: 0 }],
        ['a negative height', { height: -6 }],
        ['a width that is not a number', { width: '4' }],
        ['a millimetre figure of zero', { widthMm: 0 }],
    ])('refuses %s', (_label, overrides) => {
        const problems = validatePaperSizes([valid(overrides)]);

        expect(problems.map((problem) => problem.code)).toContain('paper-size-dimensions-invalid');
    });

    it.each([
        ['no id', { id: '' }],
        ['no label', { label: '   ' }],
    ])('refuses an entry with %s', (_label, overrides) => {
        const problems = validatePaperSizes([valid(overrides)]);

        expect(problems.map((problem) => problem.code)).toContain('paper-size-fields-missing');
    });

    it('refuses something that is not an entry at all', () => {
        expect(validatePaperSizes([null]).map((problem) => problem.code)).toContain('paper-size-malformed');
    });

    it('reaches the catalogue validator, so a broken sheet fails the build', () => {
        const problems = validateCatalog({ paperSizes: [valid({ heightMm: 152 })] });

        expect(problems.map((problem) => problem.code)).toContain('paper-size-unit-invalid');
    });
});
