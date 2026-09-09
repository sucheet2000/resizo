/**
 * THE SHARED INTENT ROUTE
 *
 * app/(tools)/[slug]/page.js serves every intent in the registry and nothing
 * else. Three things make that safe and they are all asserted here: the
 * static params come from the registry, so a new entry is built and an
 * unregistered slug is a 404 (dynamicParams is off — this is a single dynamic
 * segment, never a catch-all); the metadata for a slug is exactly what
 * intentMetadata() builds; and every tool an intent may hang off has a
 * component in the route's map, so the page can never render an empty panel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as route from '@/app/(tools)/[slug]/page';
import { INTENT_TOOL_SLUGS } from '@/app/(tools)/[slug]/IntentTool';
import { INTENTS, getIntent } from '@/lib/catalog';
import { INTENT_CAPABLE_TOOLS } from '@/lib/catalog/validate';
import { intentMetadata } from '@/lib/seo';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTE_DIR = path.join(ROOT, 'app', '(tools)', '[slug]');

describe('the intent route', () => {
    it('is one dynamic segment, not a catch-all', () => {
        expect(fs.existsSync(path.join(ROUTE_DIR, 'page.js'))).toBe(true);
        for (const entry of fs.readdirSync(path.join(ROOT, 'app', '(tools)'))) {
            expect(entry, 'a catch-all would serve arbitrary paths').not.toMatch(/\[\.\.\./);
        }
    });

    it('refuses any slug the registry does not know', () => {
        expect(route.dynamicParams).toBe(false);
    });

    it('prerenders every registered intent, in registry order', () => {
        expect(route.generateStaticParams()).toEqual(INTENTS.map((intent) => ({ slug: intent.slug })));
        expect(route.generateStaticParams().length).toBeGreaterThanOrEqual(10);
    });

    it('validates the registry while collecting params, so a broken entry fails the build', () => {
        const source = fs.readFileSync(path.join(ROUTE_DIR, 'page.js'), 'utf8');
        expect(source).toMatch(/assertCatalogValid\(\)/);
    });

    it.each(INTENTS.map((intent) => [intent.slug]))('%s gets the metadata the registry describes', async (slug) => {
        const metadata = await route.generateMetadata({ params: Promise.resolve({ slug }) });
        expect(metadata).toEqual(intentMetadata(getIntent(slug)));
        expect(metadata.alternates.canonical).toBe(`https://www.resizo.net/${slug}`);
    });

    it('treats an unknown slug as not found even if it were reached', async () => {
        await expect(route.generateMetadata({ params: Promise.resolve({ slug: 'png-to-tiff' }) })).rejects.toThrow();
    });

    it('has a tool component for exactly the tools that may host an intent', () => {
        expect([...INTENT_TOOL_SLUGS].sort()).toEqual([...INTENT_CAPABLE_TOOLS].sort());
        for (const intent of INTENTS) {
            expect(INTENT_TOOL_SLUGS, `${intent.slug} hangs off ${intent.tool}, which the route cannot render`).toContain(intent.tool);
        }
    });
});
