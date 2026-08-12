/**
 * /resize — the route four tool pages linked to for months while it returned
 * a hard 404, and the reason the resize workspace no longer lives on the
 * homepage. It owns "resize image online"; the homepage owns the hub intent.
 *
 * Server component: the metadata, the structured data and every word below are
 * rendered on the server and passed into the client workspace as children, so
 * none of the copy depends on a JavaScript pass.
 */
import ResizeTool from './ResizeTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE, SOCIAL_PRESETS } from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/resize';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Resize Image', path: PATH },
];

const DESCRIPTION = 'Resize JPEG, PNG and WebP images to exact pixel dimensions, by percentage, or to '
    + 'a platform size. Lock the aspect ratio, or resize up to 20 at once. Free, no account.';

export const metadata = buildMetadata({
    title: 'Resize Image Online — Exact Pixels, Percent or Presets | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

const FAQS = [
    {
        question: 'How many images can I resize?',
        answer: 'There is no daily quota and no account to create. Requests are rate limited to ten resizes '
            + 'a minute per address, and five batch jobs a minute, so one visitor cannot tie up the server '
            + 'for everyone else. If you reach it the panel says so and asks you to wait a minute.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, re-encoded on our server, and '
            + 'discarded the moment the response is written. Nothing is kept. '
            + 'EXIF and GPS metadata are stripped from every output, so a resized photo no longer '
            + 'carries the location it was taken.',
    },
    {
        question: 'What are the size limits?',
        answer: `${formatFileSize(MAX_FILE_SIZE)} per file and ${MAX_DIMENSION} pixels on the longest side. `
            + `A batch holds ${MAX_BULK_FILES} images and ${formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. `
            + 'Those caps exist because the whole job has to fit inside one server request; anything larger '
            + 'is better done in two passes.',
    },
    {
        question: 'Which formats can I resize?',
        answer: 'JPEG, PNG and WebP go in, and the same three come out. GIF is not accepted — there is no GIF '
            + 'decoder here, and resizing one would have flattened the animation to a single still frame '
            + 'anyway. Use a dedicated GIF tool for those.',
    },
    {
        question: 'Does resizing lose quality?',
        answer: 'Making an image smaller discards pixels, which is what you asked for, and the result looks '
            + 'the way the smaller version should look. Making it larger cannot invent detail that was never '
            + 'captured, so a 400 px photo scaled to 2000 px looks soft. Stay at or below the original '
            + 'dimensions where you can.',
    },
    {
        question: 'Can I resize several images at once?',
        answer: `Yes. Switch the panel to "Up to ${MAX_BULK_FILES}", drop the files in, and set one width and `
            + 'height for the whole batch or pin different values to a few of them. The result comes back as '
            + 'a single ZIP with a per-file list of what each image weighed before and after.',
    },
];

export default function ResizePage() {
    return (
        <>
            <JsonLd
                id="resize-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Resizer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Resize to exact pixel dimensions',
                            'Scale by percentage',
                            'Platform size presets for Instagram, YouTube, LinkedIn and more',
                            'Aspect-ratio lock',
                            'Batch of up to 20 images returned as a ZIP',
                            'Convert to JPEG, PNG or WebP in the same pass',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <ResizeTool breadcrumb={BREADCRUMB}>
                <ContentSection id="how-to-resize" heading="How to resize an image online">
                    <ol className="flex list-decimal flex-col gap-2 pl-5">
                        <li>
                            Set the target first. Type a width and height in pixels, switch to Percent and
                            type a number, or tap a platform size such as Instagram post or YouTube thumbnail.
                            The controls sit above the drop zone so a file lands already configured.
                        </li>
                        <li>
                            Add the image. Drag it onto the panel or press Choose an image. JPEG, PNG and
                            WebP are accepted, up to {formatFileSize(MAX_FILE_SIZE)} each.
                        </li>
                        <li>
                            Press Resize image. The file goes over HTTPS to our server, which re-encodes it
                            and answers with the result.
                        </li>
                        <li>
                            Download. The panel prints the real before and after byte counts and the measured
                            output dimensions, so you can check the result before you keep it.
                        </li>
                    </ol>
                </ContentSection>

                <ContentSection id="pixels-or-percent" heading="Pixels or percent — which one you want">
                    <p>
                        Use pixels when something else has already decided the number for you: an upload form
                        that wants 1200 px wide, a print template, a thumbnail slot in a theme. Type the
                        number you were given and the guesswork is over.
                    </p>
                    <p>
                        Use percent when the exact number does not matter but the weight does — a folder of
                        camera photos that all need to be roughly half as big, or a screenshot that is simply
                        too large for the page it is going on. Percent keeps every image proportional to
                        itself instead of forcing a mixed set into one shape.
                    </p>
                </ContentSection>

                <ContentSection id="aspect-ratio" heading="Width, height and the aspect ratio">
                    <p>
                        The aspect ratio is the relationship between the two sides. A 4000×3000 photo is 4:3;
                        halve both numbers and it is still 4:3, which is why it still looks right. Change only
                        one of them and it does not — the picture stretches.
                    </p>
                    <p>
                        With <strong className="font-semibold text-ink">Keep the aspect ratio</strong> ticked,
                        typing a width fills in the matching height for you, and the other way round. Leave
                        one field empty and the server works the second side out the same way.
                    </p>
                    <p>
                        Set both sides to numbers that do not match the original ratio — which is what every
                        platform size does — and the image is scaled up until it covers the frame, then the
                        overflow is trimmed evenly from the edges. That is a crop, not a stretch, and it is
                        almost always what you want for a profile picture or a cover image.
                    </p>
                </ContentSection>

                <ContentSection id="dimensions-vs-size" heading="Dimensions are not file size">
                    <p>
                        Pixel dimensions describe how big the picture is. File size describes how many bytes
                        it takes to store. The two move together, but not one for one: halving both sides
                        quarters the pixel count, and a JPEG usually lands between a fifth and a third of its
                        old weight rather than exactly a quarter, because compression works on detail, not on
                        area alone.
                    </p>
                    <p>
                        If you have a hard byte limit to hit — a job portal that rejects anything over 200 KB,
                        an email that bounces over 10 MB — resizing is the blunt half of the job and quality
                        is the fine half. Resize first, then compress to the exact number.
                    </p>
                </ContentSection>

                <ContentSection id="platform-sizes" heading="Platform sizes at a glance">
                    <p>
                        Every size below is a chip above the drop zone, so you never have to remember one.
                        These are the dimensions each placement is published at.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[20rem] border-collapse text-left">
                            <caption className="sr-only">Common social and web image dimensions</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Placement</th>
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Pixels</th>
                                    <th scope="col" className="py-2 text-ui text-ink">Shape</th>
                                </tr>
                            </thead>
                            <tbody>
                                {SOCIAL_PRESETS.map((preset) => (
                                    <tr key={preset.id} className="border-b border-line">
                                        <td className="py-2 pr-4">{preset.label}</td>
                                        <td className="py-2 pr-4 font-data text-ui text-ink">
                                            {preset.width}×{preset.height}
                                        </td>
                                        <td className="py-2 font-data text-ui">
                                            {preset.width === preset.height
                                                ? 'square'
                                                : preset.width > preset.height
                                                    ? 'landscape'
                                                    : 'portrait'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ContentSection>

                <ContentSection id="bulk-resize" heading="Resizing twenty images at once">
                    <p>
                        Switch the panel to the batch mode and the same controls apply to every file you drop
                        in. Each thumbnail carries a tick box, so you choose what actually goes into the run,
                        and a target you pin to a selection overrides the batch default for just those files —
                        useful when half a folder is portrait and half is landscape.
                    </p>
                    <p>
                        The result is one ZIP, and the panel lists each file with what it weighed before, what
                        it weighs now and the percentage saved, plus the total across the batch. Those numbers
                        are read out of the archive itself rather than estimated.
                    </p>
                </ContentSection>

                <IntentLinks
                    tool="resize"
                    id="resize-formats"
                    heading="Resizing one format in particular"
                />

                <ContentSection id="limits" heading="Limits, formats and what happens to your file">
                    <p>
                        {formatFileSize(MAX_FILE_SIZE)} per file and {MAX_DIMENSION} pixels on the longest
                        side. A batch takes {MAX_BULK_FILES} images and{' '}
                        {formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. Input formats are JPEG, PNG and
                        WebP; output is JPEG, PNG or WebP.
                    </p>
                    <p>
                        Processing happens on our server: the upload travels over HTTPS, sharp
                        re-encodes it, the bytes are returned, and nothing is kept
                        afterwards. EXIF and GPS metadata are stripped from every output. There is no account
                        to create and nothing is added to the image.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="resize-faq" />
            </ResizeTool>
        </>
    );
}
