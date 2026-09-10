import BulkCompressTool from './BulkCompressTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { formatSavings, savingsPercent } from '@/lib/format/submit-helpers';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES } from '@/lib/limits';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/bulk-image-compressor';

/**
 * The batch-example table below reads a scenario this branch has not measured
 * yet — `npm run bench` writes it once the benchmark agent lands scenario G.
 * Until then this is `null`/`[]` and the whole section renders nothing rather
 * than throwing: a page here must never publish a number benchmarks/ has not
 * actually produced.
 */
const BULK_SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'bulk-compress') ?? null;

const BULK_CASES = (BULK_SCENARIO?.cases ?? []).filter(
    (entry) => Number.isFinite(entry?.input?.bytes) && entry.input.bytes > 0 && Number.isFinite(entry?.output?.bytes),
);

/**
 * The one file of the batch the figure shows: the photograph, before and
 * after. The before is the prepared 800×534 downscale the compress figure
 * already ships; the after is the batch's own output for that file, copied
 * byte for byte by scripts/generate-demos.js. Null until the run exists.
 */
const PHOTO_CASE = BULK_CASES.find((entry) => entry.id === 'bulk-photo-1600x1067') ?? null;

const FIGURE_IMAGES = PHOTO_CASE ? [
    {
        src: '/demos/photo-source-800x534.jpg',
        width: 800,
        height: 534,
        alt: 'A generated landscape photograph: rolling hills, a tree line and a sky with soft cloud, '
            + 'before the batch ran.',
        label: 'Before',
    },
    {
        // Literal on purpose: tests/app/demo-assets.test.js reads these numbers
        // from the source and holds the file on disk to them, so a re-run that
        // shrank the photo would fail the build rather than mislabel the figure.
        src: '/demos/bulk-compressed-photo-200kb.jpg',
        width: 1600,
        height: 1067,
        alt: 'The same landscape photograph as the batch wrote it, held under 200 KB at its full '
            + 'pixel size.',
        label: 'After',
    },
] : [];

const DESCRIPTION = 'Compress a batch of JPG, PNG or WebP photos to a maximum size each, entirely on your '
    + 'device — nothing is uploaded. Download them one by one or as a ZIP.';

export const metadata = buildMetadata({
    title: 'Bulk Image Compressor — Max KB per Image | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-compress.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Bulk compressing a batch of photos means giving every file the same maximum size in kilobytes '
    + 'and letting each one reach it on its own terms, because a plain screenshot and a detailed photograph do '
    + 'not need the same quality drop to hit the same number. On Resizo you drop up to twenty JPEG, PNG or '
    + 'WebP files, pick a limit from 50 KB to 1 MB or type your own, and press Compress — each file is '
    + 'measured and, if it cannot get under the limit by quality alone, either reported honestly or shrunk in '
    + 'pixels too, depending on the mode you choose. Every encode runs on your own device, inside this browser '
    + 'tab, using a compressor the page hands to your own browser, so the batch never leaves your machine, '
    + 'and the results download one at a time or together as a ZIP.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Bulk Image Compressor', path: PATH },
];

const HOW_TO_ID = 'how-to-bulk-compress';
const HOW_TO_HEADING = 'How to compress a batch of images';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose your images',
        text: `Drop up to ${MAX_BULK_FILES} JPEG, PNG or WebP files onto the panel, or press Choose images. `
            + 'A whole folder works the same way, wherever the browser allows picking one.',
    },
    {
        name: 'Set one maximum size',
        text: 'Pick a preset chip from 50 KB to 1 MB, or type a custom limit in kilobytes. Every file in the '
            + 'batch is measured against this same number.',
    },
    {
        name: 'Choose what happens if a file can’t get there',
        text: 'Preserve dimensions keeps every pixel and only lowers quality, reporting a file that still '
            + 'cannot fit; Fit under limit lowers quality first, then shrinks the picture itself.',
    },
    {
        name: 'Press Compress and download',
        text: 'Watch each file settle as it finishes, then download results one at a time or together as a '
            + 'ZIP — a file that missed the limit says why, right beside the ones that made it.',
    },
];

