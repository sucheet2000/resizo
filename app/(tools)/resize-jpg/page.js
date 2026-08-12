/**
 * /resize-jpg — the resizer with JPEG-specific copy.
 *
 * The tool is deliberately NOT locked to JPEG input. The output format select
 * sits on Original, so a JPG in is a JPG out; forcing the format would only
 * mean that dropping a PNG here silently converted it. What is specific to this
 * page is the writing: what a re-encode costs, and where JPEG artefacts show up
 * once an image is small.
 */
import Link from 'next/link';

import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { MAX_BULK_FILES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/resize-jpg';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Resize Image', path: '/resize' },
    { name: 'Resize a JPG', path: PATH },
];

const DESCRIPTION = 'Resize a JPG online free, without uploading it. Set exact pixel dimensions, scale by '
    + 'percentage or pick a platform size, with the aspect ratio locked, and your own device does the work. '
    + 'The output stays a JPEG. No account, no watermark.';

export const metadata = buildMetadata({
    title: 'Resize JPG Online — Exact Pixels or Percent | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'To resize a JPG you give the new width or height in pixels and leave the two sides locked '
    + 'together, so the photo comes back smaller rather than squashed. On Resizo you type the '
    + 'width, add the JPG, press Resize image, and what you download is still a JPG, because the '
    + 'output format stays on Same as the original. Your own device does the decoding and the '
    + 'fresh JPEG encode, using a codec the page downloads from this site, so the photo is never '
    + 'sent anywhere.';

const FAQS = [
    {
        question: 'Does resizing a JPG lose quality?',
        answer: 'Two things happen at once. Making the image smaller discards pixels, which is what you asked '
            + 'for and generally looks fine. The file is then written out again as a JPEG at quality 80, and '
            + 'that is a fresh generation of lossy compression. Resize from the best original you have rather '
            + 'than from a copy that has already been through several rounds.',
    },
    {
        question: 'Can I make a JPG bigger without it going blurry?',
        answer: 'Not really. Enlarging cannot invent detail the camera never captured, so a 500-pixel photo '
            + 'stretched to 2000 pixels is a soft version of the same picture — and JPEG makes it worse, '
            + 'because the compression artefacts are enlarged along with everything else. Go back to the '
            + 'original file if there is one.',
    },
    {
        question: 'How much smaller will the file be?',
        answer: 'A lot, but not in proportion to the pixels. Halving the width and the height quarters the '
            + 'pixel count, and a photograph usually lands somewhere between a fifth and a third of its old '
            + 'byte size — compression responds to detail, not to area alone. The panel prints the real '
            + 'before and after numbers.',
    },
    {
        question: 'What pixel width should a JPG be for a web page?',
        answer: 'No wider than the space it will be shown in. A full-width photo on a typical site is fine at '
            + '1600 to 2000 pixels wide, an in-article image at 800 to 1200, a thumbnail at 300 to 400. '
            + 'Anything beyond that is bytes the visitor downloads and never sees.',
    },
    {
        question: 'Does the resized JPG keep its EXIF data?',
        answer: 'No. EXIF and GPS metadata are stripped from every output, so the camera model, the date and '
            + 'the coordinates the photo was taken at do not travel with the resized copy. That is deliberate '
            + 'for anything you are about to publish, and worth knowing if you were relying on the date.',
    },
    {
        question: 'Can I resize a folder of JPGs at once?',
        answer: `Yes. Switch the panel to the batch mode and drop in up to ${MAX_BULK_FILES} files. One width `
            + 'and height applies to the whole set, or you can pin different targets to some of them, and the '
            + 'result comes back as a single ZIP with the before and after size of every file.',
    },
];

const HOW_TO_ID = 'how-to-resize-jpg';
const HOW_TO_HEADING = 'How to resize a JPG';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Set the size you want',
        text: 'Type a width and a height in pixels, switch to Percent, or pick a platform size. With Keep the '
            + 'aspect ratio ticked, one number fills in the other.',
    },
    {
        name: 'Choose the JPG on your device',
        text: `Drag it onto the panel above or press Choose an image, up to ${formatFileSize(MAX_FILE_SIZE)}. `
            + 'It is read where it already sits, so there is no transfer to wait through.',
    },
    {
        name: 'Press Resize image',
        text: 'Your device decodes the JPEG, resamples it to the new dimensions and writes a fresh JPEG. The '
            + 'output format stays on Original, so a JPG in is a JPG out.',
    },
    {
        name: 'Download the new JPG',
        text: 'The panel prints the size before and after and the dimensions actually produced, so you can '
            + 'check the result before you keep it.',
    },
];

