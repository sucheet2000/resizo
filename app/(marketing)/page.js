/**
 * The homepage.
 *
 * Was a 1334-line "use client" monolith carrying its own nav, footer, feature
 * cards, scroll-reveal observer, two modals and the entire resize workspace —
 * which is also why it could not export metadata, which is why the canonical
 * and the OG block had to live in the root layout, which is why every route on
 * the site self-declared as a duplicate of this one.
 *
 * It is a server component now. The chrome comes from the route-group layout,
 * the workspace moved to /resize, and the only client code left is the hero
 * drop target and the review dialog.
 */
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HeroDropzone from '@/components/marketing/HeroDropzone';
import ToolIndex from '@/components/marketing/ToolIndex';
import ReviewList from '@/components/reviews/ReviewList';
import ReviewModal from '@/components/reviews/ReviewModal';
import JsonLd from '@/components/seo/JsonLd';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { aggregateRating, faqPage, organization, softwareApplication, webSite } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';
import { createServerClient } from '@/lib/supabase/server';

const DESCRIPTION = 'Resize images to exact pixel dimensions, compress to a target file size, convert '
    + 'between JPEG, PNG, WebP and AVIF, crop, and turn iPhone HEIC photos into JPG. Free, no account.';

const REVIEWS_SHOWN = 6;

export const metadata = buildMetadata({
    title: 'Free Online Image Tools — Resize, Compress, Convert | Resizo',
    description: DESCRIPTION,
    path: '/',
    ogImage: '/og-home.jpg',
});

const FAQS = [
    {
        question: 'Is Resizo free?',
        answer: 'Yes — every tool, with no account, no watermark on the output and no daily quota. '
            + 'Advertising on some pages pays for the servers. There is no paid tier holding a feature back, '
            + 'and nothing here asks for a card.',
    },
    {
        question: 'Do you store the images I upload?',
        answer: 'No. A file travels over HTTPS, is held in memory while the server re-encodes it, and is '
            + 'discarded the moment the response is written. It is never written to disk and never kept. '
            + 'EXIF and GPS metadata are stripped from every output, so a photo you download no longer '
            + 'carries where it was taken.',
    },
    {
        question: 'Do I need an account?',
        answer: 'No. Every tool works signed out. An account does one thing: it keeps a list of what you '
            + 'processed, so you can look back at what you resized last week. It is also what ties a review '
            + 'to a person, so the review list can be moderated.',
    },
    {
        question: 'Does this work on a phone?',
        answer: 'Yes. It is a web page, so it runs the same on iOS, Android, Windows, macOS and Linux with '
            + 'nothing to install. The HEIC tool exists precisely because iPhone photos are the ones other '
            + 'devices refuse to open.',
    },
    {
        question: 'What are the size limits?',
        answer: `${formatFileSize(MAX_FILE_SIZE)} per file and ${MAX_DIMENSION} pixels on the longest side. `
            + `A batch takes ${MAX_BULK_FILES} images and ${formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. `
            + 'Requests are rate limited per address so one visitor cannot occupy the server, and the panel '
            + 'says so plainly if you reach it.',
    },
    {
        question: 'Which formats are supported?',
        answer: 'Resize, compress and crop take JPEG, PNG and WebP, and resize also takes GIF. Convert adds '
            + 'AVIF on both sides. The HEIC tool takes the HEIC and HEIF files an iPhone produces. Output is '
            + 'JPEG, PNG, WebP or AVIF depending on the tool.',
    },
];

/**
 * Approved reviews only, read on the server so the cards and the
 * AggregateRating in the structured data describe the same rows — markup
 * claiming a rating the page does not show is a manual-action risk. A missing
 * or unreachable database drops the section rather than the page.
 */
async function loadApprovedReviews() {
    try {
        const supabase = await createServerClient();
        const { data, error } = await supabase
            .from('reviews')
            .select('id, name, role, rating, review, created_at')
            .eq('approved', true)
            .order('created_at', { ascending: false })
            .limit(60);

        if (error) return [];
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

const SECTION = 'mt-[clamp(4rem,8vw,7rem)]';
const H2 = 'font-display text-title font-bold tracking-tight text-ink';

export default async function HomePage() {
    const reviews = await loadApprovedReviews();
    const rating = aggregateRating(reviews);

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
                        rating,
                        features: [
                            'Resize to exact pixel dimensions',
                            'Compress to a target file size',
                            'Convert between JPEG, PNG, WebP and AVIF',
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
                    Resize, compress and convert images online
                </h1>
                <p className="mt-3 max-w-[52ch] text-base text-ink-muted md:text-lead">
                    Drop an image below to resize it, or pick another tool. Nothing to install.
                </p>
            </header>

            <section
                aria-label="Resize an image"
                className="mt-6 rounded-panel border border-line bg-surface-raised p-4 shadow-raised md:p-6"
            >
                <HeroDropzone />
                <p className="mt-5 border-t border-line pt-4 text-micro text-ink-muted">
                    Processed in memory on our server — never written to disk, deleted the moment your
                    download starts. No account, no watermark.
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

            <section aria-labelledby="reviews-heading" className={SECTION}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="max-w-[46ch]">
                        <h2 id="reviews-heading" className={H2}>
                            What people say
                        </h2>
                        {rating ? (
                            <p className="mt-3 font-data text-ui text-ink-muted">
                                <span className="text-ink">{rating.ratingValue}</span>
                                {' out of 5 · '}
                                {rating.reviewCount} {rating.reviewCount === 1 ? 'review' : 'reviews'}
                            </p>
                        ) : (
                            <p className="mt-3 text-base text-ink-muted">
                                Every review here is written by someone who used the tools.
                            </p>
                        )}
                    </div>
                    <ReviewModal />
                </div>

                <ReviewList reviews={reviews.slice(0, REVIEWS_SHOWN)} className="mt-6" />
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

                <ContentSection id="what-happens" heading="What happens to a file you upload">
                    <p>
                        The honest version, because plenty of sites in this category describe something else.
                        Your file is sent over HTTPS to our server, where the sharp image library decodes it,
                        applies the operation you chose and encodes the result. The bytes come back in the
                        response. The file exists only in the memory of that one request: it is never written
                        to disk, never copied into storage, and there is nothing to delete afterwards because
                        nothing was kept.
                    </p>
                    <p>
                        Two things follow from that. EXIF and GPS metadata are stripped from every output, so
                        a photo you download here no longer carries the camera, the timestamp or the
                        coordinates it was taken at. And the work is bounded at{' '}
                        {formatFileSize(MAX_FILE_SIZE)} per file, because the whole job has to fit inside a
                        single request.
                    </p>
                    <p>
                        If you sign in, one more thing is stored: a row recording that you resized a file of a
                        given name from one size to another. That is a history list, not a copy of the image,
                        and you can export or delete all of it from the dashboard.
                    </p>
                </ContentSection>

                <ContentSection id="why-free" heading="Why it is free">
                    <p>
                        Advertising on some pages covers the servers. There is no paid tier, no export limit
                        and no watermark, so there is nothing to unlock and no reason for the tools to be
                        deliberately worse than they could be.
                    </p>
                    <p>
                        Ads never sit between the headline and the drop zone, never sit beside a tool, and
                        never appear before your result does. That placement rule is written into the design
                        system rather than left to whatever a network decides to inject.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="home-faq" />
            </div>
        </div>
    );
}