const FAQS = [
    {
        question: 'Is a kilobyte here 1,000 bytes or 1,024?',
        answer: '1,024 bytes, the same convention every size on this site uses. A file reported here as under '
            + '200 KB is under 204,800 bytes — not 200,000, which is what some operating systems mean by the '
            + 'same two letters.',
    },
    {
        question: 'Why does a PNG sometimes ignore a small limit?',
        answer: 'PNG has no quality dial — it stores every pixel exactly, so Preserve dimensions can only '
            + 'report that a small ceiling is out of reach. Switch to Fit under limit and the picture itself '
            + 'is shrunk a step at a time until it fits, which is the only lever a lossless format leaves.',
    },
    {
        question: 'Does a transparent PNG stay transparent?',
        answer: 'Yes. Each file keeps the format it arrived in — a JPEG stays a JPEG, a PNG stays a PNG, a '
            + 'WebP stays a WebP — so a PNG’s transparency is never flattened away, and a JPEG, which never '
            + 'had any, does not gain any either.',
    },
    {
        question: 'What happens to a file that never gets under the limit?',
        answer: 'It is reported, never guessed at: its row says it could not meet the target and why, and its '
            + 'bytes are left out of the batch’s Saved and Reduction numbers. Nothing is downloaded for a '
            + 'file that missed the number you set.',
    },
    {
        question: 'What happens to a file that is already under the limit?',
        answer: 'It is kept exactly as it is rather than run through the encoder again — only its metadata '
            + 'is stripped. Compressing a file a second time when it already meets the target could only add '
            + 'generation loss or grow it, so Resizo leaves the pixels alone and marks it a success.',
    },
    {
        question: 'Can I add a HEIC photo to a batch?',
        answer: 'Not in this tool. HEIC needs its own decoder, which lives on the dedicated HEIC converter at '
            + '/heic — convert there to a JPEG or PNG first, then bring the result back here for the batch.',
    },
];

