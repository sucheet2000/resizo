/**
 * DOCS CONSISTENCY
 *
 * README.md and CLAUDE.md are the two documents a new contributor — human or
 * agent — reads before touching anything, and both spent months describing a
 * site that no longer existed: seven tools when ten had pages, ten intent
 * pages when fifteen shipped, a repo map with no `benchmarks/` and no guides,
 * and a Playwright line that said "chromium" after the config grew to five
 * projects. Nothing imports a sentence, so nothing caught any of it.
 *
 * This suite gives the prose the same treatment tests/design/contract.test.js
 * gives the copy: the claims that can be derived are derived, from the
 * registries and from the filesystem, and a stale one fails here rather than
 * misleading the next reader.
 *
 * WHAT IS CHECKED IS FACTS, NOT STYLE. A count, a path, a script name, a rule
 * number. How the sentence around it reads is nobody's business here.
 *
 * The counts are asserted through one fixed sentence pattern each, so the
 * document has exactly one place to state each number and the test knows
 * where to look. Rewording the sentence is fine; dropping the pattern is not,
 * because a pattern that matches nothing would let every number rot.
 *
 * Fixing a failure by loosening a pattern or deleting a claim is the wrong
 * answer — the claim is stale, so correct the claim.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GUIDES, INTENTS, sitemapTools } from '@/lib/catalog';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const CLAUDE = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* ------------------------------------------------------------------ *
 * The self-check
 *
 * Every assertion below is of the form "this document does not say X" or
 * "the number it states is right". Both pass vacuously on an empty string:
 * a document that was never read contains no stale claim and no wrong
 * number. Prove the reads landed on the real documents first.
 * ------------------------------------------------------------------ */

describe('the documents this suite reads', () => {
    it('read both files, and they are the real ones', () => {
        expect(README.length).toBeGreaterThan(5000);
        expect(CLAUDE.length).toBeGreaterThan(5000);
        expect(README).toContain('## Repo map');
        expect(README).toContain('## Scripts');
        expect(CLAUDE).toContain('## Architecture boundaries');
    });

    it('reads registries that are not empty', () => {
        expect(sitemapTools().length).toBeGreaterThan(0);
        expect(INTENTS.length).toBeGreaterThan(0);
        expect(GUIDES.length).toBeGreaterThan(0);
    });
});

/* ------------------------------------------------------------------ *
 * 1. Names that no longer exist
 * ------------------------------------------------------------------ */

/**
 * The single-file catalogue was split into the lib/catalog/ package and the
 * long-tail array became the intent registry. Both names survived in prose
 * long after the modules were gone, which sends a reader to a file that is
 * not there. Describing the history in words is fine — "the old single-file
 * catalog" names nothing importable — so only the identifiers are banned.
 */
const RETIRED_NAMES = [
    { pattern: 'LONGTAIL_PAGES', instead: 'the intent registry, lib/catalog/intents/' },
    { pattern: '`lib/catalog.js`', instead: 'the lib/catalog/ package' },
];

describe('neither document names a module that was deleted', () => {
    for (const { pattern, instead } of RETIRED_NAMES) {
        it(`does not mention ${pattern}`, () => {
            for (const [name, text] of [['README.md', README], ['CLAUDE.md', CLAUDE]]) {
                const lines = text
                    .split('\n')
                    .map((line, index) => [index + 1, line])
                    .filter(([, line]) => line.includes(pattern));

                expect(
                    lines.map(([number, line]) => `${name}:${number}  ${line.trim()}`),
                    `${pattern} no longer exists — say ${instead}`,
                ).toEqual([]);
            }
        });
    }
});

/* ------------------------------------------------------------------ *
 * 2. The counts, against the registries
 * ------------------------------------------------------------------ */

/**
 * One sentence pattern per number. `expected` is read from the registry at
 * run time, so adding a tool, an intent or a guide fails this suite until
 * the README says so.
 */
const COUNTS = [
    {
        what: 'tools with a page of their own',
        pattern: /(\d+) tools, each a real route/g,
        actual: () => sitemapTools().length,
    },
    {
        what: 'intent pages',
        pattern: /(\d+) intent pages/g,
        actual: () => INTENTS.length,
    },
    {
        what: 'guides',
        pattern: /(\d+) guides/g,
        actual: () => GUIDES.length,
    },
    // The repo map states the same count a second time, in the tree rather
    // than in the Tools section. It was stale at 14 while fifteen tool routes
    // shipped, because no pattern here looked at it.
    {
        what: 'tool routes in the repo map',
        pattern: /(\d+) tool routes/g,
        actual: () => sitemapTools().length,
    },
];

