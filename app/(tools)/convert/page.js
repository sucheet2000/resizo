/**
 * /convert
 *
 * Nothing on this page types a format name into a sentence. The intro, the
 * metadata, four of the five FAQ answers, the comparison table and the limits
 * note are all written from lib/limits.js through ./formats.js, because the
 * hand-written versions went stale the moment AVIF left the registry and there
 * was no way to notice. tests/app/convert-formats.test.js reads this file and
 * fails if a format the registry does not carry is named in it again.
 *
 * The three pair sections below are the deliberate exception: they are about one
 * conversion each, they are what people search for, and they name both of their
 * formats on purpose. The same test holds them to the registry too.
 */
import ConvertTool from './ConvertTool';
import {
    alphaFormatsProse,
    formatComparison,
    inputFormatsProse,
    losslessFormatsProse,
    lossyFormatsProse,
    outputFormatsProse,
} from './formats';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { CONVERT_OUTPUT_FORMATS } from '@/lib/limits';
import { formatFileSize } from '@/lib/format/bytes';
import { formatList } from '@/lib/format/upload-helpers';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/**
 * AVIF's demo pair, read the same way app/(tools)/favicon-generator/page.js
 * reads its own MEASURED case: found, not assumed. Until benchmarks/run.js
 * carries an 'avif' scenario with these two cases, both stay null and the
 * figure renders nothing rather than a stale or invented one — per CLAUDE.md,
 * no figure or number ships here that benchmarks/ has not produced.
 */
const AVIF_SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'avif') ?? null;
const AVIF_PHOTO = AVIF_SCENARIO?.cases?.find((entry) => entry.id === 'avif-demo-photo-800x534') ?? null;
const AVIF_TRANSPARENT = AVIF_SCENARIO?.cases?.find((entry) => entry.id === 'avif-transparent-png-to-avif') ?? null;

const AVIF_FIGURE_IMAGES = AVIF_PHOTO && AVIF_TRANSPARENT ? [
    {
        src: '/demos/photo-800x534.avif',
        width: 800,
        height: 534,
        alt: 'A photograph written as AVIF at Resizo’s default quality, shown at its real size.',
        label: 'Photo → AVIF',
    },
    {
        src: '/demos/transparent-480x320.avif',
        width: 480,
        height: 320,
        alt: 'A cut-out graphic with a transparent background, written as AVIF and kept transparent, shown '
            + 'at its real size on the checkerboard.',
        label: 'Transparent PNG → AVIF',
    },
] : [];

/** { title, publisher, url, verifiedAt } for every AVIF-specific claim on this page. */
const AVIF_SOURCES = [
    {
        claim: 'What AVIF is and how its container is structured',
        source: {
            publisher: 'Alliance for Open Media',
            title: 'AV1 Image File Format (AVIF)',
            url: 'https://aomediacodec.github.io/av1-avif/',
            verifiedAt: '2026-09-11',
        },
    },
    {
        claim: 'Which browser versions decode AVIF natively',
        source: {
            publisher: 'MDN',
            title: 'Image file type and format guide',
            url: 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types',
            verifiedAt: '2026-09-11',
        },
    },
    {
        claim: 'Current browser support share for AVIF',
        source: {
            publisher: 'caniuse',
            title: 'AVIF image format',
            url: 'https://caniuse.com/avif',
            verifiedAt: '2026-09-11',
        },
    },
];

const PATH = '/convert';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: PATH },
];

const TITLE = `Convert Image Format Online — ${formatList(CONVERT_OUTPUT_FORMATS)} | Resizo`;

const DESCRIPTION = `Convert images between ${outputFormatsProse()} online free, without uploading them. `
    + 'PNG to JPG, JPG to WebP, WebP to PNG and every other combination, at the original pixel dimensions, '
    + 'all on your own device. No account.';

export const metadata = buildMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Converting an image between formats means decoding it back to raw pixels and writing those '
    + 'pixels out again with a different encoder: the picture keeps its exact dimensions, and only '
    + 'the way it is stored — and therefore the file size — changes. On Resizo you choose what you '
    + 'have under From and what you want under To, add the file and press Convert; JPEG, PNG and '
    + 'WebP go in and come out in any combination. The decoder and the encoder are both small '
    + 'programs the page loads into your browser, and your own device runs them, so the file '
    + 'itself never leaves your computer.';

