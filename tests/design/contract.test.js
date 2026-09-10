/**
 * DESIGN CONTRACT ENFORCEMENT
 *
 * DESIGN.md ends with a rejection clause: "Any PR that reintroduces one of
 * these is wrong even if it looks good in isolation." A clause nobody can run
 * is a suggestion, so this suite turns it into a gate. It reads the source of
 * app/, components/ and the catalogue's page copy as text and fails on the
 * banned patterns.
 *
 * Two escape hatches exist, and both are deliberately noisy:
 *
 *   ALLOWLIST         permanent, justified exceptions. Each entry names the
 *                     file, the pattern and the reason. A stale entry FAILS the
 *                     suite, so the list cannot quietly accumulate.
 *
 *   PENDING_MIGRATION files not yet rebuilt on the token system. Skipped
 *                     wholesale. Delete an entry the moment its page lands —
 *                     the suite checks each listed path still exists so the
 *                     list cannot rot silently, and prints what is left.
 *
 * Weakening a regex to make this pass is the one wrong answer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_COLORS } from '@/lib/theme';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// lib/catalog holds the page copy of the intent routes since they moved out
// of app/, so the banned-copy rules read it too.
const SCAN_DIRS = ['app', 'components', 'lib/catalog'];
const GLOBALS_CSS = path.join(ROOT, 'app', 'globals.css');

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

const ALLOWLIST = [];

const PENDING_MIGRATION = [];

const PENDING_PATHS = new Set(PENDING_MIGRATION.map((entry) => entry.file));

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

// A Tailwind class token is preceded by a quote or whitespace. Anchoring on
// that is what keeps `to-` from matching the "to" in "/heic-to-jpg".
const CLASS_START = '(?<=["\'`\\s])';

const RULES = [
    {
        id: 'gradient-utility',
        pattern: /\bbg-gradient(-|\b)|\bbg-(linear|radial|conic)(-|\b)/g,
        message: 'gradients are on the rejection list — background, text or border',
    },
    {
        id: 'gradient-stop',
        pattern: new RegExp(
            `${CLASS_START}(from|via|to)-(\\[#|[a-z]+-\\d{2,3}\\b|current\\b|transparent\\b|white\\b|black\\b)`,
            'g',
        ),
        message: 'gradient colour stops (from-/via-/to-) mean a gradient is being built',
    },
    {
        id: 'backdrop-blur',
        pattern: /backdrop-blur/g,
        message: 'glass / backdrop-blur is on the rejection list',
    },
    {
        id: 'arrow-orphan',
        pattern: /> →<\/span>/g,
        message: 'a trailing arrow follows a non-breaking space (&nbsp;→), or it wraps onto a line of its own',
    },
    {
        id: 'oversized-radius',
        pattern: /\brounded-(2xl|3xl|4xl)\b/g,
        message: 'radius is capped at 12px (rounded-panel); rounded-2xl and larger are removed from the theme',
    },
    {
        id: 'text-glow',
        pattern: /\btext-glow\b|text-shadow/g,
        message: 'glows are on the rejection list',
    },
    {
        id: 'accent-hover-fade',
        // Measured: white on the accent is 4.94:1 at rest and 4.21:1 once the
        // button fades to 90% on hover, which is under the 4.5:1 the text
        // needs. A hover darkens the accent instead of thinning it.
        pattern: /bg-accent[^"'`]*hover:opacity-|hover:opacity-[^"'`]*bg-accent/g,
        message: 'an accent-filled control may not fade on hover — white on the accent drops under 4.5:1; darken it (hover:brightness-95) instead',
    },
    {
        id: 'accent-link-fade',
        // Measured: accent text on the page ground is 4.94:1 at rest and
        // 3.41:1 once a link fades to 80% on hover (3.59:1 on white). A link
        // shows its hover by thickening its underline instead, which changes
        // no colour at all.
        pattern: /text-accent[^"'`]*hover:opacity-|hover:opacity-[^"'`]*text-accent/g,
        message: 'an accent link may not fade on hover — the accent drops under 4.5:1; thicken the underline (hover:decoration-2) instead',
    },
    {
        id: 'glass',
        pattern: /\bglass(?!es\b)[-\w]*\b/gi,
        message: 'glass surfaces are on the rejection list',
    },
    {
        id: 'raw-palette',
        pattern: /\b(bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow|accent|decoration|caret)-(indigo|violet|purple|slate|zinc|gray|neutral|stone|blue|red|green|amber|yellow|orange|emerald|teal|sky|cyan|lime|rose|pink|fuchsia)-[0-9]/g,
        message: 'colour comes from the eight tokens only — no raw Tailwind palette utilities',
    },
    {
        id: 'arbitrary-hex',
        // Hex outside globals.css. lib/ is not scanned at all.
        pattern: /#[0-9a-fA-F]{3,8}\b/g,
        message: 'every colour value lives in app/globals.css — no arbitrary hex in a component',
    },
    {
        id: 'h-screen',
        pattern: /\bh-screen\b/g,
        message: 'h-screen cuts off behind mobile browser chrome — use min-h-[100dvh]',
    },
    {
        id: 'bare-new-image',
        // `new window.Image()` does not match: the regex requires Image to
        // follow `new ` directly.
        pattern: /new\s+Image\s*\(/g,
        message: 'use new window.Image() — a bare new Image() resolves to the next/image component and throws',
    },
];

/**
 * BANNED COPY — the ban is a truth ban, and the truth moved.
 *
 * It used to catch "in your browser" and "never leave your device", because on
 * the server build those sentences were lies: the file really was posted to a
 * Next.js route, decoded by sharp and thrown away afterwards. There is no route
 * and no sharp any more — every tool decodes and encodes in the visitor's own
 * tab — so those three phrases are now the most accurate thing the product can
 * say, and the list below catches the lie that replaced them.
 *
 * The rule: copy may not claim that anything is uploaded, stored, received or
 * sent to a server, because none of that happens. That includes the reassuring
 * version of the claim — "deleted the moment your download starts" only means
 * anything if the file was sent somewhere first, so it is banned exactly like
 * "processed on our server" is.
 *
 * Two entries are not truth bans and are kept for the reason they were added:
 * "client-side" / "client side" is jargon a visitor does not use, and the
 * vocabulary block below it is the anti-slop list from DESIGN.md.
 */
