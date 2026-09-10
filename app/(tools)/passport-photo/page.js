import Link from 'next/link';

import PassportTool from './PassportTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { APPLICATION_PRESETS } from '@/lib/catalog/application-presets';
import { formatFileSize } from '@/lib/format/bytes';
import { pixelsFor } from '@/lib/format/physical';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/**
 * The run that produced the two files in the figure: the generated portrait
 * through the US printed preset at 300 DPI. Read from the benchmark results so
 * the caption can only state numbers a measured run recorded.
 */
const MEASURED = benchmark.scenarios
    .find((scenario) => scenario.id === 'passport-photo')
    .cases.find((entry) => entry.id === 'passport-us-600x600');

const FIGURE_IMAGES = [
    {
        src: '/demos/portrait-source-480x640.jpg',
        width: 480,
        height: 640,
        alt: 'A generated head-and-shoulders portrait: a plain oval head, a neck and shoulders in flat '
            + 'warm colours on a light background. Not a real person.',
        label: 'Before',
    },
    {
        src: '/demos/portrait-passport-600x600.jpg',
        width: 600,
        height: 600,
        alt: 'The same generated portrait cropped to a square with the head centred and filling '
            + 'the frame, as the US printed preset asks.',
        label: 'After',
    },
];

const PATH = '/passport-photo';

const CANADA_SOURCE_URL = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-passports/photos.html';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80';

const DESCRIPTION = 'Crop and size a passport or ID photo on your own device — nothing is uploaded. Hit '
    + 'the exact pixels, DPI, format and file size a verified requirement states, or set your own.';

export const metadata = buildMetadata({
    title: 'Passport & ID Photo — Exact Size and DPI | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A passport or ID photo has to satisfy several numbers one authority publishes at once — '
    + 'an exact pixel size or a size in millimetres or inches, an aspect ratio, a format, a byte ceiling '
    + 'and sometimes a DPI record — and missing one is why a photo gets rejected and re-taken. Resizo '
    + 'reads a verified preset or the numbers you type, then crops, resizes, formats and checks the photo '
    + 'you drop in against all of them at once, using a decoder and encoder the page hands to your own '
    + 'browser so the file is read and rewritten on your own device. It cannot judge pose, expression, '
    + 'lighting, background quality or eligibility — those judgements stay with you and the issuing '
    + 'authority, and every check Resizo can run is listed beside the ones it cannot.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Passport & ID Photo', path: PATH },
];

