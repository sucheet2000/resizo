import Link from 'next/link';

import FitTool from './FitTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/**
 * The run behind the before/after figure: the 800×534 sample photo through
 * Crop to fill at 600×600, searched down to the 50 KB case — public/demos
 * holds a fixed budget (tests/app/demo-assets.test.js) and 544 KB of it is
 * already spent, so the 100 KB output does not fit as a second image. Both
 * cases still ran in the benchmark; only one is shown.
 *
 * `benchmarks/` is the only source of a published number, so until this
 * scenario has actually been measured and committed, MEASURED is null and the
 * whole demonstration renders nothing rather than a placeholder.
 */
const SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'image-size-fitter') ?? null;
const MEASURED = SCENARIO?.cases?.find((entry) => entry.id === 'fit-square-600-50kb') ?? null;

const FIGURE_IMAGES = MEASURED ? [
    {
        src: '/demos/photo-source-800x534.jpg',
        width: 800,
        height: 534,
        alt: 'The unedited sample landscape at its original 800 by 534 pixels, before any crop, resize or '
            + 'byte search has been applied.',
        label: 'Before',
    },
    {
        src: '/demos/fitter-600x600-50kb.jpg',
        width: 600,
        height: 600,
        alt: 'The same photograph cropped to a 600 by 600 square and searched down to fit a 50 KB ceiling.',
        label: 'After',
    },
] : [];

const PATH = '/image-size-fitter';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const DESCRIPTION = 'Fit an image to exact pixels and a maximum file size in one step, entirely in your '
    + 'browser — nothing is uploaded. Crop, pad, encode and check the result.';

export const metadata = buildMetadata({
    title: 'Image Size Fitter — Exact Pixels, KB and DPI | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Fit an image to exact dimensions and a maximum file size in one step — the two are '
    + 'different constraints, and hitting only one is why a resize followed by a separate compress so '
    + 'often narrowly misses a form’s size limit anyway. Resizo reads the pixels or a physical size, the '
    + 'format, a byte ceiling and floor and, when one is asked for, a DPI record, then crops or pads, '
    + 'encodes and checks the finished file against every one of them at once, using a decoder and encoder '
    + 'the page hands to your own browser so the file is read and rewritten on your own device. Enlarging '
    + 'past what the source actually has cannot add detail, and a byte ceiling the picture cannot reach at '
    + 'a readable quality is refused in a sentence rather than silently ignored or handed back broken.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Image Size Fitter', path: PATH },
];

const HOW_TO_ID = 'how-to-fit-an-image';
const HOW_TO_HEADING = 'How to fit an image to exact dimensions and file size';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Drop your image, or try the sample',
        text: 'JPEG, PNG or WebP, up to 20 MB. No image to hand yet? Try the sample photo to see the whole '
            + 'workflow first.',
    },
    {
        name: 'Set Width, Height, a maximum file size and the format',
        text: 'The four fields under the drop zone are the whole form for most jobs — a plain pixel size, an '
            + 'optional byte ceiling, and JPEG, PNG or WebP.',
    },
    {
        name: 'Open Advanced options for a physical size, a floor, or a fill choice',
        text: 'A size in millimetres, centimetres or inches, a DPI record, a minimum file size, Crop to '
            + 'fill, Fit inside or Stretch, a background colour and a lower-quality search all sit behind '
            + 'one disclosure — most jobs never need it.',
    },
    {
        name: 'Press Fit image, then read the checklist',
        text: 'Every requirement Resizo can check — dimensions, format, file size, DPI — is listed as '
            + 'Requested against Result, with Meets or Fails in words. Download image appears once every '
            + 'check that was asked for has been met.',
    },
];

const FAQS = [
    {
        question: 'Can an image always be made smaller without changing dimensions?',
        answer: 'No — a byte ceiling and pixel dimensions are independent goals. Lowering quality shrinks a '
            + 'file, but a photo’s own content sets a floor on how small it can get before it turns to '
            + 'visible blocks, and if that floor sits above the ceiling asked for, Resizo refuses the job in '
            + 'a sentence rather than quietly exceeding the limit or shrinking the dimensions instead.',
    },
    {
        question: 'Does resizing to 600 × 600 make the file 100 KB?',
        answer: 'No — pixels and bytes are different constraints. Two photos that are both exactly 600 × '
            + '600 can encode to very different byte counts depending on what is actually in the picture, so '
            + 'a maximum file size has to be asked for and checked on its own, which is what the Maximum '
            + 'file size field and the search behind it do.',
    },
    {
        question: 'Does DPI change pixel dimensions?',
        answer: 'No, not by itself. DPI is a print-resolution label written into the file’s header. A size '
            + 'given in millimetres, centimetres or inches is converted to pixels using a DPI exactly once, '
            + 'at that conversion; changing the DPI on an image already sized in pixels only relabels the '
            + 'file; it does not touch a single pixel.',
    },
    {
        question: 'Can converting JPG to PNG improve quality?',
        answer: 'No. PNG is lossless from whatever pixels it is handed, but a JPEG has already discarded '
            + 'detail during its own encode, and converting the result to PNG cannot restore what that step '
            + 'threw away — it only stops throwing away anything more.',
    },
    {
        question: 'What happens if the requirements conflict?',
        answer: 'Resizo refuses rather than breaking one. If the requested dimensions and the byte ceiling '
            + 'cannot both be met — even at the lowest quality this tool will use — the panel says so in a '
            + 'sentence and offers the levers that failure actually has: a lower quality, WebP, or a '
            + 'different limit, never a silent, smaller-than-asked-for file.',
    },
];

