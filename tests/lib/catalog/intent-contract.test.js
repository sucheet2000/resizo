/**
 * THE INTENT CONTRACT
 *
 * An intent page is one entry in lib/catalog/intents/ rendered by one shared
 * component, so the shape of that entry IS the page: a missing h1 is a page
 * with no headline, a step with no text is a HowTo that lies, a preset the
 * tool cannot honour is a chip that does nothing. validateIntent() reads an
 * entry and names every field that would render wrong, and the suite below
 * hands it one broken field at a time to prove each rule fires.
 */
import { describe, expect, it } from 'vitest';

import { intentCopy } from '@/lib/catalog/copy';
import { TOOLS } from '@/lib/catalog/tools';
import { INTENT_KINDS, validateIntent, validateIntents } from '@/lib/catalog/validate';
import { validIntent } from '@/tests/helpers/intent-fixture';

const codes = (intent, tools = TOOLS) => validateIntent(intent, { tools }).map((problem) => problem.code);

describe('validateIntent', () => {
    it('accepts a complete entry', () => {
        expect(validateIntent(validIntent(), { tools: TOOLS })).toEqual([]);
    });

    it('lists the kinds an intent may declare', () => {
        expect(INTENT_KINDS).toEqual(['format', 'conversion', 'target', 'standard']);
    });

    it.each([
        'slug', 'tool', 'kind', 'label', 'blurb', 'title', 'h1', 'intro', 'description', 'ogImage', 'answer', 'lastModified',
    ])('reports a missing or blank %s', (field) => {
        expect(codes(validIntent({ [field]: '' }))).toContain(`intent-${field}-missing`);
        expect(codes(validIntent({ [field]: undefined }))).toContain(`intent-${field}-missing`);
    });

    it('reports a kind it does not know', () => {
        expect(codes(validIntent({ kind: 'keyword' }))).toContain('intent-kind-unknown');
    });

    it('reports a tool that cannot host an intent', () => {
        expect(codes(validIntent({ tool: 'crop', preset: null }))).toContain('intent-tool-unsupported');
        expect(codes(validIntent({ tool: 'nowhere', preset: null }))).toContain('intent-tool-unsupported');
    });

    describe('presets, per tool', () => {
        it('accepts a compress target inside the byte bounds and rejects one outside', () => {
            expect(codes(validIntent({ preset: { targetKb: 10 } }))).toEqual([]);
            expect(codes(validIntent({ preset: { targetKb: 9 } }))).toContain('intent-preset-invalid');
            expect(codes(validIntent({ preset: { targetKb: 20481 } }))).toContain('intent-preset-invalid');
            expect(codes(validIntent({ preset: { targetKb: '100' } }))).toContain('intent-preset-invalid');
            expect(codes(validIntent({ preset: { targetKb: 100, extra: true } }))).toContain('intent-preset-invalid');
        });

        it('accepts a compress policy of keep or fit, and nothing else', () => {
            expect(codes(validIntent({ preset: { targetKb: 20, policy: 'fit' } }))).toEqual([]);
            expect(codes(validIntent({ preset: { targetKb: 20, policy: 'keep' } }))).toEqual([]);
            expect(codes(validIntent({ preset: { targetKb: 20, policy: 'shrink' } }))).toContain('intent-preset-invalid');
            expect(codes(validIntent({ preset: { policy: 'fit' } }))).toContain('intent-preset-invalid');
        });

        it('lets a HEIC intent ask for PNG, which is the one output that is not the default', () => {
            const heic = (preset) => codes(validIntent({ tool: 'heic', kind: 'conversion', preset }));
            expect(heic({ format: 'png' })).toEqual([]);
            expect(heic({ format: 'jpeg' })).toContain('intent-preset-invalid');
            expect(heic({ format: 'webp' })).toContain('intent-preset-invalid');
            expect(heic({ format: 'png', extra: 1 })).toContain('intent-preset-invalid');
        });

        it('accepts a convert pair of two different registry formats and rejects anything else', () => {
            const convert = (preset) => codes(validIntent({ tool: 'convert', kind: 'conversion', preset }));
            expect(convert({ from: 'png', to: 'jpeg' })).toEqual([]);
            expect(convert({ from: 'png', to: 'png' })).toContain('intent-preset-invalid');
            expect(convert({ from: 'avif', to: 'jpeg' })).toContain('intent-preset-invalid');
            expect(convert({ from: 'png' })).toContain('intent-preset-invalid');
            expect(convert(null)).toContain('intent-preset-invalid');
        });

        it('lets a resize or HEIC intent carry no preset', () => {
            expect(codes(validIntent({ tool: 'resize', kind: 'format', preset: null }))).toEqual([]);
            expect(codes(validIntent({ tool: 'heic', kind: 'conversion', preset: null }))).toEqual([]);
            expect(codes(validIntent({ tool: 'resize', kind: 'format', preset: { width: 800 } }))).toContain('intent-preset-invalid');
        });
    });

    it('reports an application block with no name or no feature', () => {
        expect(codes(validIntent({ application: { name: '', features: ['x'] } }))).toContain('intent-application-invalid');
        expect(codes(validIntent({ application: { name: 'X', features: [] } }))).toContain('intent-application-invalid');
        expect(codes(validIntent({ application: undefined }))).toContain('intent-application-invalid');
    });

    it('reports a procedure with fewer than three steps, a half-written step or no anchor', () => {
        const howTo = validIntent().howTo;
        expect(codes(validIntent({ howTo: { ...howTo, steps: howTo.steps.slice(0, 2) } }))).toContain('intent-howto-invalid');
        expect(codes(validIntent({ howTo: { ...howTo, steps: [...howTo.steps, { name: 'Orphan' }] } }))).toContain('intent-howto-invalid');
        expect(codes(validIntent({ howTo: { ...howTo, id: 'How To' } }))).toContain('intent-howto-invalid');
        expect(codes(validIntent({ howTo: { ...howTo, heading: '' } }))).toContain('intent-howto-invalid');
    });

    it('reports fewer than two sections, a section with no blocks, and a repeated section id', () => {
        const [first, second] = validIntent().sections;
        expect(codes(validIntent({ sections: [first] }))).toContain('intent-sections-invalid');
        expect(codes(validIntent({ sections: [first, { ...second, blocks: [] }] }))).toContain('intent-sections-invalid');
        expect(codes(validIntent({ sections: [first, { ...second, id: first.id }] }))).toContain('intent-section-id-duplicate');
    });

    it('reports a block it cannot render', () => {
        const [first, second] = validIntent().sections;
        const withBlock = (block) => codes(validIntent({ sections: [{ ...first, blocks: [block] }, second] }));

        expect(withBlock({ type: 'p', text: '' })).toContain('intent-block-invalid');
        expect(withBlock({ type: 'ul', items: [] })).toContain('intent-block-invalid');
        expect(withBlock({ type: 'ul', items: ['ok', ''] })).toContain('intent-block-invalid');
        expect(withBlock({ type: 'html', text: '<b>no</b>' })).toContain('intent-block-invalid');
        expect(withBlock({ type: 'table', caption: 'x', columns: [{ key: 'a', label: 'A' }], rows: [{ a: '1' }] })).toContain('intent-block-invalid');
        expect(withBlock({
            type: 'table',
            caption: 'x',
            columns: [{ key: 'a', label: 'A', rowHeader: true }, { key: 'b', label: 'B', rowHeader: true }],
            rows: [{ a: '1', b: '2' }],
        })).toContain('intent-block-invalid');
        expect(withBlock({
            type: 'table',
            caption: 'x',
            columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
            rows: [{ a: '1' }],
        })).toContain('intent-block-invalid');
    });

    /**
     * A FIGURE IS THE ONE BLOCK THAT CAN BE WRONG WITHOUT LOOKING WRONG.
     *
     * A paragraph with no text renders as nothing and somebody notices. A
     * figure with no width renders, and reflows the page under the reader as
     * each picture arrives; one with alt text reading "after" renders, and says
     * nothing at all to a screen reader or to a crawler; one pointing at an
     * off-site URL renders until the day it does not. None of those is visible
     * to the person who wrote the entry, so each is a refusal here.
     */
    it('accepts a demonstration figure, as a pair or on its own', () => {
        const [first, second] = validIntent().sections;
        const withBlock = (block) => codes(validIntent({ sections: [{ ...first, blocks: [block] }, second] }));

        const before = { src: '/demos/logo-source.png', alt: 'A blue logo on a transparent chequerboard.', width: 480, height: 320 };
        const after = { src: '/demos/logo-flattened.jpg', alt: 'The same logo on a solid white background.', width: 480, height: 320 };
        const caption = 'The transparent area becomes the background colour you pick.';

        expect(withBlock({ type: 'figure', before, after, caption })).toEqual([]);
        expect(withBlock({ type: 'figure', image: before, caption })).toEqual([]);
    });

    /**
     * The caption and the alt text are the whole of a figure for anyone not
     * looking at it, so they are copy: the doorway guard, the truthfulness
     * tests and the banned-phrase scan all read a page through intentCopy, and
     * a block kind missing from that walk is copy nothing checks.
     */
    it('puts a figure’s caption and alt text into the copy walk', () => {
        const [first, second] = validIntent().sections;
        const before = { src: '/demos/logo-source.png', alt: 'A blue logo on a transparent chequerboard.', width: 480, height: 320 };
        const after = { src: '/demos/logo-flattened.jpg', alt: 'The same logo on a solid white background.', width: 480, height: 320 };
        const caption = 'The transparent area becomes the background colour you pick.';

        const copy = intentCopy(validIntent({
            sections: [{ ...first, blocks: [{ type: 'figure', before, after, caption }] }, second],
        }));

        expect(copy).toContain(caption);
        expect(copy).toContain(before.alt);
        expect(copy).toContain(after.alt);
    });

    it('reports a figure that would render wrong', () => {
        const [first, second] = validIntent().sections;
        const withBlock = (block) => codes(validIntent({ sections: [{ ...first, blocks: [block] }, second] }));

        const before = { src: '/demos/logo-source.png', alt: 'A blue logo on a transparent chequerboard.', width: 480, height: 320 };
        const after = { src: '/demos/logo-flattened.jpg', alt: 'The same logo on a solid white background.', width: 480, height: 320 };
        const caption = 'The transparent area becomes the background colour you pick.';
        const figure = { type: 'figure', before, after, caption };

        // Neither form, or both at once.
        expect(withBlock({ type: 'figure', caption })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, image: before })).toContain('intent-block-invalid');
        // Half a pair.
        expect(withBlock({ type: 'figure', before, caption })).toContain('intent-block-invalid');
        expect(withBlock({ type: 'figure', after, caption })).toContain('intent-block-invalid');
        // A picture this repo does not ship.
        expect(withBlock({ ...figure, after: { ...after, src: 'https://example.org/after.jpg' } })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, after: { ...after, src: '/og-resize.jpg' } })).toContain('intent-block-invalid');
        // Alt text that describes nothing.
        expect(withBlock({ ...figure, after: { ...after, alt: 'After' } })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, before: { ...before, alt: '' } })).toContain('intent-block-invalid');
        // Dimensions next/image cannot reserve space with.
        expect(withBlock({ ...figure, before: { ...before, width: 0 } })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, before: { ...before, height: 320.5 } })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, after: { ...after, width: '480' } })).toContain('intent-block-invalid');
        // The only part of a figure a text-only reader gets.
        expect(withBlock({ ...figure, caption: 'Before and after.' })).toContain('intent-block-invalid');
        expect(withBlock({ ...figure, caption: undefined })).toContain('intent-block-invalid');
    });

    it('reports an inline link with no label, no target, or a target that is not a path', () => {
        const [first, second] = validIntent().sections;
        const withText = (text) => codes(validIntent({ sections: [{ ...first, blocks: [{ type: 'p', text }] }, second] }));

        expect(withText('Fine [link](/resize) here.')).toEqual([]);
        expect(withText('Fine [link](https://example.org/spec) too.')).toEqual([]);
        expect(withText('Bad [](/resize).')).toContain('intent-link-invalid');
        expect(withText('Bad [link]().')).toContain('intent-link-invalid');
        expect(withText('Bad [link](resize).')).toContain('intent-link-invalid');
        expect(withText('Bad [link](javascript:alert(1)).')).toContain('intent-link-invalid');
    });

    it('reports a limitation or FAQ that is not a sentence', () => {
        expect(codes(validIntent({ limitations: [''] }))).toContain('intent-limitations-invalid');
        expect(codes(validIntent({ limitations: 'one' }))).toContain('intent-limitations-invalid');
        const faqs = validIntent().faqs;
        expect(codes(validIntent({ faqs: faqs.slice(0, 2) }))).toContain('intent-faqs-invalid');
        expect(codes(validIntent({ faqs: [...faqs, { question: 'Q' }] }))).toContain('intent-faqs-invalid');
    });

    it('reports a sibling block without a heading', () => {
        expect(codes(validIntent({ siblingLinks: { heading: 'Other targets' } }))).toEqual([]);
        expect(codes(validIntent({ siblingLinks: {} }))).toContain('intent-siblings-invalid');
        expect(codes(validIntent({ siblingLinks: 'yes' }))).toContain('intent-siblings-invalid');
    });

    it('requires a source with a verification date on a page built on an external standard', () => {
        const standard = (sources) => codes(validIntent({ kind: 'standard', sources }));

        expect(standard([])).toContain('intent-sources-required');
        expect(standard(undefined)).toContain('intent-sources-required');
        expect(standard([{ url: 'https://example.org/spec', title: 'The spec', verifiedAt: '2026-09-01' }])).toEqual([]);
        expect(standard([{ url: 'http://example.org/spec', title: 'The spec', verifiedAt: '2026-09-01' }])).toContain('intent-source-invalid');
        expect(standard([{ url: 'https://example.org/spec', title: '', verifiedAt: '2026-09-01' }])).toContain('intent-source-invalid');
        expect(standard([{ url: 'https://example.org/spec', title: 'The spec', verifiedAt: '2099-01-01' }])).toContain('intent-source-invalid');
        expect(standard([{ url: 'https://example.org/spec', title: 'The spec' }])).toContain('intent-source-invalid');
    });

    it('checks a source on any kind of page once one is given', () => {
        expect(codes(validIntent({ sources: [{ url: 'ftp://x', title: 'x', verifiedAt: '2026-09-01' }] }))).toContain('intent-source-invalid');
    });

    it('reports a modified date that is not a calendar date, or is in the future', () => {
        expect(codes(validIntent({ lastModified: '12/08/2026' }))).toContain('intent-lastmodified-invalid');
        expect(codes(validIntent({ lastModified: '2099-01-01' }))).toContain('intent-lastmodified-invalid');
    });

    it('requires indexable to be stated as a boolean', () => {
        expect(codes(validIntent({ indexable: 'yes' }))).toContain('intent-indexable-invalid');
        expect(codes(validIntent({ indexable: undefined }))).toContain('intent-indexable-invalid');
        expect(codes(validIntent({ indexable: false }))).toEqual([]);
    });

    it('requires the OG image to be a site path', () => {
        expect(codes(validIntent({ ogImage: 'og-compress.jpg' }))).toContain('intent-ogimage-invalid');
        expect(codes(validIntent({ ogImage: 'https://elsewhere.example/og.jpg' }))).toContain('intent-ogimage-invalid');
    });

    it('names the intent in every problem', () => {
        for (const problem of validateIntent(validIntent({ h1: '', kind: 'nope' }), { tools: TOOLS })) {
            expect(problem.subject).toBe('compress-image-to-50kb');
            expect(problem.message.length).toBeGreaterThan(10);
        }
    });
});