/** 'YYYY-MM-DD' → 'Month D, YYYY', the form every verified-date line on this page uses. */
function formatVerifiedDate(iso) {
    if (typeof iso !== 'string' || iso.trim() === '') return null;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The numbers behind one row of the at-a-glance table, computed from the
 * preset's own facts rather than typed a second time — a physical preset's
 * pixel figure is derived with the same `pixelsFor` the engine and the tool
 * panel use, so the arithmetic shown here can never quietly drift from what
 * a run of this preset actually produces.
 */
/**
 * The arithmetic sentence for one side, in the unit the authority actually
 * published — millimetres are the only case where ÷ 25.4 belongs in the
 * sentence at all. An inch figure multiplies straight through (2 in × 300
 * DPI = 600 px, no division), and a centimetre figure goes through the same
 * ×10 lib/format/physical.js itself applies before dividing by 25.4.
 */
function unitArithmetic(value, unit, dpi, resultPx) {
    if (unit === 'in') return `${value} in × ${dpi} DPI = ${resultPx} px`;
    if (unit === 'cm') return `${value} cm × 10 ÷ 25.4 × ${dpi} DPI = ${resultPx} px`;
    return `${value} mm × ${dpi} DPI ÷ 25.4 = ${resultPx} px`;
}

function rowFor(preset) {
    const dpi = preset.dpi?.default ?? 300;
    const isPhysical = Boolean(preset.physical);

    // The FIELD the authority actually published in — not a millimetre
    // conversion. The US states "2 x 2 inches (51 x 51 mm)", and 2 in is
    // 50.8 mm exactly, so restating it as "51 mm" here would show the
    // rounding as though it were the source's own number.
    const sizeLabel = isPhysical
        ? `${preset.physical.width} × ${preset.physical.height} ${preset.physical.unit}`
        : `${preset.digital?.minWidth} × ${preset.digital?.minHeight} px minimum`;

    const pixelWidth = isPhysical
        ? pixelsFor(preset.physical.width, preset.physical.unit, dpi)
        : preset.digital?.minWidth;
    const pixelHeight = isPhysical
        ? pixelsFor(preset.physical.height, preset.physical.unit, dpi)
        : preset.digital?.minHeight;

    const arithmetic = isPhysical
        ? `${unitArithmetic(preset.physical.width, preset.physical.unit, dpi, pixelWidth)} wide; `
            + `${unitArithmetic(preset.physical.height, preset.physical.unit, dpi, pixelHeight)} tall`
        : 'Stated directly in pixels by the authority — no DPI arithmetic involved.';

    const bytesLabel = preset.bytes?.min || preset.bytes?.max
        ? [
            preset.bytes.min ? `at least ${formatFileSize(preset.bytes.min)}` : null,
            preset.bytes.max ? `no more than ${formatFileSize(preset.bytes.max)}` : null,
        ].filter(Boolean).join(', ')
        : 'No file-size rule stated';

    const formatsLabel = Array.isArray(preset.formats) && preset.formats.length > 0
        ? preset.formats.map((format) => format.toUpperCase()).join(' or ')
            + (preset.formatsStated === false ? ' — Resizo’s own choice, not named by the authority' : '')
        : 'Not stated — Resizo writes JPEG';

    // A digital preset's pixel minimum comes from the authority directly and
    // never touches a DPI value, so the column would otherwise show a number
    // (`?? 300`) the source never stated for it.
    const dpiLabel = isPhysical
        ? `${dpi} — Resizo’s default for a print, not named by the authority`
        : 'Not stated — no print resolution to convert';

    return {
        preset,
        sizeLabel,
        pixelWidth,
        pixelHeight,
        arithmetic,
        bytesLabel,
        formatsLabel,
        dpi,
        dpiLabel,
    };
}

const ROWS = APPLICATION_PRESETS.map(rowFor);

const HOW_TO_ID = 'how-to-make-a-passport-photo';
const HOW_TO_HEADING = 'How to make a passport or ID photo';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Pick a verified requirement, or Custom',
        text: 'The chips above the drop zone are four checked sources plus Custom. Choosing one fills the '
            + 'size, format, DPI and any file-size limit it publishes; Custom leaves every field for you to '
            + 'set.',
    },
    {
        name: 'Check the fields it filled in',
        text: 'Width, Height, Unit, DPI, Output format and the file-size limits sit under the drop zone, '
            + 'filled in from the requirement rather than from the photo. Edit any of them and the page '
            + 'switches to a custom size.',
    },
    {
        name: 'Drop your photo, or try the sample',
        text: 'JPEG, PNG or WebP, up to 20 MB. No photo to hand yet? Try the sample — a generated scene, not '
            + 'a real person — to see the whole flow first.',
    },
    {
        name: 'Position the frame over the head',
        text: 'A fixed box appears at the target shape, with a head-height band when the requirement '
            + 'publishes one. Drag, zoom or use the arrow keys to choose which part of the photo is kept.',
    },
    {
        name: 'Press Make photo',
        text: 'The crop, the resize, the format and the byte search all run in this pass. A file-size limit '
            + 'can take a few extra seconds while the button reads Finding the size.',
    },
    {
        name: 'Read the checklist, then Download photo',
        text: 'Every check Resizo can run — dimensions, format, file size, DPI — is listed with what was '
            + 'required, what the file actually has, and Meets or Fails in words. Photographic rules Resizo '
            + 'cannot check are listed underneath, followed by the source and the day it was checked.',
    },
];

