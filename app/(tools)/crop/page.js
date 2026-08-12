import Link from 'next/link';

import CropTool from './CropTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';

const PATH = '/crop';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Crop Image', path: PATH },
];

const DESCRIPTION = 'Crop images online free. Enter exact pixel coordinates and crop size, see the region '
    + 'outlined on the image before you commit, download instantly. JPEG, PNG and WebP.';

export const metadata = buildMetadata({
    title: 'Crop Images Online Free — Image Cropper | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

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
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, processed on our server, and never kept. '
            + 'It is discarded the moment your download starts, and EXIF and GPS metadata are stripped '
            + 'from every output.',
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
                            'Validates the region against the source dimensions before upload',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <CropTool breadcrumb={BREADCRUMB}>
                <ContentSection id="how-to-crop" heading="How to crop an image">
                    <p>
                        Coordinates start at the top-left corner of the image, not the centre and not the
                        bottom-left. X counts pixels to the right, Y counts pixels down. This is the single
                        thing people get wrong with coordinate cropping, so the preview outlines the region
                        you have described and dims everything that will be thrown away.
                    </p>
                    <ol className="flex list-decimal flex-col gap-2 pl-5">
                        <li>Drop a JPEG, PNG or WebP onto the panel above. The whole image is selected to begin with.</li>
                        <li>
                            Set Width and Height to the size you want to keep, then move the region with X and
                            Y until the outline sits where you want it.
                        </li>
                        <li>
                            Press Crop image. If the region runs off an edge the button stays disabled and the
                            panel tells you the size it has to fit inside.
                        </li>
                    </ol>
                </ContentSection>

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

                <ContentSection id="limits" heading="Limits and what happens to your file">
                    <p>
                        JPEG, PNG and WebP, up to 20 MB per file and 8000 pixels on the longest side. The crop
                        is applied on the server by Sharp at full source resolution — the preview is scaled to
                        fit your screen, but the coordinates always refer to real pixels in the original.
                    </p>
                    <p>
                        Your file is sent over HTTPS and processed on our server — never kept,
                        deleted the moment your download starts. EXIF and GPS metadata are stripped from
                        every output.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="crop-faq" />
            </CropTool>
        </>
    );
}