describe('README states the registry counts', () => {
    for (const { what, pattern, actual } of COUNTS) {
        it(`states the number of ${what}`, () => {
            const found = [...README.matchAll(pattern)].map((match) => Number(match[1]));

            expect(
                found.length,
                `README no longer contains a sentence matching ${pattern} — the count of `
                    + `${what} is unstated, so nothing holds it to the registry`,
            ).toBeGreaterThan(0);

            for (const stated of found) {
                expect(stated, `README says ${stated} ${what}; the registry has ${actual()}`)
                    .toBe(actual());
            }
        });
    }
});

/**
 * CLAUDE.md states the same counts in words, and its own sentence claims this
 * suite holds them to the registries. It did not: nothing here read CLAUDE.md
 * for a number at all, so "fifteen routes of their own" could have said nine
 * and passed. The claim is true from here.
 *
 * The list inside the parenthesis is checked as well as the number in front of
 * it, because the two rot separately — a tool added to the count and left out
 * of the list is the same stale sentence one comma later.
 */
const NUMBER_WORDS = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three',
    'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight',
    'twenty-nine', 'thirty',
];

const ROUTE_SENTENCE = /([a-z-]+) routes of their own \(([^)]+)\)/;
const CONTENT_SENTENCE = /([a-z-]+) intent pages and ([a-z-]+) guides/;

describe('CLAUDE.md states the registry counts in words', () => {
    it('has a number-word table that covers the counts it has to spell', () => {
        expect(NUMBER_WORDS.indexOf('fifteen')).toBe(15);
        expect(NUMBER_WORDS.length).toBeGreaterThan(sitemapTools().length);
        expect(NUMBER_WORDS.length).toBeGreaterThan(INTENTS.length);
    });

    it('counts the tool routes, and lists every one of them', () => {
        const match = CLAUDE.match(ROUTE_SENTENCE);

        expect(
            match,
            'CLAUDE.md no longer opens with "<number> routes of their own (<list>)" — '
                + 'nothing holds its route count to the registry',
        ).toBeTruthy();

        expect(match[1], `CLAUDE.md says ${match[1]} tool routes`)
            .toBe(NUMBER_WORDS[sitemapTools().length]);

        const named = match[2].split(',').map((entry) => entry.trim()).filter(Boolean);
        expect(
            named.length,
            `CLAUDE.md names ${named.length} tools in the list behind that number:\n${named.join('\n')}`,
        ).toBe(sitemapTools().length);
    });

    it('counts the intent pages and the guides', () => {
        const match = CLAUDE.match(CONTENT_SENTENCE);

        expect(
            match,
            'CLAUDE.md no longer says "<number> intent pages and <number> guides"',
        ).toBeTruthy();

        expect(match[1], `CLAUDE.md says ${match[1]} intent pages`).toBe(NUMBER_WORDS[INTENTS.length]);
        expect(match[2], `CLAUDE.md says ${match[2]} guides`).toBe(NUMBER_WORDS[GUIDES.length]);
    });
});

/* ------------------------------------------------------------------ *
 * 3. Every path in the repo map exists
 * ------------------------------------------------------------------ */

/** The fenced block that follows the "## Repo map" heading, and only that one. */
function repoMapBlock() {
    const heading = README.indexOf('## Repo map');
    if (heading === -1) return null;

    const open = README.indexOf('```', heading);
    if (open === -1) return null;

    const bodyStart = README.indexOf('\n', open) + 1;
    const close = README.indexOf('```', bodyStart);
    if (close === -1) return null;

    return README.slice(bodyStart, close);
}

/**
 * The tree column, resolved against the indentation that nests it.
 *
 * Only the first token on a line is a path — everything after it is the
 * description, which is prose and may say anything. A token counts as a path
 * when it ends in `/` (a directory) or carries a file extension; a bare word
 * like `decode` in a description column is left alone.
 */
