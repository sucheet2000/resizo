/**
 * CAN A CRAWLER REACH THE SITE AT ALL
 *
 * Everything else in the SEO suite assumes a crawler got in. This suite is the
 * assumption itself, and it is the one that fails silently in production: a
 * robots.txt is never rendered, never reviewed in a screenshot and never
 * covered by a page test, so a single line added to it can take a route — or
 * an entire class of crawler — out of the index with nothing anywhere going
 * red.
 *
 * Three separate defects are held here.
 *
 * 1. The wildcard group. `Allow: /` plus two disallows is the whole file, and
 *    the allow list must not drift back into naming routes one by one: it
 *    already did that twice, it blocked nothing, and the next person to
 *    "fix" the drift would have blocked something real.
 *
 * 2. Bot-specific rules. robots.txt is most-specific-group-wins, so ONE group
 *    naming a user agent silently replaces the wildcard group for that
 *    crawler — a `Disallow: /` under `User-agent: GPTBot` does not merge with
 *    `Allow: /`, it supersedes it. The answer-engine crawlers are named here
 *    by name and asserted to be allowed, because that is a product decision
 *    (this site wants to be quoted by them) that lives in one file nobody
 *    reads. The same resolver proves Googlebot and Bingbot still reach the
 *    tools, which is the check that would have caught a mistyped group.
 *
 * 3. Crawl budget in the sitemap. A URL with a query string or a fragment is a
 *    duplicate of the URL without it, and the sitemap is the one place the
 *    site asks a crawler to spend budget on a specific list.
 *
 * `llms.txt` is deliberately absent: it is not a standard any crawler here
 * reads, no search or answer engine has committed to it, and a second file
 * describing the site is a second file that can contradict robots.txt and the
 * sitemap. The assertion is what keeps that decision from being quietly
 * reversed by a file drop.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { INDEXABLE_ROBOTS, SITE_URL, absoluteUrl } from '@/lib/seo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The crawlers this site wants and the two it lives on. Named as strings
 * rather than derived from anything, because the point of the assertion is
 * that a human decided each one — a list computed from robots.js would agree
 * with robots.js no matter what robots.js said.
 */
const NAMED_CRAWLERS = [
    'OAI-SearchBot',
    'GPTBot',
    'ClaudeBot',
    'PerplexityBot',
    'Googlebot',
    'Bingbot',
];

/** Paths every one of those crawlers has to be able to fetch. */
const MUST_REACH = ['/', '/compress', '/compress-image-to-20kb', '/tools', '/sitemap.xml'];

const result = robots();
const RULES = [result.rules].flat().filter(Boolean);

const list = (value) => (value === undefined ? [] : [value].flat().filter((entry) => entry !== ''));

/**
 * The group a crawler obeys. robots.txt does not merge groups: a crawler uses
 * the group whose user-agent names it and ignores the wildcard entirely, which
 * is exactly why one bot-specific line is enough to lose a crawler.
 */
function groupsFor(agent) {
    const named = RULES.filter((rule) =>
        list(rule.userAgent).some((ua) => ua.toLowerCase() === agent.toLowerCase()),
    );
    if (named.length > 0) return named;
    return RULES.filter((rule) => list(rule.userAgent).includes('*'));
}

/** Longest matching directive wins; a tie goes to allow, as Google resolves it. */
function isAllowed(agent, target) {
    let allowed = -1;
    let blocked = -1;

    for (const rule of groupsFor(agent)) {
        for (const prefix of list(rule.allow)) {
            if (target.startsWith(prefix)) allowed = Math.max(allowed, prefix.length);
        }
        for (const prefix of list(rule.disallow)) {
            if (target.startsWith(prefix)) blocked = Math.max(blocked, prefix.length);
        }
    }

    return allowed >= blocked;
}

function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(absolute));
        } else if (entry.isFile()) {
            out.push(absolute);
        }
    }

    return out;
}

/* ------------------------------------------------------------------ *
 * The wildcard group
 * ------------------------------------------------------------------ */

