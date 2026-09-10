import PrintSheetTool from './PrintSheetTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { APPLICATION_PRESETS, getApplicationPreset } from '@/lib/catalog/application-presets';
import { PAPER_SIZES, paperSize } from '@/lib/catalog/paper-sizes';
import { formatFileSize } from '@/lib/format/bytes';
import { layoutSheet } from '@/lib/format/print-sheet';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/**
 * The run behind the before/after figure: the United Kingdom 35 × 45 mm
 * preset at 300 DPI, laid out on 4 × 6 paper — the defaults tile that pairing
 * six-up (2 columns × 3 rows), unlike the United States 2 × 2 in preset this
 * page defaults to, which only holds two at the same margin and gap (see "How
 * many copies fit" below). `benchmarks/` is the only source of a published
 * number, so until this scenario has actually been measured and committed,
 * MEASURED is null and the demonstration renders nothing rather than a
 * placeholder.
 */
const SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'print-sheet') ?? null;
const MEASURED = SCENARIO?.cases?.find((entry) => entry.id === 'sheet-uk-35x45-4x6-300') ?? null;

const FIGURE_IMAGES = MEASURED ? [
    {
        src: '/demos/print-sheet-4x6-preview-600x900.jpg',
        width: 600,
        height: 900,
        alt: 'A downscale of the finished print sheet: six copies of a 35 by 45 millimetre photo tiled two '
            + 'across and three down on a portrait 4 by 6 inch sheet.',
        label: 'Sheet preview',
    },
] : [];

const PATH = '/passport-photo-print';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const DESCRIPTION = 'Lay several copies of a passport or ID photo on one sheet at exact size, entirely in your '
    + 'browser — nothing is uploaded. Save as JPEG or PDF, ready to print.';

export const metadata = buildMetadata({
    title: 'Passport Photo Print Sheet — 4 × 6, A4, JPEG or PDF | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-crop.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Printing several copies of a passport or ID photo means fitting an exact physical size onto a '
    + 'sheet of paper without letting a print dialog rescale it, which quietly turns a correctly-sized photo '
    + 'into a wrong one. Choose a photo size and paper, then drop the photo: Resizo works out one deterministic '
    + 'layout model from the paper size, the photo size, a margin and a gap, and that same model drives the '
    + 'preview, the columns, the cut guides and the file you download. The photo is cropped or padded, resampled '
    + 'and tiled by code this page hands to your own browser, then saved as a JPEG at the exact pixel size or a '
    + 'PDF sized in points, so the physical size is fixed in the file; only a print dialog left on Fit to Page '
    + 'can change it.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Passport Photo Print Sheet', path: PATH },
];

/* ---------------------------------------------------- computed, never typed */

const PRINTABLE_PRESETS = APPLICATION_PRESETS.filter((preset) => preset.physical);

/** One row per photo preset, one column per paper size — every cell is a real layoutSheet() call. */
const CAPACITY_ROWS = PRINTABLE_PRESETS.map((preset) => ({
    preset,
    cells: PAPER_SIZES.map((paper) => ({
        paper,
        layout: layoutSheet({
            paperWidthMm: paper.widthMm,
            paperHeightMm: paper.heightMm,
            photoWidthMm: preset.physical.widthMm,
            photoHeightMm: preset.physical.heightMm,
        }),
    })),
}));

/** The figure named in the FAQ: the US preset on 4 × 6 paper, at the defaults and at zero margin/gap — both computed, never typed. */
const US_PRESET = getApplicationPreset('us-passport-print');
const FOUR_BY_SIX = paperSize('4x6');
const US_ON_FOUR_BY_SIX = layoutSheet({
    paperWidthMm: FOUR_BY_SIX.widthMm,
    paperHeightMm: FOUR_BY_SIX.heightMm,
    photoWidthMm: US_PRESET.physical.widthMm,
    photoHeightMm: US_PRESET.physical.heightMm,
});
const US_ON_FOUR_BY_SIX_BORDERLESS = layoutSheet({
    paperWidthMm: FOUR_BY_SIX.widthMm,
    paperHeightMm: FOUR_BY_SIX.heightMm,
    photoWidthMm: US_PRESET.physical.widthMm,
    photoHeightMm: US_PRESET.physical.heightMm,
    marginMm: 0,
    gapMm: 0,
});

