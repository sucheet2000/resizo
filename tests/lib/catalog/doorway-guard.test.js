/**
 * THE DOORWAY-PAGE GUARD
 *
 * Ten intent pages preconfiguring four tools earn ten URLs only because each
 * one says something the others do not. The cheap way to grow that number is
 * the way that gets a site penalised: copy a page, change "100 KB" to "50 KB"
 * or "JPG" to "PNG", and call it a new intent. Nothing in the contract check
 * can see that — every field is present and well-formed — so this guard
 * compares pages to each other with the numbers, the format names AND the
 * platform names masked out, and fails the build on a pair that is the same
 * page twice.
 *
 * Platforms are masked for the same reason numbers are. "Resize a photo for
 * Instagram" and "Resize a photo for TikTok" are the identical page whenever the
 * only word that moves is the one repeated on every line, and that swap is
 * cheaper to make than the number swap.
 *
 * The threshold is set from evidence, not taste: measured on the shipped
 * registry, the closest real pair (the 100 KB and 200 KB compress pages)
 * scores 0.092 and a number-swapped clone scores 1.000. 0.35 sits well clear
 * of one and far below the other, and the margin itself is asserted below so
 * a later edit cannot quietly erode it.
 */
import { describe, expect, it } from 'vitest';

import { INTENTS, getIntent } from '@/lib/catalog';
import { bodySimilarity, maskCopy } from '@/lib/catalog/similarity';
import { TOOLS } from '@/lib/catalog/tools';
import { DOORWAY_SIMILARITY, SLUG_FAMILY_CAP, validateIntents } from '@/lib/catalog/validate';
import { validIntent } from '@/tests/helpers/intent-fixture';

const codes = (intents) => validateIntents(intents, { tools: TOOLS }).map((problem) => problem.code);

/** A deep copy of an entry with every number and keyword swapped — the doorway move. */
function clone(intent, { slug, replacements }) {
    const swap = (value) => {
        if (typeof value !== 'string') return value;
        return replacements.reduce((text, [from, to]) => text.split(from).join(to), value);
    };
    const walk = (value) => {
        if (Array.isArray(value)) return value.map(walk);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]));
        }
        return swap(value);
    };
    return { ...walk(intent), slug, path: `/${slug}` };
}

describe('maskCopy', () => {
    it('folds numbers, units and format names so a keyword swap reads as the same text', () => {
        expect(maskCopy('Compress a JPG to 100 KB, or 51,200 bytes, on a 4000-pixel photo'))
            .toBe(maskCopy('Compress a PNG to 50 KB, or 102,400 bytes, on a 1200-pixel photo'));
    });

    it('folds platform and product names, so a "for Instagram" swap reads as the same text', () => {
        expect(maskCopy('A photo cropped for Instagram, taken on an iPhone and edited in Photoshop'))
            .toBe(maskCopy('A photo cropped for TikTok, taken on an Android and edited in Canva'));
    });

    it('keeps the words that carry meaning', () => {
        expect(maskCopy('Transparency survives the resize')).toContain('transparency survives the resize');
        expect(maskCopy('JPEG has no alpha channel')).not.toContain('jpeg');
    });
});

describe('bodySimilarity', () => {
    it('scores an entry against itself as 1 and against unrelated copy as near 0', () => {
        const intent = getIntent('compress-image-to-100kb');
        expect(bodySimilarity(intent, intent)).toBe(1);
        expect(bodySimilarity(intent, getIntent('heic-to-jpg'))).toBeLessThan(0.1);
    });

    it('scores a platform-swapped clone as identical', () => {
        const platform = (name, device) => validIntent({
            sections: [
                {
                    id: 'why',
                    heading: 'Why the ceiling',
                    blocks: [{
                        type: 'p',
                        text: `A picture headed for ${name} is measured by ${name} before anybody looks at it, and a `
                            + `${device} writes a file far larger than the ${name} upload field will take.`,
                    }],
                },
                { id: 'b', heading: 'B', blocks: [{ type: 'p', text: 'The rest of the page is identical on purpose.' }] },
            ],
        });

        // Identical but for the two names, which is the whole doorway move: the
        // score is 1 only because maskCopy folds them.
        expect(bodySimilarity(platform('Instagram', 'iPhone'), platform('TikTok', 'Android'))).toBe(1);
    });

    it('scores a number-swapped clone as identical', () => {
        const original = getIntent('compress-image-to-100kb');
        const copy = clone(original, {
            slug: 'compress-image-to-50kb',
            replacements: [['100 KB', '50 KB'], ['100KB', '50KB'], ['102,400', '51,200']],
        });
        expect(bodySimilarity(original, copy)).toBe(1);
    });
});

