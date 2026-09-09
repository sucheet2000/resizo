/**
 * THE GUIDE CONTRACT
 *
 * A guide is a page that exists because something was measured, or because an
 * official source says something. It is one entry in lib/catalog/guides/
 * rendered by one shared component, so the shape of the entry IS the page: no
 * answer is a page with no finding, a `modified` before `published` is a date
 * a crawler will stop trusting, an official-requirements page with no source
 * is an unverifiable claim, and a body that reads as another page's is the
 * doorway move that the intent registry is already guarded against.
 *
 * validateGuide() reads one entry and names every field that would render or
 * rank wrong; validateGuides() adds the things only a pair can get wrong. Each
 * rule below is proved by handing in one broken field at a time.
 *
 * The shipped registry is EMPTY on purpose: the first two guides are written
 * from benchmark results that do not exist yet. Everything here therefore runs
 * against tests/helpers/guide-fixture.js, and the last block asserts the empty
 * registry is genuinely valid rather than merely unchecked.
 */
import { describe, expect, it } from 'vitest';

import { GUIDES, getGuide, indexableGuides } from '@/lib/catalog/guides';
import { assertGuidesValid, validateGuide, validateGuides } from '@/lib/catalog/guides/validate';
import { INTENTS } from '@/lib/catalog/intents';
import { GENERIC_COPY_PATTERNS } from '@/lib/catalog/quality';
import { TOOLS } from '@/lib/catalog/tools';
import { AUTHOR_NAME } from '@/lib/seo';
import { validGuide } from '@/tests/helpers/guide-fixture';

const codes = (guide, options) => validateGuide(guide, options).map((problem) => problem.code);

const pairCodes = (guides, options) => validateGuides(guides, options).map((problem) => problem.code);

