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
    title: 'About Resizo — How Your Images Are Processed',
    description:
        'How Resizo works: files travel over HTTPS, are decoded by Sharp on our server, and are discarded when the work is done. EXIF and GPS metadata is stripped from every output.',
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
                intro="Six image tools that are free, need no account, and add no watermark. This page describes exactly what happens to a file you hand us, and why the work runs where it does."
                aside={
                    <DocSpecList
                        heading="Limits"
                        rows={SPEC_ROWS}
                        note="The same numbers the API enforces — this table reads them from the shared constants."
                    />
                }
            >
                <DocSection id="path" heading="What happens to a file you upload">
                    <p>
                        Resizo does its work on a server, and it is worth being precise about what
                        that means rather than hiding it behind a slogan. When you pick a file, five
                        things happen in order.
                    </p>
                    <ol className="flex list-decimal flex-col gap-3 pl-5 marker:font-data marker:text-ink-muted">
                        <li>
                            The bytes are sent over HTTPS to one of our API routes — one route per
                            tool.
                        </li>
                        <li>
                            The route reads them into a buffer held in memory. Nothing is written to
                            disk, and no image bytes are ever inserted into a database.
                        </li>
                        <li>
                            Sharp, which wraps the libvips imaging library, decodes the picture,
                            applies the operation you asked for, and encodes the result.
                        </li>
                        <li>
                            The encoded bytes are the body of the HTTP response. Your download is
                            that response.
                        </li>
                        <li>
                            The request ends. Both buffers fall out of scope and the memory is
                            reclaimed. Nothing about the picture outlives the request.
                        </li>
                    </ol>
                    <p>
                        That is the path for a file up to about 4.5 MB. A larger one takes one extra
                        step: the browser first uploads it to Vercel Blob, a temporary object store,
                        because the platform will not take a bigger file in a single request; the route
                        then reads it from there, processes it as above, and deletes it right after.
                    </p>
                    <p>
                        No record of the picture, or of the fact that it was processed, is kept
                        anywhere. There are no accounts, so there is nothing to attach such a record
                        to.{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            The privacy policy
                        </Link>{' '}
                        spells this out.
                    </p>
                </DocSection>

                <DocSection id="server" heading="Why the work runs on a server">
                    <p>
                        A lot of image tools claim the work happens on your own machine. That is a
                        real design, but it buys privacy by giving up capability, and it is not the
                        trade we made. Four things a server can do that a web page cannot:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Open HEIC.</strong> Safari is
                            the only browser that decodes the format an iPhone shoots by default. On
                            Windows, Android or Chrome, a page cannot read the file it was handed —
                            a server with the right decoder can.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Hit an exact file size.</strong>{' '}
                            Getting an image under 100 KB means encoding it repeatedly at different
                            quality settings and keeping the best fit. Our compressor runs up to
                            eight encodes per request. That is a fine thing to spend a server core
                            on and a poor thing to spend a phone battery on.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Resample properly.</strong>{' '}
                            libvips downscales with a Lanczos filter and gives byte-identical output
                            for the same input every time. Canvas scaling quality is left to the
                            browser, so the same photo comes out differently on different machines.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Control the encoder.</strong>{' '}
                            PNG quantisation, WebP and AVIF quality, JPEG settings — a page that
                            re-encodes through a canvas gets one quality number and no say in the
                            rest.
                        </li>
                    </ul>
                    <p>
                        The cost of that choice is honest: your file travels. So our promises are
                        about what the server does not do with it — it is not kept, not inserted into a
                        database, and not used for anything but your operation. A large file passes
                        through Vercel Blob for the few seconds it takes to process, then is deleted.
                        There is no version of Resizo that keeps your pictures.
                    </p>
                </DocSection>

                <DocSection id="metadata" heading="EXIF and GPS metadata is removed">
                    <p>
                        A photo from a phone carries an EXIF block, and that block routinely holds
                        the GPS coordinates where the shot was taken, the exact timestamp, and the
                        camera or phone identifier. Posting the picture posts all of it.
                    </p>
                    <p>
                        Sharp discards EXIF, IPTC and XMP unless it is explicitly told to keep them,
                        and Resizo never makes that call. Every file that leaves any of the six
                        tools has been re-encoded without its metadata. This is asserted rather than
                        assumed: the test suite pushes a JPEG carrying a known EXIF marker through
                        every route and fails the build if the marker, or any EXIF block, survives
                        the round trip.
                    </p>
                </DocSection>

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
                    <p>
                        Corrections, bug reports and complaints about this page all go to the same
                        place —{' '}
                        <a href="mailto:contact@resizo.net" className={docLinkClass}>
                            contact@resizo.net
                        </a>
                        .
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