const CAPACITY_ANSWER = `At Resizo’s defaults — a 5 mm margin, a 3 mm gap and 300 DPI — ${US_ON_FOUR_BY_SIX.copies} `
    + `${US_ON_FOUR_BY_SIX.copies === 1 ? 'copy' : 'copies'} of a 2 × 2 in photo fit on 4 × 6 in paper, arranged `
    + `${US_ON_FOUR_BY_SIX.orientation} in ${US_ON_FOUR_BY_SIX.columns} `
    + `${US_ON_FOUR_BY_SIX.columns === 1 ? 'column' : 'columns'} and ${US_ON_FOUR_BY_SIX.rows} `
    + `${US_ON_FOUR_BY_SIX.rows === 1 ? 'row' : 'rows'}. Setting the margin and the gap to 0 raises that to `
    + `${US_ON_FOUR_BY_SIX_BORDERLESS.copies} — the borderless layout a photo kiosk prints, edge to edge, which `
    + 'most home printers cannot reproduce.';

const HOW_TO_ID = 'how-to-create-a-print-sheet';
const HOW_TO_HEADING = 'How to create a passport photo print sheet';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose a photo size and paper',
        text: 'Pick one of the verified presets shared with Passport & ID Photo, or set a custom size, then '
            + 'choose 4 × 6, 5 × 7, Letter or A4 paper.',
    },
    {
        name: 'Drop your photo, or try the sample',
        text: 'JPEG, PNG or WebP, up to 20 MB. No photo to hand yet? Try the sample to see the whole layout '
            + 'first.',
    },
    {
        name: 'Check DPI, copies and cut guides',
        text: 'Resizo fills the sheet by default at 300 DPI with a 5 mm margin and a 3 mm gap; Advanced options '
            + 'holds the margin, spacing, cut guides, the reference line and the fill behaviour for the visitor '
            + 'who wants to change them.',
    },
    {
        name: 'Press Create sheet, then print at Actual Size',
        text: 'Read the checklist, then choose Download JPEG or Download PDF. Print the downloaded file at '
            + 'Actual Size or 100% — a print dialog set to Fit to Page will rescale the physical dimensions '
            + 'this page just set.',
    },
];

const FAQS = [
    {
        question: 'Why does Actual Size matter?',
        answer: 'Because a print dialog set to Fit to Page or a scaling percentage other than 100% resizes the '
            + 'whole sheet to the paper it finds loaded, which changes the physical size of every photo on it '
            + 'even though the file itself never moved a pixel. Actual Size or 100% is the one setting that '
            + 'prints the sheet at the exact size this page laid it out at.',
    },
    {
        question: 'Does 300 DPI change the physical size?',
        answer: 'No. DPI converts a physical size into a pixel count once, at that conversion — it does not '
            + 'change the millimetres or inches printed on the paper. 300 DPI is Resizo’s own default for a '
            + 'photo print, not something any preset states; the DPI sets how many pixels stand for each inch, '
            + 'never the inch itself.',
    },
    {
        question: 'How many 2 × 2 photos fit on 4 × 6 paper?',
        answer: CAPACITY_ANSWER,
    },
    {
        question: 'Can Resizo guarantee passport acceptance?',
        answer: 'No. Resizo can enforce the photo’s pixel size, its aspect ratio and the paper it is printed '
            + 'on, and it independently checks the finished file against all three. It cannot see pose, '
            + 'expression, lighting or a real backdrop, and it makes no decision about whether an authority '
            + 'will accept the printed photo — Passport & ID Photo lists what it can and cannot verify for each '
            + 'preset.',
    },
    {
        question: 'Why might my photo look blurry?',
        answer: 'Because the source photo was smaller than the pixels the chosen size and DPI require, so it '
            + 'had to be enlarged to reach them — enlarging increases pixel dimensions but cannot recreate '
            + 'detail a camera never captured. Resizo names the source and target size before the sheet is '
            + 'built whenever this happens.',
    },
];

