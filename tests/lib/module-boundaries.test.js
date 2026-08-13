/**
 * Module Boundaries
 *
 * Three rules that are invisible in the source and expensive to rediscover.
 * Each one was a measured problem before it was a test, and each one regresses
 * by somebody doing a perfectly reasonable thing:
 *
 *  1. HEAVY DEPENDENCIES ARE LAZY. A top-level `import JSZip from 'jszip'` in
 *     lib/upload/bulk-batch.js put 124 KB of archiver into the FIRST LOAD of
 *     /resize, /resize-jpg and /resize-png — paid by everyone who resizes one
 *     image and never opens the bulk tab. Moving it behind `import()` took
 *     /resize from 871.4 KB to 681.3 KB. The same rule already covers
 *     @cantoo/pdf-lib and all seven WASM codecs; this test is what stops the
 *     next one from escaping.
 *
 *  2. THE ENGINE READS lib/limits.js, THE PAGES READ lib/catalog.js. They used
 *     to be one file with a fan-in of 38, so editing a tool's description
 *     touched a module the image engine imports. lib/constants.js survives only
 *     as a dead re-export awaiting the owner's confirmation to delete it —
 *     nothing may import it again.
 *
 *  3. lib/hooks/ IS REACT, lib/format/ IS NOT. The WORKER engine imports
 *     lib/format/upload-helpers.js and lib/format/submit-helpers.js directly.
 *     While those two sat in lib/hooks/, beside four 'use client' files, the
 *     worker's React-free guarantee rested on nobody adding a useState to a
 *     file in a directory called hooks — which is exactly what that directory
 *     invites.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_DIRS = ['app', 'components', 'lib'];

function walk(dir, out = []) {
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) return out;

    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(relative, out);
        else if (entry.name.endsWith('.js')) out.push(relative);
    }
    return out;
}

const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => walk(dir));

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** A static `import ... from '<specifier>'`, which `import('<specifier>')` is not. */
function hasStaticImportOf(source, specifier) {
    const pattern = new RegExp(
        String.raw`(^|\n)\s*import\s[^;]*?from\s*['"]${specifier}['"]`,
        's'
    );
    return pattern.test(source);
}

describe('heavy dependencies stay behind import()', () => {
    const HEAVY = ['jszip', '@cantoo/pdf-lib'];

    for (const dependency of HEAVY) {
        it(`no module statically imports ${dependency}`, () => {
            const offenders = SOURCE_FILES.filter((file) =>
                hasStaticImportOf(read(file), dependency)
            );
            expect(offenders, `${dependency} must be loaded with import()`).toEqual([]);
        });
    }

    it('bulk-batch reaches jszip through a memoised dynamic import', () => {
        const source = read(path.join('lib', 'upload', 'bulk-batch.js'));
        expect(source).toMatch(/import\(\s*'jszip'\s*\)/);
        expect(hasStaticImportOf(source, 'jszip')).toBe(false);
    });
});

describe('the engine limits and the site catalogue stay apart', () => {
    it('nothing imports the retired lib/constants.js', () => {
        const offenders = SOURCE_FILES.filter(
            (file) => file !== path.join('lib', 'constants.js') && read(file).includes("'@/lib/constants'")
        );
        expect(offenders, 'import from @/lib/limits or @/lib/catalog').toEqual([]);
    });

    it('lib/limits.js carries no page copy and imports nothing', () => {
        const source = read(path.join('lib', 'limits.js'));
        expect(source).not.toMatch(/\bTOOLS\b\s*=/);
        expect(source).not.toMatch(/\bLONGTAIL_PAGES\b\s*=/);
        expect(source).not.toMatch(/\bSOCIAL_PRESETS\b\s*=/);
        expect(source).not.toMatch(/(^|\n)\s*import\s/);
    });

    it('lib/catalog.js carries no limits and imports nothing', () => {
        const source = read(path.join('lib', 'catalog.js'));
        expect(source).not.toMatch(/export const MAX_[A-Z_]+\s*=/);
        expect(source).not.toMatch(/export const DEFAULT_QUALITY\s*=/);
        expect(source).not.toMatch(/(^|\n)\s*import\s/);
    });
});

describe('the worker never reaches React through lib/', () => {
    const hookFiles = walk(path.join('lib', 'hooks'));
    const formatFiles = walk(path.join('lib', 'format'));

    it('lib/hooks/ is not empty and lib/format/ is not empty', () => {
        expect(hookFiles.length).toBeGreaterThan(0);
        expect(formatFiles.length).toBeGreaterThan(0);
    });

    it.each(hookFiles)('%s is a client module', (file) => {
        expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
    });

    it.each(formatFiles)('%s is pure — no React, no client directive', (file) => {
        const source = read(file);
        expect(source).not.toMatch(/from\s*['"]react['"]/);
        expect(source).not.toMatch(/\buse[A-Z]\w*\s*\(/);
        expect(source.trimStart().startsWith("'use client'")).toBe(false);
    });

    it('the worker engine imports its formatting helpers from lib/format/', () => {
        const source = read(path.join('lib', 'image-client', 'operations.js'));
        expect(source).toContain("'@/lib/format/submit-helpers'");
        expect(source).toContain("'@/lib/format/upload-helpers'");
        expect(source).not.toContain("'@/lib/hooks/");
    });
});
