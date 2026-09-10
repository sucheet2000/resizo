/**
 * The homepage.
 *
 * A fully static server component. The chrome comes from the route-group
 * layout, the workspace lives at /resize, and the only client code is the hero
 * drop target. It fetches nothing — there is no database and no per-request
 * data — so the whole page prerenders.
 *
 * What it is FOR changed. It used to be a resizer with a list of other tools
 * under it: the headline named three operations, the drop zone claimed the
 * page, and the ten cards below were the whole family flattened into one grid
 * with no grouping and no preconfigured pages in it — so the form tools, the
 * metadata tools and the byte ceilings were invisible from the front door.
 * The order is now: what this place is (the headline and one intro), the
 * fastest path for the commonest job (the drop zone), the promises, nine
 * curated jobs, the categories, then how it actually works.
 *
 * The drop zone stays first because DESIGN.md is explicit that the tool is the
 * hero and a CTA that scrolls to one is on the reject list — but it speaks for
 * one job now rather than for the site.
 */
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import BrowseByNeed from '@/components/marketing/BrowseByNeed';
import HeroDropzone from '@/components/marketing/HeroDropzone';
import ToolIndex from '@/components/marketing/ToolIndex';
import JsonLd from '@/components/seo/JsonLd';
import TrustStrip from '@/components/tools/TrustStrip';
import { TOOLS } from '@/lib/catalog';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';
import { formatFileSize } from '@/lib/format/bytes';
import { faqPage, organization, softwareApplication, webSite } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

/**
 * The no-upload claim leads, and that ordering is the point rather than a
 * stylistic preference. It used to close the sentence, starting at character
 * 154 — far enough back that Google's snippet cut it mid-word ("into JPG —
 * w|ithout uploading anything"), so the one line separating this site from
 * iloveimg and tinypng was the one line the result never showed. The tool verbs
 * still come first so the money terms are not buried either.
 * tests/app/metadata.test.js pins the ordering for every page.
 */
/**
 * Read from the registry, never typed. This sentence said "Five tools" for as
 * long as /jpg-to-pdf and /merge-pdf existed, because a launch updates the
 * catalogue and nobody thinks to re-count a paragraph.
 */
const TOOL_COUNT = TOOLS.filter((tool) => tool.hasOwnPage).length;

const DESCRIPTION = 'Resize, compress, convert and crop images without uploading them — every '
    + 'tool runs on your own device. Exact pixel sizes, exact KB targets, JPEG, PNG, WebP and '
    + 'iPhone HEIC photos. Free, no account, no watermark.';

export const metadata = buildMetadata({
    title: 'Free Image Tools — Resize, Compress, Convert, No Upload | Resizo',
    description: DESCRIPTION,
    path: '/',
    ogImage: '/og-home.jpg',
});

/**
 * START WITH A JOB — nine entries, curated, ordered by what people actually
 * are most useful in rather than by the order the registry lists them in.
 *
 * Slugs only. ToolIndex resolves each one against the registry, so a renamed
 * route leaves a gap here rather than a link into a 404, and tests/pages/
 * home.test.jsx fails if a slug stops existing. Tools and intent pages are
 * mixed on purpose: "compress to 50 KB" is a job in exactly the way "compress"
 * is, and a visitor who came for the number should not have to find the tool
 * first and then the number.
 *
 * The spans are the point of the grid. Twelve columns in rows of 7+5, 5+4+3,
 * 7+5 and 7+5 — asymmetric by what an entry is worth, never the equal-column
 * card row on the reject list.
 */
const START_WITH_A_JOB = [
    {
        slug: 'compress',
        kind: 'tool',
        span: 'md:col-span-7',
        weight: 'lead',
        line: 'Aim at a byte target — 100 KB for a form that rejects anything larger, a few MB for an email — and see exactly what you got.',
    },
    {
        slug: 'resize',
        kind: 'tool',
        span: 'md:col-span-5',
        weight: 'lead',
        line: 'Type exact pixel dimensions, scale by a percentage, or tap a platform size such as 1080×1080. The aspect-ratio lock fills in the side you did not type.',
        extra: { href: '/resize#bulk', label: 'Or resize up to 20 at once, back as one ZIP' },
    },
    {
        slug: 'compress-image-to-50kb',
        kind: 'intent',
        span: 'md:col-span-5',
        line: 'The 50 KB ceiling an application form or a scan upload asks for, with the target and the fit-under policy already set.',
    },
    {
        slug: 'heic-to-jpg',
        kind: 'intent',
        span: 'md:col-span-4',
        line: 'The iPhone photo that Windows, Android and half the upload forms on the internet refuse to open, turned into a JPG.',
    },
    {
        slug: 'compress-image-to-20kb',
        kind: 'intent',
        span: 'md:col-span-3',
        line: 'The 20 KB ceiling on a signature strip or a thumbnail field, where the picture has to get smaller too.',
    },
    {
        slug: 'convert',
        kind: 'tool',
        span: 'md:col-span-7',
        line: 'JPEG, PNG and WebP in any direction, for the form that takes one of the three and refuses the other two.',
    },
    {
        slug: 'signature-resizer',
        kind: 'tool',
        span: 'md:col-span-5',
        line: 'Crop a scanned signature, size it to the pixels a form wants, put it on white, and bring it under the byte limit in one pass.',
    },
    {
        slug: 'remove-image-metadata',
        kind: 'tool',
        span: 'md:col-span-7',
        line: 'Take the camera, the date and the GPS coordinates out of a photo before you send it, without re-encoding a single pixel.',
    },
    {
        slug: 'change-image-dpi',
        kind: 'tool',
        span: 'md:col-span-5',
        line: 'Set the print resolution a file claims — 300 DPI for a print shop, 96 for a portal that checks — leaving the pixels exactly as they are.',
    },
];

