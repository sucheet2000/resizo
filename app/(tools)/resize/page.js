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
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { SOCIAL_PRESETS } from '@/lib/catalog';
import { describePreset, hasVerifiedSource } from '@/lib/catalog/presets';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';
import { formatFileSize } from '@/lib/format/bytes';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/resize';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

/** A verifiedAt is a calendar day: read it as UTC and print it as UTC. */
const VERIFIED_DATE = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };

const formatVerifiedAt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', VERIFIED_DATE);

/** One entry per page cited, not per preset — LinkedIn cites two, Instagram one for two chips. */
const SOURCED_PRESETS = SOCIAL_PRESETS.filter(hasVerifiedSource);

const UNSOURCED_PRESETS = SOCIAL_PRESETS.filter((preset) => !hasVerifiedSource(preset));

/** "a, b and c" — the labels, never a bare count, so the sentence stays checkable. */
function listLabels(presets) {
    const labels = presets.map((preset) => preset.label);
    if (labels.length < 2) return labels.join('');
    return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Resize Image', path: PATH },
];

const DESCRIPTION = 'Resize JPEG, PNG and WebP images to exact pixel dimensions, by percentage, or to '
    + 'a platform size, without uploading them — the resizing happens on your own device. Lock the '
    + 'aspect ratio, or resize up to 20 at once. Free, no account.';

