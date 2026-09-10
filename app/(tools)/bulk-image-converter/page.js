import Link from 'next/link';

import BulkConvertTool from './BulkConvertTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { formatSavings, savingsPercent } from '@/lib/format/submit-helpers';
import { formatLabel } from '@/lib/format/upload-helpers';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES } from '@/lib/limits';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/bulk-image-converter';

/**
 * The measured table below reads a scenario this branch has not benchmarked
 * yet — `npm run bench` writes it once scenario 'bulk-convert' lands. Until
 * then this is `null`/`[]` and the whole section renders nothing, exactly as
 * /bulk-image-compressor's own page does: a page here must never publish a
 * number benchmarks/ has not actually produced.
 */
const BULK_SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'bulk-convert') ?? null;

const BULK_CASES = (BULK_SCENARIO?.cases ?? []).filter(
    (entry) => Number.isFinite(entry?.input?.bytes) && entry.input.bytes > 0 && Number.isFinite(entry?.output?.bytes),
);

/**
 * The one file of the batch the figure shows: the transparent source going
 * out as WebP, which is the case that actually demonstrates something a
 * screenshot of a re-encoded JPEG could not — the checkerboard staying a
 * checkerboard. Null until the run exists, at which point
 * scripts/generate-demos.js copies its own output into public/demos/ byte for
 * byte, same as the compressor's photo case does.
 */
const TRANSPARENT_CASE = BULK_CASES.find((entry) => entry.id === 'convert-transparent-png-to-webp') ?? null;

const FIGURE_IMAGES = TRANSPARENT_CASE ? [
    {
        src: '/demos/transparent-source-480x320.png',
        width: 480,
        height: 320,
        alt: 'A generated logo on a transparent background, the checkerboard showing through, before the '
            + 'batch ran.',
        label: 'Before',
    },
    {
        // Literal on purpose: tests/app/demo-assets.test.js reads these numbers
        // from the source and holds the file on disk to them.
        src: '/demos/transparent-480x320-converted.webp',
        width: 480,
        height: 320,
        alt: 'The same logo written as WebP, the transparent background still transparent.',
        label: 'After',
    },
] : [];

const DESCRIPTION = 'Convert a batch of JPG, PNG or WebP photos to one output format, entirely on your '
    + 'device — nothing is uploaded. Download them one by one or as a ZIP.';

export const metadata = buildMetadata({
    title: 'Bulk Image Converter — JPG, PNG, WebP in One Go | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A bulk image converter turns every file in a folder — screenshots, photos, logos, whatever '
    + 'mix a project collected — into one chosen format in a single pass, instead of opening each one '
    + 'separately to save it again. Resizo’s version takes up to twenty images at once, JPEG, PNG or WebP, '
    + 'asks only which of those three the whole batch should become, and decodes and re-encodes every file '
    + 'right on your own hardware, inside this browser tab, through a decoder and encoder the page hands to '
    + 'your own browser. A file already in the format you picked comes back exactly as it was rather than '
    + 'being re-encoded for no reason, a transparent PNG or logo going out as JPEG lands on whichever '
    + 'background colour you choose, and every finished file downloads on its own or together in one ZIP.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Bulk Image Converter', path: PATH },
];

const HOW_TO_ID = 'how-to-bulk-convert';
const HOW_TO_HEADING = 'How to convert a batch of images';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose your images',
        text: `Drop up to ${MAX_BULK_FILES} JPEG, PNG or WebP files onto the panel, or press Choose images. `
            + 'A whole folder works the same way, wherever the browser allows picking one.',
    },
    {
        name: 'Pick one output format',
        text: 'Choose JPG, PNG or WebP as the single format the entire batch will become — it applies to '
            + 'every file in the queue, whatever format each one arrived in.',
    },
    {
        name: 'Set the quality, or the background if it applies',
        text: 'JPG and WebP take a quality dial; PNG has none, being lossless. Converting to JPG also asks '
            + 'where a transparent picture’s see-through areas should land — white, black, or a colour you pick.',
    },
    {
        name: 'Press Convert and download',
        text: 'Watch each file settle as it finishes, then download results one at a time or together as a '
            + 'ZIP — a file that could not convert says why, right beside the ones that did.',
    },
];

