import Link from 'next/link';

import CropTool from './CropTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/crop';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Crop Image', path: PATH },
];

const DESCRIPTION = 'Crop images online free, without uploading them. Enter exact pixel coordinates and '
    + 'crop size, see the region outlined on the image before you commit, and the cropping happens on your '
    + 'own device. JPEG, PNG and WebP.';

export const metadata = buildMetadata({
    title: 'Crop Images Online Free — No Upload, Exact Pixels | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Cropping an image means keeping one rectangle of it and throwing away everything outside: '
    + 'you say how far in from the left and from the top the rectangle starts, and how wide and '
    + 'tall it is, all counted in pixels from the top-left corner. On Resizo you add the picture, '
    + 'type X, Y, Width and Height, watch the outline move over the preview, then press Crop image '
    + '— what comes back is in the same format it went in as. The preview and the cut both happen '
    + 'on your own machine, on code the page hands to your browser, so nothing about the photo '
    + 'goes over the network.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

const FAQS = [
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
        name: 'Set the region you want to keep',
        text: 'Set Width and Height to the size you want, then move the region with X and Y until the '
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
                            'Live outline of the region that will be kept',
                            'Rule-of-thirds guides inside the crop region',
                            'Validates the region against the real source dimensions before it runs',
                            'Crops on your own device — the image is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Cut a rectangle out of a JPEG, PNG or WebP by exact pixel '
                            + 'coordinates, on your own device.',
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
                            bottom-left. X counts pixels to the right, Y counts pixels down. This is the
                            single thing people get wrong with coordinate cropping, so the preview outlines
                            the region you have described and dims everything that will be thrown away.
                        </p>
                    )}
                />

                <ContentSection id="aspect-ratio" heading="Crop to a specific aspect ratio">
                    <p>
                        An aspect ratio is just a fixed relationship between width and height, so you can work
                        it out from whichever side you want to keep whole. For a square 1:1 crop, set width
                        and height to the same number — the largest square you can take from a 4000×3000 photo
                        is 3000×3000.
                    </p>
                    <p>
                        For a 4:5 portrait crop, the height is the width multiplied by 1.25: a 1080 wide crop
                        needs a height of 1350. For 16:9, the height is the width multiplied by 0.5625, so
                        1920 wide pairs with 1080 high. To centre any of these, set X to half the difference
                        between the source width and your crop width, and Y to half the difference between the
                        heights.
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