const BANNED_COPY = [
    // Claims a transfer that no longer happens.
    'our server',
    'our servers',
    'over https',
    'uploaded to',
    // Claims storage, and then reassures about storage that cannot exist.
    'deleted the moment',
    'discarded the moment',
    'deleted after processing',
    'deleted right after',
    'never written to disk',
    'never kept',
    'temporary storage',
    'vercel blob',
    // There is no request to limit and nothing to count.
    'rate limit',
    // Promises about the business rather than the tools. The durable promise
    // is that every CORE tool is free to use with no account, no watermark
    // and no daily quota — not that Resizo can never be commercial, never
    // have a paid product or never earn anything. Copy that says the latter
    // is a promise nobody can keep and has to be rewritten the day it is
    // broken, which is the worst moment to be rewriting the trust copy.
    'non-commercial',
    'noncommercial',
    'no paid tier',
    'free forever',
    'always free',
    'always be free',
    'never charge',
    'never be monetised',
    'never be monetized',
    'never monetise',
    'never monetize',
    // Jargon, not a lie.
    'client-side',
    'client side',
    'premium',
    'enterprise-grade',
    'professional-grade',
    'zero friction',
    'lightning fast',
    'next-gen',
    'supercharge',
    'world-class',
];

// Whole-word bans: 'elevate' must not match 'elevation'.
const BANNED_WORDS = ['seamless', 'elevate', 'unleash'];

