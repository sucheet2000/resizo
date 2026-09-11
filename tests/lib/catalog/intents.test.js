/**
 * THE INTENT REGISTRY
 *
 * INTENTS is read by four things that must never disagree: the [slug] route
 * that renders the pages, the hub blocks on the parent tool pages, the /tools
 * directory and the sitemap. The shape tests below are ordinary unit tests;
 * the copy tests exist because the failure mode here is not a wrong value, it
 * is a page that claims a data flow this build does not have, on the exact
 * pages that rank for "without uploading".
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INTENTS, TOOLS, getIntent, getTool, intentCopy, intentsFor } from '@/lib/catalog';
import { absoluteUrl } from '@/lib/seo';

describe('INTENTS registry', () => {
    it('lists the seventeen intent routes, grouped by tool', () => {
        expect(INTENTS).toHaveLength(17);
        expect(INTENTS.map((intent) => intent.slug)).toEqual([
            'resize-jpg',
            'resize-png',
            'resize-webp',
            'compress-image-to-20kb',
            'compress-image-to-50kb',
            'compress-image-to-100kb',
            'compress-image-to-200kb',
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
            'webp-to-png',
            'avif-to-jpg',
            'avif-to-png',
            'heic-to-jpg',
            'heic-to-png',
        ]);
    });

    it('points every entry at an OG image that exists in public/', () => {
        // A page's own OG image is checked by tests/app/metadata.test.js from
        // its source; an intent declares its image in the registry instead, so
        // a typo here would ship a 404 in every share card.
        for (const intent of INTENTS) {
            expect(intent.ogImage, `${intent.slug} declares no ogImage`).toMatch(/^\/og-[a-z0-9-]+\.(jpg|png)$/);
            expect(
                fs.existsSync(path.join(process.cwd(), 'public', intent.ogImage.replace(/^\//, ''))),
                `${intent.slug}: ${intent.ogImage} is missing from public/`,
            ).toBe(true);
        }
    });

    it('serves every entry at its slug and nowhere else', () => {
        for (const intent of INTENTS) {
            expect(intent.slug).toMatch(/^[a-z0-9-]+$/);
            expect(intent.path).toBe(`/${intent.slug}`);
        }
    });

    it('keeps slugs, paths, labels, titles and h1s unique', () => {
        for (const key of ['slug', 'path', 'label', 'title', 'h1', 'description', 'answer']) {
            const values = INTENTS.map((intent) => intent[key]);
            expect(new Set(values).size, `two intents share a ${key}`).toBe(values.length);
        }
    });

    it('never collides with a tool route', () => {
        const toolPaths = new Set(TOOLS.map((tool) => tool.href));
        for (const intent of INTENTS) {
            expect(toolPaths.has(intent.path)).toBe(false);
        }
    });

    it('hangs every entry off a tool that owns a page of its own', () => {
        for (const intent of INTENTS) {
            const tool = getTool(intent.tool);
            expect(tool, `${intent.slug} points at an unknown tool`).not.toBeNull();
            expect(tool.hasOwnPage).toBe(true);
        }
    });

    it('groups the entries by tool in registry order', () => {
        const seen = [];
        for (const intent of INTENTS) {
            if (seen[seen.length - 1] !== intent.tool) seen.push(intent.tool);
        }
        expect(new Set(seen).size, 'a tool group is split in two').toBe(seen.length);

        const toolOrder = TOOLS.map((tool) => tool.slug);
        const positions = seen.map((slug) => toolOrder.indexOf(slug));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it('marks every entry indexable and dates it on or after the overhaul', () => {
        for (const intent of INTENTS) {
            expect(intent.indexable).toBe(true);
            expect(intent.lastModified >= '2026-08-11').toBe(true);
        }
    });

    it('preconfigures the tool where the tool can be preconfigured', () => {
        // The two tiny ceilings open on the policy that may shrink the picture:
        // at 20 and 50 KB quality alone rarely gets a photograph there.
        expect(getIntent('compress-image-to-20kb').preset).toEqual({ targetKb: 20, policy: 'fit' });
        expect(getIntent('compress-image-to-50kb').preset).toEqual({ targetKb: 50, policy: 'fit' });
        expect(getIntent('compress-image-to-100kb').preset).toEqual({ targetKb: 100 });
        expect(getIntent('compress-image-to-200kb').preset).toEqual({ targetKb: 200 });
        expect(getIntent('png-to-jpg').preset).toEqual({ from: 'png', to: 'jpeg' });
        expect(getIntent('jpg-to-png').preset).toEqual({ from: 'jpeg', to: 'png' });
        expect(getIntent('jpg-to-webp').preset).toEqual({ from: 'jpeg', to: 'webp' });
        expect(getIntent('png-to-webp').preset).toEqual({ from: 'png', to: 'webp' });
        expect(getIntent('webp-to-jpg').preset).toEqual({ from: 'webp', to: 'jpeg' });
        expect(getIntent('webp-to-png').preset).toEqual({ from: 'webp', to: 'png' });
        expect(getIntent('heic-to-png').preset).toEqual({ format: 'png' });
        // The resizer and the HEIC-to-JPG converter take no preset; these pages
        // are distinct by what they say, and the doorway guard holds them to it.
        expect(getIntent('resize-jpg').preset).toBeNull();
        expect(getIntent('resize-png').preset).toBeNull();
        expect(getIntent('resize-webp').preset).toBeNull();
        expect(getIntent('heic-to-jpg').preset).toBeNull();
    });

    it('links the convert spokes to each other and leaves the rest to their inline links', () => {
        for (const intent of INTENTS) {
            if (intent.tool === 'convert') expect(intent.siblingLinks).toEqual({ heading: 'Other conversions' });
            else expect(intent.siblingLinks).toBeNull();
        }
    });
});

describe('getIntent', () => {
    it('finds an entry by slug', () => {
        expect(getIntent('png-to-jpg')).toMatchObject({ path: '/png-to-jpg', tool: 'convert' });
    });

    it.each([
        ['an unknown slug', 'png-to-tiff'],
        ['a tool slug', 'convert'],
        ['an empty string', ''],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
    ])('returns null for %s', (_label, slug) => {
        expect(getIntent(slug)).toBeNull();
    });
});

describe('intentsFor', () => {
    it('returns the entries of one tool', () => {
        expect(intentsFor('resize').map((intent) => intent.slug)).toEqual(['resize-jpg', 'resize-png', 'resize-webp']);
        expect(intentsFor('convert').map((intent) => intent.slug)).toEqual([
            'png-to-jpg',
            'jpg-to-png',
            'jpg-to-webp',
            'png-to-webp',
            'webp-to-jpg',
            'webp-to-png',
            'avif-to-jpg',
            'avif-to-png',
        ]);
        expect(intentsFor('heic').map((intent) => intent.slug)).toEqual(['heic-to-jpg', 'heic-to-png']);
    });

    it('drops the page you are already on', () => {
        const siblings = intentsFor('convert', { exclude: 'png-to-jpg' });
        expect(siblings.map((intent) => intent.slug)).not.toContain('png-to-jpg');
        expect(siblings).toHaveLength(7);
    });

    it('returns an empty list for an unknown tool', () => {
        expect(intentsFor('sharpen')).toEqual([]);
        expect(intentsFor(undefined)).toEqual([]);
    });

    it('covers every entry exactly once across the tools', () => {
        const gathered = TOOLS.flatMap((tool) => intentsFor(tool.slug));
        expect(gathered).toHaveLength(INTENTS.length);
        expect(new Set(gathered.map((intent) => intent.slug)).size).toBe(INTENTS.length);
    });
});

/**
 * THE COPY ON THESE TEN PAGES HAS TO MATCH WHAT THE BUILD ACTUALLY DOES.
 *
 * Every image operation runs in the visitor's own tab. Nothing is sent
 * anywhere, so a sentence describing a server, an upload of the visitor's file,
 * or a file being kept and then deleted is not merely stale marketing — it is
 * the site claiming a data flow that does not exist, on the exact pages that
 * rank for "without uploading". The ban is therefore mechanical, and it reads
 * every string the entry renders — headline, intro, description, answer,
 * steps, sections, FAQs — through intentCopy().
 *
 * The patterns are written to catch the CLAIM, not the word. These pages say
 * "without uploading", "the file is never uploaded" and "upload forms accept
 * JPG and PNG" all legitimately — the first two are the truth this cluster is
 * built on, and the third is about somebody else's form. So nothing matches a
 * bare "upload"; each pattern names a transfer, a store or a deletion.
 *
 * GIF is still absolute: it left every allowlist in lib/limits.js when the work
 * moved into the browser and there is no GIF decoder here, so a page naming it
 * as a supported format is advertising a conversion the tool will refuse.
 *
 * AVIF is no longer absolute and the three patterns that replaced it are
 * narrower, because the format is now genuinely supported and the pages have to
 * be able to say so. What they may not say is the three things this build does
 * NOT do with it, each of which reads as a capability rather than as a word:
 * that an AVIF written here could be lossless (the encoder is lossy only, at
 * one quality on libavif's own scale), that a high dynamic range or a depth
 * above 8 bits survives the decode (the browser normalises both before any
 * tool sees a sample), and that an animated one converts (it is refused from
 * its brand before anything is decoded). Each pattern needs the claim, not the
 * subject: "animated AVIF is not supported here" is the truth these pages are
 * required to tell, so only an affirmative reading of it fails.
 */
