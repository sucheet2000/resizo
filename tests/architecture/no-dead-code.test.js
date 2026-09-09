/**
 * NOTHING UNREACHABLE SURVIVES
 *
 * Two rules, both of which this repo broke while nobody was looking.
 *
 *  1. EVERY MODULE IN lib/ AND components/ IS REACHED FROM AN ENTRY POINT.
 *     Four were not: components/ui/Modal.js (173 lines) outlived the account
 *     dialogs it was built for, lib/csv.js outlived the usage export, and
 *     lib/constants.js and lib/image-client/index.js were both left behind by
 *     refactors as re-export shims that every caller had already stopped using.
 *     Each still had a passing test, so the suite reported them as covered
 *     working code. Coverage cannot see this: a test importing a dead module
 *     makes it look alive.
 *
 *  2. THE REPO ROOT HOLDS ONLY WHAT IT IS SUPPOSED TO.
 *     Three SheetJS documentation pages and a screenshot of a competitor's
 *     homepage — 217 KB of scratch from a research task — were committed to the
 *     root and sat there through four subsequent pull requests. Nothing imports
 *     a stray root file, so no other rule in this suite could see them, and
 *     `git status` was clean because they were committed.
 *
 * The whitelist below is the assertion, not an exemption list. Adding a file to
 * the root of a repo is a deliberate act — a build config, a licence, a
 * dockerfile — and typing its name here is the cost of that act. Scratch output
 * from a research task never earns the line.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatChain, importClosure, listSourceFiles, ROOT } from '@/tests/helpers/import-graph';

import { execFileSync } from 'node:child_process';

/**
 * Next's file-based router owns app/, so every module under it is an entry
 * point or is reached from one — enumerating page.js, layout.js, route.js,
 * not-found.js, sitemap.js, manifest.js and the rest would only go stale the
 * next time Next adds a convention.
 *
 * The other two entries are the ones no import graph can find on its own:
 * the worker, which lib/image-client/client.js loads through
 * `new Worker(new URL('./image.worker.js', import.meta.url))` rather than an
 * import, and scripts/, which npm invokes by path.
 */
const ENTRY_POINTS = [
    ...listSourceFiles('app'),
    ...listSourceFiles('scripts'),
    'lib/image-client/image.worker.js',
];

const OWNED = [...listSourceFiles('lib'), ...listSourceFiles('components')];

function reachable() {
    const seen = new Map();
    for (const entry of ENTRY_POINTS) {
        for (const [file, chain] of importClosure(entry, { edges: 'all' })) {
            if (!seen.has(file)) seen.set(file, chain);
        }
    }
    return seen;
}

describe('every module is reachable from an entry point', () => {
    // Without this the rule passes vacuously: an entry list that resolves to
    // nothing leaves an empty closure, and an empty closure accuses every file
    // rather than none — but a closure that silently stopped following imports
    // would accuse them too. Prove the walk actually crossed the layers first.
    it('walks from a page all the way down to the engine', () => {
        expect(ENTRY_POINTS.length).toBeGreaterThan(20);
        expect(ENTRY_POINTS).toContain('lib/image-client/image.worker.js');

        const found = reachable();
        for (const expected of [
            'components/tools/ToolShell.js',
            'lib/catalog/index.js',
            'lib/limits.js',
            'lib/image-client/operations.js',
            'lib/image-client/encode.js',
        ]) {
            expect([...found.keys()], `the walk never reached ${expected}`).toContain(expected);
        }
    });

    it('leaves nothing in lib/ or components/ unreached', () => {
        const found = reachable();
        const orphans = OWNED.filter((file) => !found.has(file));

        expect(
            orphans,
            'dead modules — delete them, or import them from something that ships:\n  ' +
                orphans.join('\n  ')
        ).toEqual([]);
    });

    it('names the chain that reaches a module, so a failure is actionable', () => {
        const chain = reachable().get('lib/image-client/encode.js');
        expect(formatChain(chain)).toMatch(/encode\.js$/);
    });
});

/**
 * Tracked files only. Build output, coverage reports and Playwright artifacts
 * land in the root too, and .gitignore is what holds those back — this rule is
 * about what gets *committed*.
 */
const ROOT_FILES = execFileSync('git', ['ls-files', '--full-name'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0 && !line.includes('/'));

const ALLOWED_AT_ROOT = new Set([
    '.dockerignore',
    '.env.example',
    '.gitignore',
    'CLAUDE.md',
    'DESIGN.md',
    'Dockerfile',
    'LICENSE',
    'README.md',
    'docker-compose.yml',
    'eslint.config.mjs',
    'jsconfig.json',
    'next.config.js',
    'package-lock.json',
    'package.json',
    'playwright.config.js',
    'postcss.config.mjs',
    'vercel.json',
    'vitest.config.mjs',
]);

describe('the repo root', () => {
    it('reads the list it is asserting against', () => {
        expect(ROOT_FILES).toContain('package.json');
        expect(ROOT_FILES.length).toBeGreaterThan(10);
    });

    it('holds no file that has not been deliberately put there', () => {
        const strays = ROOT_FILES.filter((file) => !ALLOWED_AT_ROOT.has(file));

        expect(
            strays,
            'unexpected file(s) in the repo root. Scratch output belongs in the ' +
                'scratchpad, not in a commit; a genuinely new root file belongs in ' +
                'ALLOWED_AT_ROOT:\n  ' + strays.join('\n  ')
        ).toEqual([]);
    });

    it('keeps every allowed name real, so the list cannot rot', () => {
        const missing = [...ALLOWED_AT_ROOT].filter((file) => !ROOT_FILES.includes(file));
        expect(missing, 'ALLOWED_AT_ROOT names files that no longer exist').toEqual([]);
    });
});

describe('lib/ has no directory whose name collides with a sibling file', () => {
    // lib/format-bytes.js sat beside lib/format/, so `@/lib/format...` could
    // mean either and a reader had to open both to find out which. The engine
    // imports out of lib/format/, which made the ambiguity load-bearing.
    it('keeps helper modules inside the directory that names them', () => {
        const dirs = new Set(
            listSourceFiles('lib')
                .map((file) => path.dirname(file))
                .filter((dir) => dir !== 'lib')
                .map((dir) => path.basename(dir))
        );
        const collisions = listSourceFiles('lib')
            .filter((file) => path.dirname(file) === 'lib')
            .filter((file) => [...dirs].some((dir) => path.basename(file).startsWith(`${dir}-`)));

        expect(
            collisions,
            'move these into the directory their name already claims:\n  ' + collisions.join('\n  ')
        ).toEqual([]);
    });
});
