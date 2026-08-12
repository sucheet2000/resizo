import { describe, expect, it } from 'vitest';

import {
    aggregateRating,
    breadcrumbList,
    faqPage,
    organization,
    softwareApplication,
    webSite,
} from '@/lib/schema';
import { SITE_NAME, SITE_URL } from '@/lib/seo';

function isAbsolute(url) {
    return typeof url === 'string' && url.startsWith('https://');
}

describe('organization', () => {
    const node = organization();

    it('is a schema.org Organization with a stable @id', () => {
        expect(node['@context']).toBe('https://schema.org');
        expect(node['@type']).toBe('Organization');
        expect(node['@id']).toBe(`${SITE_URL}/#organization`);
        expect(node.name).toBe(SITE_NAME);
    });

    it('uses absolute urls everywhere', () => {
        expect(isAbsolute(node.url)).toBe(true);
        expect(isAbsolute(node.logo.url)).toBe(true);
    });

    it('is stable across calls', () => {
        expect(organization()).toEqual(node);
    });
});

describe('webSite', () => {
    const node = webSite();

    it('points at the organization by reference rather than repeating it', () => {
        expect(node['@type']).toBe('WebSite');
        expect(node.publisher).toEqual({ '@id': `${SITE_URL}/#organization` });
    });

    it('declares no SearchAction, because there is no search endpoint', () => {
        expect(node.potentialAction).toBeUndefined();
    });
});

describe('softwareApplication', () => {
    it('builds a free web tool node from a registry entry', () => {
        const node = softwareApplication({
            name: 'Compress Image',
            description: 'Reduce file size without visible quality loss.',
            path: '/compress',
        });

        expect(node['@type']).toBe('SoftwareApplication');
        expect(node.name).toBe('Compress Image');
        expect(node.url).toBe(`${SITE_URL}/compress`);
        expect(node['@id']).toBe(`${SITE_URL}/compress#software`);
        expect(node.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
        expect(node.applicationCategory).toBe('MultimediaApplication');
    });

    it('accepts href as an alias for path', () => {
        expect(softwareApplication({ name: 'Crop', href: '/crop' }).url).toBe(`${SITE_URL}/crop`);
    });

    it('normalises a trailing slash so the @id never forks', () => {
        expect(softwareApplication({ name: 'Crop', path: '/crop/' }).url).toBe(`${SITE_URL}/crop`);
    });

    it('omits description and featureList when there is nothing to say', () => {
        const node = softwareApplication({ name: 'Crop', path: '/crop' });
        expect(node).not.toHaveProperty('description');
        expect(node).not.toHaveProperty('featureList');
        expect(node).not.toHaveProperty('aggregateRating');
    });

    it('carries a rating through unchanged when one is supplied', () => {
        const rating = aggregateRating([5, 4]);
        const node = softwareApplication({ name: 'Crop', path: '/crop', rating });
        expect(node.aggregateRating).toBe(rating);
    });

    it('drops blank feature strings', () => {
        const node = softwareApplication({
            name: 'Crop',
            path: '/crop',
            features: ['Exact pixel crop', '  ', ''],
        });
        expect(node.featureList).toEqual(['Exact pixel crop']);
    });

    it('falls back to the site root for a tool with no path', () => {
        expect(softwareApplication({ name: 'Resizo' }).url).toBe(`${SITE_URL}/`);
    });
});

describe('breadcrumbList', () => {
    it('numbers positions from one and resolves absolute item urls', () => {
        const node = breadcrumbList([
            { name: 'Home', path: '/' },
            { name: 'Compress Image', path: '/compress' },
        ]);

        expect(node['@type']).toBe('BreadcrumbList');
        expect(node.itemListElement).toEqual([
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
            { '@type': 'ListItem', position: 2, name: 'Compress Image', item: `${SITE_URL}/compress` },
        ]);
    });

    it('renumbers after dropping an unnamed entry so positions stay contiguous', () => {
        const node = breadcrumbList([
            { name: 'Home', path: '/' },
            { name: '', path: '/nowhere' },
            { name: 'Crop', path: '/crop' },
        ]);

        expect(node.itemListElement.map((entry) => entry.position)).toEqual([1, 2]);
        expect(node.itemListElement[1].name).toBe('Crop');
    });

    it('allows a trailing entry with no url', () => {
        const node = breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Current' }]);
        expect(node.itemListElement[1]).not.toHaveProperty('item');
    });

    it.each([[[]], [null], [undefined], ['/compress']])('returns null for %o', (input) => {
        expect(breadcrumbList(input)).toBeNull();
    });
});

describe('faqPage', () => {
    it('accepts the long and short key spellings', () => {
        const node = faqPage([
            { question: 'Is it free?', answer: 'Yes.' },
            { q: 'Do you keep my images?', a: 'No.' },
        ]);

        expect(node['@type']).toBe('FAQPage');
        expect(node.mainEntity).toHaveLength(2);
        expect(node.mainEntity[0]).toEqual({
            '@type': 'Question',
            name: 'Is it free?',
            acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
        });
        expect(node.mainEntity[1].name).toBe('Do you keep my images?');
    });

    it('drops a half-written pair rather than emitting an empty answer', () => {
        const node = faqPage([
            { question: 'Is it free?', answer: 'Yes.' },
            { question: 'Unanswered?' },
            { answer: 'Orphan.' },
        ]);

        expect(node.mainEntity).toHaveLength(1);
    });

    it.each([[[]], [null], [{}]])('returns null for %o', (input) => {
        expect(faqPage(input)).toBeNull();
    });
});

describe('aggregateRating', () => {
    it('averages real ratings and rounds to one decimal', () => {
        expect(aggregateRating([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({
            '@type': 'AggregateRating',
            ratingValue: 4.3,
            reviewCount: 3,
            bestRating: 5,
            worstRating: 1,
        });
    });

    it('accepts bare numbers as well as review rows', () => {
        expect(aggregateRating([5, 3]).ratingValue).toBe(4);
    });

    it('drops out-of-range values instead of clamping them', () => {
        const node = aggregateRating([{ rating: 5 }, { rating: 0 }, { rating: 7 }]);
        expect(node.reviewCount).toBe(1);
        expect(node.ratingValue).toBe(5);
    });

    it('coerces numeric strings, which is how Supabase returns numerics', () => {
        expect(aggregateRating([{ rating: '4' }, { rating: '5' }]).ratingValue).toBe(4.5);
    });

    it.each([[[]], [null], [undefined], [[{ rating: 'excellent' }]], [[{}]]])(
        'returns null rather than inventing a rating for %o',
        (input) => {
            expect(aggregateRating(input)).toBeNull();
        },
    );
});