const FAQS = [
    {
        question: 'Are files uploaded?',
        answer: 'No. Every file is decoded and re-encoded on your own device, inside this browser tab. '
            + 'Nothing about the batch is sent anywhere for this tool to work.',
    },
    {
        question: 'Does converting JPG to PNG improve quality?',
        answer: 'No — it prevents any FURTHER loss from repeated JPEG re-saves, because PNG is lossless from '
            + 'that point on, but it cannot restore detail a JPEG already discarded. A PNG made this way is '
            + 'usually larger than the JPEG it came from, for no visible gain.',
    },
    {
        question: 'What happens to transparent images when converting to JPG?',
        answer: 'JPEG has no transparency channel at all, so every see-through pixel is placed on a background '
            + 'colour before the file is written — white by default, or black or a colour you choose. PNG and '
            + 'WebP outputs keep the transparency exactly as it was.',
    },
    {
        question: 'Why can PNG files become larger after converting?',
        answer: 'PNG stores every pixel exactly, with no quality dial to trade size away — a photograph that a '
            + 'JPEG or WebP can compress heavily often comes back from PNG larger than it went in, because '
            + 'lossless storage of a complex photo simply costs more bytes.',
    },
    {
        question: 'Does WebP always come out smaller?',
        answer: 'Often, not always. WebP usually beats JPEG and PNG at the same visual quality, but the actual '
            + 'result depends on the picture and the quality you set — a flat graphic or an already-compressed '
            + 'photo can land close to, or even above, its starting size.',
    },
    {
        question: 'What happens to a file that is already in the output format?',
        answer: 'It is handed back exactly as it arrived, metadata and all, rather than being re-encoded for no '
            + 'reason — re-compressing a JPEG as a JPEG would only cost quality to produce a file the batch '
            + 'already had.',
    },
    {
        question: 'Can I add a HEIC photo to a batch?',
        answer: 'Not in this tool. HEIC needs its own decoder, which lives on the dedicated HEIC converter at '
            + '/heic — convert there to a JPEG or PNG first, then bring the result back here for the batch.',
    },
];