export default function ResizeJpgPage() {
    return (
        <>
            <JsonLd
                id="resize-jpg-schema"
                data={[
                    softwareApplication({
                        name: 'JPG Image Resizer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Resize a JPG to exact pixel dimensions',
                            'Scale by percentage',
                            'Aspect-ratio lock',
                            'Platform sizes for Instagram, YouTube, LinkedIn and more',
                            'Keeps JPEG as the output format',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Resize a JPG to exact pixel dimensions, a percentage or a platform size, on your own device, '
                            + 'with JPEG as the output.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ResizeTool
                title="Resize a JPG"
                intro="Exact pixels, a percentage, or a platform size. The output stays a JPEG."
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="re-encode" heading="Resizing a JPEG re-encodes it">
                    <p>
                        A JPEG cannot be resized in place. The file has to be decoded back to raw pixels,
                        resampled to the new dimensions, and compressed again — and that last step is a fresh
                        generation of lossy compression, written here at quality 80.
                    </p>
                    <p>
                        In practice this matters less than it sounds, because you are usually shrinking. What
                        it does mean is that repeated round trips add up: resizing the same photo four times to
                        four different widths from the same original is fine, while resizing yesterday&rsquo;s
                        output again today is not the same thing. Keep the original and always work from it.
                    </p>
                </ContentSection>

                <ContentSection id="down-versus-up" heading="Shrinking hides artefacts. Enlarging magnifies them">
                    <p>
                        Downscaling averages several source pixels into each output pixel, and that averaging
                        happens to smooth over the blocking and the halo-like ringing an earlier JPEG save left
                        behind. A slightly rough photograph often looks cleaner at half its size than it did at
                        full size.
                    </p>
                    <p>
                        Enlarging does the reverse. There is no extra detail to draw on, so the resampler
                        spreads what is there across more pixels — and it spreads the artefacts too, turning a
                        subtle 8-pixel pattern into a visible 30-pixel one. Stay at or below the original
                        dimensions whenever you can.
                    </p>
                </ContentSection>

                <ContentSection id="small-sizes" heading="Where JPEG struggles: very small sizes">
                    <p>
                        JPEG compresses in 8×8 pixel blocks, and it stores colour at half the resolution of
                        brightness in each direction — that is the standard 4:2:0 arrangement our output uses.
                        On a 2000-pixel photo neither fact is noticeable. On a 120-pixel avatar, each block is
                        a much larger share of the image, and coarse colour starts to show on anything
                        saturated.
                    </p>
                    <p>
                        So for small interface graphics — avatars with lettering, badges, icons, anything with
                        thin type or hard edges at 200 pixels or less — switch the output format to PNG in the
                        settings above, or start from a PNG. For small photographs, JPEG is still fine.
                    </p>
                </ContentSection>

                <ContentSection id="format-choice" heading="The output format stays on Original">
                    <p>
                        The format select above sits on Original, so a JPG goes in and a JPG comes out with the
                        same extension and a recognisable filename. You can override it in the same pass:
                        choosing WebP typically takes another quarter to a third off the file, and choosing PNG
                        will make a photograph substantially heavier because PNG has no way to compress
                        photographic detail.
                    </p>
                    <p>
                        Resizing a{' '}
                        <Link
                            href="/resize-png"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            PNG instead
                        </Link>{' '}
                        works differently and has its own page. If your photo has to come in under a specific
                        byte limit, resize it here first and then{' '}
                        <Link
                            href="/compress-image-to-200kb"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            compress it to a target size
                        </Link>{' '}
                        — dimensions are the blunt lever and quality is the fine one.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="Limits and what happens to your file">
                    <p>
                        {formatFileSize(MAX_FILE_SIZE)} per file and {MAX_DIMENSION} pixels on the longest
                        side, in or out. JPEG, PNG and WebP are accepted, and the same three come back.
                    </p>
                    <p>
                        The resizing is done by your own device. The JPG is opened where it already is
                        and the smaller one is written on the same machine, so nothing is transmitted and
                        there is no copy of your photo anywhere else. The output is built from raw pixels,
                        which is why it carries no EXIF or GPS data. If a photograph is too large for the
                        memory your browser can spare, the panel says so before it starts.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="resize-jpg-faq" />
            </ResizeTool>
        </>
    );
}
