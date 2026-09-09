import { describe, expect, it } from 'vitest';

import {
    breadcrumbList,
    faqPage,
    howTo,
    organization,
    softwareApplication,
    webSite,
} from '@/lib/schema';
import { AUTHOR_NAME, GITHUB_PROFILE_URL, GITHUB_REPO_URL, SITE_NAME, SITE_URL } from '@/lib/seo';

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

    /**
     * Entity clarity, with nothing invented: the public repository is the one
     * place on the web that unambiguously is this project, and the person who
     * builds it is named as its founder. No social profiles, no ratings, no
     * awards, no user counts — none of those exist to cite.
     */
    it('points at the public repository and names the builder', () => {
        expect(node.sameAs).toEqual([GITHUB_REPO_URL]);
        expect(node.founder).toEqual({ '@type': 'Person', name: AUTHOR_NAME, url: GITHUB_PROFILE_URL });
    });

    it('invents no rating, review, award or audience', () => {
        for (const property of ['aggregateRating', 'review', 'award', 'numberOfEmployees', 'address', 'telephone']) {
            expect(node).not.toHaveProperty(property);
        }
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

    it('names the person who builds it as its author', () => {
        expect(node.author).toEqual({ '@type': 'Person', name: AUTHOR_NAME, url: GITHUB_PROFILE_URL });
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
        expect(node).not.toHaveProperty('review');
    });

    it('credits the builder as author and the site as publisher', () => {
        const node = softwareApplication({ name: 'Crop', path: '/crop' });
        expect(node.author).toEqual({ '@type': 'Person', name: AUTHOR_NAME, url: GITHUB_PROFILE_URL });
        expect(node.publisher).toEqual({ '@id': `${SITE_URL}/#organization` });
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

describe('howTo', () => {
    const STEPS = [
        { name: 'Set the size you want', text: 'Type a width and a height in pixels.' },
        { name: 'Choose the image on your device', text: 'Drag it onto the panel above.' },
        { name: 'Download the result', text: 'The panel prints the size before and after.' },
    ];

    const node = howTo({
        name: 'How to resize an image online',
        description: 'Resize on your own device.',
        path: '/resize',
        anchor: 'how-to-resize',
        steps: STEPS,
    });

    it('builds a schema.org HowTo with a stable @id on the page it lives on', () => {
        expect(node['@context']).toBe('https://schema.org');
        expect(node['@type']).toBe('HowTo');
        expect(node['@id']).toBe(`${SITE_URL}/resize#howto`);
        expect(node.name).toBe('How to resize an image online');
        expect(node.description).toBe('Resize on your own device.');
    });

    it('points its url at the anchor of the visible step list', () => {
        expect(node.url).toBe(`${SITE_URL}/resize#how-to-resize`);
        expect(isAbsolute(node.url)).toBe(true);
    });

    it('falls back to the bare page url when no anchor is given', () => {
        expect(howTo({ name: 'How to crop', path: '/crop', steps: STEPS }).url)
            .toBe(`${SITE_URL}/crop`);
    });

    it('accepts href as an alias for path, like softwareApplication does', () => {
        expect(howTo({ name: 'How to crop', href: '/crop', steps: STEPS })['@id'])
            .toBe(`${SITE_URL}/crop#howto`);
    });

    it('emits one ordered HowToStep per entry', () => {
        expect(node.step).toEqual([
            {
                '@type': 'HowToStep',
                position: 1,
                name: 'Set the size you want',
                text: 'Type a width and a height in pixels.',
            },
            {
                '@type': 'HowToStep',
                position: 2,
                name: 'Choose the image on your device',
                text: 'Drag it onto the panel above.',
            },
            {
                '@type': 'HowToStep',
                position: 3,
                name: 'Download the result',
                text: 'The panel prints the size before and after.',
            },
        ]);
    });

    it('numbers positions from one, in the order the page shows them', () => {
        expect(node.step.map((step) => step.position)).toEqual([1, 2, 3]);
    });

    it('drops a half-written step and renumbers so positions stay contiguous', () => {
        const partial = howTo({
            name: 'How to crop',
            path: '/crop',
            steps: [
                { name: 'Choose the image', text: 'Drop it on the panel.' },
                { name: 'Unexplained' },
                { text: 'Orphan direction.' },
                { name: '  ', text: 'Blank name.' },
                { name: 'Download the crop', text: 'The panel shows it first.' },
            ],
        });

        expect(partial.step).toHaveLength(2);
        expect(partial.step.map((step) => step.position)).toEqual([1, 2]);
        expect(partial.step[1].name).toBe('Download the crop');
    });

    it('invents no supply, tool, cost or duration for a web page', () => {
        for (const property of ['supply', 'tool', 'estimatedCost', 'totalTime']) {
            expect(node).not.toHaveProperty(property);
        }
    });

    it('omits the description when there is nothing to say', () => {
        expect(howTo({ name: 'How to crop', path: '/crop', steps: STEPS }))
            .not.toHaveProperty('description');
    });

    it.each([
        ['no argument at all', undefined],
        ['an empty object', {}],
        ['a name with no steps', { name: 'How to crop', path: '/crop', steps: [] }],
        ['steps with no name', { path: '/crop', steps: [{ name: 'A', text: 'B' }] }],
        ['a blank name', { name: '   ', path: '/crop', steps: [{ name: 'A', text: 'B' }] }],
        ['steps that are not an array', { name: 'How to crop', steps: 'Drop a file' }],
        ['steps that are all malformed', { name: 'How to crop', steps: [{ name: 'A' }, null] }],
    ])('returns null for %s', (_label, input) => {
        expect(howTo(input)).toBeNull();
    });
});
