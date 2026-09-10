/**
 * THE PLATFORM SIZES, AND WHERE THEY CAME FROM
 *
 * A chip that says "Instagram portrait 1080×1350" is a factual claim about
 * somebody else's product, and it was wrong: Instagram's own help page moved
 * the tallest supported feed photo from 4:5 to 3:4 and nothing here noticed,
 * because nothing here recorded which page the number came from in the first
 * place.
 *
 * So every preset now carries either a `source` — the platform's own help page
 * and the day a human read it — or an explicit `null` that says "this is a
 * convention, not a rule". `null` is a legitimate answer and most of the
 * registry uses it; what is not legitimate is a number with no decision
 * attached, which is why an absent `source` key is a failure here rather than
 * a shrug.
 *
 * `validatePresets` is the gate and `describePreset` is the sentence a visitor
 * reads. Both are asserted against the shipped registry AND against deliberately
 * broken copies of it, because a validator that has never rejected anything is
 * indistinguishable from one that returns [] unconditionally.
 */
import { describe, expect, it } from 'vitest';

import { SOCIAL_PRESETS, describePreset, hasVerifiedSource, validatePresets } from '@/lib/catalog/presets';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A citation is only worth something if it is the platform talking about
 * itself. A tool blog restating Instagram's numbers is the exact thing this
 * registry exists to stop repeating, so the host is pinned per platform rather
 * than merely required to be https.
 *
 * Meta serves the Instagram help articles from facebook.com/help/instagram/…
 * as well, but the link a visitor should click is the one on Instagram's own
 * domain, so that is the only host allowed for the Instagram group.
 */
const ALLOWED_HOSTS = {
    Instagram: ['help.instagram.com'],
    YouTube: ['support.google.com'],
    LinkedIn: ['www.linkedin.com'],
    X: ['help.x.com'],
    Facebook: ['www.facebook.com'],
    WhatsApp: ['faq.whatsapp.com'],
    Discord: ['support.discord.com'],
    Pinterest: ['help.pinterest.com'],
};

const GOOD_SOURCE = {
    label: 'Instagram Help Center',
    url: 'https://help.instagram.com/1631821640426723',
    verifiedAt: '2026-09-10',
};

/** A mutable copy, so a test can break one entry without breaking the module. */
const copy = () => SOCIAL_PRESETS.map((preset) => ({ ...preset }));

const codes = (presets) => validatePresets(presets).map((problem) => problem.code);

const withFirst = (patch) => {
    const presets = copy();
    presets[0] = { ...presets[0], ...patch };
    return presets;
};

describe('validatePresets', () => {
    it('finds nothing wrong with the shipped registry', () => {
        expect(validatePresets()).toEqual([]);
        expect(validatePresets(SOCIAL_PRESETS)).toEqual([]);
    });

    it('reports a verifiedAt date that has not happened yet', () => {
        expect(codes(withFirst({ source: { ...GOOD_SOURCE, verifiedAt: '2099-01-01' } })))
            .toContain('preset-source-invalid');
    });

    it.each([
        ['an http url', { url: 'http://help.instagram.com/1631821640426723' }],
        ['a bare host', { url: 'help.instagram.com' }],
        ['a relative path', { url: '/instagram' }],
    ])('reports %s on a source', (_label, patch) => {
        expect(codes(withFirst({ source: { ...GOOD_SOURCE, ...patch } })))
            .toContain('preset-source-invalid');
    });

    it.each([
        ['no label', { label: '' }],
        ['a whitespace label', { label: '   ' }],
        ['no verifiedAt at all', { verifiedAt: undefined }],
        ['a verifiedAt that is not a calendar day', { verifiedAt: 'September 2026' }],
    ])('reports a source with %s', (_label, patch) => {
        expect(codes(withFirst({ source: { ...GOOD_SOURCE, ...patch } })))
            .toContain('preset-source-invalid');
    });

    // The absent key is the interesting case: `source: null` is a decision,
    // a missing `source` is an entry nobody checked.
    it('reports a preset that never decided whether it has a source', () => {
        const presets = copy();
        const { source: _dropped, ...bare } = presets[0];
        presets[0] = bare;
        expect(codes(presets)).toContain('preset-source-invalid');
    });

    it('accepts an explicit null', () => {
        expect(codes(withFirst({ source: null }))).toEqual([]);
    });

    it('reports the same id declared twice', () => {
        const presets = copy();
        presets.push({ ...presets[0], label: 'Instagram post again' });
        expect(codes(presets)).toContain('preset-id-duplicate');
    });

    it.each([
        ['zero', { width: 0 }],
        ['negative', { height: -1080 }],
        ['fractional', { width: 1080.5 }],
        ['a string', { height: '1350' }],
        ['missing', { width: undefined }],
    ])('reports a dimension that is %s', (_label, patch) => {
        expect(codes(withFirst(patch))).toContain('preset-dimension-invalid');
    });

    it('names the preset it is complaining about', () => {
        const [problem] = validatePresets(withFirst({ width: 0 }));
        expect(problem.subject).toBe(SOCIAL_PRESETS[0].id);
        expect(problem.message).toContain(SOCIAL_PRESETS[0].id);
    });

    it('survives an entry that is not an object at all', () => {
        expect(() => validatePresets([null])).not.toThrow();
        expect(validatePresets([null]).length).toBeGreaterThan(0);
    });
});