describe('validateIntents', () => {
    it('reports two intents sharing a title, an h1, a description or an answer', () => {
        const first = validIntent();
        const second = validIntent({ slug: 'compress-image-to-30kb', preset: { targetKb: 30 } });

        const found = validateIntents([first, second], { tools: TOOLS }).map((problem) => problem.code);
        expect(found).toContain('intent-title-duplicate');
        expect(found).toContain('intent-h1-duplicate');
        expect(found).toContain('intent-description-duplicate');
        expect(found).toContain('intent-answer-duplicate');
    });

    it('compares titles case-insensitively', () => {
        const first = validIntent();
        const second = validIntent({
            slug: 'compress-image-to-30kb',
            preset: { targetKb: 30 },
            title: first.title.toUpperCase(),
            h1: 'Other',
            description: 'Other description, on your own device.',
            answer: 'Other answer. On Resizo it differs.',
        });

        const found = validateIntents([first, second], { tools: TOOLS }).map((problem) => problem.code);
        expect(found).toContain('intent-title-duplicate');
        for (const field of ['h1', 'description', 'answer']) expect(found).not.toContain(`intent-${field}-duplicate`);
    });

    it('returns nothing for the shipped registry', async () => {
        const { INTENTS } = await import('@/lib/catalog');
        expect(validateIntents(INTENTS, { tools: TOOLS })).toEqual([]);
    });
});

describe('each shipped entry meets the contract', async () => {
    const { INTENTS } = await import('@/lib/catalog');

    it.each(INTENTS.map((intent) => [intent.slug, intent]))('%s', (_slug, intent) => {
        expect(validateIntent(intent, { tools: TOOLS })).toEqual([]);
    });
});