describe('validateGuide', () => {
    it('accepts a complete entry', () => {
        expect(validateGuide(validGuide())).toEqual([]);
    });

    it.each(['slug', 'title', 'h1', 'description', 'answer', 'author'])(
        'reports a missing or blank %s',
        (field) => {
            expect(codes(validGuide({ [field]: '' }))).toContain(`guide-${field}-missing`);
            expect(codes(validGuide({ [field]: undefined }))).toContain(`guide-${field}-missing`);
        },
    );

    it('reports a slug that is not lower-case words joined by hyphens', () => {
        expect(codes(validGuide({ slug: 'What The Tag Does' }))).toContain('guide-slug-malformed');
        expect(codes(validGuide({ slug: 'guides/nested' }))).toContain('guide-slug-malformed');
    });

    /**
     * The expected byline is injected, not imported: lib/catalog/ may not read
     * lib/seo.js, so the route hands AUTHOR_NAME in and this does the same.
     */
    it('reports an author who is not the one person this site has', () => {
        expect(codes(validGuide({ author: 'A Contributor' }), { author: AUTHOR_NAME }))
            .toContain('guide-author-invalid');
        expect(codes(validGuide(), { author: AUTHOR_NAME })).toEqual([]);
    });

    it('says nothing about the byline when no expected author is handed in', () => {
        expect(codes(validGuide({ author: 'A Contributor' }))).toEqual([]);
    });

    it('reports an answer too short to stand on its own', () => {
        expect(codes(validGuide({ answer: 'It is a tag.' }))).toContain('guide-answer-missing');
    });

    describe('dates', () => {
        it('accepts two ISO dates with modified at or after published', () => {
            expect(codes(validGuide({ published: '2026-09-02', modified: '2026-09-02' }))).toEqual([]);
        });

        it('reports a date that is not a calendar date', () => {
            expect(codes(validGuide({ published: '2 September 2026' }))).toContain('guide-dates-invalid');
            expect(codes(validGuide({ modified: '2026-9-5' }))).toContain('guide-dates-invalid');
            expect(codes(validGuide({ modified: undefined }))).toContain('guide-dates-invalid');
        });

        it('reports a revision that predates the publication', () => {
            expect(codes(validGuide({ published: '2026-09-05', modified: '2026-09-02' })))
                .toContain('guide-dates-invalid');
        });

        it('reports a date that has not happened yet', () => {
            expect(codes(validGuide({ published: '2099-01-01', modified: '2099-01-02' })))
                .toContain('guide-dates-invalid');
        });
    });

    describe('sources', () => {
        it('requires them when the page rests on an official requirement', () => {
            expect(codes(validGuide({ sources: [] }))).toContain('guide-sources-missing');
            expect(codes(validGuide({ sources: undefined }))).toContain('guide-sources-missing');
        });

        it('leaves them optional when the page rests on its own measurement', () => {
            expect(codes(validGuide({ basedOnOfficialRequirements: false, sources: [] }))).toEqual([]);
        });

        it('reports a source that cannot be checked', () => {
            const withSource = (source) => codes(validGuide({ sources: [source] }));
            const good = validGuide().sources[0];

            expect(withSource({ ...good, url: 'http://www.cipa.jp/std/std-sec_e.html' })).toContain('guide-source-invalid');
            expect(withSource({ ...good, url: '/standards' })).toContain('guide-source-invalid');
            expect(withSource({ ...good, label: '' })).toContain('guide-source-invalid');
            expect(withSource({ ...good, verifiedAt: undefined })).toContain('guide-source-invalid');
            expect(withSource({ ...good, verifiedAt: '2099-01-01' })).toContain('guide-source-invalid');
        });

        it('reports a boolean it was not given', () => {
            expect(codes(validGuide({ basedOnOfficialRequirements: 'yes' })))
                .toContain('guide-official-invalid');
        });
    });

    describe('where the reader goes next', () => {
        it('reports a destination the site does not have', () => {
            const related = [{ slug: 'png-to-tiff', nextJob: 'Convert the photo to TIFF on your own device.' }];
            expect(codes(validGuide({ relatedTools: related }))).toContain('guide-related-unknown');
        });

        it('accepts a tool slug and an intent slug', () => {
            const related = [
                { slug: 'compress', nextJob: 'Bring the rotated photo under a form ceiling on your own device.' },
                { slug: 'heic-to-jpg', nextJob: 'Turn the iPhone original into a JPG before you rotate it.' },
            ];
            expect(codes(validGuide({ relatedTools: related }))).toEqual([]);
        });

        it('reports a next job that is not a sentence', () => {
            expect(codes(validGuide({ relatedTools: [{ slug: 'resize', nextJob: 'Resize' }] })))
                .toContain('guide-related-invalid');
            expect(codes(validGuide({ relatedTools: [{ slug: 'resize' }] })))
                .toContain('guide-related-invalid');
            expect(codes(validGuide({ relatedTools: [] }))).toContain('guide-related-invalid');
        });
    });

    describe('the body', () => {
        it('reports fewer than two sections, a section with no blocks and a repeated id', () => {
            const [first, second] = validGuide().sections;
            expect(codes(validGuide({ sections: [first] }))).toContain('guide-sections-invalid');
            expect(codes(validGuide({ sections: [first, { ...second, blocks: [] }] }))).toContain('guide-sections-invalid');
            expect(codes(validGuide({ sections: [first, { ...second, id: first.id }] }))).toContain('guide-section-id-duplicate');
        });

        it('reports a block it cannot render', () => {
            const [first, second] = validGuide().sections;
            const withBlock = (block) => codes(validGuide({ sections: [{ ...first, blocks: [block] }, second] }));

            expect(withBlock({ type: 'p', text: '' })).toContain('guide-block-invalid');
            expect(withBlock({ type: 'ul', items: [] })).toContain('guide-block-invalid');
            expect(withBlock({ type: 'html', text: '<b>no</b>' })).toContain('guide-block-invalid');
            expect(withBlock({
                type: 'table',
                caption: 'x',
                columns: [{ key: 'a', label: 'A' }],
                rows: [{ a: '1' }],
            })).toContain('guide-block-invalid');
        });

        it('reports a link with no label or an unusable target', () => {
            const [first, second] = validGuide().sections;
            const block = { type: 'p', text: 'Read [](/resize) and [this](javascript:alert(1)) too.' };
            expect(codes(validGuide({ sections: [{ ...first, blocks: [block] }, second] })))
                .toContain('guide-link-invalid');
        });

        it('reports a methodology that is not a list of blocks', () => {
            expect(codes(validGuide({ methodology: 'We ran the benchmark.' }))).toContain('guide-methodology-invalid');
            expect(codes(validGuide({ methodology: [{ type: 'p', text: '' }] }))).toContain('guide-methodology-invalid');
        });

        it('leaves the methodology optional', () => {
            expect(codes(validGuide({ methodology: undefined }))).toEqual([]);
        });

        it('reports a half-written FAQ but leaves the list optional', () => {
            expect(codes(validGuide({ faqs: [{ question: 'Why?' }] }))).toContain('guide-faqs-invalid');
            expect(codes(validGuide({ faqs: undefined }))).toEqual([]);
        });

        it('reports an indexable flag that is not a boolean', () => {
            expect(codes(validGuide({ indexable: 'yes' }))).toContain('guide-indexable-invalid');
        });
    });

    /**
     * The filler list is lib/catalog/quality.js's, shared with the intent
     * registry rather than copied. The sentences below are drawn from that
     * list on purpose: if a pattern is dropped there, this fails here, and
     * somebody looks at both.
     */
    describe('the content-quality contract', () => {
        it('reads its filler list from the shared content-quality module', () => {
            expect(GENERIC_COPY_PATTERNS.length).toBeGreaterThan(5);
        });

        it.each([
            ["In today's digital world, every photo quietly carries a tag nobody reads.", 'the stock opener'],
            ["Whether you're a photographer or someone who just took a picture, the tag decides.", 'the audience hedge'],
            ['Look no further: the orientation tag is the whole reason the photo is sideways.', 'the filler transition'],
            ['Rotating a photo here is hassle-free and the tag is dropped for you afterwards.', 'the marketing adjective'],
        ])('refuses %j — %s', (answer) => {
            expect(codes(validGuide({ answer }))).toContain('guide-generic-copy');
        });

        it('reads the filler out of the body too, not just the answer', () => {
            const [first, second] = validGuide().sections;
            const block = { type: 'p', text: 'The fix is seamless once the tag is applied.' };

            expect(codes(validGuide({ sections: [{ ...first, blocks: [block] }, second] })))
                .toContain('guide-generic-copy');
        });

        it('leaves a real answer alone', () => {
            expect(codes(validGuide())).toEqual([]);
        });
    });
});

