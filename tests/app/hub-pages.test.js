/**
 * THE HUB PAGES LINK TO THEIR SPOKES
 *
 * An intent page is reachable two ways by design: from the /tools directory
 * and from its parent tool page, where the IntentLinks block lists every
 * intent that preconfigures that tool. The block reads the registry, so what
 * can go wrong is not a missing row but a hub page that stopped rendering the
 * block at all — which no registry test can see. This reads each hub page's
 * source for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INTENTS, TOOLS, intentsFor } from '@/lib/catalog';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const HUBS = TOOLS.filter((tool) => tool.hasOwnPage && intentsFor(tool.slug).length > 0);

describe('every tool with intents links to them from its own page', () => {
    it('found the hubs', () => {
        expect(HUBS.map((tool) => tool.slug)).toEqual(['resize', 'compress', 'convert', 'heic']);
        expect(HUBS.flatMap((tool) => intentsFor(tool.slug))).toHaveLength(INTENTS.length);
    });

    /**
     * Either the block, which lists every spoke from the registry, or a
     * literal link to each spoke written into the page's own copy — /heic
     * links /heic-to-jpg by hand in prose, which is a link all the same.
     */
    it.each(HUBS.map((tool) => [tool.slug, tool]))('/%s links every intent that preconfigures it', (slug) => {
        const source = fs.readFileSync(path.join(ROOT, 'app', '(tools)', slug, 'page.js'), 'utf8');
        const rendersBlock = new RegExp(`<IntentLinks[\\s\\S]*?tool="${slug}"`).test(source);

        for (const intent of intentsFor(slug)) {
            const linked = rendersBlock || source.includes(`'${intent.path}'`) || source.includes(`"${intent.path}"`);
            expect(linked, `/${slug} never links ${intent.path} — an intent nothing links to is an orphan`).toBe(true);
        }
    });
});