export default function BulkImageCompressorPage() {
    return (
        <>
            <JsonLd
                id="bulk-image-compressor-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Bulk Image Compressor',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Compresses up to twenty JPEG, PNG and WebP files in one batch, each to its own maximum size',
                            'Preserve dimensions, or Fit under limit for a file quality alone cannot shrink enough',
                            'Reports a file that could not meet the target rather than guessing or degrading it silently',
                            'Downloads each result individually or as one ZIP archive',
                            'Keeps the format each file arrived in, so a transparent PNG stays transparent',
                            'Runs on your own device — no image is uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Set one maximum file size, drop a batch of photos, and compress every '
                            + 'one of them to fit it, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <BulkCompressTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <ContentSection id="own-target" heading="Every image gets its own target">
                    <p>
                        A single maximum size in KB applies to every file in the batch, but the work behind it
                        is separate for each one. A flat product photo might barely need a quality drop to
                        fit; a busy landscape at the same pixel size can need to go much further — Resizo runs
                        the search per file rather than picking one setting for the whole batch.
                    </p>
                    <p>
                        The row for each file shows the limit it was measured against and whether it landed
                        under it, so a batch of twenty never hides the one file that struggled.
                    </p>
                    <p>
                        A file that is already at or under the limit is not re-encoded at all — it comes back
                        at its own size with only its metadata removed, because running it through the
                        encoder again could only make it larger or worse, never smaller.
                    </p>
                </ContentSection>

                <ContentSection id="preserve-or-fit" heading="Preserve dimensions or fit under the limit">
                    <p>
                        Preserve dimensions never touches a pixel — it only turns quality down, and a file
                        that still cannot fit at its full size is reported as such rather than shrunk behind
                        your back. Fit under limit tries quality first and, if that alone is not enough,
                        reduces the picture itself a step at a time, in the same shape, until it fits or hits
                        the smallest size Resizo allows.
                    </p>
                    <p>
                        Neither mode ever converts a file to a different format to hit the number — only the
                        two levers named above are ever used.
                    </p>
                </ContentSection>

                <ContentSection id="png-is-not-jpeg" heading="PNG is not JPEG">
                    <p>
                        JPEG and WebP both have a quality dial, so Preserve dimensions can usually find a
                        setting under most limits. PNG is lossless — it stores every pixel exactly and has no
                        quality to trade away — so under Preserve dimensions a PNG either already fits or it
                        does not, with nothing in between for the tool to adjust.
                    </p>
                    <p>
                        Fit under limit is the only mode that can still help a PNG: shrinking the picture is
                        the one lever a lossless format leaves.
                    </p>
                </ContentSection>

                <ContentSection id="transparency" heading="Transparency stays where the format keeps it">
                    <p>
                        Every file keeps the format it arrived in — a JPEG stays a JPEG, a PNG stays a PNG, a
                        WebP stays a WebP — because converting formats to chase a size was never asked for. A
                        PNG or WebP with transparent pixels keeps them; a JPEG, which cannot represent
                        transparency at all, is unaffected either way.
                    </p>
                </ContentSection>

                <ContentSection id="tiny-target" heading="Why a very small target fails">
                    <p>
                        A 4000×3000 photo asked to fit under 20 KB is not a quality problem — it is a
                        pixel-count problem, and no amount of turning the quality dial down reaches a target
                        that small at that size. Preserve dimensions reports this plainly rather than handing
                        back a file that is technically under the limit but reduced to an unusable smear of
                        blocks.
                    </p>
                    <p>
                        Fit under limit is built for exactly this case: it lowers quality to a sensible floor
                        first, then reduces the picture’s dimensions until the number is reachable, and says
                        in the result that it did.
                    </p>
                </ContentSection>

                <ContentSection id="in-your-browser" heading="Everything happens in your browser">
                    <p>
                        Every file in the batch is decoded, measured and re-encoded by code this page hands to
                        your own browser, so nothing is uploaded and there is no copy of it sitting anywhere
                        else for this to work. The ZIP, when you ask for one, is also built on your device
                        from the files already sitting in its memory.
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
                            Real files from a measured run, each held to the same limit and reaching it on its
                            own terms.
                        </p>
                        <div className="overflow-x-auto" role="region" aria-label="Measured batch example" tabIndex={0}>
                            <table className="w-full min-w-[32rem] border-collapse text-left text-ui">
                                <caption className="sr-only">One measured batch, file by file</caption>
                                <thead>
                                    <tr className="border-b border-line">
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">File</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">Before</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">After</th>
                                        <th scope="col" className="py-2 font-semibold text-ink">Reduction</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {BULK_CASES.map((entry) => {
                                        // A file already at or under its own limit is
                                        // kept rather than re-encoded (lib/upload/
                                        // compress-batch.js). Its own kept flag is the
                                        // source of truth for that — metadata stripping
                                        // can leave its output a little SMALLER than its
                                        // input, which a byte comparison alone would read
                                        // as a (tiny, misleading) real re-encode. The
                                        // byte comparison survives only as a fallback for
                                        // a results file measured before this field
                                        // existed, where `kept` is absent entirely.
                                        const kept = entry.kept !== undefined
                                            ? entry.kept === true
                                            : entry.output.bytes >= entry.input.bytes;
                                        const reduction = kept
                                            ? null
                                            : formatSavings(savingsPercent(entry.input.bytes, entry.output.bytes));
                                        return (
                                            <tr key={entry.id} className="border-b border-line">
                                                <th scope="row" className="py-2 pr-4 font-medium text-ink">
                                                    {entry.sample ?? entry.id}
                                                </th>
                                                <td className="py-2 pr-4 font-data text-ink">{formatFileSize(entry.input.bytes)}</td>
                                                <td className="py-2 pr-4 font-data text-ink">{formatFileSize(entry.output.bytes)}</td>
                                                <td className="py-2 font-data text-accent">
                                                    {kept ? 'Kept — already under the limit' : (reduction ?? '—')}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {PHOTO_CASE ? (
                            <Figure
                                images={FIGURE_IMAGES}
                                caption={(
                                    <>
                                        {`The photograph in that batch: a ${PHOTO_CASE.input.width}×${PHOTO_CASE.input.height} JPEG at `}
                                        {`${formatFileSize(PHOTO_CASE.input.bytes)} came back `}
                                        {`${PHOTO_CASE.output.width}×${PHOTO_CASE.output.height} at `}
                                        {`${formatFileSize(PHOTO_CASE.output.bytes)} under a 200 KB limit. `}
                                        The before image is shown at 800×534, a downscale of the source; the after
                                        image is the batch&rsquo;s own output, byte for byte.
                                    </>
                                )}
                            />
                        ) : null}
                    </ContentSection>
                ) : null}

                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <FaqList items={FAQS} id="bulk-image-compressor-faq" />
            </BulkCompressTool>
        </>
    );
}