const COPY_RULES = [
    ...BANNED_COPY.map((phrase) => ({
        id: `copy:${phrase}`,
        pattern: new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        message: `"${phrase}" is banned copy (untrue, or on the banned-vocabulary list)`,
    })),
    ...BANNED_WORDS.map((word) => ({
        id: `copy:${word}`,
        pattern: new RegExp(`\\b${word}\\b`, 'gi'),
        message: `"${word}" is on the banned-vocabulary list`,
    })),
];

const ALL_RULES = [...RULES, ...COPY_RULES];

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

function walk(dir) {
    const out = [];
    const absolute = path.join(ROOT, dir);
    if (!fs.existsSync(absolute)) return out;

    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        const relative = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            out.push(...walk(relative));
        } else if (entry.isFile() && /\.jsx?$/.test(entry.name)) {
            out.push(relative);
        }
    }

    return out;
}

const SOURCE_FILES = SCAN_DIRS.flatMap(walk)
    .map((file) => file.split(path.sep).join('/'))
    .sort();

const SCANNED_FILES = SOURCE_FILES.filter((file) => !PENDING_PATHS.has(file));

const CONTENTS = new Map(
    SOURCE_FILES.map((file) => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]),
);

function isAllowed(file, ruleId) {
    return ALLOWLIST.some((entry) => entry.file === file && entry.rule === ruleId);
}

function lineOf(source, index) {
    return source.slice(0, index).split('\n').length;
}