export default function BulkImageConverterPage() {
    return (
        <>
            <JsonLd
                id="bulk-image-converter-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Bulk Image Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts up to twenty JPEG, PNG and WebP files in one batch to a single chosen format',
                            'Keeps a file already in the output format untouched instead of re-encoding it',
                            'Places a transparent image’s see-through areas on a chosen background when it becomes JPEG',
                            'Reports a file that could not convert rather than guessing or skipping it silently',
                            'Downloads each result individually or as one ZIP archive',
                            'Runs on your own device — no image is uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Pick one output format, drop a batch of photos, and convert every one of '
                            + 'them to it, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <BulkConvertTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <ContentSection id="one-format" heading="One output format for the whole batch">
                    <p>
                        The format you pick applies to every file in the queue, whatever mix arrived — a
                        screenshot, a photo and a logo can all go in together and all come out the format you
                        chose. That is the difference from converting one file at a time on{' '}
                        <Link href="/convert">the single-file converter</Link>: here the decision is made once,
                        for the whole folder.
                    </p>
                </ContentSection>

                <ContentSection id="jpg-to-png-quality" heading="JPG to PNG does not restore lost detail">
                    <p>
                        No. A JPEG has already thrown away the detail its quality setting discarded, and writing
                        it into a lossless PNG afterwards cannot bring any of that back — it only stops a
                        FURTHER loss on any future re-save. The visible result is the same picture in a usually
                        larger file.
                    </p>
                </ContentSection>

                <ContentSection id="transparency-to-jpg" heading="Transparent images going out as JPG">
                    <p>
                        JPEG cannot store transparency at all, so a see-through pixel has to become some solid
                        colour on the way out. Resizo places it on white by default, with black and a custom
                        colour offered beside it — the same choice a visitor would make placing a logo on a
                        page background. PNG and WebP outputs need no such decision: both keep the
                        transparency exactly as it was.
                    </p>
                </ContentSection>

                <ContentSection id="png-can-grow" heading="Why can PNG files become larger">
                    <p>
                        PNG has no quality dial — it stores every pixel exactly, which is precisely what makes
                        it lossless and precisely why it cannot chase a smaller number the way JPEG or WebP
                        can. A busy photograph converted from JPEG to PNG typically comes back several times
                        larger for an identical picture, because a JPEG at typical quality is already smaller
                        than PNG can lossily — sorry, losslessly — represent the same detail.
                    </p>
                </ContentSection>

                <ContentSection id="webp-often-smaller" heading="WebP often, not always, comes out smaller">
                    <p>
                        WebP usually produces the smallest file of the three at a comparable quality, which is
                        why it is the default output here — but output size depends on the image and the
                        quality setting, not on the format name alone. A flat, simple graphic or a photo
                        already compressed hard elsewhere can land close to its starting size in any format.
                    </p>
                </ContentSection>

                <ContentSection id="kept-unchanged" heading="A file already in the output format is kept unchanged">
                    <p>
                        A JPEG asked to become a JPEG is not run through the encoder again — it is handed back
                        exactly as it arrived, metadata included, because re-encoding it could only cost
                        quality or grow the file for a picture that already is what was asked for. The row for
                        that file says so, and it still downloads and still joins the ZIP.
                    </p>
                </ContentSection>

                <ContentSection id="in-your-browser" heading="Everything happens in your browser">
                    <p>
                        Every file in the batch is decoded, measured and re-encoded by code this page hands to
                        your own browser, so nothing is uploaded and there is no copy of it anywhere else for
                        this to work. The ZIP, when you ask for one, is built on your device too, from the
                        files already sitting in its memory.
                    </p>
                </ContentSection>

                <ContentSection id="how-many" heading="How many at once">
                    <p>
                        {`Up to ${MAX_BULK_FILES} images or ${formatFileSize(MAX_BULK_TOTAL_BYTES)} total, `}
                        whichever is reached first, can go into one batch. A folder works the same way as a
                        multi-file pick, and Resizo counts what it found before adding anything, so you are
                        told the moment it can hold no more rather than after the fact.
                    </p>
                </ContentSection>

                {BULK_CASES.length > 0 ? (
                    <ContentSection id="batch-example" heading="One batch, measured">
                        <p>
                            Four real conversions from a measured run, each one a different source and target
                            format.
                        </p>
                        <div className="overflow-x-auto" role="region" aria-label="Measured batch example" tabIndex={0}>
                            <table className="w-full min-w-[32rem] border-collapse text-left text-ui">
                                <caption className="sr-only">One measured batch, file by file</caption>
                                <thead>
                                    <tr className="border-b border-line">
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">File</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">Format</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">Before</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">After</th>
                                        <th scope="col" className="py-2 font-semibold text-ink">Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {BULK_CASES.map((entry) => {
                                        const change = formatSavings(savingsPercent(entry.input.bytes, entry.output.bytes));
                                        return (
                                            <tr key={entry.id} className="border-b border-line">
                                                <th scope="row" className="py-2 pr-4 font-medium text-ink">
                                                    {entry.sample ?? entry.id}
                                                </th>
                                                <td className="py-2 pr-4 font-data text-ink">
                                                    {formatLabel(entry.input.format)}
                                                    <span aria-hidden="true" className="px-1 text-accent">→</span>
                                                    {formatLabel(entry.output.format)}
                                                </td>
                                                <td className="py-2 pr-4 font-data text-ink">{formatFileSize(entry.input.bytes)}</td>
                                                <td className="py-2 pr-4 font-data text-ink">{formatFileSize(entry.output.bytes)}</td>
                                                <td className="py-2 font-data text-accent">{change ?? '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {TRANSPARENT_CASE ? (
                            <Figure
                                images={FIGURE_IMAGES}
                                caption={(
                                    <>
                                        {`The transparent file in that batch: a ${TRANSPARENT_CASE.input.width}×${TRANSPARENT_CASE.input.height} PNG at `}
                                        {`${formatFileSize(TRANSPARENT_CASE.input.bytes)} came back a `}
                                        {`${TRANSPARENT_CASE.output.width}×${TRANSPARENT_CASE.output.height} WebP at `}
                                        {`${formatFileSize(TRANSPARENT_CASE.output.bytes)}, transparency intact. `}
                                        Both images are shown at 480×320; the after image is the batch&rsquo;s own
                                        output, byte for byte.
                                    </>
                                )}
                            />
                        ) : null}
                    </ContentSection>
                ) : null}

                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <FaqList items={FAQS} id="bulk-image-converter-faq" />
            </BulkConvertTool>
        </>
    );
}
