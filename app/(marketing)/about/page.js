import Link from 'next/link';

import DocPage, { DocSection, DocSpecList, docLinkClass } from '@/components/marketing/DocPage';
import JsonLd from '@/components/seo/JsonLd';
import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
    TOOLS,
} from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { breadcrumbList, organization, webSite } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/about';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'About', path: PATH },
];

export const metadata = buildMetadata({
    title: 'About Resizo — Free Image Tools, No Account',
    description:
        'Resizo is a free set of image tools — resize, compress, convert, crop and HEIC — with no account, no watermark, and nothing kept. Built by an independent developer.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Per file', value: formatFileSize(MAX_FILE_SIZE) },
    { label: 'Longest side', value: `${MAX_DIMENSION.toLocaleString('en-US')} px` },
    { label: 'Output pixels', value: `${MAX_PIXELS / 1_000_000} MP` },
    { label: 'Files per batch', value: String(MAX_BULK_FILES) },
    { label: 'Batch total', value: formatFileSize(MAX_BULK_TOTAL_BYTES) },
    { label: 'Requests', value: '10 / min' },
];

export default function AboutPage() {
    const tools = TOOLS.filter((tool) => tool.hasOwnPage);

    return (
        <>
            <JsonLd
                id="about-schema"
                data={[organization(), webSite(), breadcrumbList(BREADCRUMB)]}
            />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="About Resizo"
                intro="Six image tools that are free, need no account, and add no watermark. Here's what Resizo is, the limits it runs under, and who builds it."
                aside={
                    <DocSpecList
                        heading="Limits"
                        rows={SPEC_ROWS}
                        note="The same numbers the API enforces — this table reads them from the shared constants."
                    />
                }
            >
                <DocSection id="no-account" heading="There are no accounts">
                    <p>
                        There is nothing to sign up for and nothing to log in to. Every tool works
                        the same for everyone, with the same limits and the same output, and no
                        step ever asks who you are.
                    </p>
                    <p>
                        Because nothing is kept, there is no history to look back on, no dashboard,
                        and nothing tying what you processed to a name. The absence of an account is
                        the feature: there is no record to keep, export or delete.
                    </p>
                </DocSection>

                <DocSection id="limits" heading="Limits, and why they exist">
                    <p>
                        A single upload is capped at {formatFileSize(MAX_FILE_SIZE)} and{' '}
                        {MAX_DIMENSION.toLocaleString('en-US')} pixels on the longest side, with an
                        output budget of {MAX_PIXELS / 1_000_000} megapixels. A batch takes up to{' '}
                        {MAX_BULK_FILES} files totalling {formatFileSize(MAX_BULK_TOTAL_BYTES)}.
                        Each tool allows ten requests a minute from one address.
                    </p>
                    <p>
                        These are not upsell gates — there is nothing to buy. They are the size at
                        which one request stays inside the memory and time a serverless function
                        gets, so that a decode from one visitor cannot starve everyone else.
                    </p>
                </DocSection>

                <DocSection id="who" heading="Who builds Resizo">
                    <p>
                        Resizo is built and maintained by one developer. It is a free,
                        non-commercial project: no ads, no paid tier, no accounts, no data brokered,
                        no images retained to train anything.
                    </p>
                </DocSection>

                <DocSection id="tools" heading="The tools">
                    <ul className="flex flex-col gap-3">
                        {tools.map((tool) => (
                            <li key={tool.slug} className="flex flex-wrap items-baseline gap-x-2">
                                <Link href={tool.href} className={docLinkClass}>
                                    {tool.title}
                                </Link>
                                <span>— {tool.description}</span>
                            </li>
                        ))}
                    </ul>
                </DocSection>
            </DocPage>
        </>
    );
}
