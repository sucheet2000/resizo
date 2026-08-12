/**
 * LONG-TAIL ROUTE REGISTRY
 *
 * LONGTAIL_PAGES is read by three things that must never disagree: the pages
 * themselves, the hub link blocks on the parent tool pages, and the sitemap.
 * The shape tests below are ordinary unit tests; the ones that touch the
 * filesystem exist because the failure mode here is not a wrong value, it is a
 * route in the registry with no page behind it (a 404 in the sitemap) or a page
 * on disk that nothing links to (an orphan Google finds and no visitor does).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    LONGTAIL_PAGES,
    TOOLS,
    getLongtailPage,
    getTool,
    longtailPagesFor,
} from '@/lib/constants';
import { absoluteUrl } from '@/lib/seo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function pageFile(page) {
    return path.join(ROOT, 'app', '(tools)', page.slug, 'page.js');
}

function sourceOf(page) {
    return fs.readFileSync(pageFile(page), 'utf8');
}

describe('LONGTAIL_PAGES registry', () => {
    it('lists the ten long-tail routes', () => {
        expect(LONGTAIL_PAGES).toHaveLength(10);
        expect(LONGTAIL_PAGES.map((page) => page.slug)).toEqual([
            'resize-jpg',
            'resize-png',
            'compress-image-to-100kb',
            'compress-image-to-200kb',
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
            'heic-to-jpg',
        ]);
    });

    it('gives every entry the full shape', () => {
        for (const page of LONGTAIL_PAGES) {
            expect(Object.keys(page).sort()).toEqual([
                'blurb',
                'label',
                'lastModified',
                'path',
                'slug',
                'tool',
            ]);
            expect(page.slug).toMatch(/^[a-z0-9-]+$/);
            expect(page.path).toBe(`/${page.slug}`);
            expect(page.label.length).toBeGreaterThan(0);
            expect(page.blurb.length).toBeGreaterThan(20);
            expect(page.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('keeps slugs, paths and labels unique', () => {
        for (const key of ['slug', 'path', 'label']) {
            const values = LONGTAIL_PAGES.map((page) => page[key]);
            expect(new Set(values).size).toBe(values.length);
        }
    });

    it('never collides with a tool route', () => {
        const toolPaths = new Set(TOOLS.map((tool) => tool.href));
        for (const page of LONGTAIL_PAGES) {
            expect(toolPaths.has(page.path)).toBe(false);
        }
    });

    it('hangs every page off a tool that owns a page of its own', () => {
        for (const page of LONGTAIL_PAGES) {
            const tool = getTool(page.tool);
            expect(tool, `${page.slug} points at an unknown tool`).not.toBeNull();
            expect(tool.hasOwnPage).toBe(true);
        }
    });

    it('groups the entries by tool in registry order', () => {
        const seen = [];
        for (const page of LONGTAIL_PAGES) {
            if (seen[seen.length - 1] !== page.tool) seen.push(page.tool);
        }
        expect(new Set(seen).size, 'a tool group is split in two').toBe(seen.length);

        const toolOrder = TOOLS.map((tool) => tool.slug);
        const positions = seen.map((slug) => toolOrder.indexOf(slug));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
});

describe('getLongtailPage', () => {
    it('finds a page by slug', () => {
        expect(getLongtailPage('png-to-jpg')).toMatchObject({ path: '/png-to-jpg', tool: 'convert' });
    });

    it.each([
        ['an unknown slug', 'png-to-tiff'],
        ['a tool slug', 'convert'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
    ])('returns null for %s', (_label, slug) => {
        expect(getLongtailPage(slug)).toBeNull();
    });
});

describe('longtailPagesFor', () => {
    it('returns the pages of one tool', () => {
        expect(longtailPagesFor('resize').map((page) => page.slug)).toEqual(['resize-jpg', 'resize-png']);
        expect(longtailPagesFor('convert').map((page) => page.slug)).toEqual([
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
        ]);
    });

    it('drops the page you are already on', () => {
        const siblings = longtailPagesFor('convert', { exclude: 'png-to-jpg' });
        expect(siblings.map((page) => page.slug)).not.toContain('png-to-jpg');
        expect(siblings).toHaveLength(4);
    });

    it('returns an empty list for an unknown tool', () => {
        expect(longtailPagesFor('sharpen')).toEqual([]);
        expect(longtailPagesFor(undefined)).toEqual([]);
    });

    it('covers every entry exactly once across the tools', () => {
        const gathered = TOOLS.flatMap((tool) => longtailPagesFor(tool.slug));
        expect(gathered).toHaveLength(LONGTAIL_PAGES.length);
        expect(new Set(gathered.map((page) => page.slug)).size).toBe(LONGTAIL_PAGES.length);
    });
});

describe('every registered route has a page behind it', () => {
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s ships app/(tools)/%s/page.js', (_slug, page) => {
        expect(fs.existsSync(pageFile(page)), `${page.path} is in the registry with no page`).toBe(true);
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s declares its own canonical', (_slug, page) => {
        const source = sourceOf(page);
        expect(source).toContain('buildMetadata');
        expect(source, 'the canonical path must be the page path').toContain(`'${page.path}'`);
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s emits schema and a visible FAQ', (_slug, page) => {
        const source = sourceOf(page);
        for (const marker of ['softwareApplication', 'breadcrumbList', 'faqPage', 'FaqList']) {
            expect(source, `${page.slug} is missing ${marker}`).toContain(marker);
        }
    });

    // The FAQ markup has to mirror FAQ copy the page actually shows, so both
    // read the one FAQS array rather than two lists that can drift apart.
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s feeds one FAQ array to both', (_slug, page) => {
        const source = sourceOf(page);
        expect(source).toContain('faqPage(FAQS)');
        expect(source).toContain('items={FAQS}');
    });

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))('%s links back to its parent tool', (_slug, page) => {
        const tool = getTool(page.tool);
        expect(sourceOf(page)).toContain(`'${tool.href}'`);
    });
});

describe('the hub pages link to their spokes', () => {
    it.each(['resize', 'compress', 'convert', 'heic'])('/%s reaches its long-tail pages', (slug) => {
        const source = fs.readFileSync(path.join(ROOT, 'app', '(tools)', slug, 'page.js'), 'utf8');
        const reachable = longtailPagesFor(slug).every((page) => source.includes(page.path))
            || source.includes('IntentLinks');
        expect(reachable, `/${slug} does not link to any of its long-tail pages`).toBe(true);
    });
});

/**
 * THE COPY ON THESE TEN PAGES HAS TO MATCH WHAT THE BUILD ACTUALLY DOES.
 *
 * Every image operation now runs in the visitor's own tab. Nothing is sent
 * anywhere, so a sentence describing a server, an upload of the visitor's file,
 * or a file being kept and then deleted is not merely stale marketing — it is
 * the site claiming a data flow that does not exist, on the exact pages that
 * rank for "without uploading". The ban is therefore mechanical.
 *
 * The patterns are written to catch the CLAIM, not the word. These pages say
 * "without uploading", "the file is never uploaded" and "upload forms accept
 * JPG and PNG" all legitimately — the first two are the truth this cluster is
 * built on, and the third is about somebody else's form. So nothing matches a
 * bare "upload"; each pattern names a transfer, a store or a deletion.
 *
 * AVIF and GIF are absolute. Both left every allowlist in lib/constants.js when
 * the work moved into the browser (no decoder for either, and an AVIF encode
 * costs 823 KB of download), so a page naming one as a supported format is
 * advertising a conversion the tool will refuse.
 */
