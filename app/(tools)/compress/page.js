import CompressTool from './CompressTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/compress';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Compress Image', path: PATH },
];

const DESCRIPTION = 'Compress JPEG, PNG and WebP images online free, without uploading them. Drag the '
    + 'quality slider or set an exact target size in KB and watch the bytes drop — all on your own device. '
    + '20 MB per file, no account.';

export const metadata = buildMetadata({
    title: 'Compress Images Online Free — No Upload, Exact KB Target | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-compress.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Compressing an image means storing the same picture in fewer bytes, either by lowering the '
    + "encoder's quality or by naming the file size you have to hit and letting the encoder find "
    + 'the quality that fits it. On Resizo you pick By quality or To a target size, type the '
    + 'number, add a JPEG, PNG or WebP and press Compress image — the result reports what the file '
    + 'really weighs rather than an estimate. Every one of those encodes runs inside this browser '
    + 'tab on your own device, on a compressor the page fetches from this site, so the picture '
    + 'never travels anywhere.';

const FAQS = [
    {
        question: 'Is compressing an image free?',
        answer: 'Yes. Every tool on Resizo is free to use with no sign-up, no watermark and no daily quota. '
            + 'There are no accounts and nothing to buy — the tools are the whole product.',
    },
    {
        question: 'Can I compress an image without uploading it?',
        answer: 'That is how this tool works, and the only way it works. The compressing software is loaded '
            + 'into the page, and your file is read, re-encoded and saved by your own device. It is never '
            + 'sent to us, so there is nothing for us to keep. The smaller file is written from raw pixels, '
            + 'so it carries no EXIF or GPS data either.',
    },
    {
        question: 'What is the largest file I can compress?',
        answer: '20 MB per file, and up to 8000 pixels on the longest side. If your photo is larger than '
            + 'that, resize it first — dropping the dimensions cuts the file size faster than any quality '
            + 'setting, and then compression has less work to do.',
    },
    {
        question: 'Will compressing an image lower the quality?',
        answer: 'For JPEG and WebP, yes, by design — that is what lossy compression trades away. At quality '
            + '80 the difference is very hard to see on a screen, and the file is usually a fraction of the '
            + 'original. PNG is lossless, so it is handled differently and never re-encodes detail away.',
    },
    {
        question: 'Why did my PNG barely get smaller?',
        answer: 'PNG stores every pixel exactly, so there is no quality to give up. The slider reduces the '
            + 'number of colours instead, which shrinks logos, icons and screenshots a great deal and '
            + 'photographs hardly at all. A photograph saved as PNG should be converted to JPEG or WebP.',
    },
    {
        question: 'Can I compress several images at once?',
        answer: 'This tool takes one image at a time. The bulk resizer handles up to 20 images in a single '
            + 'pass and returns them as a ZIP, and it can change the output format for the whole batch at '
            + 'the same time.',
    },
];

const HOW_TO_ID = 'how-to-compress';
const HOW_TO_HEADING = 'How to compress an image';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Decide how you want to compress',
        text: 'Leave the slider on quality for a general reduction, or switch to a target size and type '
            + 'the number of kilobytes you need.',
    },
    {
        name: 'Choose the image on your device',
        text: 'Drop a JPEG, PNG or WebP onto the panel above, or press Browse files. The limit is 20 MB '
            + 'per file, and the file stays where it is — there is no transfer step.',
    },
    {
        name: 'Press Compress image',
        text: 'Your device re-encodes the picture and measures what came out. The panel prints the original '
            + 'size, the new size and the percentage saved.',
    },
    {
        name: 'Download the smaller file',
        text: 'Check the numbers first. If the saving is not enough, move the slider or set a target size '
            + 'and run it again — there is no quota to use up.',
    },
];