export const metadata = buildMetadata({
    title: 'Resize Image Online — No Upload, Exact Pixels or Percent | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'To resize an image you set the pixel size you want — a width, a height, or a percentage of '
    + 'what you started with — and keep the two sides in proportion so the picture shrinks instead '
    + 'of stretching. On Resizo you set that target first, drop in a JPEG, PNG or WebP, press '
    + 'Resize image, and the panel prints the dimensions and the byte count that actually came out. '
    + 'The resizing itself is done by your own computer, running image code the page brings with '
    + 'it, so the picture never leaves the machine it is already on.';

const FAQS = [
    {
        question: 'How many images can I resize?',
        answer: 'As many as you like. There is no daily quota, no account to create and nothing counting '
            + 'your use, because the resizing happens on your own device rather than somewhere that has to '
            + 'be shared out between visitors. The only thing that slows you down is how fast your machine '
            + 'gets through a large photo.',
    },
    {
        question: 'Can I resize an image without uploading it?',
        answer: 'That is the only way this tool works. The page loads the resizing software into your '
            + 'browser, and your file is read, resized and saved by your own device — it is never sent to '
            + 'us, so there is nothing for us to keep. The download is written on your machine too, from '
            + 'raw pixels, so it carries no EXIF or GPS data and no longer says where the photo was taken.',
    },
    {
        question: 'What are the size limits?',
        answer: `${formatFileSize(MAX_FILE_SIZE)} per file and ${MAX_DIMENSION} pixels on the longest side. `
            + `A batch holds ${MAX_BULK_FILES} images and ${formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. `
            + 'Those caps exist because a photo has to be unpacked into raw pixels to be resized, and raw '
            + 'pixels take several times the space of the file. If your device cannot spare that much '
            + 'memory the panel says so before it starts, rather than failing part way through.',
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

const HOW_TO_ID = 'how-to-resize';
const HOW_TO_HEADING = 'How to resize an image online';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Set the target first',
        text: 'Type a width and height in pixels, switch to Percent and type a number, or tap a platform '
            + 'size such as Instagram post or YouTube thumbnail. The controls sit above the drop zone so a '
            + 'file lands already configured.',
    },
    {
        name: 'Choose the image on your device',
        text: `Drag it onto the panel or press Choose an image. JPEG, PNG and WebP are accepted, up to `
            + `${formatFileSize(MAX_FILE_SIZE)} each. Nothing is sent anywhere at this point, or at any `
            + 'other point.',
    },
    {
        name: 'Press Resize image',
        text: 'Your device opens the file, scales it and writes the new one, with no transfer to wait for.',
    },
    {
        name: 'Download the result',
        text: 'The panel prints the real before and after byte counts and the measured output dimensions, '
            + 'so you can check the result before you keep it.',
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
                            'Resizes on your own device — the image is never uploaded',
                            'Resize to exact pixel dimensions',
                            'Scale by percentage',
                            'Platform size presets for Instagram, YouTube, LinkedIn and more',
                            'Aspect-ratio lock',
                            'Batch of up to 20 images returned as a ZIP',
                            'Convert to JPEG, PNG or WebP in the same pass',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Resize a JPEG, PNG or WebP to exact pixel dimensions, a percentage or '
                            + 'a platform size, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ResizeTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

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
                        one field empty and the tool works the second side out the same way.
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
                        The last column says where each number came from: {SOURCED_PRESETS.length} of the{' '}
                        {SOCIAL_PRESETS.length} are the size the platform&rsquo;s own help page states, and the
                        rest are the export sizes people have settled on. There is a{' '}
                        <a href="#preset-sources" className={LINK}>list of the pages we read</a> further down.
                    </p>
                    <div
                        className="overflow-x-auto"
                        role="region"
                        aria-label="Common social and web image dimensions"
                        tabIndex={0}
                    >
                        <table className="w-full min-w-[20rem] border-collapse text-left">
                            <caption className="sr-only">Common social and web image dimensions</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Placement</th>
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Pixels</th>
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Shape</th>
                                    <th scope="col" className="py-2 text-ui text-ink">Where it comes from</th>
                                </tr>
                            </thead>
                            <tbody>
                                {SOCIAL_PRESETS.map((preset) => (
                                    <tr key={preset.id} className="border-b border-line">
                                        <td className="py-2 pr-4">{preset.label}</td>
                                        <td className="py-2 pr-4 font-data text-ui text-ink">
                                            {preset.width}×{preset.height}
                                        </td>
                                        <td className="py-2 pr-4 font-data text-ui">
                                            {preset.width === preset.height
                                                ? 'square'
                                                : preset.width > preset.height
                                                    ? 'landscape'
                                                    : 'portrait'}
                                        </td>
                                        <td className="py-2">{describePreset(preset)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ContentSection>

                <ContentSection id="preset-sources" heading="Where the platform sizes come from">
                    <p>
                        A chip that names a size is a claim about somebody else&rsquo;s product, and a claim
                        like that goes stale without anyone here touching a file. So every one of them was
                        read back against the platform&rsquo;s own help page, and the sizes nobody publishes
                        are named as conventions instead of being dressed up as rules.
                    </p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        {SOURCED_PRESETS.map((preset) => (
                            <li key={preset.id}>
                                <span className="text-ink">{preset.label}</span>{' '}
                                <span className="font-data text-micro">
                                    {preset.width}&times;{preset.height}
                                </span>
                                {' — '}
                                <a href={preset.source.url} target="_blank" rel="noopener" className={LINK}>
                                    {preset.source.label}
                                </a>
                                {', checked '}
                                <time dateTime={preset.source.verifiedAt}>
                                    {formatVerifiedAt(preset.source.verifiedAt)}
                                </time>
                            </li>
                        ))}
                    </ul>
                    <p>
                        The other {UNSOURCED_PRESETS.length} — {listLabels(UNSOURCED_PRESETS)} — have no
                        published size behind them. Instagram documents no story or profile-picture size, X
                        documents a range of accepted shapes rather than a pixel count, and WhatsApp and
                        Discord each document only a floor. Those are the export sizes in common use. They
                        will not be rejected anywhere, but nobody at those companies asked for them.
                    </p>
                    <p>
                        Two of the twelve moved on this pass. Instagram now keeps a feed photo at a width of
                        1080 pixels with a height of up to 1440, so the portrait chip is 1080&times;1440
                        rather than the 1080&times;1350 it read for years, and YouTube now recommends a
                        3840&times;2160 thumbnail rather than 1280&times;720. Both of the older sizes still
                        upload without complaint. Neither is what the platform asks for any more.
                    </p>
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

                <ContentSection id="limits" heading="Resizing without uploading: limits and what happens to your file">
                    <p>
                        {formatFileSize(MAX_FILE_SIZE)} per file and {MAX_DIMENSION} pixels on the longest
                        side. A batch takes {MAX_BULK_FILES} images and{' '}
                        {formatFileSize(MAX_BULK_TOTAL_BYTES)} in total. Input formats are JPEG, PNG and
                        WebP; output is JPEG, PNG or WebP.
                    </p>
                    <p>
                        All of the work is done by your device. The page carries the image code with it, your
                        file is opened where it already is, and the resized copy is written back on the same
                        machine — nothing about it is transmitted, so there is no wait for an upload on a
                        slow connection and no copy of your photo anywhere else. The output is built from raw
                        pixels, which is why it carries no EXIF or GPS data. There is no account to create
                        and nothing is added to the image.
                    </p>
                    <p>
                        The one thing that varies is your hardware. Opening a photograph costs several times
                        its file size in memory, so a 48-megapixel image is heavy work for a phone. The panel
                        checks what the browser can spare first, and if a job will not fit it says so and
                        suggests a smaller target instead of losing your file part way through.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="resize-faq" />
            </ResizeTool>
        </>
    );
}