const FALSE_CLAIMS = [
    {
        id: 'a server of ours',
        pattern: /\bour (server|servers|backend|machines|infrastructure)\b/i,
    },
    {
        id: 'the file travelling somewhere',
        pattern: /\b(sent|posted|transmitted|transferred|uploaded)\s+to\s+(a|our|the)?\s*(server|us|resizo)\b/i,
    },
    {
        id: 'us receiving or keeping the file',
        pattern: /\bwe\s+(store|keep|save|retain|receive|process|hold|delete)\b/i,
    },
    {
        id: 'a deletion, which implies the file arrived somewhere',
        pattern: /\bdelet(e|ed|es|ion)\b[^.]{0,80}\b(process|processing|upload|uploaded|download|server|hour|minute)/i,
    },
    {
        id: 'the visitor being told to upload',
        pattern: /\bupload your\b/i,
    },
    {
        id: 'the file being held in memory somewhere',
        pattern: /\b(in|into) memory\b(?![^.]{0,40}\byour (own )?(device|browser|machine)\b)/i,
    },
    { id: 'AVIF, which has no browser decoder here', pattern: /\bAVIF\b/ },
    { id: 'GIF, which has no browser decoder here', pattern: /\bGIF\b/ },
];

describe('long-tail copy describes the client-side build it actually ships', () => {
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))(
        '%s claims no upload, no server, no AVIF and no GIF',
        (_slug, page) => {
            const source = sourceOf(page);
            const found = FALSE_CLAIMS
                .map((claim) => [claim, source.match(claim.pattern)])
                .filter(([, match]) => match !== null)
                .map(([claim, match]) => `${claim.id} — "${match[0].trim()}"`);

            expect(
                found,
                `${page.slug} says something the build no longer does:\n${found.join('\n')}`,
            ).toEqual([]);
        },
    );

    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))(
        '%s says where the work happens instead of leaving it implied',
        (_slug, page) => {
            expect(
                sourceOf(page),
                `${page.slug} must state that the file stays on the visitor's own device`,
            ).toMatch(/your own (device|machine|computer)|never leaves your (device|computer)/i);
        },
    );
});