function violationsIn(file, rule) {
    const source = CONTENTS.get(file) ?? '';
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const found = [];

    let match = pattern.exec(source);
    while (match !== null) {
        found.push(`${file}:${lineOf(source, match.index)} — ${match[0].trim()}`);
        if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
        match = pattern.exec(source);
    }

    return found;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('design contract: the scan itself', () => {
    it('bans an accent link that fades on hover, and passes one that thickens its underline', () => {
        const rule = RULES.find((entry) => entry.id === 'accent-link-fade');
        const hits = (text) => text.match(rule.pattern) ?? [];
        expect(hits('"text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"')).toHaveLength(1);
        expect(hits('"text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2"')).toEqual([]);
        expect(hits('"text-ink transition-opacity hover:opacity-80"')).toEqual([]);
    });

    it('bans glass surfaces without banning the everyday word for spectacles', () => {
        const rule = RULES.find((entry) => entry.id === 'glass');
        const hits = (text) => text.match(rule.pattern) ?? [];
        expect(hits('bg-surface/80 glass-panel glassmorphism glass')).toEqual(['glass-panel', 'glassmorphism', 'glass']);
        expect(hits('Take off any eyeglasses, sunglasses, or tinted glasses. Glasses are permitted only')).toEqual([]);
    });

    it('finds source to scan', () => {
        expect(SOURCE_FILES.length).toBeGreaterThan(10);
        expect(SCANNED_FILES.length).toBeGreaterThan(10);
    });

    it('covers the design-system components', () => {
        for (const file of [
            'components/tools/ToolShell.js',
            'components/tools/ResultPanel.js',
            'components/ui/Dropzone.js',
            'components/layout/SiteHeader.js',
            'app/layout.js',
        ]) {
            expect(SCANNED_FILES).toContain(file);
        }
    });
});

describe('design contract: rejection clause', () => {
    it.each(ALL_RULES.map((rule) => [rule.id, rule]))('bans %s', (_id, rule) => {
        const violations = SCANNED_FILES
            .filter((file) => !isAllowed(file, rule.id))
            .flatMap((file) => violationsIn(file, rule));

        expect(violations, `${rule.message}\n${violations.join('\n')}`).toEqual([]);
    });
});

/**
 * The other half of the ban. Deleting a phrase from BANNED_COPY only stops the
 * suite complaining; it does not make the page say anything. DESIGN.md requires
 * a concrete privacy line at the point of upload, so these three surfaces — the
 * panel every tool renders, the footer on every route, and the homepage — have
 * to state where the work actually happens, in words a visitor uses.
 */
const PRIVACY_LINE_FILES = [
    'components/tools/TrustStrip.js',
    'components/layout/SiteFooter.js',
    'app/(marketing)/page.js',
];

/** The pages that must compose the strip rather than restate its sentence. */
const TRUST_STRIP_FILES = [
    'components/tools/ToolShell.js',
];

describe('design contract: the trust facts are stated through the strip, once', () => {
    it.each(TRUST_STRIP_FILES)('%s composes TrustStrip', (file) => {
        const source = CONTENTS.get(file);
        expect(source, `${file} is not being scanned`).toBeTruthy();
        expect(source).toMatch(/import TrustStrip from '@\/components\/tools\/TrustStrip'/);
        expect(source).toMatch(/<TrustStrip[\s/>]/);
    });
});

describe('design contract: the privacy line states where the work happens', () => {
    it.each(PRIVACY_LINE_FILES)('%s says the file stays on the visitor’s device', (file) => {
        const source = CONTENTS.get(file);
        expect(source, `${file} is not being scanned`).toBeTruthy();
        expect(
            source,
            `${file} must carry the privacy line — "on your device" / "never leaves your device"`,
        ).toMatch(/on your (own )?device|never leaves your device/i);
    });
});

/**
 * The positive half of the business-copy rule: the pages that explain what
 * Resizo is have to state the promise the product actually keeps — every
 * core tool free to use, no account, no watermark, no daily quota — rather
 * than merely no longer saying the wrong thing.
 */
const PROMISE_FILES = [
    'app/(marketing)/page.js',
    'app/(marketing)/about/page.js',
];

describe('design contract: the free-core-tools promise is stated, in its durable form', () => {
    it.each(PROMISE_FILES)('%s promises free core tools with no account, no watermark and no daily quota', (file) => {
        const source = CONTENTS.get(file);
        expect(source, `${file} is not being scanned`).toBeTruthy();

        expect(source).toMatch(/core\s+(Resizo\s+)?tools?\s+(is|are)\s+free\s+to\s+use/i);
        expect(source).toMatch(/no account/i);
        expect(source).toMatch(/no watermark/i);
        expect(source).toMatch(/no daily quota/i);
    });
});

describe('design contract: allowlist stays honest', () => {
    it('has a file, a rule and a reason on every entry', () => {
        for (const entry of ALLOWLIST) {
            expect(entry.file, 'allowlist entry needs a file').toBeTruthy();
            expect(ALL_RULES.map((rule) => rule.id)).toContain(entry.rule);
            expect(entry.reason.length, `${entry.file} needs a real reason`).toBeGreaterThan(40);
        }
    });

    it('points only at files that exist', () => {
        for (const entry of ALLOWLIST) {
            expect(fs.existsSync(path.join(ROOT, entry.file)), `${entry.file} is gone`).toBe(true);
        }
    });

    it('carries no stale entry — an exception with nothing to except is deleted', () => {
        for (const entry of ALLOWLIST) {
            const rule = ALL_RULES.find((candidate) => candidate.id === entry.rule);
            const found = violationsIn(entry.file, rule);
            expect(
                found.length,
                `${entry.file} no longer violates ${entry.rule}; remove the allowlist entry`,
            ).toBeGreaterThan(0);
        }
    });
});

describe('design contract: pending migrations stay visible', () => {
    it('lists only files that still exist', () => {
        const missing = PENDING_MIGRATION
            .filter((entry) => !fs.existsSync(path.join(ROOT, entry.file)))
            .map((entry) => entry.file);

        expect(
            missing,
            `these files are gone — delete their PENDING_MIGRATION entries:\n${missing.join('\n')}`,
        ).toEqual([]);
    });

    it('gives every entry a reason', () => {
        for (const entry of PENDING_MIGRATION) {
            expect(entry.reason.length, `${entry.file} needs a reason`).toBeGreaterThan(20);
        }
    });
});

describe('design contract: globals.css defines the token system', () => {
    const css = fs.readFileSync(GLOBALS_CSS, 'utf8');

    it.each([
        '--surface',
        '--surface-raised',
        '--surface-sunken',
        '--ink',
        '--ink-muted',
        '--line',
        '--accent',
        '--accent-ink',
    ])('defines %s', (token) => {
        expect(css).toMatch(new RegExp(`${token}:\\s*#`));
    });

    it('defines the radius scale and caps it at 12px', () => {
        expect(css).toMatch(/--radius-input:\s*4px/);
        expect(css).toMatch(/--radius-button:\s*8px/);
        expect(css).toMatch(/--radius-panel:\s*12px/);
        expect(css).toMatch(/--radius-2xl:\s*initial/);
        expect(css).toMatch(/--radius-3xl:\s*initial/);
    });

    it('defines the four motion durations and the one easing curve', () => {
        for (const duration of ['120ms', '180ms', '240ms', '520ms']) {
            expect(css).toContain(duration);
        }
        expect(css).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    });

    it('defines the display clamp and the oversized numeral', () => {
        expect(css).toMatch(/--text-display:\s*clamp\(2\.5rem,\s*5vw,\s*4rem\)/);
        expect(css).toMatch(/--text-numeral:/);
    });

    it('ships both dark-mode guards', () => {
        expect(css).toContain('@media (prefers-color-scheme: dark)');
        expect(css).toContain(':root:not([data-theme="light"])');
        expect(css).toContain(':root[data-theme="dark"]');
    });

    it('redefines every colour token in both dark guards', () => {
        const mediaBlock = css.slice(
            css.indexOf(':root:not([data-theme="light"])'),
            css.indexOf(':root[data-theme="dark"]'),
        );
        const attributeBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));

        for (const token of ['--surface', '--surface-raised', '--surface-sunken', '--ink', '--ink-muted', '--line', '--accent', '--accent-ink']) {
            expect(mediaBlock, `${token} missing from the media-query guard`).toContain(`${token}:`);
            expect(attributeBlock, `${token} missing from the data-theme guard`).toContain(`${token}:`);
        }
    });

    it('ships the focus ring as 2px accent with 2px offset', () => {
        expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
        expect(css).toMatch(/:focus-visible\s*\{[^}]*outline-offset:\s*2px/);
    });

    it('ships the checkerboard at 3% contrast', () => {
        expect(css).toMatch(/@utility checkerboard/);
        expect(css).toMatch(/--checker:\s*rgb\([^)]*\/\s*0\.0[0-3]\)/);
    });

    it('ships the shadow-as-border and ambient layers', () => {
        expect(css).toMatch(/--elevation-edge:\s*0 0 0 1px/);
        expect(css).toMatch(/--elevation-raised:/);
        expect(css).toMatch(/--edge:\s*rgb\([^)]*\/\s*0\.08\)/);
    });

    it('ships the prefers-reduced-motion reset', () => {
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
        expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    });

    it('agrees with lib/theme.js, the one place a non-CSS consumer reads a colour', () => {
        const light = css.match(/:root\s*\{[\s\S]*?--surface:\s*(#[0-9A-Fa-f]{6})/);
        const dark = css.match(/:root\[data-theme="dark"\]\s*\{[\s\S]*?--surface:\s*(#[0-9A-Fa-f]{6})/);

        expect(light?.[1]).toBeTruthy();
        expect(dark?.[1]).toBeTruthy();
        expect(THEME_COLORS.light.toUpperCase()).toBe(light[1].toUpperCase());
        expect(THEME_COLORS.dark.toUpperCase()).toBe(dark[1].toUpperCase());
    });

    it('carries none of the deleted pre-redesign utilities', () => {
        for (const dead of ['.glass-panel', '.text-glow', 'shimmer', 'no-scrollbar', 'fade-in-up']) {
            expect(css, `${dead} was deleted in the redesign`).not.toContain(dead);
        }
    });
});
