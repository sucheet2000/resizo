/**
 * THE DIRECT-ANSWER PARAGRAPH ON EVERY TOOL PAGE
 *
 * Search Console says the site is found — 1.12M impressions a quarter at an
 * average position of 9 — and not chosen: 3.1% of those impressions become a
 * click. A short, self-contained answer near the top of the page is the shape
 * a featured snippet and an AI Overview lift verbatim, so every tool route
 * carries one in ToolShell's `answer` slot.
 *
 * This suite reads the fifteen page.js files as text, because the failure modes
 * are all source-level: a page that never passes the prop, two pages that were
 * written by copying a third, or a sentence that describes a data flow this
 * build does not have.
 *
 * THE PAGE LIST IS DERIVED, NEVER TYPED. It comes from sitemapTools() and
 * LONGTAIL_PAGES, the same two registries the sitemap reads, so a seventeenth
 * tool route cannot quietly ship without an answer of its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LONGTAIL_PAGES, sitemapTools } from '@/lib/constants';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every route that renders a ToolShell: the six tools, then the ten spokes. */
const PAGES = [
    ...sitemapTools().map((tool) => ({ slug: tool.slug, path: tool.href })),
    ...LONGTAIL_PAGES.map((page) => ({ slug: page.slug, path: page.path })),
];

function sourceOf(page) {
    return fs.readFileSync(path.join(ROOT, 'app', '(tools)', page.slug, 'page.js'), 'utf8');
}

/**
 * The ANSWER const with its `'a' + 'b'` concatenation joined up. Both quote
 * styles are read: one page has an apostrophe in it and is written in doubles.
 */
function answerOf(page) {
    const block = sourceOf(page).match(/\nconst ANSWER = ([\s\S]*?);\n/);
    if (!block) return null;

    return [...block[1].matchAll(/'([^']*)'|"([^"]*)"/g)]
        .map((match) => match[1] ?? match[2])
        .join('')
        .trim();
}

/** The `intro` prop on the same page, when it sets one. */
function introOf(page) {
    const match = sourceOf(page).match(/\n\s+intro="([^"]+)"/);
    return match ? match[1] : null;
}

function sentencesOf(answer) {
    return answer.split(/(?<=\.)\s+/).filter((sentence) => sentence.trim() !== '');
}

const ANSWERS = new Map(PAGES.map((page) => [page.slug, answerOf(page)]));

describe('every tool route ships a direct answer', () => {
    it('has sixteen routes to check, from the registries rather than a list here', () => {
        expect(PAGES).toHaveLength(16);
        expect(new Set(PAGES.map((page) => page.slug)).size).toBe(16);
    });

    it.each(PAGES.map((page) => [page.slug, page]))('%s declares an ANSWER', (slug, page) => {
        const answer = ANSWERS.get(slug);
        expect(answer, `${page.path} has no ANSWER const`).toBeTruthy();
        expect(answer.length, `${page.path}: too short to answer anything`).toBeGreaterThan(200);
        expect(answer.length, `${page.path}: this is a paragraph, not a section`).toBeLessThan(800);
    });

    it.each(PAGES.map((page) => [page.slug, page]))('%s hands it to the tool as `answer`', (slug, page) => {
        const source = sourceOf(page);
        expect(source, `${page.path} never passes answer={ANSWER}`).toContain('answer={ANSWER}');
        expect(source, `${page.path} must not put the answer in the intro slot`)
            .not.toContain('intro={ANSWER}');
    });

    it.each(PAGES.map((page) => [page.slug, page]))('%s keeps the answer out of the sub-line', (slug, page) => {
        const intro = introOf(page);
        if (intro === null) return;
        expect(intro, `${page.path}: the intro is one line, the answer is three sentences`)
            .not.toBe(ANSWERS.get(slug));
    });
});

/**
 * The formula, and the reason for each half of it. Sentence one has to be
 * quotable with nothing around it, which is why no brand name may appear in it
 * — a snippet that opens with "Resizo" reads as an advert and is worth less
 * than one that reads as an answer. Sentence two is where the page earns the
 * click, so it names the site and what a person actually does here.
 */
describe('the answers follow the formula', () => {
    it.each(PAGES.map((page) => [page.slug, page]))('%s answers, then places, then differentiates', (slug, page) => {
        const sentences = sentencesOf(ANSWERS.get(slug));

        expect(sentences.length, `${page.path}: fewer than three sentences`).toBeGreaterThanOrEqual(3);
        expect(sentences[0], `${page.path}: sentence one must be quotable standalone, so no brand name`)
            .not.toMatch(/resizo/i);
        expect(
            sentences.slice(1).join(' '),
            `${page.path}: nothing after sentence one names the site`,
        ).toMatch(/\bResizo\b/);
    });

    it.each(PAGES.map((page) => [page.slug, page]))('%s says where the work happens and why', (slug, page) => {
        const answer = ANSWERS.get(slug);

        expect(answer, `${page.path}: no mechanism — say what runs the job, not just that it is private`)
            .toMatch(/your own (device|computer|browser|machine|hardware)|in your browser|this browser tab/i);
        expect(answer, `${page.path}: the mechanism has to name the code the page brings with it`)
            .toMatch(/page (downloads|loads|fetches|carries|brings|hands)|WebAssembly module|loaded into your browser/i);
    });
});