describe('robots.txt is one wildcard group', () => {
    it('reads a robots.txt with rules in it', () => {
        // An empty rule set blocks nothing and would pass every assertion below
        // by having nothing to check.
        expect(RULES.length).toBe(1);
    });

    it('applies to every crawler and allows the whole site', () => {
        const [rule] = RULES;
        expect(list(rule.userAgent)).toEqual(['*']);
        expect(list(rule.allow)).toEqual(['/']);
    });

    it('disallows exactly the two paths that never render indexable HTML', () => {
        expect(list(RULES[0].disallow)).toEqual(['/api/', '/auth/']);
    });

    it('points at the sitemap on the canonical host', () => {
        expect(result.sitemap).toBe(absoluteUrl('/sitemap.xml'));
        expect(result.sitemap.startsWith(`${SITE_URL}/`)).toBe(true);
    });

    it('names no crawler of its own', () => {
        // A group naming one bot replaces the wildcard group for that bot
        // rather than adding to it, so a single named group is a policy change
        // for that crawler and nothing else on the site can show it.
        const named = RULES.flatMap((rule) => list(rule.userAgent)).filter((ua) => ua !== '*');
        expect(named, `robots.txt names ${named.join(', ')} — the wildcard group no longer applies to them`).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * The crawlers, by name
 * ------------------------------------------------------------------ */

describe('every crawler this site wants can reach it', () => {
    it.each(NAMED_CRAWLERS)('%s is served by the wildcard group', (agent) => {
        const groups = groupsFor(agent);
        expect(groups.length, `${agent} matches no group at all`).toBeGreaterThan(0);

        for (const rule of groups) {
            expect(
                list(rule.userAgent),
                `${agent} is answered by a group of its own, not the wildcard one`,
            ).toEqual(['*']);
        }
    });

    it.each(NAMED_CRAWLERS)('%s may fetch every public route', (agent) => {
        for (const target of MUST_REACH) {
            expect(isAllowed(agent, target), `${agent} is blocked from ${target}`).toBe(true);
        }
    });

    it.each(NAMED_CRAWLERS)('%s is still kept out of /api/ and /auth/', (agent) => {
        // Proves the resolver above reads disallow at all — without this the
        // "may fetch" assertions would pass against a file with no rules in it.
        expect(isAllowed(agent, '/api/health')).toBe(false);
        expect(isAllowed(agent, '/auth/callback')).toBe(false);
    });
});

/* ------------------------------------------------------------------ *
 * The sitemap spends crawl budget on canonical URLs only
 * ------------------------------------------------------------------ */

describe('the sitemap asks for canonical URLs only', () => {
    const urls = sitemap().map((entry) => entry.url);

    it('reads a sitemap with the whole site in it', () => {
        expect(urls.length).toBeGreaterThanOrEqual(19);
    });

    it('lists every URL absolute, on the one canonical host', () => {
        for (const url of urls) {
            expect(url.startsWith(`${SITE_URL}/`), `${url} is not on ${SITE_URL}`).toBe(true);
            expect(() => new URL(url), `${url} is not a URL`).not.toThrow();
        }
    });

    it('carries no query string and no fragment', () => {
        // Both make a second URL for a page that already has one, and the
        // sitemap is where a crawler is told what to spend its budget on.
        const dirty = urls.filter((url) => url.includes('?') || url.includes('#'));
        expect(dirty, `these sitemap URLs are duplicates of a canonical route:\n${dirty.join('\n')}`).toEqual([]);
    });

    it('lists every URL exactly once', () => {
        const seen = new Map();
        for (const url of urls) seen.set(url, (seen.get(url) ?? 0) + 1);
        const repeated = [...seen].filter(([, count]) => count > 1).map(([url]) => url);
        expect(repeated, `repeated in the sitemap:\n${repeated.join('\n')}`).toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * What an indexable page tells a crawler it may show
 * ------------------------------------------------------------------ */

describe('the indexable robots directives', () => {
    it('lets the page be indexed and its links followed', () => {
        expect(INDEXABLE_ROBOTS.index).toBe(true);
        expect(INDEXABLE_ROBOTS.follow).toBe(true);
    });

    it('opts into a full-length snippet and a large image preview', () => {
        // At an average position of nine the snippet is the whole pitch, and
        // Google's default clips it to a couple of lines with no thumbnail.
        expect(INDEXABLE_ROBOTS['max-snippet']).toBe(-1);
        expect(INDEXABLE_ROBOTS['max-image-preview']).toBe('large');
    });

    it('never carries noindex or nofollow', () => {
        expect(JSON.stringify(INDEXABLE_ROBOTS)).not.toMatch(/noindex|nofollow/);
    });
});

/* ------------------------------------------------------------------ *
 * No second file describing the site
 * ------------------------------------------------------------------ */

describe('there is no llms.txt', () => {
    const served = [...walk(path.join(ROOT, 'public')), ...walk(path.join(ROOT, 'app'))];

    it('found the files that get served', () => {
        // An empty file list contains no stray file, so the assertion below
        // means nothing until the walk is shown to have read something.
        expect(served.length).toBeGreaterThan(10);
        expect(served.some((file) => file.endsWith(`${path.sep}robots.js`))).toBe(true);
    });

    it('ships no llms.txt for robots.txt and the sitemap to contradict', () => {
        const strays = served
            .filter((file) => path.basename(file).toLowerCase() === 'llms.txt')
            .map((file) => path.relative(ROOT, file));

        expect(
            strays,
            `llms.txt is not a standard any crawler here reads, and it is a second `
            + `description of the site that can drift from robots.txt and the sitemap:\n${strays.join('\n')}`,
        ).toEqual([]);
    });
});