describe('describePreset', () => {
    it('credits the platform and the day the page was read', () => {
        expect(describePreset({ source: GOOD_SOURCE }))
            .toBe('Stated by Instagram Help Center, checked September 10, 2026');
    });

    it.each([
        ['an explicit null', { source: null }],
        ['a preset with no source key', {}],
        ['nothing at all', null],
    ])('calls %s a convention rather than a rule', (_label, preset) => {
        expect(describePreset(preset)).toBe('Common export size, not a platform rule');
    });

    it('never claims a rule the platform did not state', () => {
        for (const preset of SOCIAL_PRESETS) {
            const hint = describePreset(preset);
            if (preset.source) expect(hint).toContain(preset.source.label);
            else expect(hint).toBe('Common export size, not a platform rule');
        }
    });
});

describe('the shipped sources', () => {
    const sourced = SOCIAL_PRESETS.filter((preset) => preset.source);

    it('cites at least one first-party page', () => {
        expect(sourced.length).toBeGreaterThan(0);
    });

    it('gives every preset a source or an explicit null, never an absent key', () => {
        for (const preset of SOCIAL_PRESETS) {
            expect(Object.hasOwn(preset, 'source'), `${preset.id} never decided`).toBe(true);
        }
    });

    it('points every source at the platform’s own domain, over https', () => {
        for (const preset of sourced) {
            const url = new URL(preset.source.url);
            expect(url.protocol, `${preset.id} is not https`).toBe('https:');
            expect(ALLOWED_HOSTS[preset.group], `${preset.group} has no allowed hosts`).toBeTruthy();
            expect(
                ALLOWED_HOSTS[preset.group],
                `${preset.id} cites ${url.host}, which is not ${preset.group}'s own site`,
            ).toContain(url.host);
        }
    });

    it('dates every source with a calendar day that has already passed', () => {
        const today = new Date().toISOString().slice(0, 10);
        for (const preset of sourced) {
            expect(preset.source.verifiedAt, `${preset.id}`).toMatch(ISO_DATE);
            expect(preset.source.verifiedAt <= today, `${preset.id} is dated in the future`).toBe(true);
        }
    });

    it('labels every source with something a reader can recognise', () => {
        for (const preset of sourced) {
            expect(preset.source.label.trim().length).toBeGreaterThan(3);
        }
    });
});

describe('the catalog build refuses a bad citation', () => {
    it('surfaces a preset source problem through validateCatalog', async () => {
        const { validateCatalog } = await import('@/lib/catalog/validate');
        const { SOCIAL_PRESETS: shipped } = await import('@/lib/catalog/presets');
        const bad = shipped.map((preset, index) => (index === 0
            ? { ...preset, source: { label: 'x', url: 'http://example.com', verifiedAt: '2099-01-01' } }
            : preset));
        const codes = validateCatalog({ presets: bad }).map((problem) => problem.code);
        expect(codes).toContain('preset-source-invalid');
        expect(validateCatalog({ presets: shipped }).filter((problem) => problem.code.startsWith('preset-'))).toEqual([]);
    });
});

describe('hasVerifiedSource', () => {
    /**
     * The one predicate every caller shares: the resize page's sources
     * section and describePreset must never disagree about which chips are
     * platform-stated, so both ask this and neither tests truthiness itself.
     */
    it('is true for a shipped source and false for an explicit null', () => {
        const sourced = SOCIAL_PRESETS.find((preset) => preset.source);
        const bare = SOCIAL_PRESETS.find((preset) => preset.source === null);
        expect(hasVerifiedSource(sourced)).toBe(true);
        expect(hasVerifiedSource(bare)).toBe(false);
    });

    it('is false for a source with a day that has not happened yet, exactly as describePreset treats it', () => {
        const sourced = SOCIAL_PRESETS.find((preset) => preset.source);
        const future = { ...sourced, source: { ...sourced.source, verifiedAt: '2999-01-01' } };
        expect(hasVerifiedSource(future)).toBe(false);
        expect(describePreset(future)).toBe('Common export size, not a platform rule');
    });
});