const FALSE_CLAIMS = [
    { id: 'a server of ours', pattern: /\bour (server|servers|backend|machines|infrastructure)\b/i },
    {
        id: 'the file travelling somewhere',
        pattern: /\b(sent|posted|transmitted|transferred|uploaded)\s+to\s+(a|our|the)?\s*(server|us|resizo)\b/i,
    },
    { id: 'us receiving or keeping the file', pattern: /\bwe\s+(store|keep|save|retain|receive|process|hold|delete)\b/i },
    {
        id: 'a deletion, which implies the file arrived somewhere',
        pattern: /\bdelet(e|ed|es|ion)\b[^.]{0,80}\b(process|processing|upload|uploaded|download|server|hour|minute)/i,
    },
    { id: 'the visitor being told to upload', pattern: /\bupload your\b/i },
    {
        id: 'the file being held in memory somewhere',
        pattern: /\b(in|into) memory\b(?![^.]{0,40}\byour (own )?(device|browser|machine)\b)/i,
    },
    {
        id: 'a lossless AVIF, which this build cannot write',
        pattern: /\blossless(?:ly)?\s+AVIF\b|\bAVIF\b[^.]{0,30}\b(?:is|are|was|were)\s+lossless\b/i,
    },
    {
        id: 'HDR or a bit depth above 8 surviving a decode that normalises both',
        pattern: /\b(?:HDR|10[-\s]?bit|12[-\s]?bit|wide[-\s]gamut)\b[^.]{0,60}\b(?:kept|preserved|survives?|retained|carried over|intact)\b/i,
    },
    {
        id: 'an animated AVIF converting, when it is refused before any decode',
        pattern: /\banimated\s+AVIF\b[^.]{0,40}\b(?:is supported|works here|converts|is converted|comes through|is kept)\b/i,
    },
    { id: 'GIF, which has no browser decoder here', pattern: /\bGIF\b/ },
];

