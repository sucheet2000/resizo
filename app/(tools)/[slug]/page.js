/**
 * /[slug] — every intent page, from one route.
 *
 * The long-tail routes (/resize-jpg, /png-to-jpg, /compress-image-to-100kb …)
 * used to be one hand-written page.js each. They are entries in
 * lib/catalog/intents/ now, and this route renders whichever one the slug
 * names, so a new intent is a registry entry and nothing else.
 *
 * Three things keep this from becoming a doorway-page generator:
 *
 *   - generateStaticParams lists exactly the registry, so every intent is
 *     prerendered to static HTML at build time, the same as before;
 *   - dynamicParams is false, so a slug that is not in the registry is a 404
 *     rather than a page — and this is a single dynamic segment, never a
 *     catch-all, so no path with a slash in it can reach it either;
 *   - the registry is validated while the params are collected, so a
 *     duplicate path, a missing h1 or a preset the tool cannot honour fails
 *     `next build` instead of shipping.
 *
 * Static segments win over a dynamic one, so /resize, /about and /tools are
 * untouched by this file existing beside them.
 */
import { notFound } from 'next/navigation';

import IntentTool from './IntentTool';
import IntentPage from '@/components/intent/IntentPage';
import { INTENTS, assertCatalogValid, getIntent } from '@/lib/catalog';
import { intentMetadata } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
    assertCatalogValid();
    return INTENTS.map((intent) => ({ slug: intent.slug }));
}

export async function generateMetadata({ params }) {
    const { slug } = await params;
    const intent = getIntent(slug);
    if (!intent) notFound();

    return intentMetadata(intent);
}

export default async function IntentRoute({ params }) {
    const { slug } = await params;
    const intent = getIntent(slug);
    if (!intent) notFound();

    const Tool = (props) => <IntentTool tool={intent.tool} {...props} />;

    return <IntentPage intent={intent} Tool={Tool} />;
}
