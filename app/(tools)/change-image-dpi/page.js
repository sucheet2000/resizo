import Link from 'next/link';

import DpiTool from './DpiTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { GITHUB_REPO_URL, buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/change-image-dpi';

const BENCHMARK_URL = `${GITHUB_REPO_URL}/blob/main/benchmarks/README.md`;

/**
 * The 300 DPI run. The interesting figure in it is the byte delta: the file
 * came back eighteen bytes heavier, which is the resolution record itself and
 * nothing else — the strongest available evidence that no pixel was touched.
 */
const MEASURED = benchmark.scenarios
    .find((scenario) => scenario.id === 'dpi')
    .cases.find((entry) => entry.id === 'dpi-300-photo');

/**
 * A diagram, not a photograph, so it is a hand-written SVG rather than an
 * output of a run: there is no measurement behind a drawing of paper, and
 * pretending otherwise by rasterising it would only make it heavier and
 * unreadable to a screen reader.
 */
const FIGURE_IMAGES = [
    {
        src: '/demos/dpi-print-size.svg',
        width: 468,
        height: 300,
        alt: 'Two rectangles drawn in proportion to paper for one 1600 by 1200 pixel image: at 72 DPI it '
            + 'covers 22.22 by 16.67 inches, and at 300 DPI the same pixels cover 5.33 by 4.00 inches.',
    },
];

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Change Image DPI', path: PATH },
];

const DESCRIPTION = 'Change the DPI a JPEG or PNG reports without uploading it. Pick 72, 150, 300 or 600 '
    + 'and the number is written into every resolution field the file carries, so every program reads the '
    + 'same one. The picture data is copied byte for byte — nothing is decoded or re-encoded.';

export const metadata = buildMetadata({
    title: 'Change Image DPI Online — Set 300 DPI, No Upload | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-resize.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'DPI is a note in a file’s header about how large the picture is meant to print; it is not '
    + 'a property of the pixels, so changing it adds no detail and takes none away. A 1600 × 1200 photo is '
    + 'still 1600 × 1200 whether the file claims 72 DPI or 300 — at 72 that is 22.22 inches across, at 300 '
    + 'it is 5.33 inches across. Resizo reads the note a JPEG or PNG is already carrying, shows both print '
    + 'sizes side by side, and writes the number you choose into every resolution field the file has, so '
    + 'every program reads the same one. The compressed picture data is copied byte for byte — nothing is '
    + 'decoded and nothing is re-encoded. The reader and the writer are code this page hands to your '
    + 'browser, so the file is opened and rewritten on your own device.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

/**
 * One pixel size, four labels. The point of the table is the column that does
 * not move: the picture is the same 1,920,000 pixels in every row, and only
 * the sentence it carries about paper changes.
 */
const PRINT_SIZES = [
    { dpi: '72', size: '22.22 × 16.67 in', note: 'What a file with no resolution recorded is usually assumed to be' },
    { dpi: '150', size: '10.67 × 8.00 in', note: 'A common setting for a home printer' },
    { dpi: '300', size: '5.33 × 4.00 in', note: 'The figure print shops ask for most often' },
    { dpi: '600', size: '2.67 × 2.00 in', note: 'Fine printing, and small on the page as a result' },
];

const FAQS = [
    {
        question: 'Does changing the DPI change the pixels in my image?',
        answer: 'No. The width and height in pixels are exactly what they were, and so is every pixel in '
            + 'between: this page rewrites a number in the file’s header and copies the compressed picture '
            + 'data across untouched. Nothing is decoded, nothing is re-encoded, and no detail is added or '
            + 'lost. The file usually comes back the same number of bytes, or a handful larger when a '
            + 'resolution record had to be added because it had none.',
    },
    {
        question: 'Why does my image say 72 DPI?',
        answer: 'Because nothing ever wrote a different number into it. A camera, a screenshot or an export '
            + 'from a web tool often leaves the resolution field unset, and software that finds no value '
            + 'falls back to 72 and shows you that. It says nothing about the quality of the picture — a '
            + '6000 × 4000 photo marked 72 DPI has exactly as much detail as the same file marked 300, and '
            + 'the readout on this page tells you which of the two it is and which header the value came '
            + 'from.',
    },
    {
        question: 'Which DPI do I need?',
        answer: 'The one whoever is printing or receiving the file asks for, and nothing else. 300 is the '
            + 'figure print shops name most often, 150 suits a home printer, and 72 or 96 is what screen '
            + 'work is usually labelled. The four chips on this page are labelled Screens, Home printing, '
            + 'Print and Fine print because they are the values people are commonly asked for — none of '
            + 'them is a requirement any printer or upload form enforces, so read the instruction in front '
            + 'of you and type that number into New DPI.',
    },
    {
        question: 'Is my image uploaded anywhere?',
        answer: 'No. The reader that inspects the header and the writer that rewrites it are loaded into '
            + 'the page and run on your own device, so the file is opened and saved by your own machine and '
            + 'never reaches us. That also means there is nothing on this page that could send a photo '
            + 'somewhere — it is opened where it already sits, and the new file is written beside it.',
    },
    {
        question: 'Why can I not do this to a WebP or a HEIC file?',
        answer: 'A WebP has no resolution field at all — the format simply does not define one, so there is '
            + 'no number in the file to read or to change, and any tool that offers to set the DPI of a WebP '
            + 'is decoding it and writing something else. HEIC is not supported here either. Convert an '
            + 'iPhone photo to JPEG first and the resolution field arrives with it.',
    },
    {
        question: 'Will Photoshop and other software read the new value?',
        answer: 'That is the reason both fields are written. A JPEG can keep its resolution in the JFIF '
            + 'header and again in the EXIF block, and a PNG in the pHYs chunk and again in an eXIf chunk — '
            + 'and different programs read different ones first. Writing one and leaving the other stale is '
            + 'what makes a file report 300 in one application and 144 in the next, so this page rewrites '
            + 'every field the file actually has and the line under the result names the ones it wrote.',
    },
];

const HOW_TO_ID = 'how-to-change-image-dpi';
const HOW_TO_HEADING = 'How to change the DPI of an image';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the JPEG or PNG on your device',
        text: 'Drop the file onto the panel, or press Browse images. JPEG and PNG, up to 20 MB. It is read '
            + 'where it already sits, and only the header is read — the picture itself is never decoded.',
    },
    {
        name: 'Read What this file says',
        text: 'The readout appears as soon as the file lands: Recorded resolution and which header it came '
            + 'from, Pixel size, and Prints at the recorded DPI. If nothing was ever recorded it says None '
            + 'recorded, which is the usual answer.',
    },
    {
        name: 'Type the number into New DPI',
        text: 'New DPI starts at 300. Type the figure you were asked for, or press one of the Common print '
            + 'resolutions chips — Screens 72, Home printing 150, Print 300, Fine print 600.',
    },
    {
        name: 'Check the print size before you commit',
        text: 'The last row of the readout recalculates as you type, so Will print at 300 DPI shows the size '
            + 'on paper the new number implies while the old row still shows the size the file claims now.',
    },
    {
        name: 'Press Set DPI',
        text: 'The button reads Writing… while the header is rewritten. Every other byte of the file is '
            + 'copied straight across, so the pixel dimensions cannot move.',
    },
    {
        name: 'Read the line under the result, then Download image',
        text: 'It names the value the file carried before, the value it carries now, which resolution '
            + 'fields were written, and the print size that implies. Press Download image to save it.',
    },
];