describe('intent copy describes the client-side build it actually ships', () => {
    it('reads a substantial amount of copy per entry', () => {
        for (const intent of INTENTS) {
            const text = intentCopy(intent).join(' ');
            expect(text.length, `${intent.slug} renders almost nothing`).toBeGreaterThan(3000);
        }
    });

    it.each(INTENTS.map((intent) => [intent.slug, intent]))(
        '%s claims no upload, no server, no GIF and nothing AVIF cannot do here',
        (_slug, intent) => {
            const text = intentCopy(intent).join('\n');
            const found = FALSE_CLAIMS
                .map((claim) => [claim, text.match(claim.pattern)])
                .filter(([, match]) => match !== null)
                .map(([claim, match]) => `${claim.id} — "${match[0].trim()}"`);

            expect(found, `${intent.slug} says something the build no longer does:\n${found.join('\n')}`).toEqual([]);
        },
    );

    it.each(INTENTS.map((intent) => [intent.slug, intent]))(
        '%s says where the work happens instead of leaving it implied',
        (_slug, intent) => {
            expect(
                intentCopy(intent).join('\n'),
                `${intent.slug} must state that the file stays on the visitor's own device`,
            ).toMatch(/your own (device|machine|computer)|never leaves your (device|computer)/i);
        },
    );

    /**
     * The FAQ answer about uploading is the one place these ten pages converged
     * on a single sentence, because the honest answer is the same fact every
     * time. It still has to be written for the page it is on, so the answers are
     * held apart here even though the questions may legitimately rhyme.
     */
    it('does not repeat one no-upload answer verbatim across the cluster', () => {
        const answers = new Map();
        const repeats = [];

        for (const intent of INTENTS) {
            const faq = intent.faqs.find((entry) => /upload|sent anywhere/i.test(entry.question));
            if (!faq) continue;

            const answer = faq.answer.trim().toLowerCase();
            if (answers.has(answer)) repeats.push(`${answers.get(answer)} and ${intent.slug}`);
            else answers.set(answer, intent.slug);
        }

        expect(answers.size, 'no page states the no-upload fact at all').toBeGreaterThan(5);
        expect(repeats, `these pages give a word-for-word identical no-upload answer:\n${repeats.join('\n')}`).toEqual([]);
    });
});

describe('canonical URLs', () => {
    it('resolves every registered path to an absolute URL on the site host', () => {
        for (const intent of INTENTS) {
            expect(absoluteUrl(intent.path)).toBe(`https://www.resizo.net${intent.path}`);
        }
    });
});