const FAQS = [
    {
        question: 'Is Resizo free?',
        answer: 'Yes. Every core Resizo tool is free to use — no account, no watermark on the output and '
            + 'no daily quota. There are no ads, and nothing here asks for a card.',
    },
    {
        question: 'Do my images get uploaded anywhere?',
        answer: 'No, and there is nowhere for them to go. Opening a tool loads the image software into '
            + 'the page, and the picture is then read, changed and saved by your own device — it stays on '
            + 'the machine you are sitting at, so there is nothing for us to receive, keep or hand on. '
            + 'The file you download is written by your device too. What that file still carries from the '
            + 'original — the camera and location block, the colour profile, the print resolution — '
            + 'depends on which tool you used, and every tool page states what its own changes.',
    },
    {
        question: 'Do I need an account?',
        answer: 'No. There are no accounts on Resizo at all — nothing to sign up for and nothing to log '
            + 'in to. Every tool works the same for everyone, and because nothing is kept, there is no '
            + 'history to look back on and nothing tying your use to a name.',
    },
    {
        question: 'Does this work on a phone?',
        answer: 'Yes. It is a web page, so it runs on iOS, Android, Windows, macOS and Linux with nothing '
            + 'to install. The HEIC tool exists precisely because iPhone photos are the ones other devices '
            + 'refuse to open. One honest caveat: since the phone does the work itself, a very large image '
            + 'takes longer on an older handset, and one that will not fit in the memory the browser can '
            + 'spare is refused with a message rather than crashing the tab.',
    },
    {
        question: 'What are the size limits?',
        answer: `${formatFileSize(MAX_FILE_SIZE)} per file and ${MAX_DIMENSION} pixels on the longest side. `
            + `A batch takes ${MAX_BULK_FILES} images and ${formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. `
            + 'There is no daily quota and nothing counting how often you use it. The real ceiling is your '
            + 'own hardware: a very large photo needs a lot of memory to open, and the panel works out '
            + 'whether this device can hold the job before it starts rather than failing part way through.',
    },
    {
        question: 'Which formats are supported?',
        answer: 'Resize, compress, crop and convert all take JPEG, PNG and WebP, and the HEIC tool takes the '
            + 'HEIC and HEIF files an iPhone produces; image output is JPEG, PNG or WebP, and the two '
            + 'document tools write a PDF. AVIF and GIF are not accepted: there is no decoder for either '
            + 'one here, so a file in those formats would be refused rather than quietly turned into '
            + 'something else.',
    },
];

/**
 * Real, attributable quotes only. Paste them here — { name, role, text } — and
 * the band below renders them; leave it empty until there are genuine ones.
 * Never invent a name, a quote, a rating or a user count.
 */
const TESTIMONIALS = [];

const SECTION = 'mt-[clamp(4rem,8vw,7rem)]';
const H2 = 'font-display text-title font-bold tracking-tight text-ink';