describe('validateGuides', () => {
    it('accepts an empty registry — the first guides are not written yet', () => {
        expect(validateGuides([])).toEqual([]);
    });

    it('reports a registry bylined to two different people', () => {
        const other = validGuide({
            slug: 'a-second-guide',
            title: 'A Second Title | Resizo',
            h1: 'A second headline',
            description: 'A second description, measured on your own device with nothing uploaded.',
            author: 'Somebody Else',
        });

        expect(pairCodes([validGuide(), other])).toContain('guide-author-invalid');
    });

    it('reports two guides that claim one slug', () => {
        const twin = validGuide({ title: 'A Second Title | Resizo', h1: 'A second headline' });
        expect(pairCodes([validGuide(), twin])).toContain('guide-slug-collision');
    });

    it('reports a slug a tool or an intent already answers to', () => {
        expect(pairCodes([validGuide({ slug: 'compress' })])).toContain('guide-slug-collision');
        expect(pairCodes([validGuide({ slug: 'heic-to-jpg' })])).toContain('guide-slug-collision');
    });

    it('reports a slug a route under /guides already owns', () => {
        expect(pairCodes([validGuide({ slug: 'index' })])).toContain('guide-slug-collision');
    });

    it('reports a title an intent or a tool already carries', () => {
        const [intent] = INTENTS;
        const [tool] = TOOLS;

        expect(pairCodes([validGuide({ title: intent.title })])).toContain('guide-title-duplicate');
        expect(pairCodes([validGuide({ title: tool.title })])).toContain('guide-title-duplicate');
    });

    it('reports two guides sharing a title, an h1 or a description', () => {
        const twin = validGuide({ slug: 'a-second-guide' });
        const shared = pairCodes([validGuide(), twin]);

        expect(shared).toContain('guide-title-duplicate');
        expect(shared).toContain('guide-h1-duplicate');
        expect(shared).toContain('guide-description-duplicate');
    });

    it('reports a guide whose body is another guide with the keywords swapped', () => {
        const clone = validGuide({
            slug: 'a-second-guide',
            title: 'A Second Title | Resizo',
            h1: 'A second headline',
            description: 'A second description that says the work happens on your own device, nothing uploaded.',
        });

        expect(pairCodes([validGuide(), clone])).toContain('guide-doorway');
    });

    it('reports a guide whose body is an intent page with the keywords swapped', () => {
        const guide = validGuide();
        const twin = { slug: 'an-intent-twin', sections: guide.sections, faqs: guide.faqs };

        expect(pairCodes([guide], { intents: [twin] })).toContain('guide-doorway');
    });

    it('does not accuse two guides that answer different questions', () => {
        const other = validGuide({
            slug: 'a-different-question',
            title: 'A Different Question | Resizo',
            h1: 'A different question',
            description: 'A different finding, measured on your own device with nothing uploaded.',
            answer: 'Compressing a photograph twice does not halve it twice. The second pass throws away '
                + 'detail the first pass already removed, so the file barely moves while the picture keeps '
                + 'getting worse. One pass to the size you actually need is the whole technique.',
            sections: [
                {
                    id: 'one-pass',
                    heading: 'One pass beats two',
                    blocks: [{ type: 'p', text: 'The encoder quantises what it is given. Handing it its own output invites it to quantise the artefacts.' }],
                },
                {
                    id: 'what-to-do',
                    heading: 'What to do instead',
                    blocks: [{ type: 'ul', items: ['Keep the original.', 'Pick the ceiling once.', 'Encode from the original every time.'] }],
                },
            ],
            faqs: undefined,
            methodology: undefined,
        });

        expect(pairCodes([validGuide(), other])).not.toContain('guide-doorway');
    });
});

