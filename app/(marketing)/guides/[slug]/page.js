/**
 * /guides/[slug] — every guide page, from one route.
 *
 * The same arrangement as app/(tools)/[slug]/page.js, for the same three
 * reasons:
 *
 *   - generateStaticParams lists exactly the registry, so every guide is
 *     prerendered to static HTML at build time;
 *   - dynamicParams is false, so a slug that is not in the registry is a 404
 *     rather than a page — and this is a single dynamic segment, never a
 *     catch-all, so no path with a further slash can reach it;
 *   - the registry is validated while the params are collected, so a guide
 *     with no answer, a source with no verified date, a revision dated before
 *     its own publication or a body that reads as another page's fails
 *     `next build` instead of shipping.
 *
 * The registry is empty until the first benchmark results exist, so today this
 * route prerenders nothing and every /guides/… URL is a 404. That is correct:
 * a guide is a page about a measurement, and there is no measurement yet.
 */
import { notFound } from 'next/navigation';

import GuidePage from '@/components/guide/GuidePage';
import { GUIDES, assertGuidesValid, getGuide } from '@/lib/catalog';
import { AUTHOR_NAME, guideMetadata } from '@/lib/seo';

export const dynamicParams = false;

export function generateStaticParams() {
    // The expected byline is handed in rather than read inside the validator:
    // lib/catalog/ may not import lib/seo.js, so this route is where the one
    // author's name meets the registry that has to match it.
    assertGuidesValid(GUIDES, { author: AUTHOR_NAME });
    return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }) {
    const { slug } = await params;
    const guide = getGuide(slug);
    if (!guide) notFound();

    return guideMetadata(guide);
}

export default async function GuideRoute({ params }) {
    const { slug } = await params;
    const guide = getGuide(slug);
    if (!guide) notFound();

    return <GuidePage guide={guide} />;
}