export default function ChangeImageDpiPage() {
    return (
        <>
            <JsonLd
                id="change-image-dpi-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo DPI Changer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Reads the resolution a JPEG or PNG records, and names the header it came from',
                            'Shows the print size the file implies now and at the number you type',
                            'Writes both the JFIF and the EXIF resolution of a JPEG, so they cannot disagree',
                            'Writes both the pHYs and the eXIf resolution of a PNG',
                            'Copies the compressed picture data byte for byte — no decode, no re-encode',
                            'Runs on your own device — the image is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Set the print resolution a JPEG or PNG reports, without decoding or '
                            + 're-encoding the picture, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <DpiTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            The panel reads before it writes. A file dropped here is inspected first, so the
                            number it already carries and the header that number lives in are on screen
                            before you decide what to replace them with.
                        </p>
                    )}
                />

                <ContentSection id="what-dpi-is" heading="What DPI is inside a JPEG or a PNG">
                    <p>
                        DPI stands for dots per inch, and inside an image file it is a note in the header
                        saying how large the picture is meant to be when it is printed. It is not a property
                        of the pixels. Nothing about the picture data records it, nothing about the picture
                        data changes when you edit it, and two files with identical pixels can carry
                        different numbers.
                    </p>
                    <p>
                        That is why the readout on this page prints the arithmetic rather than the number on
                        its own. Pixels divided by DPI gives inches, so the value only means something once
                        you know how many pixels there are — and the same value means a different size on
                        paper for every different picture.
                    </p>
                    <p>
                        A file often carries no value at all. Screenshots, exports from web tools and plenty
                        of camera output leave the field unset, and software that finds nothing there falls
                        back to 72 and displays that, which is where most of the &ldquo;my image is only 72
                        DPI&rdquo; alarm comes from. The readout says None recorded when that is the case,
                        rather than repeating the guess back to you.
                    </p>
                </ContentSection>

                <ContentSection id="pixels-versus-print-size" heading="Pixels stay put; the print size is what moves">
                    <p>
                        Take a 1600 × 1200 photograph. It is 1600 × 1200 in every row below — the file is the
                        same file, and the only thing changing is the label it carries about paper:
                    </p>
                    <div
                        className="overflow-x-auto"
                        role="region"
                        aria-label="The print size a 1600 × 1200 photograph implies at four recorded resolutions"
                        tabIndex={0}
                    >
                        <table className="w-full min-w-[30rem] border-collapse text-left text-ui">
                            <caption className="sr-only">
                                The print size a 1600 × 1200 photograph implies at four recorded resolutions
                            </caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Recorded DPI</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Pixels</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Prints at</th>
                                    <th scope="col" className="py-2 font-semibold text-ink">Where you see it</th>
                                </tr>
                            </thead>
                            <tbody>
                                {PRINT_SIZES.map((row) => (
                                    <tr key={row.dpi} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 font-data font-medium text-ink">
                                            {row.dpi}
                                        </th>
                                        <td className="py-2 pr-4 font-data text-ink">1600 × 1200</td>
                                        <td className="py-2 pr-4 font-data text-ink">{row.size}</td>
                                        <td className="py-2">{row.note}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <Figure
                        images={FIGURE_IMAGES}
                        caption={(
                            <>
                                The 72 and 300 DPI rows of that table, drawn to one scale of paper. Nothing
                                about the picture moves between them:{' '}
                                {`the benchmark put a ${MEASURED.input.width}×${MEASURED.input.height} photo `}
                                {`through this tool at ${MEASURED.settings.dpi} DPI and got `}
                                {`${MEASURED.output.width}×${MEASURED.output.height} back, `}
                                {`${formatFileSize(MEASURED.output.bytes - MEASURED.input.bytes)} heavier, `}
                                which is the resolution record itself.{' '}
                                <a href={BENCHMARK_URL} rel="noopener" className={LINK}>see the benchmark</a>
                            </>
                        )}
                    />
                    <p>
                        Nothing in that table is a change in quality. The 300 DPI row is not sharper than the
                        72 DPI row; it is the same photograph asked to occupy a quarter of the width, which
                        is what makes it look better on paper. Print it at 22 inches across and the detail is
                        spread thin whatever the header says.
                    </p>
                    <p>
                        So this page cannot make a small picture into a large print. If a printer needs more
                        pixels than the file has, no number written into a header will produce them.{' '}
                        <Link href="/resize" className={LINK}>Need more pixels, not a different label?
                        Resize the image</Link> — that changes the picture itself, and enlarging a small one
                        softens it, which is the honest trade.
                    </p>
                </ContentSection>

                <ContentSection id="what-is-written" heading="Which fields get written, and why both of them">
                    <p>
                        A JPEG can record its resolution twice: in the JFIF header sitting right at the front
                        of the file, and again in the EXIF block as XResolution and YResolution. A PNG can do
                        the same, in its pHYs chunk and in an eXIf chunk. Different software reads a
                        different one first, and a file whose two records disagree reports one number to your
                        design application and another to the shop&rsquo;s.
                    </p>
                    <p>
                        That is the failure this page exists to fix, so it writes every resolution field the
                        file actually has — JFIF and EXIF for a JPEG, pHYs and eXIf for a PNG — and the line
                        under the result names the ones it wrote. The header the format calls its own is
                        created when it is missing, since a file with no resolution record at all is the
                        commonest case; an EXIF block is only ever rewritten in place, never invented, because
                        adding one would move every other field in it.
                    </p>
                    <p>
                        Everything else is copied straight across. The compressed picture data, every other
                        segment or chunk, and anything a phone stapled onto the end all arrive byte for byte
                        as they were, which is why the pixel dimensions cannot change and why a JPEG does not
                        lose a generation of quality to a header edit. The file grows by a few bytes only
                        when a record had to be added where there was none.
                    </p>
                    <p>
                        The resolution fields are the only ones touched, so the camera model, the date and
                        any GPS coordinates stay exactly where they were.{' '}
                        <Link href="/remove-image-metadata" className={LINK}>Want the camera data gone as
                        well? Remove the metadata</Link> — that is a separate job on a separate page, and it
                        leaves the pixels alone in the same way.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="What this page can and cannot do, and where it runs">
                    <p>
                        JPEG and PNG, up to 20 MB per file, one file at a time. WebP is not here because the
                        format defines no resolution field at all — there is no number in a WebP to read or
                        to write, and a tool that claims to set one is decoding the picture and making a new
                        file. HEIC is not supported either; convert an iPhone photo to JPEG first and it
                        arrives with a resolution field of its own.
                    </p>
                    <p>
                        Values from 1 to 10000 are accepted, but very low ones are not worth setting. Some
                        software — libvips, which a great deal of server-side image handling is built on —
                        treats an implausibly low resolution as no resolution at all and reports its own
                        default of 72 instead, so a file written at 1 DPI can come back reading 72. Every
                        figure a print shop, a portal or a publisher actually asks for — 72, 96, 150, 200,
                        300, 600 — sits far above the range where that happens.
                    </p>
                    <p>
                        Changing the DPI does not make the file smaller, because no compression decision is
                        revisited; at most it grows by the few bytes of a header that had to be added. If the
                        file is too heavy for wherever it is going, that is a different job:{' '}
                        <Link href="/compress" className={LINK}>too large to send? Compress the image</Link>,
                        then set the resolution afterwards so the number survives.
                    </p>
                    <p>
                        All of it happens on your own device. The header is read the moment the file lands,
                        the new one is written when you press Set DPI, and both run on your own machine, so
                        the photo is never transmitted and no copy of it exists anywhere else. This page also
                        asks very little of your hardware compared with the rest of the site — nothing is
                        unpacked into raw pixels, because nothing here needs the picture at all.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="change-image-dpi-faq" />
            </DpiTool>
        </>
    );
}