export default function CompressPage() {
    return (
        <>
            <JsonLd
                id="compress-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Compressor',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Compresses on your own device — the image is never uploaded',
                            'Compress JPEG, PNG and WebP',
                            'Quality slider from 1 to 100',
                            'Compress to an exact target file size in KB or MB',
                            'Reports the original size, the new size and the percentage saved',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Shrink a JPEG, PNG or WebP with a quality slider or an exact size '
                            + 'target, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <CompressTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="exact-file-size" heading="Compress to an exact file size">
                    <p>
                        A quality slider cannot answer &ldquo;make this 100 KB&rdquo;. Quality is a perceptual
                        setting, and the number of bytes it produces depends entirely on the picture: a flat
                        studio shot and a photo of a forest come out at wildly different sizes from the same
                        setting.
                    </p>
                    <p>
                        So the target mode measures instead of guessing. Your device encodes the image, reads
                        the real byte length back, and binary-searches the quality range for the best-looking
                        version that still fits under your number — around eight encodes at most, none of
                        which sends a byte anywhere. The result lands at or just below the target, never
                        above it.
                    </p>
                    <p>
                        If even the smallest encode overshoots, you get told the smallest size actually
                        achievable for that image rather than a file that misses the requirement. Job portals,
                        government forms and university applications are the usual reason people need this,
                        and they reject anything over the stated limit.
                    </p>
                </ContentSection>

                <ContentSection id="quality-setting" heading="Which quality setting should I use?">
                    <p>
                        Quality 90 keeps a file that still looks untouched next to the original and is the
                        right choice when the image will be edited again later. Quality 80 is the web default
                        and the setting to reach for when you are not sure — a 4 MB phone photo usually lands
                        somewhere between 400 KB and 700 KB.
                    </p>
                    <p>
                        Quality 60 to 70 is aggressive but still fine for a photograph viewed on a screen at
                        normal size. Below 50 the artefacts become visible: blocking around hard edges, and
                        banding across skies and other smooth gradients.
                    </p>
                </ContentSection>

                <ContentSection id="format-differences" heading="JPEG, PNG and WebP each shrink differently">
                    <p>
                        JPEG is lossy, so quality is a real dial and the file responds to it immediately. WebP
                        is also lossy and typically produces a file 25 to 35 percent smaller than a JPEG at
                        the same visual quality, which is why it is worth converting to.
                    </p>
                    <p>
                        PNG is lossless — it stores every pixel exactly, so there is no quality to trade. The
                        slider reduces the number of colours in the image instead. That works extremely well
                        on logos, icons, diagrams and screenshots, which use few colours to begin with, and
                        badly on photographs, which end up banded. PNG compression reduces colours, so it is
                        best for graphics, not photos.
                    </p>
                </ContentSection>

                <ContentSection id="use-cases" heading="When you need to compress an image">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>Email attachments, where most providers cap a single message near 25 MB.</li>
                        <li>WordPress and other CMS installs that refuse anything over a 2 MB upload limit.</li>
                        <li>Shopify, Etsy and eBay product photos, where page weight affects how fast a listing loads.</li>
                        <li>Chat apps such as Discord, which re-compresses or rejects anything over its own cap.</li>
                        <li>Job portals and government forms that demand a photo or scan under 100 KB or 200 KB.</li>
                        <li>Assembling a PDF, where a handful of full-resolution photos can make the document unusable.</li>
                    </ul>
                </ContentSection>

                <IntentLinks
                    tool="compress"
                    id="compress-targets"
                    heading="Aiming at one number in particular"
                />

                <ContentSection id="limits" heading="Compressing without uploading: limits and what happens to your file">
                    <p>
                        This tool accepts JPEG, PNG and WebP up to 20 MB per file and 8000 pixels on the
                        longest side. The output keeps the format it came in with; use the converter if you
                        want a different one.
                    </p>
                    <p>
                        The compressing is done by your own device — the file is opened where it already is
                        and the smaller copy is written on the same machine, so nothing is transmitted and
                        there is no copy of your photo anywhere else. Because the output is built from raw
                        pixels, it carries no EXIF or GPS data and no longer says where the photo was taken.
                    </p>
                    <p>
                        The practical ceiling is your hardware rather than a policy. A photograph has to be
                        unpacked into raw pixels before it can be re-encoded, which takes several times the
                        file size in memory, so an old phone will refuse a job a laptop takes happily. The
                        panel works that out before it starts and tells you what to try instead.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="compress-faq" />
            </CompressTool>
        </>
    );
}
