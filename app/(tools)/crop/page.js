import Link from 'next/link';

import CropTool from './CropTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { GITHUB_REPO_URL, buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/crop';

const BENCHMARK_URL = `${GITHUB_REPO_URL}/blob/main/benchmarks/README.md`;

/** The crop the benchmark run made, and every number under the figure below. */
const MEASURED = benchmark.scenarios
    .find((scenario) => scenario.id === 'demo-outputs')
    .cases.find((entry) => entry.id === 'crop-photo');

const FIGURE_IMAGES = [
    {
        src: '/demos/photo-source-800x534.jpg',
        width: 800,
        height: 534,
        alt: 'The whole sample frame before cropping: a band of cloud and a low sun over layered ridge '
            + 'lines, then open water, then a strip of shingle along the bottom edge.',
        label: 'Before',
    },
    {
        src: '/demos/photo-crop-900x600.jpg',
        width: 900,
        height: 600,
        alt: 'The rectangle that survived the crop. The sun, the ridge lines and the water are kept; the '
            + 'cloud at the top and the shingle at the bottom are gone, and what is left is at the same '
            + 'detail it always had.',
        label: 'After',
    },
];

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Crop Image', path: PATH },
];

const DESCRIPTION = 'Crop images online free, without uploading them. Tap an aspect ratio — 1:1, 4:3, '
    + '3:2, 4:5, 16:9, 9:16 — or type exact pixel coordinates, see the region outlined before you commit, '
    + 'and the crop happens on your own device. JPEG, PNG and WebP.';

export const metadata = buildMetadata({
    title: 'Crop Image Online — No Upload, Aspect Ratio or Exact Pixels | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Cropping an image means keeping one rectangle of it and throwing away everything outside: '
    + 'you say how far in from the left and from the top the rectangle starts, and how wide and '
    + 'tall it is, all counted in pixels from the top-left corner. On Resizo you add the picture, '
    + 'then either tap one of the six aspect ratios, from 1:1 to 9:16, and the largest centred '
    + 'rectangle of that shape fills the four fields, or type X, Y, Width and Height yourself. The '
    + 'outline moves over the preview as you go, and what comes back after Crop image is in the same '
    + 'format it went in as. The preview and the cut both happen on your own machine, on code the '
    + 'page hands to your browser, so nothing about the photo goes over the network.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

const FAQS = [
    {
        question: 'How do I crop an image to 1:1, 16:9 or another aspect ratio?',
        answer: 'Add the image, then tap one of the six chips above the number fields — 1:1, 4:3, 3:2, 4:5, '
            + '16:9 or 9:16. The four fields fill with the largest rectangle of that shape that fits, centred '
            + 'on the picture, and you can move it afterwards with X and Y. Nothing is enlarged to reach a '
            + 'shape, so a 1200×800 photo cropped to 1:1 comes back as 800×800.',
    },
    {
        question: 'Where does X and Y start counting from?',
        answer: 'From the top-left corner of the image. X counts pixels to the right, Y counts pixels down. '
            + 'So x 0, y 0 is the very first pixel, and a crop of x 100, y 50 skips the leftmost 100 columns '
            + 'and the top 50 rows before it starts keeping anything.',
    },
    {
        question: 'Why is my crop rejected as out of bounds?',
        answer: 'Because the region runs off the edge. X plus width has to be no larger than the image width, '
            + 'and Y plus height no larger than the image height. The panel prints the source dimensions '
            + 'right under the preview, and the outline shows you exactly what will be kept.',
    },
    {
        question: 'Does cropping reduce the quality of the image?',
        answer: 'The pixels that survive are the pixels you started with. The file is re-encoded in its '
            + 'original format on the way out, which for a JPEG means one more lossy pass, so the change is '
            + 'there but very hard to see. A PNG crop is lossless.',
    },
    {
        question: 'What formats and sizes can I crop?',
        answer: 'JPEG, PNG and WebP, up to 20 MB per file and 8000 pixels on the longest side. The output '
            + 'comes back in the same format it went in as, so a cropped PNG stays a PNG and keeps its '
            + 'transparency.',
    },
    {
        question: 'Can I crop an image without uploading it?',
        answer: 'Yes — this cropper does not upload anything. The image software is loaded into the page, '
            + 'and your file is read, cropped and saved by your own device, so it never reaches us and '
            + 'there is nothing for us to keep. The cropped file is written from raw pixels, so it carries '
            + 'no EXIF or GPS data either.',
    },
];

const HOW_TO_ID = 'how-to-crop';
const HOW_TO_HEADING = 'How to crop an image';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the image on your device',
        text: 'Drop a JPEG, PNG or WebP onto the panel above. The whole image is selected to begin with, '
            + 'and it is read where it sits rather than being sent anywhere.',
    },
    {
        name: 'Pick a shape, or set the region by hand',
        text: 'Tap an aspect ratio chip and the largest centred rectangle of that shape fills the four '
            + 'fields. Or set Width and Height yourself, then move the region with X and Y until the '
            + 'outline sits where you want it.',
    },
    {
        name: 'Press Crop image',
        text: 'If the region runs off an edge the button stays disabled and the panel tells you the size it '
            + 'has to fit inside.',
    },
    {
        name: 'Download the crop',
        text: 'The panel shows the cropped image and its size, so you can look at it before you keep it.',
    },
];

