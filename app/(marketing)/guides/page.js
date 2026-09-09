/**
 * /guides — the index.
 *
 * Every published guide, newest revision first, each with the first sentence of
 * its answer rather than a blurb written for this page. That is deliberate: a
 * summary composed separately from the finding is a second copy of the claim,
 * free to drift from it, and the whole reason a guide exists is that its
 * numbers are not free to drift.
 *
 * The page is indexable from the day it ships, before the first guide lands.
 * It is not an empty container: it states what a guide is on this site and what
 * one has to carry to be published here, which is a thing worth reading on its
 * own and a page a writer can be pointed at. The list underneath grows from the
 * registry with no edit here.
 */
import Link from 'next/link';

import GuideByline from '@/components/guide/GuideByline';
import Breadcrumb from '@/components/seo/Breadcrumb';
import JsonLd from '@/components/seo/JsonLd';
import { indexableGuides } from '@/lib/catalog';
import { breadcrumbList } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/guides';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Guides', path: PATH },
];

/** Newest revision first — a guide that was re-measured is the one to read. */
const PUBLISHED = indexableGuides()
    .slice()
    .sort((a, b) => b.modified.localeCompare(a.modified));

export const metadata = buildMetadata({
    title: 'Image Guides — What We Measured | Resizo',
    description:
        'Every Resizo tool runs on your own device, and these guides show what that measures out to: '
        + 'real numbers from real files, with the method that produced them and the date each source was checked.',
    path: PATH,
});

/** The finding's opening sentence, taken from the answer so it cannot drift. */
function firstSentence(answer) {
    const text = String(answer ?? '').trim();
    const end = text.search(/[.!?](?:\s|$)/);
    return end === -1 ? text : text.slice(0, end + 1);
}

export default function GuidesPage() {
    return (
        <div className="shell py-8 md:py-12">
            <JsonLd id="guides-schema" data={[breadcrumbList(BREADCRUMB)]} />

            <Breadcrumb items={BREADCRUMB} className="mb-6" />

            <header className="max-w-3xl">
                <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                    Guides
                </h1>
            </header>

            <div className="mt-3 flex max-w-[68ch] flex-col gap-3 text-base text-ink-muted md:text-lead">
                <p>
                    A guide here is a page that exists because something was measured against the tools
                    themselves, or because an official source says something and we checked it on a stated
                    date.
                </p>
                <p>
                    Each one opens with the finding, in a few sentences you can read on their own, and puts
                    the method that produced it directly underneath — the sample, the command, and the
                    numbers the prose is built from, so you can run it again and disagree with us.
                </p>
                <p>
                    Nothing goes up before its measurement exists. A guide with no working to show is a
                    claim, and a claim is not worth a URL.
                </p>
            </div>

            {PUBLISHED.length === 0 ? (
                <p className="mt-10 max-w-[60ch] text-base text-ink-muted">No guides yet.</p>
            ) : (
                <ul className="mt-10 flex max-w-[68ch] flex-col gap-8">
                    {PUBLISHED.map((guide) => (
                        <li key={guide.slug} className="border-b border-line pb-8 last:border-b-0">
                            <h2 className="font-display text-title font-bold tracking-tight text-ink">
                                <Link
                                    href={guide.path}
                                    className="rounded-input underline-offset-4 hover:underline"
                                >
                                    {guide.h1}
                                </Link>
                            </h2>
                            <GuideByline
                                className="mt-2"
                                author={guide.author}
                                published={guide.published}
                                modified={guide.modified}
                            />
                            <p className="mt-3 text-base text-ink-muted">{firstSentence(guide.answer)}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
