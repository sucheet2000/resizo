/**
 * GuidePage
 *
 * One renderer for every entry in lib/catalog/guides/, the way
 * components/intent/IntentPage.js is one renderer for every intent. A new
 * guide is a registry entry, not a new component and not a new route.
 *
 * The order is fixed and it is the argument for the whole content type:
 *
 *   headline → byline → THE ANSWER → methodology → sections → sources →
 *   where to go next → FAQ
 *
 * The answer is first because a finding buried under an introduction is a page
 * nobody quotes and nobody links. The methodology sits directly under it
 * because a number with no method behind it is a claim, and this site's
 * position is that a claim it cannot show its working for should not be
 * published. The sources carry the date they were checked for the same reason.
 *
 * EVERYTHING HERE RENDERS ON THE SERVER. A guide has no tool panel, nothing to
 * preconfigure and nothing to interact with, so there is no client island and
 * no reason for one — tests/app/guide-route.test.js fails the suite if a
 * 'use client' directive appears in this directory. That is what keeps a page
 * of prose from shipping a React bundle to render paragraphs.
 */
import Link from 'next/link';

import ContentBlocks from '@/components/content/ContentBlocks';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import GuideByline, { formatGuideDate } from '@/components/guide/GuideByline';
import Breadcrumb from '@/components/seo/Breadcrumb';
import JsonLd from '@/components/seo/JsonLd';
import { getIntent, getTool } from '@/lib/catalog';
import { article, breadcrumbList } from '@/lib/schema';

const linkClass = 'rounded-input font-medium text-accent underline underline-offset-4';

/** Home → the guides index → this page. The leaf is the headline a reader sees. */
export function guideBreadcrumb(guide) {
    return [
        { name: 'Home', path: '/' },
        { name: 'Guides', path: '/guides' },
        { name: guide.h1, path: guide.path ?? `/guides/${guide.slug}` },
    ];
}

/**
 * A relatedTools slug names a tool or an intent page, and the registry is the
 * only thing that knows which — so a guide never writes a URL down and a route
 * that is renamed moves here with it. lib/catalog/guides/validate.js refuses a
 * slug that is neither, so this returning null means the entry was never
 * validated.
 */
function destinationFor(slug) {
    const tool = getTool(slug);
    if (tool) return { href: tool.href, name: tool.title };

    const intent = getIntent(slug);
    if (intent) return { href: intent.path, name: intent.label };

    return null;
}

export default function GuidePage({ guide }) {
    const breadcrumb = guideBreadcrumb(guide);
    const methodology = Array.isArray(guide.methodology) ? guide.methodology : [];
    const sources = Array.isArray(guide.sources) ? guide.sources : [];
    const related = (Array.isArray(guide.relatedTools) ? guide.relatedTools : [])
        .map((entry) => ({ ...entry, destination: destinationFor(entry.slug) }))
        .filter((entry) => entry.destination !== null);

    return (
        <div className="shell py-8 md:py-12">
            <JsonLd id={`${guide.slug}-schema`} data={[article(guide), breadcrumbList(breadcrumb)]} />

            <Breadcrumb items={breadcrumb} className="mb-6" />

            <article className="flex max-w-[68ch] flex-col gap-10">
                <header>
                    <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                        {guide.h1}
                    </h1>
                    <GuideByline
                        className="mt-3"
                        author={guide.author}
                        published={guide.published}
                        modified={guide.modified}
                    />
                </header>

                {/*
                  * The finding, before anything else on the page. It is styled
                  * up rather than down: this paragraph is what a snippet
                  * quotes and what a reader came for.
                  */}
                <p className="text-base text-ink md:text-lead">{guide.answer}</p>

                {methodology.length > 0 ? (
                    <ContentSection id="methodology" heading="Methodology">
                        <ContentBlocks blocks={methodology} />
                    </ContentSection>
                ) : null}

                {(guide.sections ?? []).map((section) => (
                    <ContentSection key={section.id} id={section.id} heading={section.heading}>
                        <ContentBlocks blocks={section.blocks} />
                    </ContentSection>
                ))}

                {sources.length > 0 ? (
                    <ContentSection id="sources" heading="Sources">
                        <ul className="flex list-disc flex-col gap-2 pl-5">
                            {sources.map((source) => (
                                <li key={source.url}>
                                    <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener"
                                        className={linkClass}
                                    >
                                        {source.label}
                                    </a>
                                    {' — checked '}
                                    <time dateTime={source.verifiedAt}>{formatGuideDate(source.verifiedAt)}</time>
                                </li>
                            ))}
                        </ul>
                    </ContentSection>
                ) : null}

                {related.length > 0 ? (
                    <ContentSection id="where-to-go-next" heading="Where to go next">
                        <ul className="flex flex-col gap-3">
                            {related.map((entry) => (
                                <li key={entry.slug}>
                                    <Link href={entry.destination.href} className={linkClass}>
                                        {entry.destination.name}
                                    </Link>
                                    {' — '}
                                    {entry.nextJob}
                                </li>
                            ))}
                        </ul>
                    </ContentSection>
                ) : null}

                <FaqList items={guide.faqs} id={`${guide.slug}-faq`} />
            </article>
        </div>
    );
}
