/**
 * Internal-link relationships, computed from the registry.
 *
 * Which pages link to which used to be a fact scattered across ten JSX files.
 * It is a function of the data now: the breadcrumb parent, the sibling block,
 * the inline links in the copy and the Related Tools block are all derivable,
 * which is what lets a test say "nothing links to this page" before Google
 * finds that out.
 */
import { describe, expect, it } from 'vitest';

import { INTENTS, TOOLS, getIntent, inboundLinks, intentCopy, intentLinks, relatedTools } from '@/lib/catalog';
import { validIntent } from '@/tests/helpers/intent-fixture';

describe('relatedTools', () => {
    it('excludes the current tool and the tool with no page', () => {
        expect(relatedTools('resize').map((tool) => tool.slug)).toEqual([
            'compress', 'convert', 'crop', 'heic', 'jpg-to-pdf', 'merge-pdf',
        ]);
    });
});

describe('intentCopy', () => {
    it('lists every string the page renders, link markup reduced to its labels', () => {
        const copy = intentCopy(validIntent({ path: '/x' }));

        expect(copy).toContain('Compress an Image to 50 KB');
        expect(copy).toContain('The target is already set to 50 KB.');
        expect(copy).toContain('Why a form stops at 50 KB');
        expect(copy).toContain('A ceiling that low is a database column, not a taste. Resize it first.');
        expect(copy).toContain('Signature scans.');
        expect(copy).toContain('800×600');
        expect(copy).toContain('Will it be exactly 50 KB?');
        expect(copy).toContain('Leave the target where it is');
        expect(copy.join(' ')).not.toContain('](');
    });

    it('keeps the body separate from the headline copy when asked', () => {
        const body = intentCopy(validIntent({ path: '/x' }), { part: 'body' });
        expect(body).not.toContain('Compress an Image to 50 KB');
        expect(body).toContain('A ceiling that low is a database column, not a taste. Resize it first.');
        expect(body).toContain('At or just under.');
    });
});

describe('intentLinks', () => {
    it('lists the parent tool, the inline targets and the related tools of an entry', () => {
        const links = intentLinks(validIntent({ path: '/x' }));

        expect(links).toContain('/compress');
        expect(links).toContain('/resize');
        for (const tool of relatedTools('compress')) expect(links).toContain(tool.href);
        expect(links).not.toContain('/x');
    });

    it('adds the sibling intents only when the entry renders a sibling block', () => {
        const alone = intentLinks(validIntent({ path: '/x', tool: 'convert', kind: 'conversion', preset: { from: 'png', to: 'jpeg' } }));
        expect(alone).not.toContain('/jpg-to-png');

        const withSiblings = intentLinks(validIntent({
            path: '/x',
            tool: 'convert',
            kind: 'conversion',
            preset: { from: 'png', to: 'jpeg' },
            siblingLinks: { heading: 'Other conversions' },
        }));
        expect(withSiblings).toContain('/jpg-to-png');
        expect(withSiblings).toContain('/webp-to-jpg');
    });

    it('drops external targets and fragments, and lists each path once', () => {
        const links = intentLinks(validIntent({
            path: '/x',
            sections: [
                {
                    id: 'a',
                    heading: 'A',
                    blocks: [{ type: 'p', text: 'See [the spec](https://example.org/spec), [bulk](/resize#bulk) and [resize](/resize) or [resize again](/resize).' }],
                },
                { id: 'b', heading: 'B', blocks: [{ type: 'p', text: 'x' }] },
            ],
        }));

        expect(links).not.toContain('https://example.org/spec');
        expect(links.filter((href) => href === '/resize')).toHaveLength(1);
        expect(links).toContain('/resize');
        expect(links).not.toContain('/resize#bulk');
    });
});

describe('inboundLinks', () => {
    it('names every intent whose page links to a path', () => {
        expect(inboundLinks('/compress-image-to-200kb')).toContain('compress-image-to-100kb');
        expect(inboundLinks('/resize-png')).toContain('resize-jpg');
        expect(inboundLinks('/jpg-to-png')).toContain('png-to-jpg');
    });

    it('returns nothing for a path no intent links to', () => {
        expect(inboundLinks('/nowhere')).toEqual([]);
    });

    it('never counts a page as linking to itself', () => {
        for (const intent of INTENTS) {
            expect(inboundLinks(intent.path)).not.toContain(intent.slug);
        }
    });

    it('sees every tool page linked from every intent through the Related Tools block', () => {
        for (const tool of TOOLS.filter((entry) => entry.hasOwnPage)) {
            const from = inboundLinks(tool.href);
            const expected = INTENTS.filter((intent) => intent.tool !== tool.slug || getIntent(intent.slug).tool === tool.slug);
            expect(from.length).toBeGreaterThanOrEqual(expected.length - 1);
        }
    });
});