describe('the guard', () => {
    it('sets the threshold from the measurement, with the margin pinned', () => {
        expect(DOORWAY_SIMILARITY).toBe(0.35);

        let closest = 0;
        for (let i = 0; i < INTENTS.length; i += 1) {
            for (let j = i + 1; j < INTENTS.length; j += 1) {
                closest = Math.max(closest, bodySimilarity(INTENTS[i], INTENTS[j]));
            }
        }
        expect(closest, 'the closest shipped pair must stay well under half the threshold').toBeLessThan(DOORWAY_SIMILARITY / 2);
        // Measured 0.092 with the platform mask in place. This second bound is
        // the early warning: two pages converging shows up here long before
        // they reach the threshold that fails the build.
        expect(closest, 'two shipped pages have converged — rewrite one, do not raise the limit').toBeLessThan(0.15);
    });

    it('passes the shipped registry', () => {
        expect(codes(INTENTS)).toEqual([]);
    });

    it('catches a page that only changes 100 KB to 50 KB', () => {
        const original = getIntent('compress-image-to-100kb');
        const copy = clone(original, {
            slug: 'compress-image-to-50kb',
            replacements: [['100 KB', '50 KB'], ['100KB', '50KB'], ['102,400', '51,200'], ['100 kb', '50 kb']],
        });
        copy.preset = { targetKb: 50 };

        const found = validateIntents([...INTENTS, copy], { tools: TOOLS });
        expect(found.map((problem) => problem.code)).toContain('intent-content-duplicate');
        expect(found.find((problem) => problem.code === 'intent-content-duplicate').subject).toContain('compress-image-to-50kb');
    });

    it('catches a page that only swaps the format name', () => {
        const original = getIntent('png-to-webp');
        const copy = clone(original, {
            slug: 'jpg-to-webp-again',
            replacements: [['PNG', 'JPG'], ['png', 'jpeg'], ['a PNG', 'a JPG']],
        });
        copy.preset = { from: 'jpeg', to: 'webp' };
        copy.title = 'A different title so only the body is compared | Resizo';
        copy.h1 = 'A different h1';
        copy.description = 'A different description, on your own device.';
        copy.answer = 'A different answer. On Resizo it is still different, on your own device.';

        expect(codes([...INTENTS, copy])).toContain('intent-content-duplicate');
    });

    it('lets two genuinely different pages about the same tool stand', () => {
        expect(bodySimilarity(getIntent('resize-jpg'), getIntent('resize-png'))).toBeLessThan(DOORWAY_SIMILARITY);
        expect(bodySimilarity(getIntent('compress-image-to-100kb'), getIntent('compress-image-to-200kb'))).toBeLessThan(DOORWAY_SIMILARITY);
    });

    it('catches two intents of one tool that preconfigure it identically', () => {
        const twin = validIntent({
            slug: 'compress-image-to-100kb-twin',
            path: '/compress-image-to-100kb-twin',
            preset: { targetKb: 100 },
            title: 'Twin | Resizo',
            h1: 'Twin',
            description: 'Twin description, on your own device.',
            answer: 'Twin answer. On Resizo it differs, on your own device.',
        });

        const found = validateIntents([...INTENTS, twin], { tools: TOOLS });
        const problem = found.find((entry) => entry.code === 'intent-preset-duplicate');
        expect(problem).toBeTruthy();
        expect(problem.subject).toContain('compress-image-to-100kb');
        expect(problem.subject).toContain('compress-image-to-100kb-twin');
    });

    it('catches a paragraph pasted verbatim from one page into another', () => {
        const donor = getIntent('resize-jpg');
        const pasted = donor.sections[0].blocks[0].text;
        const receiver = validIntent({
            slug: 'compress-image-to-50kb',
            path: '/compress-image-to-50kb',
            sections: [
                { id: 'a', heading: 'A', blocks: [{ type: 'p', text: pasted }] },
                { id: 'b', heading: 'B', blocks: [{ type: 'p', text: 'Something else entirely.' }] },
            ],
        });

        expect(codes([...INTENTS, receiver])).toContain('intent-paragraph-duplicate');
    });

    it('lets a short shared sentence pass — the honest facts repeat', () => {
        const receiver = validIntent({
            slug: 'compress-image-to-50kb',
            path: '/compress-image-to-50kb',
            sections: [
                { id: 'a', heading: 'A', blocks: [{ type: 'p', text: 'JPEG, PNG and WebP.' }] },
                { id: 'b', heading: 'B', blocks: [{ type: 'p', text: 'Something else entirely.' }] },
            ],
        });

        expect(codes([...INTENTS, receiver])).not.toContain('intent-paragraph-duplicate');
    });

    it('refuses a family of slugs that differ only by a number once it outgrows the cap', () => {
        // The four ceilings forms ask for — 20, 50, 100 and 200 KB — and no more.
        expect(SLUG_FAMILY_CAP).toBe(4);

        const family = [30, 40, 300].map((kb) => validIntent({
            slug: `compress-image-to-${kb}kb`,
            path: `/compress-image-to-${kb}kb`,
            preset: { targetKb: kb },
            title: `Compress to ${kb} | Resizo`,
            h1: `Compress an Image to ${kb} KB`,
            description: `Compress to ${kb} KB, on your own device.`,
            answer: `An answer about ${kb}. On Resizo it differs, on your own device.`,
        }));

        // Whatever ships, the cap is what stops the family growing past it: the
        // shipped members plus enough extra numbers to exceed four fails, and
        // the same registry with the extras removed does not.
        const shipped = INTENTS.filter((intent) => /^compress-image-to-\d+kb$/.test(intent.slug)).length;
        const extras = family.slice(0, Math.max(0, SLUG_FAMILY_CAP + 1 - shipped));
        expect(extras.length).toBeGreaterThan(0);
        expect(codes([...INTENTS, ...extras.slice(0, -1)])).not.toContain('intent-numeric-family');
        const found = validateIntents([...INTENTS, ...extras], { tools: TOOLS });
        const problem = found.find((entry) => entry.code === 'intent-numeric-family');
        expect(problem).toBeTruthy();
        expect(problem.message).toContain('compress-image-to-#kb');
    });
});