const FAQS = [
    {
        question: 'Does a "Meets" on this page mean my application will be accepted?',
        answer: 'No. "Meets" means the finished file matches the pixels, format, file size or DPI Resizo can '
            + 'measure — nothing more. It cannot see pose, expression, lighting, a real backdrop, red-eye or '
            + 'how recently the photo was taken, and it makes no decision about eligibility. Every '
            + 'requirement lists the photographic rules Resizo cannot check, and the authority that publishes '
            + 'the requirement is the one that decides whether to accept the file.',
    },
    {
        question: 'Should I choose JPEG or PNG?',
        answer: 'JPEG unless the form you are filling in names PNG. None of the four sources on this page '
            + 'names a file format, so the presets write JPEG as Resizo’s own choice — the format every '
            + 'photo lab and upload form accepts. PNG is here for a portal that states it explicitly or a '
            + 'Custom job with its own rule.',
    },
    {
        question: 'What happens if my photo cannot fit under the maximum file size?',
        answer: 'The dimensions are kept exactly as asked, quality is lowered first, and if that still misses '
            + 'the limit the panel says so with a sentence explaining why, plus a button to allow a lower '
            + 'quality, switch to WebP in Custom mode, or change the limit — never a silent, smaller photo.',
    },
    {
        question: 'Is my photo uploaded anywhere to check it against these requirements?',
        answer: 'No. The cropping, resizing, encoding and the checklist itself all run in code this page '
            + 'hands to your browser, so the photo is read and rewritten on your own device and the checks '
            + 'are run against the file that was just written there — nothing is sent anywhere to be '
            + 'verified.',
    },
    {
        question: 'Why is Canada not one of the presets?',
        answer: 'Because no file this tool — or any resizing tool — writes can meet either Canadian route. '
            + 'IRCC asks for a printed photo taken in person by a commercial photographer, and a digital '
            + 'photo saved directly from the original camera file with no alteration; Resizo’s output is '
            + 'cropped, resized and re-encoded by definition. The page explains this in full below rather '
            + 'than offering a preset that would only fail at submission.',
    },
    {
        question: 'Can I use my own size instead of one of the four presets?',
        answer: 'Yes — press Custom, or simply edit any field a preset filled in, and the page switches to '
            + 'your own numbers. Custom mode runs the same crop, resize, format and file-size engine as every '
            + 'preset; the only difference is that there is no published authority to list a source for '
            + 'afterwards.',
    },
];

