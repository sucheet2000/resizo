/**
 * /resize-png — the resizer with PNG-specific copy.
 *
 * PNG is the opposite case to /resize-jpg: no re-compression to worry about,
 * but an alpha channel to preserve, a file size that follows content rather
 * than pixel count, and a set of icon dimensions people are actually looking
 * for when they search this.
 */
import Link from 'next/link';

import ResizeTool from '@/app/(tools)/resize/ResizeTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';
import { formatFileSize } from '@/lib/format-bytes';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/resize-png';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Resize Image', path: '/resize' },
    { name: 'Resize a PNG', path: PATH },
];

const DESCRIPTION = 'Resize a PNG online free, without uploading it. Exact pixel dimensions or a '
    + 'percentage, transparency kept, and no compression artefacts because PNG is lossless. Icons, logos '
    + 'and screenshots, resized on your own device. No account.';

export const metadata = buildMetadata({
    title: 'Resize PNG Online — Transparency Kept, Lossless | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Resizing a PNG is a different job from resizing a photograph: a logo, an icon or a '
    + 'screenshot has to come out the other side with its transparent areas and its hard edges '
    + 'intact. On Resizo you type the new width in pixels, add the PNG, and press Resize image — '
    + 'the result is a PNG again, still see-through where it was see-through, and written without '
    + "any loss, because nothing here reduces a PNG's colours. The resampling and the rewrite are "
    + 'both done by your own browser, on code the page carries with it, so the file stays on your '
    + 'machine from start to finish.';

const ICON_SIZES = [
    { use: 'Favicon', pixels: '32×32', note: 'The one browsers show in a tab. 16×16 is the fallback.' },
    { use: 'Apple touch icon', pixels: '180×180', note: 'Saved to the home screen on an iPhone or iPad.' },
    { use: 'Web app icon, small', pixels: '192×192', note: 'The Android home-screen size in a web manifest.' },
    { use: 'Web app icon, large', pixels: '512×512', note: 'Splash screens and app listings.' },
    { use: 'Avatar or profile mark', pixels: '512×512', note: 'Large enough for every service to downscale from.' },
];

const FAQS = [
    {
        question: 'Does resizing a PNG lose quality?',
        answer: 'There is no compression loss — PNG is lossless, so the file is stored exactly as it is '
            + 'written, and saving it a hundred times changes nothing. What you do lose is pixels: shrinking '
            + 'an image throws away detail permanently, and enlarging it later cannot bring that detail back.',
    },
    {
        question: 'Does the transparent background survive?',
        answer: 'Yes, as long as the output format stays PNG or WebP. The alpha channel is resampled along '
            + 'with the colour, so a cut-out keeps its clean edge and a soft shadow stays soft. Choosing JPEG '
            + 'as the output is the one thing that destroys it — JPEG has no alpha channel and fills every '
            + 'transparent pixel with black.',
    },
    {
        question: 'Why is my resized PNG still so large?',
        answer: 'PNG size follows what is in the picture, not just how many pixels there are. Flat colour '
            + 'compresses enormously; photographic detail barely compresses at all. If the image is a '
            + 'photograph that happens to be saved as a PNG, no amount of resizing will fix the file size — '
            + 'convert it to JPG or WebP instead.',
    },
    {
        question: 'Can I enlarge a PNG logo without it going fuzzy?',
        answer: 'Not from the PNG. A PNG is a grid of pixels, and enlarging one spreads the pixels it has '
            + 'across a bigger grid. If the logo was drawn in a vector program, go back to that file and '
            + 'export at the size you need — a vector master can be exported at any size perfectly sharp.',
    },
    {
        question: 'Will pixel art stay crisp?',
        answer: 'No. The resampler here is a smooth one, which is right for photographs and logos and wrong '
            + 'for pixel art: the hard single-pixel steps get blended into soft gradients. Pixel art needs a '
            + 'nearest-neighbour resize, which is a different job from the one this tool does.',
    },
    {
        question: 'Can I resize a PNG without uploading it?',
        answer: 'That is the only way this tool works. The resizing software is loaded into the page, and '
            + 'your PNG is read, scaled and saved by your own device, so it never reaches us and there is '
            + 'nothing for us to keep. The new file is written from raw pixels, so it carries no EXIF or '
            + 'GPS data.',
    },
];

const HOW_TO_ID = 'how-to-resize-png';
const HOW_TO_HEADING = 'How to resize a PNG';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Set the size you want',
        text: 'Type a width and a height in pixels, or switch to Percent. The sizes further down the page are '
            + 'the ones favicons, app icons and logos are usually asked for at.',
    },
    {
        name: 'Choose the PNG on your device',
        text: `Drag it onto the panel above or press Choose an image, up to ${formatFileSize(MAX_FILE_SIZE)}. `
            + 'Nothing about it is sent anywhere.',
    },
    {
        name: 'Press Resize image',
        text: 'Your device redraws the picture at the new size and writes a new PNG. The alpha channel comes '
            + 'through, and nothing is quantised away.',
    },
    {
        name: 'Download the new PNG',
        text: 'The panel prints the size before and after and the dimensions produced. A PNG that grows rather '
            + 'than shrinks is normal on a resize up, and the numbers show it.',
    },
];