export default function CropPage() {
    return (
        <>
            <JsonLd
                id="crop-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Cropper',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Crop JPEG, PNG and WebP by exact pixel coordinates',
                            'Aspect-ratio presets — 1:1, 4:3, 3:2, 4:5, 16:9, 9:16 — fitted and centred',
                            'Live outline of the region that will be kept',
                            'Rule-of-thirds guides inside the crop region',
                            'Validates the region against the real source dimensions before it runs',
                            'Crops on your own device — the image is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Cut a rectangle out of a JPEG, PNG or WebP by aspect ratio or by '
                            + 'exact pixel coordinates, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <CropTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            Coordinates start at the top-left corner of the image, not the centre and not the
                            bottom-left: X counts pixels to the right, Y counts pixels down. A ratio chip
                            fills those same four fields, so either way the preview outlines the region you
                            have described and dims everything that will be thrown away.
                        </p>
                    )}
                />

                <ContentSection id="aspect-ratio" heading="Crop to a specific aspect ratio">
                    <p>
                        An aspect ratio is a fixed relationship between the two sides, and the six chips above
                        the X, Y, Width and Height fields work it out for you: Square 1:1, Standard 4:3,
                        Classic 3:2, Portrait 4:5, Widescreen 16:9 and Tall 9:16. Pick one and the four fields
                        fill with the largest rectangle of that shape that fits, centred on the picture. The
                        chips appear once an image is in the panel, because the numbers depend on the size of
                        the picture they are measured against.
                    </p>
                    <p>
                        Nothing is ever enlarged to reach a shape. A 4000×3000 photo gives 3000×3000 at 1:1,
                        4000×2250 at 16:9 and 1688×3000 at 9:16, where the height is what runs out first —
                        always the biggest rectangle of that shape the source can hold. The fields stay yours
                        afterwards: move the frame off centre with X and Y and the shape is unchanged, because
                        only Width and Height decide it.
                    </p>
                </ContentSection>

                <ContentSection id="crop-vs-resize" heading="Cropping and resizing are not the same thing">
                    <p>
                        Cropping removes pixels from the edges and changes the shape of the frame. The pixels
                        that remain are untouched, so a 1000×1000 crop from a large photo is still at full
                        detail — you have simply thrown the rest of the picture away.
                    </p>
                    <p>
                        Resizing keeps the entire frame and rescales every pixel in it, which changes the
                        dimensions without changing what is in the shot. If you need a specific size and a
                        specific shape, do both: crop to the shape first, then{' '}
                        <Link href="/resize" className={LINK}>resize to the exact dimensions</Link>. Doing it
                        in that order means the resize works from the region you actually care about.
                    </p>
                    <Figure
                        images={FIGURE_IMAGES}
                        caption={(
                            <>
                                {`A ${MEASURED.settings.rect.width}×${MEASURED.settings.rect.height} rectangle `}
                                {`taken out of ${MEASURED.input.width}×${MEASURED.input.height}, starting `}
                                {`${MEASURED.settings.rect.x} px in and ${MEASURED.settings.rect.y} px down: `}
                                {`${formatFileSize(MEASURED.input.bytes)} became `}
                                {`${formatFileSize(MEASURED.output.bytes)}, JPEG in and JPEG out. `}
                                The after is the tool&rsquo;s own file, byte for byte; the before is the same
                                source shown at 800 px wide to keep this page light.{' '}
                                <a href={BENCHMARK_URL} rel="noopener" className={LINK}>see the benchmark</a>
                            </>
                        )}
                    />
                </ContentSection>

                <ContentSection id="limits" heading="Cropping without uploading: limits and what happens to your file">
                    <p>
                        JPEG, PNG and WebP, up to 20 MB per file and 8000 pixels on the longest side. The crop
                        is applied at full source resolution — the preview is scaled to fit your screen, but
                        the coordinates always refer to real pixels in the original.
                    </p>
                    <p>
                        All of it happens on your own device: the file is opened where it already is, the
                        rectangle is cut, and the new file is written on the same machine. Nothing is
                        transmitted, so there is no copy of your image anywhere else, and because the output
                        is built from raw pixels it carries no EXIF or GPS data.
                    </p>
                    <p>
                        The one limit that depends on you is memory. A photograph has to be unpacked into raw
                        pixels before a region can be cut out of it, which takes several times the file size,
                        so the panel checks what this device can spare and says so if a job will not fit.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="crop-faq" />
            </CropTool>
        </>
    );
}