export default function PassportPhotoPrintPage() {
    return (
        <>
            <JsonLd
                id="passport-photo-print-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Passport Photo Print Sheet',
                        description: DESCRIPTION,
                        path: PATH,
                        category: 'forms',
                        features: [
                            'Lays several copies of a passport or ID photo on one sheet at an exact physical size',
                            'Four paper sizes — 4 × 6, 5 × 7, Letter and A4 — and the same verified photo presets as Passport & ID Photo',
                            'Computes columns, rows and capacity from the paper, the photo size, a margin and a gap, and fills or clamps the copy count',
                            'Draws corner or full-line cut guides and an optional 50 mm reference line',
                            'Saves a JPEG at the exact sheet pixel size or a PDF sized in points, so the physical size is fixed in the file; only a print dialog left on Fit to Page can change it',
                            'Independently re-checks the finished file’s paper size, resolution, photo size and copy count',
                            'Runs on your own device — the photo is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Lay a passport or ID photo out as several copies on one sheet of paper, on '
                            + 'your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <PrintSheetTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            The photo size and paper are chosen before a file even lands; DPI, copies and the cut
                            guides already carry sensible defaults, so most sheets need nothing more than a photo.
                        </p>
                    )}
                />

                <ContentSection id="one-layout" heading="One layout, one file">
                    <p>
                        The preview above the button, the columns and rows Resizo reports, the cut guides and the
                        file behind Download all come from the same layout calculation, run once. A preview that
                        quietly disagreed with the file underneath it is the one failure this tool cannot recover
                        from, because it is only found after the paper has been cut.
                    </p>
                </ContentSection>

                <ContentSection id="actual-size" heading="Actual size, not fit to page">
                    <p>
                        A JPEG carries pixels and a resolution record; a PDF carries a page size in points. Either
                        way, the sheet Resizo builds states its own exact physical size, and a print dialog left on
                        Fit to Page or a scaling percentage overrides it — the printer stretches or shrinks the
                        whole sheet to whatever paper it finds loaded. Actual Size or 100% is what keeps the photo
                        the size this page set. Most printers also refuse to print into the last few millimetres of
                        the sheet, which is its own margin on top of the one set here.
                    </p>
                </ContentSection>

                <ContentSection id="dpi-pixels" heading="DPI sets pixels, not inches">
                    <p>
                        A photo size stated in millimetres or inches has no pixel count until a resolution is also
                        chosen — the same 2 × 2 in photo is 600 × 600 px at 300 DPI and 1200 × 1200 px at 600 DPI,
                        both exactly 2 inches on paper. Raising the DPI here changes only how many pixels the photo
                        and the sheet are built from; it never changes the physical size printed.
                    </p>
                </ContentSection>

                <ContentSection id="how-many-fit" heading="How many copies fit">
                    <p>
                        Every number below comes from the same layout calculation the tool panel runs, at Resizo’s
                        defaults: a 5 mm margin, a 3 mm gap, 300 DPI. A tighter margin or a smaller gap raises every
                        number in the table; the four papers are the same four offered above.
                    </p>
                    <div className="overflow-x-auto" role="region" aria-label="Copies per sheet table" tabIndex={0}>
                        <table className="w-full min-w-[40rem] border-collapse text-left text-ui">
                            <caption className="sr-only">How many copies fit, by photo size and paper</caption>
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Photo size</th>
                                    {PAPER_SIZES.map((paper) => (
                                        <th key={paper.id} scope="col" className="py-2 pr-4 font-semibold text-ink">
                                            {paper.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {CAPACITY_ROWS.map((row) => (
                                    <tr key={row.preset.id} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 font-medium text-ink">
                                            {row.preset.jurisdiction} {row.preset.physical.width} ×{' '}
                                            {row.preset.physical.height} {row.preset.physical.unit}
                                        </th>
                                        {row.cells.map(({ paper, layout }) => (
                                            <td key={paper.id} className="py-2 pr-4 font-data text-ink">
                                                {layout.ok
                                                    ? `${layout.copies} (${layout.columns}×${layout.rows}, ${layout.orientation})`
                                                    : 'Does not fit'}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {MEASURED ? (
                        <Figure
                            images={FIGURE_IMAGES}
                            caption={(
                                <>
                                    {`The measured run: a ${MEASURED.input.width}×${MEASURED.input.height} JPEG at `}
                                    {`${formatFileSize(MEASURED.input.bytes)} became a `}
                                    {`${MEASURED.output.width}×${MEASURED.output.height} sheet at `}
                                    {`${formatFileSize(MEASURED.output.bytes)}, ${MEASURED.output.density} DPI. `}
                                    The image above is a 600×900 downscale for this page.
                                </>
                            )}
                        />
                    ) : null}
                </ContentSection>

                <ContentSection id="printer-margins" heading="Your printer’s own margins">
                    <p>
                        The margin and gap set on this page describe the space Resizo leaves between and around the
                        photos on the sheet — they say nothing about the strip most printers cannot physically
                        print into, along every edge of the paper. A 0 mm margin here still prints with whatever
                        unprintable border the printer itself imposes; check the printed sheet before trusting a
                        cut guide near the edge.
                    </p>
                </ContentSection>

                <ContentSection id="in-your-browser" heading="Everything happens in your browser">
                    <p>
                        The crop, the resampling, the tiling, the cut guides and the JPEG or PDF encode are all code
                        this page hands to your own browser tab — there is no server this photo is sent to, checked
                        on, or held by. The same tab that shows you the preview is the one building the file, which
                        is also why a very large photo on a very small phone can be refused outright: the limit is
                        what this device can spare, not a policy.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="passport-photo-print-faq" />
            </PrintSheetTool>
        </>
    );
}