/* ------------------------------------------------------------------ *
 * Ten pages, ten reasons to exist
 * ------------------------------------------------------------------ */

/** The DESCRIPTION const, with its `'a' + 'b'` concatenation joined up. */
function descriptionOf(page) {
    const block = sourceOf(page).match(/const DESCRIPTION = ([\s\S]*?);\n/);
    if (!block) return null;
    return [...block[1].matchAll(/'([^']*)'/g)].map((match) => match[1]).join('');
}

/** The `title` prop handed to the tool shell, which renders it as the h1. */
function headingOf(page) {
    const match = sourceOf(page).match(/\n\s+title="([^"]+)"/);
    return match ? match[1] : null;
}

/** The `title:` inside buildMetadata — the <title> tag, not the h1. */
function metaTitleOf(page) {
    const match = sourceOf(page).match(/buildMetadata\(\{[\s\S]*?\n\s*title: '([^']+)'/);
    return match ? match[1] : null;
}

/**
 * Ten pages preconfiguring four tools only earn ten URLs if each one says
 * something the others do not. Two sharing a description or an h1 is the
 * doorway-page shape, and it is worth failing a build over: this cluster is
 * indexed on the strength of being ten different answers.
 */
describe('no two long-tail pages are the same page', () => {
    it.each(LONGTAIL_PAGES.map((page) => [page.slug, page]))(
        '%s has a description, an h1 and a meta title to compare',
        (_slug, page) => {
            expect(descriptionOf(page), `${page.slug}: no DESCRIPTION const`).toBeTruthy();
            expect(headingOf(page), `${page.slug}: no title prop for the h1`).toBeTruthy();
            expect(metaTitleOf(page), `${page.slug}: no title in buildMetadata`).toBeTruthy();
        },
    );

    it.each([
        ['meta description', descriptionOf],
        ['h1', headingOf],
        ['meta title', metaTitleOf],
    ])('gives every page its own %s', (label, read) => {
        const seen = new Map();
        const duplicates = [];

        for (const page of LONGTAIL_PAGES) {
            const value = read(page).trim().toLowerCase();
            if (seen.has(value)) duplicates.push(`${seen.get(value)} and ${page.slug}: "${value}"`);
            else seen.set(value, page.slug);
        }

        expect(
            duplicates,
            `two long-tail pages share a ${label}, which is the doorway-page shape:\n${duplicates.join('\n')}`,
        ).toEqual([]);
    });

    /**
     * The FAQ answer about uploading is the one place these ten pages converged
     * on a single sentence, because the honest answer is the same fact every
     * time. It still has to be written for the page it is on, so the answers are
     * held apart here even though the questions may legitimately rhyme.
     */
    it('does not repeat one no-upload answer verbatim across the cluster', () => {
        const answers = new Map();
        const repeats = [];

        for (const page of LONGTAIL_PAGES) {
            const source = sourceOf(page);
            const block = source.match(
                /question: '[^']*(?:upload|sent anywhere)[^']*',\s*\n\s*answer: ([\s\S]*?),\n\s*\},/i,
            );
            if (!block) continue;

            const answer = [...block[1].matchAll(/'([^']*)'/g)]
                .map((match) => match[1])
                .join('')
                .trim()
                .toLowerCase();

            if (answers.has(answer)) repeats.push(`${answers.get(answer)} and ${page.slug}`);
            else answers.set(answer, page.slug);
        }

        expect(answers.size, 'no page states the no-upload fact at all').toBeGreaterThan(5);
        expect(
            repeats,
            `these pages give a word-for-word identical no-upload answer:\n${repeats.join('\n')}`,
        ).toEqual([]);
    });
});

describe('canonical URLs', () => {
    it('resolves every registered path to an absolute URL on the site host', () => {
        for (const page of LONGTAIL_PAGES) {
            expect(absoluteUrl(page.path)).toBe(`https://www.resizo.net${page.path}`);
        }
    });
});