/**
 * COPY THAT DESCRIBES A BUILD THAT DOES NOT EXIST.
 *
 * Nothing is transferred anywhere, so a sentence about a file being uploaded,
 * kept or deleted afterwards is not stale marketing — it is the site claiming a
 * data flow it does not have, in the one paragraph most likely to be quoted
 * back by a search engine.
 *
 * The patterns catch the CLAIM rather than the word, exactly as
 * tests/lib/longtail-pages.test.js does, because these pages legitimately talk
 * about how a format STORES pixels and about somebody else's web form. What is
 * banned is a transfer, a copy held somewhere, a deletion, and "offline" — we
 * ship a manifest but no service worker, so an offline claim would be false.
 */
const FALSE_CLAIMS = [
    { id: 'an upload of any kind', pattern: /\bupload/i },
    { id: 'the file travelling somewhere', pattern: /\bsent\s+(to|over|off|away)\b/i },
    { id: 'a server of ours', pattern: /\bour (server|servers|backend|machines|infrastructure)\b/i },
    {
        id: 'the file being held somewhere',
        pattern: /\b(stored|kept|saved|retained|held)\b[^.]{0,30}\b(us|our|server|site|resizo|here)\b/i,
    },
    { id: 'us receiving or keeping the file', pattern: /\bwe\s+(store|keep|save|retain|receive|process|hold|delete)\b/i },
    { id: 'a deletion, which implies the file arrived somewhere', pattern: /\bdelet(e|ed|es|ion)\b/i },
    { id: 'working offline, which needs a service worker we do not ship', pattern: /\boffline\b/i },
    { id: 'AVIF, which has no codec in this build', pattern: /\bAVIF\b/ },
    { id: 'GIF, which has no codec in this build', pattern: /\bGIF\b/ },
];

describe('the answers describe the build that actually ships', () => {
    it.each(PAGES.map((page) => [page.slug, page]))('%s claims nothing untrue', (slug, page) => {
        const answer = ANSWERS.get(slug);
        const found = FALSE_CLAIMS
            .map((claim) => [claim, answer.match(claim.pattern)])
            .filter(([, match]) => match !== null)
            .map(([claim, match]) => `${claim.id} — "${match[0].trim()}"`);

        expect(found, `${page.path} says something the build does not do:\n${found.join('\n')}`).toEqual([]);
    });

    it.each(PAGES.map((page) => [page.slug, page]))('%s uses "add" or "choose", never "upload"', (slug, page) => {
        expect(ANSWERS.get(slug), `${page.path}: nothing is uploaded, so nobody uploads anything`)
            .toMatch(/\b(add|drop|choose|pick)\b/i);
    });
});

/* ------------------------------------------------------------------ *
 * Sixteen answers, sixteen questions
 * ------------------------------------------------------------------ */

/** Overlapping three-word runs, which is what a rewritten sentence loses. */
function shingles(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    const out = new Set();
    for (let index = 0; index + 2 < words.length; index += 1) {
        out.add(words.slice(index, index + 3).join(' '));
    }
    return out;
}

function similarity(first, second) {
    const a = shingles(first);
    const b = shingles(second);
    const shared = [...a].filter((shingle) => b.has(shingle)).length;
    return shared / (a.size + b.size - shared);
}

/**
 * Sixteen pages preconfiguring six tools only deserve sixteen URLs if each
 * answers its own question. Sixteen variations of one sentence is the
 * doorway-page shape, and a near-duplicate is as bad as a duplicate: the
 * threshold is on three-word runs, so two answers may share vocabulary — they
 * are all about images — but not phrasing.
 */
describe('no two answers are the same answer', () => {
    it('gives every page its own, word for word', () => {
        const seen = new Map();
        const duplicates = [];

        for (const page of PAGES) {
            const answer = ANSWERS.get(page.slug).toLowerCase();
            if (seen.has(answer)) duplicates.push(`${seen.get(answer)} and ${page.slug}`);
            else seen.set(answer, page.slug);
        }

        expect(duplicates, `these pages share an answer:\n${duplicates.join('\n')}`).toEqual([]);
    });

    it('keeps every pair well clear of a rewrite of the same paragraph', () => {
        const tooClose = [];

        for (let i = 0; i < PAGES.length; i += 1) {
            for (let j = i + 1; j < PAGES.length; j += 1) {
                const score = similarity(ANSWERS.get(PAGES[i].slug), ANSWERS.get(PAGES[j].slug));
                if (score >= 0.25) {
                    tooClose.push(`${PAGES[i].slug} / ${PAGES[j].slug}: ${score.toFixed(2)}`);
                }
            }
        }

        expect(tooClose, `these read as the same paragraph twice:\n${tooClose.join('\n')}`).toEqual([]);
    });

    /**
     * Each page has a job somebody arrived with. The answer has to be about
     * THAT job, not about images in general, which is the whole reason these
     * ten spokes are separate URLs.
     */
    it.each([
        ['compress-image-to-100kb', /100 KB/],
        ['compress-image-to-200kb', /200 KB/],
        ['png-to-jpg', /transparen/i],
        ['png-to-webp', /transparen/i],
        ['jpg-to-webp', /(smaller|lighter)/i],
        ['webp-to-jpg', /(open|refus|software)/i],
        ['heic-to-jpg', /(Windows|Android)/],
        ['resize-png', /(logo|icon|screenshot|transparen)/i],
        ['resize-jpg', /\bJPG\b/],
        ['crop', /rectangle/i],
        ['jpg-to-pdf', /\bpage\b/i],
    ])('%s answers its own question', (slug, pattern) => {
        expect(ANSWERS.get(slug)).toMatch(pattern);
    });
});
