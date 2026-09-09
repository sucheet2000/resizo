import Link from 'next/link';

import DocPage, { DocSection, DocSpecList, docLinkClass } from '@/components/marketing/DocPage';
import JsonLd from '@/components/seo/JsonLd';
import {
    TOOLS,
} from '@/lib/catalog';
import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
} from '@/lib/limits';
import { formatFileSize } from '@/lib/format/bytes';
import { breadcrumbList, organization, webSite } from '@/lib/schema';
import { AUTHOR_NAME, GITHUB_REPO_URL, buildMetadata } from '@/lib/seo';

const PATH = '/about';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'About', path: PATH },
];

export const metadata = buildMetadata({
    title: 'About Resizo — Free Image Tools That Run on Your Device',
    description:
        `Resizo is a free set of image and PDF tools that run on your own device — nothing is uploaded, no account, no watermark. Resize, compress, convert, crop, HEIC to JPG, and combine files into a PDF. Built and maintained by ${AUTHOR_NAME}.`,
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Per file', value: formatFileSize(MAX_FILE_SIZE) },
    { label: 'Longest side', value: `${MAX_DIMENSION.toLocaleString('en-US')} px` },
    { label: 'Output pixels', value: `${MAX_PIXELS / 1_000_000} MP` },
    { label: 'Files per batch', value: String(MAX_BULK_FILES) },
    { label: 'Batch total', value: formatFileSize(MAX_BULK_TOTAL_BYTES) },
    { label: 'Image data sent to us', value: '0 bytes' },
];

export default function AboutPage() {
    // Counted, never typed — the intro below said "Six image tools" while there
    // were seven, for the same reason the homepage said "Five".
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
                intro={`${tools.length} tools that are free, need no account, add no watermark, and do their work on your own device instead of uploading your files. Here's what Resizo is, the limits it runs under, and who builds it.`}
                aside={
                    <DocSpecList
                        heading="Limits"
                        rows={SPEC_ROWS}
                        note="The same numbers the tools enforce on your device — this table reads them from the shared constants."
                    />
                }
            >
                <DocSection id="on-your-device" heading="The work happens on your device">
                    <p>
                        Open a tool and the page brings the image software with it: decoders and encoders
                        for JPEG, PNG, WebP and HEIC, compiled to run inside a browser. Your picture is read,
                        changed and written back out by the machine you are sitting at. Nothing is uploaded,
                        so there is no copy of your photo anywhere but on your own disk.
                    </p>
                    <p>
                        That also means there is nothing here to breach. No file store, no database, no
                        account records — the deployment holds static pages and the image code, and it has
                        no credentials for anything because there is nothing for it to reach.
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
                        A single file is capped at {formatFileSize(MAX_FILE_SIZE)} and{' '}
                        {MAX_DIMENSION.toLocaleString('en-US')} pixels on the longest side, with an
                        output budget of {MAX_PIXELS / 1_000_000} megapixels. A batch takes up to{' '}
                        {MAX_BULK_FILES} files totalling {formatFileSize(MAX_BULK_TOTAL_BYTES)}.
                        There is no quota, no queue and nothing counting how often you use it.
                    </p>
                    <p>
                        These are not upsell gates. They are the size at which the job comfortably fits in
                        the memory a browser tab is given. A photograph has to
                        be unpacked into raw pixels to be worked on, and raw pixels are far bigger than the
                        file: a 12-megapixel photo is about 46 MB of memory once opened, and an operation
                        usually needs two of those at once.
                    </p>
                    <p>
                        So the honest limit is your own hardware, and it moves. A desktop with memory to
                        spare will take a job an old phone will not. Every tool works the cost out before it
                        starts and refuses a job that will not fit, with a sentence saying why and what to
                        try instead — a smaller target, or resizing before compressing. That is deliberate:
                        a tab that runs out of memory is closed by the operating system without warning, and
                        on an iPhone it happens silently, so guessing and hoping would mean losing the photo
                        you were working on.
                    </p>
                </DocSection>

                <DocSection id="what-changed" heading="This used to run on a server">
                    <p>
                        For most of Resizo&rsquo;s life the work happened elsewhere. Your file was sent to a
                        server, a library called sharp did the resizing there, and the result came back in
                        the reply. The argument for it was real: server hardware is predictable, one image
                        library behaved the same for everyone, and a browser genuinely could not decode a
                        HEIC or hit an exact kilobyte target.
                    </p>
                    <p>
                        That stopped being true. A browser will now run the same codecs compiled to
                        WebAssembly, and for the common jobs it uses its own built-in image pipeline, which
                        is quick — and none of it waits on a connection. So the argument inverted. The old
                        design asked you to hand a personal photo to a stranger&rsquo;s computer for a job
                        your own computer could do, and no promise about deleting a file afterwards is as
                        good as never having it.
                    </p>
                    <p>
                        The trade is honest and worth stating. Results now depend on the device: a big
                        photograph is slower on an old phone than it was on a server, and a job too large
                        for the memory the browser can spare is refused instead of being sent away to
                        succeed elsewhere. Two formats went with the change — AVIF and GIF are no longer
                        accepted anywhere, because there is no decoder for either one available here, and
                        refusing them is better than pretending. What you get back is a tool that works
                        without a connection to us doing anything but serving the page, and a privacy claim
                        that is a fact about the software rather than a policy about our conduct.
                    </p>
                </DocSection>

                <DocSection id="who" heading="Who builds Resizo">
                    <p>
                        Resizo is built and maintained by {AUTHOR_NAME}. The source is public, at{' '}
                        <a href={GITHUB_REPO_URL} className={docLinkClass}>
                            github.com/sucheet2000/resizo
                        </a>
                        , so what this page claims about uploads can be checked against the code rather
                        than taken on trust.
                    </p>
                    <p>
                        Every core Resizo tool is free to use: no account, no watermark and no daily quota.
                        There are no ads, no data brokered and no images retained to train anything.
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