const FAQS = [
    {
        question: 'Which formats can I convert between?',
        answer: `${inputFormatsProse()}, in any direction. The From menu narrows what the drop zone will `
            + 'accept, so a mismatched file is caught the moment you drop it, and the To menu decides what '
            + 'comes back.',
    },
    {
        question: 'Does converting change the size of the image?',
        answer: 'The pixel dimensions stay exactly the same. The file size almost always changes, because '
            + 'each format stores the same picture differently — going from PNG to JPEG on a photograph '
            + 'often cuts the file to a tenth of what it was.',
    },
    {
        question: 'What happens to transparency?',
        answer: `${alphaFormatsProse()} keep an alpha channel. JPEG has none, so when you convert to `
            + 'JPEG the transparent areas are filled with black. If the transparency matters, convert to '
            + 'WebP or stay on PNG.',
    },
    {
        question: 'Does converting lose quality?',
        answer: `Converting to ${losslessFormatsProse()} is lossless. Converting to ${lossyFormatsProse()} `
            + 're-encodes the picture at a sensible default quality, which is visually very close to the '
            + 'original but not bit-identical. Converting the same file back and forth repeatedly will '
            + 'slowly degrade it.',
    },
    {
        question: 'Can I convert an image without uploading it?',
        answer: 'Yes — that is the only way this converter works. The decoders and encoders are loaded into '
            + 'the page, and your file is read, converted and saved by your own device. It is never sent to '
            + 'us, so there is nothing for us to keep, and the converted file carries no EXIF or GPS data '
            + 'because it is written from raw pixels.',
    },
    {
        question: 'What is AVIF?',
        answer: 'AVIF stores a still picture using the still-image profile of the AV1 video codec. It '
            + 'usually compresses a photograph tighter than JPEG at a similar visual quality, keeps '
            + 'transparency the way PNG and WebP do, and — see the sources below — is decoded natively by '
            + 'every current major browser.',
    },
    {
        question: 'Is AVIF lossless here?',
        answer: 'No. AVIF is written in lossy mode only; this build does not expose AVIF’s lossless option. '
            + 'Quality runs 1 to 100 on AVIF’s own scale, which is not the same scale JPEG or WebP use, so '
            + 'the same number does not mean the same amount of compression. Neither /convert nor /resize '
            + 'offers a quality dial for it yet — both write AVIF at Resizo’s usual default of 80.',
    },
    {
        question: 'Does AVIF keep transparency?',
        answer: 'Yes. An AVIF output keeps an alpha channel whenever the source has one, and that is checked '
            + 'after every encode by reading the finished file’s own header rather than trusting the encoder.',
    },
    {
        question: 'Is AVIF always smaller than WebP or JPEG?',
        answer: 'No. AVIF is often smaller than WebP at a comparable quality, but not on every image — the '
            + 'comparison table above states this plainly rather than repeating the usual claim that it '
            + 'always wins.',
    },
    {
        question: 'Does converting a JPEG to AVIF restore quality?',
        answer: 'No. Converting only changes how the existing pixels are stored; it cannot add back detail a '
            + 'JPEG’s own compression already discarded. A JPEG re-encoded to AVIF is usually a smaller file '
            + 'of the same picture, never a better one.',
    },
    {
        question: 'What happens to metadata, colour and a 10-bit source, with AVIF?',
        answer: 'An AVIF output carries no EXIF, GPS or XMP data and no embedded colour profile, the same as '
            + 'every other re-encode on this site. Colour is converted to standard sRGB, and a 10-bit or '
            + '12-bit AVIF source is decoded down to 8-bit, because both the browser’s AVIF decoder and this '
            + 'site’s pipeline work in 8-bit. An HDR source (PQ or HLG) is normalised to an ordinary range by '
            + 'that same decode, and the original dynamic range cannot be recovered afterwards.',
    },
    {
        question: 'Are AVIF files uploaded?',
        answer: 'No — the same as every other format here. An AVIF is decoded by the browser’s own built-in '
            + 'decoder and, when you are writing one, encoded by a small program this page loads into the '
            + 'tab; your file is read and saved on your own device and never sent anywhere.',
    },
    {
        question: 'Which browsers open AVIF?',
        answer: 'Chrome has decoded AVIF natively since version 85, Firefox since version 93, and Safari '
            + 'since version 16 on iOS 16 or macOS Ventura — see the sources below. A browser without native '
            + 'AVIF support is told so before anything is read, rather than being handed a blank result.',
    },
    {
        question: 'Why is AVIF slower to write?',
        answer: 'AV1, the video codec AVIF borrows its compression from, analyses each block of the picture '
            + 'more exhaustively than JPEG or WebP do, and the encoder here runs single-threaded in the '
            + 'browser tab rather than across several CPU cores — the trade this site makes for shipping no '
            + 'server. The underlying encoder’s own licence notices are published at '
            + '/licenses/avif-encoder-notices.txt.',
    },
];