export default function HomePage() {
    return (
        <div className="shell py-8 md:py-12">
            <JsonLd
                id="home-schema"
                data={[
                    organization(),
                    webSite(),
                    softwareApplication({
                        name: 'Resizo',
                        description: DESCRIPTION,
                        path: '/',
                        features: [
                            'Runs on your own device — images are never uploaded',
                            'Resize to exact pixel dimensions',
                            'Compress to a target file size',
                            'Convert between JPEG, PNG and WebP',
                            'Crop to exact pixel coordinates',
                            'Convert iPhone HEIC photos to JPG',
                            'Size a signature or a form photo to the pixels and bytes a form asks for',
                            'Change the print resolution a file claims, or strip its EXIF, GPS and XMP',
                            'Combine photos or PDFs into one document',
                            'Batch of up to 20 images returned as a ZIP',
                        ],
                    }),
                    faqPage(FAQS),
                ]}
            />

            {/* The tool is the hero: the drop zone is painted with the page and
                needs no scrolling to reach. No CTA button that scrolls to it. */}
            <header className="max-w-3xl">
                <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                    Free image tools that run on your device
                </h1>
            </header>
            <p className="mt-3 max-w-[60ch] text-base text-ink-muted md:text-lead">
                Resize to exact pixels, compress to a byte ceiling, convert between formats, crop, size a
                signature or a photo for a form, change the DPI a file claims, strip its metadata, or
                combine several into one PDF. Every one of them reads and writes the file on the machine in
                front of you, so nothing is uploaded.
            </p>

            <section
                aria-label="Resize an image"
                className="mt-6 rounded-panel border border-line bg-surface-raised p-4 shadow-raised md:p-6"
            >
                <HeroDropzone />
                <p className="mt-5 border-t border-line pt-4 text-micro text-ink-muted">
                    Your image never leaves your device — the work happens here, in this browser tab.
                </p>
            </section>

            {/* The same four facts, in the same shape, as under every tool
                panel and in the directory — not a second hand-written list
                that can drift away from them. */}
            <TrustStrip detail className="mt-4" />

            <section id="start" aria-labelledby="start-heading" className={SECTION}>
                <h2 id="start-heading" className={H2}>
                    Start with a job
                </h2>
                <p className="mt-3 max-w-[72ch] text-base text-ink-muted">
                    Nine common jobs. Each one opens the tool it needs with the
                    settings that job wants already filled in.
                </p>
                <ToolIndex items={START_WITH_A_JOB} className="mt-6" />
            </section>

            <section id="browse" aria-labelledby="browse-heading" className={SECTION}>
                <h2 id="browse-heading" className={H2}>
                    Browse by need
                </h2>
                <p className="mt-3 max-w-[72ch] text-base text-ink-muted">
                    All {TOOL_COUNT} tools, grouped by the thing you came to get done rather than by file
                    type. Each group opens the full directory at that section.
                </p>
                <BrowseByNeed className="mt-6" />
            </section>

            <section aria-labelledby="trust-heading" className={SECTION}>
                <h2 id="trust-heading" className={H2}>
                    What happens to your file
                </h2>

                <div className="mt-3 flex max-w-[72ch] flex-col gap-4 text-base text-ink-muted">
                    <p>
                        Opening a tool brings its decoders and encoders down with the page, as WebAssembly
                        served from this site, and they run inside the tab: your picture is read, changed
                        and written back out by the machine in front of you. The site&rsquo;s content
                        security policy sets <code className="font-data text-ui text-ink">connect-src &apos;self&apos;</code>,
                        which means the page is only permitted to talk to this site — a page that tried to
                        send your picture anywhere else would be blocked by the browser rather than merely
                        trusted. The file you download is assembled in the tab and saved by the browser
                        itself. What a tool changes about a file differs by tool: some rewrite every pixel,
                        others change one field and leave the picture untouched, so each tool page states
                        what its own does.
                    </p>
                    <p>
                        Every core Resizo tool is free to use. No account, no watermark and no daily quota.
                    </p>
                </div>

                {TESTIMONIALS.length > 0 ? (
                    <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                        {TESTIMONIALS.map((quote) => (
                            <li
                                key={quote.name}
                                className="rounded-panel border border-line bg-surface-raised p-5"
                            >
                                <p className="text-base text-ink">{quote.text}</p>
                                <p className="mt-3 font-data text-micro text-ink-muted">
                                    {quote.name}
                                    {quote.role ? ` · ${quote.role}` : ''}
                                </p>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </section>

            <div className={`${SECTION} flex max-w-[72ch] flex-col gap-10`}>
                <ContentSection id="which-tool" heading="Which tool do I need?">
                    <p>
                        Most of the time the answer comes from the message that sent you here. If a form says
                        the image has to be a certain number of pixels wide, that is a resize. If it says the
                        file has to be under a certain number of kilobytes, that is a compress — the
                        dimensions can stay exactly as they are and the file still gets lighter.
                    </p>
                    <p>
                        If the upload is refused with something about the file type, that is a convert: a
                        surprising number of forms still take JPEG and PNG only. If the picture is right but
                        the framing is not, that is a crop. And if you took the photo on an iPhone and nothing
                        will open it at all, that is HEIC, which is its own tool because it is its own
                        problem.
                    </p>
                    <p>
                        Jobs stack. A 12-megapixel phone photo headed for a job application usually wants a
                        resize down to something sensible, then a compress to hit the byte limit. Doing it in
                        that order gives a far better-looking result than compressing a huge image hard enough
                        to squeeze under the cap on its own.
                    </p>
                </ContentSection>

                <ContentSection id="why-free" heading="Why it is free">
                    <p>
                        It costs very little to run, which is most of the answer. Your device does the image
                        work, so there is no processing bill that would have to be recovered from you
                        somehow, and the published cap of {formatFileSize(MAX_FILE_SIZE)} per file is about
                        what a browser tab can hold rather than about what a plan allows.
                    </p>
                    <p>
                        Nothing on the page is trying to sell you anything or follow you around the web.
                        There is nothing to unlock, so there is no reason for any of the tools to be
                        deliberately worse than they could be. The tools are the whole product.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="home-faq" />
            </div>
        </div>
    );
}
