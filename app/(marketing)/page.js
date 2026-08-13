/**
 * The homepage.
 *
 * A fully static server component. The chrome comes from the route-group
 * layout, the workspace lives at /resize, and the only client code is the hero
 * drop target. It fetches nothing — there is no database and no per-request
 * data — so the whole page prerenders.
 */
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HeroDropzone from '@/components/marketing/HeroDropzone';
import ToolIndex from '@/components/marketing/ToolIndex';
import JsonLd from '@/components/seo/JsonLd';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';
import { formatFileSize } from '@/lib/format-bytes';
import { faqPage, organization, softwareApplication, webSite } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const DESCRIPTION = 'Resize images to exact pixel dimensions, compress to a target file size, convert '
    + 'between JPEG, PNG and WebP, crop, and turn iPhone HEIC photos into JPG — without uploading '
    + 'anything. Every tool runs on your own device. Free, no account.';

export const metadata = buildMetadata({
    title: 'Free Image Tools — Resize, Compress, Convert, No Upload | Resizo',
    description: DESCRIPTION,
    path: '/',
    ogImage: '/og-home.jpg',
});

const FAQS = [
    {
        question: 'Is Resizo free?',
        answer: 'Yes — every tool, with no account, no watermark on the output and no daily quota. '
            + 'Resizo is a free, non-commercial project: there is no paid tier holding a feature back, '
            + 'no ads, and nothing here asks for a card.',
    },
    {
        question: 'Do my images get uploaded anywhere?',
        answer: 'No, and there is nowhere for them to go. Opening a tool loads the image software into '
            + 'the page, and the picture is then read, changed and saved by your own device — it stays on '
            + 'the machine you are sitting at, so there is nothing for us to receive, keep or hand on. '
            + 'The file you download is also written by your device, and it carries no EXIF or GPS data, '
            + 'so it no longer says where the photo was taken.',
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
            + 'HEIC and HEIF files an iPhone produces. Output is JPEG, PNG or WebP. AVIF and GIF are not '
            + 'accepted: there is no decoder for either one here, so a file in those formats would be '
            + 'refused rather than quietly turned into something else.',
    },
];

/**
 * The trust band, built only from things that are actually true of the tool —
 * no invented quotes, no user counts, no ratings. Each row states a promise the
 * site keeps and the reason it can keep it.
 */
const TRUST = [
    { label: 'Nothing is uploaded', detail: 'The image is opened, changed and saved by your own device. It is never sent to us, so there is nothing for us to hold.' },
    { label: 'No account, ever', detail: 'Every tool works signed out. There is nothing to sign up for and nothing to log in to.' },
    { label: 'Free, no watermark', detail: 'No paid tier, no export limit, and nothing stamped on the image you get back.' },
    { label: 'The formats forms ask for', detail: 'JPEG, PNG and WebP, plus the HEIC and HEIF an iPhone shoots.' },
    { label: 'No waiting on a transfer', detail: 'The file is already where the work happens, so a 20 MB photo starts immediately even on a slow connection.' },
    { label: 'Bounded by your device', detail: 'A very large image needs memory to open. The panel checks what this device can spare first and says so if a job will not fit.' },
    { label: 'No metadata in the output', detail: 'Files are written from raw pixels, so EXIF and GPS data are gone — a photo no longer says where it was taken.' },
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
                    Resize, compress and convert images without uploading them
                </h1>
                <p className="mt-3 max-w-[52ch] text-base text-ink-muted md:text-lead">
                    Drop an image below to resize it, or pick another tool. It is processed on your own
                    device — nothing to install, nothing to upload.
                </p>
            </header>

            <section
                aria-label="Resize an image"
                className="mt-6 rounded-panel border border-line bg-surface-raised p-4 shadow-raised md:p-6"
            >
                <HeroDropzone />
                <p className="mt-5 border-t border-line pt-4 text-micro text-ink-muted">
                    Your image never leaves your device — the work happens here, in this browser tab.
                    No account, no watermark.
                </p>
            </section>

            <section id="tools" aria-labelledby="tools-heading" className={SECTION}>
                <h2 id="tools-heading" className={H2}>
                    Every Resizo tool
                </h2>
                <p className="mt-3 max-w-[72ch] text-base text-ink-muted">
                    Five tools, each doing one job with the controls that job actually needs. All of them
                    take the same file and all of them hand it straight back.
                </p>
                <ToolIndex className="mt-6" />
            </section>

            <section aria-labelledby="trust-heading" className={SECTION}>
                <h2 id="trust-heading" className={H2}>
                    What you get
                </h2>
                <p className="mt-3 max-w-[72ch] text-base text-ink-muted">
                    No sign-up, nothing kept, no catch. Here is exactly what that means.
                </p>

                <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {TRUST.map((item) => (
                        <li
                            key={item.label}
                            className="rounded-panel border border-line bg-surface-raised p-5"
                        >
                            <p className="font-display text-ui font-bold text-ink">{item.label}</p>
                            <p className="mt-2 text-ui text-ink-muted">{item.detail}</p>
                        </li>
                    ))}
                </ul>

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

                <ContentSection id="what-happens" heading="What happens to your file">
                    <p>
                        The honest version, because plenty of sites in this category describe something else.
                        When you open a tool, the page brings the image software down with it — the same
                        decoders and encoders a desktop program would use, compiled to run inside a browser.
                        Your picture is then read where it already is, changed, and written back out by the
                        machine in front of you. It is not sent to Resizo, and there is no copy of it
                        anywhere else to delete.
                    </p>
                    <p>
                        Two things follow from that. The file you download is built from raw pixels, so the
                        EXIF block goes with the original: no camera, no timestamp, no coordinates. And the
                        limits are your device&rsquo;s rather than ours. Opening a big photograph needs
                        several times its file size in memory, so the tool works out what this machine can
                        spare before it starts, and says so plainly instead of freezing the tab. The
                        published cap is {formatFileSize(MAX_FILE_SIZE)} per file; a phone with very little
                        memory free may draw the line lower, and will tell you where.
                    </p>
                </ContentSection>

                <ContentSection id="why-free" heading="Why it is free">
                    <p>
                        Resizo is a free, non-commercial project. There are no ads, no paid tier, no export
                        limit and no watermark, so there is nothing to unlock and no reason for the tools to be
                        deliberately worse than they could be.
                    </p>
                    <p>
                        It also costs very little to run, which is part of the answer. Your device does the
                        image work, so there is no processing bill that would have to be recovered from you
                        somehow. Nothing on the page is trying to sell you anything or track you across the
                        web. The tools are the whole product.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="home-faq" />
            </div>
        </div>
    );
}