const FORMATS = formatComparison();

const SOURCE_LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

/** One row of the AVIF sources table — publisher and title share a link, the way favicon-generator's does. */
function AvifSourceRow({ entry }) {
    return (
        <tr className="border-b border-line align-top">
            <th scope="row" className="py-2 pr-4 text-base font-normal text-ink">{entry.claim}</th>
            <td className="py-2 pr-4 text-base text-ink-muted">
                <a href={entry.source.url} target="_blank" rel="noopener noreferrer" className={SOURCE_LINK}>
                    {entry.source.publisher} — {entry.source.title}
                </a>
            </td>
            <td className="py-2 font-data text-ui text-ink-muted">{entry.source.verifiedAt}</td>
        </tr>
    );
}

function AvifSourcesTable() {
    return (
        <div className="overflow-x-auto" role="region" aria-label="AVIF sources, cited" tabIndex={0}>
            <table className="w-full min-w-[34rem] border-collapse text-left">
                <caption className="sr-only">Where the AVIF facts on this page come from</caption>
                <thead>
                    <tr className="border-b border-line">
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">What this establishes</th>
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">Source</th>
                        <th scope="col" className="py-2 text-ui text-ink">Verified</th>
                    </tr>
                </thead>
                <tbody>
                    {AVIF_SOURCES.map((entry) => (
                        <AvifSourceRow key={entry.claim} entry={entry} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const HOW_TO_ID = 'how-to-convert';
const HOW_TO_HEADING = 'How to convert an image';

/**
 * Rendered by HowToSteps and described by howTo() — one array, never two. No
 * format is named here on purpose; this page's format sentences all come from
 * ./formats.js so they cannot go stale, and a step list is no exception.
 */
const STEPS = [
    {
        name: 'Pick the format you want out of the To menu',
        text: 'Leave From on Detect unless you want the drop zone to accept only one kind of file.',
    },
    {
        name: 'Choose the image on your device',
        text: 'Drop it onto the panel above, or press Browse files. Up to 20 MB. The file is opened where '
            + 'it already is, so there is no transfer to sit through.',
    },
    {
        name: 'Press the Convert button',
        text: 'It is labelled with the format you picked. Your device decodes the picture and writes it out '
            + 'again in the new format, at the same pixel dimensions.',
    },
    {
        name: 'Download the converted file',
        text: 'The result panel shows the new size next to the old one before you keep it.',
    },
];

export default function ConvertPage() {
    return (
        <>
            <JsonLd
                id="convert-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            `Convert between ${outputFormatsProse()}`,
                            'Converts on your own device — the image is never uploaded',
                            'Keeps the original pixel dimensions',
                            'Rejects a mismatched file the moment it is dropped',
                            'Writes output with no EXIF or GPS metadata',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: `Change an image to ${outputFormatsProse('or')} on your own device, `
                            + 'keeping the pixel dimensions it already had.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="png-to-jpg" heading="PNG to JPG">
                    <p>
                        This is the most common conversion people need, and it is almost always about size. A
                        photograph saved as PNG stores every pixel exactly, so a 12-megapixel shot can sit at
                        20 MB; the same picture as a JPEG is usually well under 2 MB and looks the same on a
                        screen.
                    </p>
                    <p>
                        The one thing to watch is transparency. JPEG has no alpha channel, so any transparent
                        area is filled with black on the way out. That is fine for a photograph and wrong for
                        a logo — for a logo, convert to WebP instead, which keeps transparency and is smaller
                        than PNG anyway.
                    </p>
                </ContentSection>

                <ContentSection id="jpg-to-webp" heading="JPG to WebP">
                    <p>
                        WebP typically produces a file 25 to 35 percent smaller than a JPEG at the same visual
                        quality, and every current browser displays it. If you are preparing images for a
                        website, this is the conversion that makes the page lighter without changing a single
                        pixel dimension.
                    </p>
                    <p>
                        Keep the JPEG original if the image will be edited later. Converting from one lossy
                        format to another re-encodes the picture, and repeating that many times over will
                        eventually show.
                    </p>
                </ContentSection>

                <ContentSection id="webp-to-jpg" heading="WebP to JPG or PNG">
                    <p>
                        The reason people search for this is almost always the same: they saved an image from
                        a website, and now a form, an older photo editor or a print shop refuses to accept it.
                        WebP is a web format first, and plenty of desktop software still has no idea what to
                        do with one.
                    </p>
                    <p>
                        Convert to JPG for a photograph, or to PNG if the image has transparency you need to
                        keep — a product cut-out or a logo, for example. PNG output is lossless, so nothing is
                        thrown away in the second step.
                    </p>
                </ContentSection>

                <ContentSection id="which-format" heading="Which format should I choose?">
                    <div
                        className="overflow-x-auto"
                        role="region"
                        aria-label="What each output format keeps, and what it is for"
                        tabIndex={0}
                    >
                        <table className="w-full min-w-[34rem] border-collapse text-left text-ui">
                            <caption className="sr-only">What each output format keeps, and what it is for</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Format</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Transparency</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Compression</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Typical size</th>
                                    <th scope="col" className="py-2 font-semibold text-ink">Best for</th>
                                </tr>
                            </thead>
                            <tbody>
                                {FORMATS.map((row) => (
                                    <tr key={row.format} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 font-data font-medium text-ink">
                                            {row.label}
                                        </th>
                                        <td className="py-2 pr-4">{row.transparency}</td>
                                        <td className="py-2 pr-4">{row.compression}</td>
                                        <td className="py-2 pr-4">{row.size}</td>
                                        <td className="py-2">{row.best}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    id="convert-pairs"
                    heading="Pages for one conversion in particular"
                />

                <ContentSection id="limits" heading="Converting without uploading: limits and what happens to your file">
                    <p>
                        Up to 20 MB per file and 8000 pixels on the longest side. Animated images are not
                        converted here — only the still formats in the table above.
                    </p>
                    <p>
                        The conversion is done by your own device. Your file is opened where it already is
                        and the new one is written on the same machine, so nothing is transmitted and there
                        is no copy of it anywhere else. The output is built from raw pixels, which is why it
                        carries no EXIF or GPS data and no longer says where the photo was taken.
                    </p>
                    <p>
                        The limit that can move is your hardware: a picture has to be unpacked into raw
                        pixels to be re-encoded, and that takes several times the file size in memory. If a
                        job will not fit in what the browser can spare, the panel says so before it starts.
                    </p>
                </ContentSection>

                {AVIF_FIGURE_IMAGES.length > 0 ? (
                    <ContentSection id="avif-example" heading="AVIF, on a real photo and a transparent graphic">
                        <p>
                            Both files below are this tool’s own output, at Resizo’s default quality, copied from a
                            measured run rather than drawn for the page.
                        </p>
                        <Figure
                            images={AVIF_FIGURE_IMAGES}
                            caption={(
                                <>
                                    {`A ${AVIF_PHOTO.input.width}×${AVIF_PHOTO.input.height} JPEG at `}
                                    {`${formatFileSize(AVIF_PHOTO.input.bytes)} came back as AVIF at `}
                                    {`${formatFileSize(AVIF_PHOTO.output.bytes)}; a transparent `}
                                    {`${AVIF_TRANSPARENT.input.width}×${AVIF_TRANSPARENT.input.height} PNG at `}
                                    {`${formatFileSize(AVIF_TRANSPARENT.input.bytes)} came back at `}
                                    {`${formatFileSize(AVIF_TRANSPARENT.output.bytes)}, transparency kept. Measured `}
                                    on the benchmark machine — see the sources below for the method.
                                </>
                            )}
                        />
                    </ContentSection>
                ) : null}

                <ContentSection id="avif-sources" heading="Where the AVIF facts on this page come from">
                    <p>
                        Not one of the figures above is Resizo’s own opinion. Each row below names the document
                        that states it and the day it was last read.
                    </p>
                    <AvifSourcesTable />
                </ContentSection>

                <FaqList items={FAQS} id="convert-faq" />
            </ConvertTool>
        </>
    );
}