export default function PassportPhotoPage() {
    return (
        <>
            <JsonLd
                id="passport-photo-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Passport & ID Photo',
                        description: DESCRIPTION,
                        path: PATH,
                        category: 'forms',
                        features: [
                            'Crops, resizes and formats a photo to an exact pixel size and aspect ratio',
                            'Four verified passport and ID requirements, each with its source and the day it was checked',
                            'A custom mode for any size, unit, format or file-size limit not covered by a preset',
                            'Saves JPEG or PNG, with a maximum and, when asked, a minimum file size',
                            'Writes a DPI record into the file on request, derived from a physical size in mm or inches',
                            'Independently re-checks the finished file against the requirement and lists every result',
                            'Runs on your own device — the photo is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Crop, size and format a passport or ID photo to a verified requirement '
                            + 'or your own numbers, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <PassportTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            The requirement you pick fills every field, so a file lands already configured;
                            the fields sit under the drop zone for checking or for a custom size. The frame
                            is the one thing that waits for a photo to exist, because a crop means nothing
                            until there is a picture to measure it against.
                        </p>
                    )}
                />

                <ContentSection id="what-it-does" heading="What the tool does to a photo">
                    <p>
                        One measured run, on the generated portrait the page offers as a sample. The
                        United States printed preset asked for 2 × 2 inches at 300 DPI, which is
                        600 × 600 pixels; the tool cropped the 3:4 source to a square around the
                        frame, resampled it, wrote the DPI record and checked the result.
                    </p>
                    <Figure
                        images={FIGURE_IMAGES}
                        caption={(
                            <>
                                {`A ${MEASURED.input.width}×${MEASURED.input.height} JPEG at `}
                                {`${formatFileSize(MEASURED.input.bytes)} came back `}
                                {`${MEASURED.output.width}×${MEASURED.output.height} at `}
                                {`${formatFileSize(MEASURED.output.bytes)}, ${MEASURED.output.density} DPI, as JPG. `}
                                The before image is shown at 480×640, a downscale of the 1200×1600 source;
                                the after image is the tool&rsquo;s own output, byte for byte.
                            </>
                        )}
                    />
                </ContentSection>

                <ContentSection id="verified-requirements" heading="Verified requirements at a glance">
                    <p>
                        Four requirements, read from the issuing authority&rsquo;s own page and checked on the
                        date shown. Pixel figures for a physical size are worked out at 300 DPI, which is
                        Resizo&rsquo;s own choice for a photo print — none of them names a resolution — and
                        changing DPI on this page changes the pixel target the same way.
                    </p>

                    <div className="overflow-x-auto" role="region" aria-label="Verified requirements table" tabIndex={0}>
                        <table className="w-full min-w-[40rem] border-collapse text-left text-ui">
                            <caption className="sr-only">Verified requirements at a glance</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Requirement</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Stated size</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Pixels at default DPI</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">File size</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Format</th>
                                    <th scope="col" className="py-2 font-semibold text-ink">Default DPI</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ROWS.map((row) => (
                                    <tr key={row.preset.id} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 font-medium text-ink">
                                            {row.preset.name ?? row.preset.jurisdiction}
                                        </th>
                                        <td className="py-2 pr-4 font-data text-ink">{row.sizeLabel}</td>
                                        <td className="py-2 pr-4 font-data text-ink">
                                            {row.pixelWidth}×{row.pixelHeight} px
                                        </td>
                                        <td className="py-2 pr-4 font-data text-ink">{row.bytesLabel}</td>
                                        <td className="py-2 pr-4 font-data text-ink">{row.formatsLabel}</td>
                                        <td className="py-2 font-data text-ink">{row.dpiLabel}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <p>
                        The pixel arithmetic behind each physical size, in full:
                    </p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        {ROWS.map((row) => (
                            <li key={row.preset.id}>
                                <strong className="font-semibold text-ink">{row.preset.name ?? row.preset.jurisdiction}</strong>
                                {': '}
                                {row.arithmetic}
                            </li>
                        ))}
                    </ul>
                </ContentSection>

                <ContentSection id="sources" heading="Where these requirements come from">
                    <ul className="flex list-disc flex-col gap-3 pl-5">
                        {ROWS.map((row) => {
                            const verified = formatVerifiedDate(row.preset.source?.verifiedAt);
                            return (
                                <li key={row.preset.id}>
                                    <strong className="font-semibold text-ink">{row.preset.name ?? row.preset.jurisdiction}</strong>
                                    {row.preset.source?.url ? (
                                        <>
                                            {' — '}
                                            <a
                                                href={row.preset.source.url}
                                                rel="noopener"
                                                className={LINK}
                                            >
                                                {row.preset.source.label ?? row.preset.source.url}
                                            </a>
                                            {verified ? (
                                                <>
                                                    {', checked '}
                                                    <time dateTime={row.preset.source.verifiedAt}>{verified}</time>
                                                </>
                                            ) : null}
                                            .
                                        </>
                                    ) : null}
                                    {Array.isArray(row.preset.notes) && row.preset.notes.length > 0 ? (
                                        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-muted">
                                            {row.preset.notes.map((note) => <li key={note}>{note}</li>)}
                                        </ul>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </ContentSection>

                <ContentSection id="enforce-vs-verify" heading="What Resizo can enforce, and what it cannot">
                    <p>
                        Everything below the fold on this page is mechanical: a pixel count, a byte count, a
                        format tag and a DPI field are all things Resizo can read back out of the file it just
                        wrote and compare against a number. Nothing about a face is mechanical in that way, so
                        none of it is checked here.
                    </p>
                    <p><strong className="font-semibold text-ink">Resizo can enforce:</strong></p>
                    <ul className="flex list-disc flex-col gap-1 pl-5">
                        <li>The exact pixel width and height, and the aspect ratio that implies.</li>
                        <li>The output format — JPEG or PNG.</li>
                        <li>A maximum file size, and, in Custom mode, a minimum.</li>
                        <li>A DPI record, written into the file and read back to confirm it landed.</li>
                    </ul>
                    <p>
                        <strong className="font-semibold text-ink">Resizo cannot verify</strong> pose, facial
                        expression, lighting or shadows, red-eye, whether the real backdrop in your photo is
                        the colour or texture asked for, how recently the photo was taken, or whether the
                        issuing authority will accept the finished file. Each requirement&rsquo;s own wording
                        for the rules it cannot check:
                    </p>
                    {ROWS.map((row) => (
                        Array.isArray(row.preset.cannotVerify) && row.preset.cannotVerify.length > 0 ? (
                            <div key={row.preset.id}>
                                <h3 className="text-base font-semibold text-ink">{row.preset.name ?? row.preset.jurisdiction}</h3>
                                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                                    {row.preset.cannotVerify.map((item) => <li key={item}>{item}</li>)}
                                </ul>
                            </div>
                        ) : null
                    ))}
                </ContentSection>

                <ContentSection id="physical-vs-pixels" heading="Physical size versus pixels">
                    <p>
                        An authority that publishes a size on paper — millimetres or inches — is describing a
                        print, not a file, and a print has no pixel count until a resolution is also chosen.
                        The same 35 mm is 413 pixels at 300 DPI and 138 pixels at 100 DPI; a form that states
                        &ldquo;35 mm&rdquo; is not silently also stating a pixel count.
                    </p>
                    <p>
                        Resizo uses the formula every printer uses — millimetres ÷ 25.4 × DPI, rounded to the
                        nearest whole pixel — shown in full for every physical preset above. 300 DPI is
                        Resizo&rsquo;s own choice for the presets, the resolution photo labs print at; no source
                        on this page names one. Changing DPI here changes only the pixel target, never the
                        physical size a preset states.{' '}
                        <Link href="/change-image-dpi" className={LINK}>
                            Need the same arithmetic without cropping a photo? Change image DPI
                        </Link>{' '}
                        does the conversion on its own.
                    </p>
                </ContentSection>

                <ContentSection id="not-listed" heading="Why some countries are not listed">
                    <p>
                        Canada is the clearest case, so it is named rather than left as a silent gap.
                        Immigration, Refugees and Citizenship Canada requires a printed photo &ldquo;taken in
                        person by a commercial photographer or photo studio&rdquo;, and a digital photo for an
                        online renewal has to be &ldquo;saved directly from the original file captured by the
                        camera&rdquo;, with any alteration rejected. Resizo&rsquo;s output is cropped, resized
                        and re-encoded on your device by definition, so neither Canadian route can be met by a
                        file this tool writes — no Canadian preset is offered here rather than one that would
                        only fail at submission. (Immigration, Refugees and Citizenship Canada,{' '}
                        <a href={CANADA_SOURCE_URL} rel="noopener" className={LINK}>
                            Photos for Canadian passports
                        </a>
                        , a page dated February 11, 2026 and read on September 10, 2026.)
                    </p>
                    <p>
                        The same test applies beyond Canada: a country whose rule requires an unaltered
                        original file straight from a camera, or a photograph taken in person by a
                        professional, is a country no cropping-and-resizing tool can serve, and a preset is
                        added here only once a route exists that a file Resizo writes can actually satisfy.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="passport-photo-faq" />
            </PassportTool>
        </>
    );
}