export default function ImageSizeFitterPage() {
    return (
        <>
            <JsonLd
                id="image-size-fitter-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Size Fitter',
                        description: DESCRIPTION,
                        path: PATH,
                        category: 'forms',
                        features: [
                            'Fits an image to exact pixel dimensions, from a plain size or from millimetres, centimetres or inches at a DPI',
                            'Enforces a maximum and, when asked, a minimum file size by searching quality at the exact dimensions',
                            'Saves JPEG, PNG or WebP, with a lower-quality search available for a ceiling nothing else can reach',
                            'Crops to fill, fits inside with padding, or stretches to the exact box, with a movable crop frame',
                            'Writes a DPI record into the file on request, and drops it for WebP, which has no such field',
                            'Independently re-checks the finished file against every requirement asked for and lists every result',
                            'Runs on your own device — the image is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Fit an image to exact pixel dimensions and a maximum file size, with an '
                            + 'optional DPI record, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <FitTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            Width, Height, a maximum file size and the format sit right under the drop zone;
                            everything else waits behind Advanced options for the visitor who needs it.
                        </p>
                    )}
                >
                    <p>
                        Fitted a photo to an exact size and need several copies laid out for printing?{' '}
                        <Link href="/passport-photo-print" className={LINK}>Create a print sheet</Link>.
                    </p>
                </HowToSteps>

                <ContentSection id="every-requirement" heading="Every requirement at once">
                    <p>
                        A form rarely asks for only one thing. &ldquo;600 × 600, JPEG, under 100 KB&rdquo; is
                        three separate constraints — a pixel size, a format, and a byte ceiling — and a tool
                        that only resizes leaves the other two to chance. Resizo reads every field that was
                        filled in and checks the finished file against all of them at once, the same
                        requirement-fitting engine{' '}
                        <Link href="/passport-photo" className={LINK}>/passport-photo</Link>
                        {' '}runs against a verified authority&rsquo;s numbers instead of your own.
                    </p>
                    {MEASURED ? (
                        <Figure
                            images={FIGURE_IMAGES}
                            caption={(
                                <>
                                    {`A ${MEASURED.input.width}×${MEASURED.input.height} JPEG at `}
                                    {`${formatFileSize(MEASURED.input.bytes)} came back `}
                                    {`${MEASURED.output.width}×${MEASURED.output.height} at `}
                                    {`${formatFileSize(MEASURED.output.bytes)}, cropped to fill and searched `}
                                    down to a 50 KB ceiling. The before image is shown at 800×534, a downscale
                                    of the {MEASURED.input.width}×{MEASURED.input.height} source; the after
                                    image is the tool&rsquo;s own output, byte for byte.
                                </>
                            )}
                        />
                    ) : null}
                </ContentSection>

                <ContentSection id="enlarging" heading="Enlarging cannot add detail">
                    <p>
                        Asking for dimensions larger than the area being kept is always possible — the engine
                        will hit the exact pixel count either way — but stretching an 800 × 800 source up to
                        1600 × 1600 does not create the detail a camera never captured at that size. Resizo
                        says so before the job runs, naming the source size and the target size, rather than
                        letting &ldquo;1600 × 1600 exact&rdquo; be read as a claim about sharpness it never
                        made.
                    </p>
                </ContentSection>

                <ContentSection id="in-your-browser" heading="Everything happens in your browser">
                    <p>
                        The crop, the resize, the format encode, the byte search and the DPI record are all
                        code this page hands to your own browser tab — there is no server this image is sent
                        to, checked on, or held by. The same tab that shows you the photo is the one doing
                        the work, which is also why a very large image on a very small phone can be refused
                        outright: the limit is what this device can spare, not a policy.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="image-size-fitter-faq" />
            </FitTool>
        </>
    );
}