const PATH_TOKEN = /^[A-Za-z0-9_.@[\]()/-]+(\/|\.(js|jsx|css|json|md|mjs|yml|heic|png))$/;

function repoMapPaths() {
    const block = repoMapBlock();
    if (block === null) return [];

    const stack = [];
    const found = [];

    for (const line of block.split('\n')) {
        if (line.trim() === '') continue;

        const indent = line.length - line.trimStart().length;
        const [token] = line.trim().split(/\s+/);
        if (!PATH_TOKEN.test(token)) continue;

        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();

        const prefix = stack.length > 0 ? stack[stack.length - 1].prefix : '';
        const full = prefix + token;

        found.push({ full, directory: token.endsWith('/') });
        if (token.endsWith('/')) stack.push({ indent, prefix: full });
    }

    return found;
}

describe('the repo map describes the tree that exists', () => {
    // Without this the rule passes vacuously: a heading that moved, a fence
    // that changed, or a token regex that stopped matching all leave an empty
    // list, and an empty list contains no missing path. Prove the parse found
    // the real tree before asserting anything about it.
    it('parses the block and finds the tree in it', () => {
        const paths = repoMapPaths().map((entry) => entry.full);

        expect(paths.length).toBeGreaterThan(25);
        for (const expected of [
            'app/api/health/',
            'lib/image-client/',
            'lib/image-client/capability.js',
            'lib/limits.js',
            'components/tools/',
            'tests/architecture/',
        ]) {
            expect(paths).toContain(expected);
        }
    });

    it('names only files and directories that are on disk', () => {
        const missing = repoMapPaths()
            .filter(({ full, directory }) => {
                const target = path.join(ROOT, full);
                if (!fs.existsSync(target)) return true;
                return directory && !fs.statSync(target).isDirectory();
            })
            .map(({ full }) => full);

        expect(missing, 'the repo map names paths that do not exist').toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Every script in the Scripts table is a real script
 * ------------------------------------------------------------------ */

/** The first column of every row in the table under the "### Scripts" heading. */
function scriptsTableNames() {
    const heading = README.indexOf('### Scripts');
    if (heading === -1) return [];

    const names = new Set();

    for (const line of README.slice(heading).split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('## ')) break;
        if (!trimmed.startsWith('|')) continue;

        const [, first = ''] = trimmed.split('|');
        for (const [, span] of first.matchAll(/`([^`]+)`/g)) {
            const name = span.replace(/^npm run /, '').replace(/^npm /, '');
            if (/^[a-z][a-z0-9:-]*$/.test(name)) names.add(name);
        }
    }

    return [...names];
}

describe('the Scripts table lists scripts that exist', () => {
    it('found the table', () => {
        expect(scriptsTableNames().length).toBeGreaterThan(8);
    });

    it('names only scripts package.json defines', () => {
        const unknown = scriptsTableNames().filter((name) => !(name in PACKAGE.scripts));

        expect(unknown, 'README documents npm scripts that package.json does not define')
            .toEqual([]);
    });
});

/* ------------------------------------------------------------------ *
 * 5. CLAUDE.md carries every architecture rule the suite asserts
 * ------------------------------------------------------------------ */

const ARCHITECTURE_SUITES = [
    'tests/architecture/boundaries.test.js',
    'tests/architecture/no-dead-code.test.js',
];

/** The numbered rules in CLAUDE.md's architecture section, in order. */
function architectureRuleNumbers() {
    const start = CLAUDE.indexOf('## Architecture boundaries');
    if (start === -1) return [];

    const rest = CLAUDE.slice(start);
    const end = rest.indexOf('\n## ', 1);
    const section = end === -1 ? rest : rest.slice(0, end);

    return [...section.matchAll(/^(\d+)\. \*\*/gm)].map((match) => Number(match[1]));
}

describe('CLAUDE.md documents the enforced architecture rules', () => {
    it('names both suites that enforce them', () => {
        for (const suite of ARCHITECTURE_SUITES) {
            expect(fs.existsSync(path.join(ROOT, suite)), `${suite} is missing`).toBe(true);
            expect(CLAUDE, `CLAUDE.md never names ${suite}`).toContain(suite);
        }
    });

    it('numbers the rules 1 to 9 with no gap and no repeat', () => {
        expect(architectureRuleNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
});
