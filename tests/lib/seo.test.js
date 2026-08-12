import { describe, expect, it } from 'vitest';
import {
    DEFAULT_OG_IMAGE,
    SITE_NAME,
    SITE_URL,
    absoluteUrl,
    buildMetadata,
    normalizePath,
} from '@/lib/seo';

describe('site constants', () => {
    it('points at the canonical host with no trailing slash', () => {
        expect(SITE_URL).toBe('https://www.resizo.net');
        expect(SITE_URL.endsWith('/')).toBe(false);
    });

    it('names the site', () => {
        expect(SITE_NAME).toBe('Resizo');
    });

    it('has a root-relative default OG image', () => {
        expect(DEFAULT_OG_IMAGE).toBe('/og-image.jpg');
    });
});

describe('normalizePath', () => {
    it.each([
        ['/', '/'],
        ['/resize', '/resize'],
        ['resize', '/resize'],
        ['/resize/', '/resize'],
        ['/resize///', '/resize'],
        ['/a/b/c/', '/a/b/c'],
        ['//', '/'],
        ['///', '/'],
    ])('normalizes %s to %s', (input, expected) => {
        expect(normalizePath(input)).toBe(expected);
    });

    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['null', null],
        ['undefined', undefined],
        ['a number', 42],
        ['an object', {}],
    ])('returns the root for %s', (_label, input) => {
        expect(normalizePath(input)).toBe('/');
    });

    it('always returns a single leading slash', () => {
        for (const input of ['/', 'a', '/a', '/a/', '', null, 'a/b/']) {
            const result = normalizePath(input);
            expect(result.startsWith('/')).toBe(true);
            expect(result.startsWith('//')).toBe(false);
        }
    });
});

describe('absoluteUrl', () => {
    it.each([
        ['/', 'https://www.resizo.net/'],
        ['/resize', 'https://www.resizo.net/resize'],
        ['resize', 'https://www.resizo.net/resize'],
        ['/resize/', 'https://www.resizo.net/resize'],
        ['', 'https://www.resizo.net/'],
    ])('turns %s into %s', (input, expected) => {
        expect(absoluteUrl(input)).toBe(expected);
    });

    it('never emits a double slash after the host', () => {
        for (const input of ['/', '//', 'about', '/about/']) {
            expect(absoluteUrl(input)).not.toMatch(/net\/\//);
        }
    });
});

describe('buildMetadata', () => {
    const base = {
        title: 'Resize Image Online',
        description: 'Change image dimensions with pixel-perfect precision.',
        path: '/resize',
    };

    it('carries the title and description through', () => {
        const metadata = buildMetadata(base);
        expect(metadata.title).toBe(base.title);
        expect(metadata.description).toBe(base.description);
    });

    it('sets an absolute per-path canonical', () => {
        expect(buildMetadata(base).alternates.canonical).toBe('https://www.resizo.net/resize');
    });

    it('defaults the canonical to the root when no path is given', () => {
        const metadata = buildMetadata({ title: 'Resizo', description: 'Image tools.' });
        expect(metadata.alternates.canonical).toBe('https://www.resizo.net/');
    });

    it('gives every route its own openGraph url rather than inheriting one', () => {
        expect(buildMetadata(base).openGraph.url).toBe('https://www.resizo.net/resize');
        expect(buildMetadata({ ...base, path: '/crop' }).openGraph.url).toBe('https://www.resizo.net/crop');
    });

    it('builds a complete openGraph block', () => {
        const { openGraph } = buildMetadata(base);
        expect(openGraph).toMatchObject({
            title: base.title,
            description: base.description,
            siteName: 'Resizo',
            locale: 'en_US',
            type: 'website',
        });
        expect(openGraph.images).toEqual([
            { url: '/og-image.jpg', width: 1200, height: 630, alt: base.title },
        ]);
    });

    it('honours a custom openGraph type', () => {
        expect(buildMetadata({ ...base, type: 'article' }).openGraph.type).toBe('article');
    });

    it('honours a custom OG image in both openGraph and twitter', () => {
        const metadata = buildMetadata({ ...base, ogImage: '/og-resize.jpg' });
        expect(metadata.openGraph.images[0].url).toBe('/og-resize.jpg');
        expect(metadata.twitter.images).toEqual(['/og-resize.jpg']);
    });

    it('builds the twitter summary card', () => {
        expect(buildMetadata(base).twitter).toEqual({
            card: 'summary_large_image',
            title: base.title,
            description: base.description,
            images: ['/og-image.jpg'],
        });
    });

    describe('keywords', () => {
        it('includes a non-empty keyword list', () => {
            const metadata = buildMetadata({ ...base, keywords: ['resize image', 'image resizer'] });
            expect(metadata.keywords).toEqual(['resize image', 'image resizer']);
        });

        it.each([
            ['an empty array', []],
            ['undefined', undefined],
            ['null', null],
            ['a string', 'resize image'],
        ])('omits the key entirely for %s', (_label, keywords) => {
            expect(buildMetadata({ ...base, keywords })).not.toHaveProperty('keywords');
        });
    });

    it('does not throw when called with no arguments', () => {
        expect(() => buildMetadata()).not.toThrow();
        expect(buildMetadata().alternates.canonical).toBe('https://www.resizo.net/');
    });

    it('normalizes a path with a trailing slash into the canonical', () => {
        expect(buildMetadata({ ...base, path: '/resize/' }).alternates.canonical)
            .toBe('https://www.resizo.net/resize');
    });
});
