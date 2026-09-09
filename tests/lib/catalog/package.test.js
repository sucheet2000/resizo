/**
 * THE CATALOG PACKAGE
 *
 * lib/catalog.js held the tool registry, the long-tail routes and the presets
 * in one file. It is a package now — one module per concern, an index that
 * re-exports the lot so `@/lib/catalog` keeps resolving — and this suite pins
 * that shape: the old file is gone, each module owns what it says it owns,
 * every tool sits in a category that exists, and the validator that will guard
 * the registry at build time knows a broken registry when it sees one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as catalog from '@/lib/catalog';
import { CATEGORIES, categoriesWithProducts, getCategory, toolsInCategory } from '@/lib/catalog/categories';
import { INTENTS, getIntent, intentsFor } from '@/lib/catalog/intents';
import { ASPECT_RATIOS, SOCIAL_PRESETS, getSocialPreset, socialPresetGroups } from '@/lib/catalog/presets';
import { relatedTools } from '@/lib/catalog/relations';
import { TOOLS, getTool, sitemapTools } from '@/lib/catalog/tools';
import { assertCatalogValid, validateCatalog } from '@/lib/catalog/validate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('the package replaces the file', () => {
    it('has no lib/catalog.js beside lib/catalog/', () => {
        expect(fs.existsSync(path.join(ROOT, 'lib', 'catalog.js'))).toBe(false);
        expect(fs.existsSync(path.join(ROOT, 'lib', 'catalog', 'index.js'))).toBe(true);
    });

    it('re-exports every registry and helper from the index', () => {
        expect(catalog.TOOLS).toBe(TOOLS);
        expect(catalog.getTool).toBe(getTool);
        expect(catalog.sitemapTools).toBe(sitemapTools);
        expect(catalog.relatedTools).toBe(relatedTools);
        expect(catalog.SOCIAL_PRESETS).toBe(SOCIAL_PRESETS);
        expect(catalog.getSocialPreset).toBe(getSocialPreset);
        expect(catalog.socialPresetGroups).toBe(socialPresetGroups);
        expect(catalog.ASPECT_RATIOS).toBe(ASPECT_RATIOS);
        expect(catalog.INTENTS).toBe(INTENTS);
        expect(catalog.getIntent).toBe(getIntent);
        expect(catalog.intentsFor).toBe(intentsFor);
        expect(catalog.CATEGORIES).toBe(CATEGORIES);
        expect(catalog.categoriesWithProducts).toBe(categoriesWithProducts);
        expect(catalog.validateCatalog).toBe(validateCatalog);
    });
});

describe('categories', () => {
    it('gives every category an id, a title and a blurb, and keeps ids unique', () => {
        expect(CATEGORIES.length).toBeGreaterThan(0);
        for (const category of CATEGORIES) {
            expect(category.id).toMatch(/^[a-z0-9-]+$/);
            expect(category.title.length).toBeGreaterThan(0);
            expect(category.blurb.length).toBeGreaterThan(20);
        }
        expect(new Set(CATEGORIES.map((category) => category.id)).size).toBe(CATEGORIES.length);
    });

    it('puts every tool in a category that exists', () => {
        for (const tool of TOOLS) {
            expect(getCategory(tool.category), `${tool.slug} is in an unknown category`).not.toBeNull();
        }
    });

    it('groups the tools by category in registry order', () => {
        const gathered = CATEGORIES.flatMap((category) => toolsInCategory(category.id));
        expect(gathered).toHaveLength(TOOLS.length);
        expect(new Set(gathered.map((tool) => tool.slug)).size).toBe(TOOLS.length);
    });

    it('shows only the categories that hold a tool with a page of its own', () => {
        const shown = categoriesWithProducts();
        expect(shown.length).toBeGreaterThan(0);
        for (const category of shown) {
            expect(toolsInCategory(category.id).some((tool) => tool.hasOwnPage)).toBe(true);
        }
        // Every shipped category currently has a product; the hiding is proved
        // on a synthetic registry rather than by inventing an empty category.
        expect(shown).toEqual(CATEGORIES);
    });

    it('hides a category with no product in it, and one whose only tool has no page', () => {
        const tools = [
            { slug: 'resize', hasOwnPage: true, category: 'resize-crop' },
            { slug: 'bulk-resize', hasOwnPage: false, category: 'batch' },
        ];
        const categories = [
            { id: 'resize-crop', title: 'Resize & Crop', blurb: 'x' },
            { id: 'batch', title: 'Batch', blurb: 'x' },
            { id: 'ai', title: 'AI Image Tools', blurb: 'x' },
        ];
        expect(categoriesWithProducts({ tools, categories }).map((category) => category.id)).toEqual(['resize-crop']);
    });

    it.each([['an unknown id', 'sharpen'], ['an empty string', ''], ['null', null], ['undefined', undefined]])(
        'returns null for %s',
        (_label, id) => {
            expect(getCategory(id)).toBeNull();
        },
    );
});

describe('validateCatalog', () => {
    it('finds nothing wrong with the shipped registry', () => {
        expect(validateCatalog()).toEqual([]);
        expect(() => assertCatalogValid()).not.toThrow();
    });

    const base = () => ({
        tools: TOOLS.map((tool) => ({ ...tool })),
        categories: CATEGORIES.map((category) => ({ ...category })),
        presets: SOCIAL_PRESETS.map((preset) => ({ ...preset })),
        ratios: ASPECT_RATIOS.map((ratio) => ({ ...ratio })),
        intents: INTENTS.map((page) => ({ ...page })),
    });

    const codes = (registry) => validateCatalog(registry).map((problem) => problem.code);

    it('reports a tool slug used twice', () => {
        const registry = base();
        registry.tools.push({ ...registry.tools[0], href: '/resize-again' });
        expect(codes(registry)).toContain('tool-slug-duplicate');
    });

    it('reports two routes claiming one path', () => {
        const registry = base();
        registry.intents[0] = { ...registry.intents[0], slug: 'compress', path: '/compress' };
        expect(codes(registry)).toContain('path-duplicate');
    });

    it('reports a tool in a category that does not exist', () => {
        const registry = base();
        registry.tools[0] = { ...registry.tools[0], category: 'nowhere' };
        expect(codes(registry)).toContain('tool-category-unknown');
    });

    it('reports an intent hung off a tool with no page of its own', () => {
        const registry = base();
        registry.intents[0] = { ...registry.intents[0], tool: 'bulk-resize' };
        expect(codes(registry)).toContain('intent-parent-invalid');
    });

    it('reports an intent whose path is not its slug', () => {
        const registry = base();
        registry.intents[0] = { ...registry.intents[0], path: '/elsewhere' };
        expect(codes(registry)).toContain('intent-path-mismatch');
    });

    it('reports a slug that a route could not serve', () => {
        const registry = base();
        registry.intents[0] = { ...registry.intents[0], slug: 'Resize JPG', path: '/Resize JPG' };
        expect(codes(registry)).toContain('slug-malformed');
    });

    it('reports a reserved path, which a static route already owns', () => {
        const registry = base();
        registry.intents[0] = { ...registry.intents[0], slug: 'about', path: '/about' };
        expect(codes(registry)).toContain('path-reserved');
    });

    it('reports a platform preset the resizer would refuse', () => {
        const registry = base();
        registry.presets[0] = { ...registry.presets[0], width: 9000 };
        expect(codes(registry)).toContain('preset-out-of-range');
    });

    it('names the subject in every problem, so a failure is actionable', () => {
        const registry = base();
        registry.tools[0] = { ...registry.tools[0], category: 'nowhere' };
        const [problem] = validateCatalog(registry);
        expect(problem.subject).toBe('resize');
        expect(problem.message).toContain('nowhere');
    });

    it('throws with every problem listed when asked to assert', () => {
        const registry = base();
        registry.tools[0] = { ...registry.tools[0], category: 'nowhere' };
        registry.intents[0] = { ...registry.intents[0], path: '/elsewhere' };
        expect(() => assertCatalogValid(registry)).toThrow(/nowhere[\s\S]*elsewhere|elsewhere[\s\S]*nowhere/);
    });
});