describe('assertGuidesValid', () => {
    it('says nothing about a valid registry', () => {
        expect(() => assertGuidesValid([])).not.toThrow();
        expect(() => assertGuidesValid([validGuide()])).not.toThrow();
    });

    it('throws with every code and message, so a build failure reads as a fix', () => {
        expect(() => assertGuidesValid([validGuide({ answer: '' })]))
            .toThrow(/guide-answer-missing/);
    });
});

describe('the shipped registry', () => {
    it('lists the two guides written from the first benchmark run, in registry order', () => {
        expect(GUIDES.map((guide) => guide.slug)).toEqual([
            'large-photo-to-20-kb',
            'jpeg-vs-webp-at-the-same-size',
        ]);
    });

    it('is valid, which is the assertion an empty list still has to pass', () => {
        expect(validateGuides(GUIDES)).toEqual([]);
    });

    it('gives every entry a path derived from its slug, never stored twice', () => {
        for (const guide of GUIDES) {
            expect(guide.path).toBe(`/guides/${guide.slug}`);
        }
    });

    it('looks an entry up by slug and refuses one it does not have', () => {
        expect(getGuide('what-the-orientation-tag-does')).toBeNull();
        expect(getGuide(undefined)).toBeNull();
    });

    it('separates the indexable entries, which is what the index page and the sitemap list', () => {
        expect(indexableGuides().map((guide) => guide.slug)).toEqual(GUIDES.map((guide) => guide.slug));
        for (const guide of GUIDES) expect(guide.indexable).toBe(true);
    });
});