export default function ResizePngPage() {
    return (
        <>
            <JsonLd
                id="resize-png-schema"
                data={[
                    softwareApplication({
                        name: 'PNG Image Resizer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Resize a PNG to exact pixel dimensions',
                            'Scale by percentage',
                            'Keeps the alpha channel',
                            'Lossless, full-colour PNG output with no palette reduction',
                            'Aspect-ratio lock',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Resize a PNG to exact pixel dimensions or a percentage on your own device, with the '
                            + 'transparency intact.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ResizeTool
                title="Resize a PNG"
                intro="Exact pixels or a percentage, with the transparency intact and no compression artefacts."
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="lossless" heading="Lossless, but not reversible">
                    <p>
                        PNG stores every pixel exactly. Nothing is approximated on the way in or out, so a
                        resized PNG carries none of the blocking or ringing that a re-saved JPEG picks up, and
                        you can open and re-save it as often as you like without any accumulating damage. The
                        PNG encoder in this page has no quality setting to get wrong: the output is always
                        full colour, with nothing quantised away.
                    </p>
                    <p>
                        Lossless is not the same as reversible, though. Going from 1024 pixels to 256 throws
                        away three quarters of the information in each direction, and it is gone — scaling the
                        result back up produces a soft 1024-pixel image, not the one you started with. Keep the
                        largest version you have as the master and export the smaller sizes from it.
                    </p>
                </ContentSection>

                <ContentSection id="transparency" heading="Transparency and hard edges">
                    <p>
                        The alpha channel is resampled along with the colour, so transparency survives the
                        resize completely: fully clear stays clear, and the partly transparent pixels along an
                        anti-aliased curve keep their exact degree of transparency. A logo shrunk here still
                        drops cleanly onto any background.
                    </p>
                    <p>
                        The one thing to keep an eye on is very fine detail. Thin one-pixel outlines and small
                        text baked into an image are close to the limit of what any resampler can represent
                        once the image is small; below roughly 100 pixels they tend to go faint. If the artwork
                        exists as a vector file, exporting from that at the target size beats resizing a
                        bitmap every time.
                    </p>
                </ContentSection>

                <ContentSection id="size-follows-content" heading="PNG file size follows content, not pixel count">
                    <p>
                        Halving both sides of a JPEG reliably takes most of the bytes with it. PNG does not
                        behave that way, because it compresses by finding repetition rather than by discarding
                        detail. A screenshot of a mostly-flat interface can shrink dramatically. A photograph
                        saved as a PNG stays heavy at any size, because there is no repetition to find.
                    </p>
                    <p>
                        If that is the situation you are in, the format is the problem rather than the
                        dimensions. Send the photograph to{' '}
                        <Link
                            href="/png-to-jpg"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            PNG to JPG
                        </Link>{' '}
                        if it has no transparency, or to{' '}
                        <Link
                            href="/png-to-webp"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            PNG to WebP
                        </Link>{' '}
                        if it does.
                    </p>
                </ContentSection>

                <ContentSection id="icon-sizes" heading="The PNG sizes people usually need">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[28rem] border-collapse text-left">
                            <caption className="sr-only">Common PNG icon and asset dimensions</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Use</th>
                                    <th scope="col" className="py-2 pr-4 text-ui text-ink">Pixels</th>
                                    <th scope="col" className="py-2 text-ui text-ink">Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ICON_SIZES.map((row) => (
                                    <tr key={row.use} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 text-base font-normal text-ink">
                                            {row.use}
                                        </th>
                                        <td className="py-2 pr-4 font-data text-ui text-ink">{row.pixels}</td>
                                        <td className="py-2">{row.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p>
                        Type the number into the width field with the ratio lock on and the height fills itself
                        in. Square icons are easiest to get right if the source is already square — otherwise
                        setting both sides scales the image up to cover the frame and trims the overflow, which
                        is a crop rather than a squash.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="Limits and what happens to your file">
                    <p>
                        {formatFileSize(MAX_FILE_SIZE)} per file and {MAX_DIMENSION} pixels on the longest
                        side. Resizing a{' '}
                        <Link
                            href="/resize-jpg"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            JPG instead
                        </Link>{' '}
                        involves a re-encode and has its own page.
                    </p>
                    <p>
                        The resizing is done by your own device. The PNG is opened where it already is and
                        the resized one is written on the same machine, so nothing is transmitted and there
                        is no copy of it anywhere else. The output is built from raw pixels, which is why it
                        carries no EXIF or GPS data. A very large PNG needs a lot of memory to open, so the
                        panel checks what this device can spare before it starts.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="resize-png-faq" />
            </ResizeTool>
        </>
    );
}
