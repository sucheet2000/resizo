/**
 * /guides/large-photo-to-20-kb — the first guide, and the first page on this
 * site whose numbers came out of a measurement rather than out of arithmetic.
 *
 * The page /compress-image-to-20kb explains what the fit policy WILL do. This
 * explains what it DID, once, to a file whose bytes are committed in this
 * repository: which lever moved, how far, what it cost and how long it took.
 * The two are deliberately different jobs and the doorway guard measures them
 * against each other, so nothing here restates the tool page's argument — it
 * reports a run and reads it.
 *
 * EVERY FIGURE IS INTERPOLATED FROM benchmarks/results/latest.json. Not one is
 * typed. That is the whole point of importing the results here: a number in
 * the prose and a number in the table cannot disagree if neither was written
 * by hand, and a re-run that moves a figure moves the sentence with it. The
 * policy constants come from lib/limits.js for the same reason — the engine
 * owns the floor and the step, and a guide that quoted them from memory would
 * be wrong the day either changed.
 */
import results from '@/benchmarks/results/latest.json';
import { FIT_MAX_STEPS, FIT_MIN_DIMENSION, FIT_MIN_QUALITY, FIT_SCALE_STEP } from '@/lib/limits';

const scenario = (id) => results.scenarios.find((entry) => entry.id === id);

const findCase = (scenarioId, caseId) => scenario(scenarioId).cases.find((entry) => entry.id === caseId);

/** The 20 KB run, and the two lanes of the resize-then-compress question. */
const FIT = findCase('fit-20kb', 'fit-20kb-photo');
const RESIZE_FIRST = findCase('resize-then-compress', 'resize-then-compress');
const FULL_SIZE = findCase('resize-then-compress', 'compress-at-full-size');

const ENVIRONMENT = results.environment;

/* -------------------------------------------------------------- *
 * Formatting. Locale-free on purpose: a build must not render a
 * different separator than the machine that ran the benchmark.
 * -------------------------------------------------------------- */

const count = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const kb = (bytes) => `${(bytes / 1024).toFixed(2)} KB`;

const box = (side) => `${side.width}×${side.height}`;

const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

const decibels = (value) => value.toFixed(2);

const structural = (value) => value.toFixed(4);

const pixelsIn = (side) => side.width * side.height;

const bitsPerPixel = (bytes, side) => ((bytes * 8) / pixelsIn(side)).toFixed(2);

const percent = (share) => `${Math.round(share * 100)}%`;

/* -------------------------------------------------------------- *
 * Derived from the run, never asserted alongside it.
 * -------------------------------------------------------------- */

const TARGET_KB = FIT.settings.targetKb;

const TARGET_BYTES = TARGET_KB * 1024;

/** 524 is 0.8^5 of 1600, so the walk took five steps. */
const SHRINK_STEPS = Math.round(Math.log(FIT.output.width / FIT.input.width) / Math.log(FIT_SCALE_STEP));

const SIDE_LOST = Math.round((1 - FIT_SCALE_STEP) * 100);

const WIDTH_KEPT = percent(FIT.output.width / FIT.input.width);

const PIXELS_DROPPED = percent(1 - pixelsIn(FIT.output) / pixelsIn(FIT.input));

/** What one bit would have had to cover, had the pixel count not moved. */
const BITS_AT_FULL_SIZE = bitsPerPixel(FIT.output.bytes, FIT.input);

const PIXELS_PER_BIT = Math.round(pixelsIn(FIT.input) / (FIT.output.bytes * 8));

const REFERENCE_WIDTH = RESIZE_FIRST.output.width;

const LOOSE_TARGET_KB = RESIZE_FIRST.settings.targetKb;

const PSNR_GAP = (FULL_SIZE.psnr - RESIZE_FIRST.psnr).toFixed(2);

const SSIM_GAP = (FULL_SIZE.ssim - RESIZE_FIRST.ssim).toFixed(4);

/* -------------------------------------------------------------- *
 * The two tables.
 * -------------------------------------------------------------- */

const FIT_TABLE = {
    type: 'table',
    caption: `The ${TARGET_KB} KB run: what went in and what came back`,
    columns: [
        { key: 'stage', label: 'Stage', rowHeader: true },
        { key: 'bytes', label: 'Bytes', mono: true },
        { key: 'pixels', label: 'Pixels', mono: true },
        { key: 'quality', label: 'Quality', mono: true },
        { key: 'time', label: 'Time', mono: true },
    ],
    rows: [
        {
            stage: 'Went in',
            bytes: `${count(FIT.input.bytes)} (${kb(FIT.input.bytes)})`,
            pixels: box(FIT.input),
            quality: '—',
            time: '—',
        },
        {
            stage: 'Came back',
            bytes: `${count(FIT.output.bytes)} (${kb(FIT.output.bytes)})`,
            pixels: box(FIT.output),
            quality: String(FIT.output.quality),
            time: seconds(FIT.wallMs),
        },
    ],
};

const LANE_TABLE = {
    type: 'table',
    caption: `Two ways to reach ${LOOSE_TARGET_KB} KB, both scored at ${REFERENCE_WIDTH} px`,
    columns: [
        { key: 'lane', label: 'Lane', rowHeader: true },
        { key: 'bytes', label: 'Bytes', mono: true },
        { key: 'pixels', label: 'Pixels', mono: true },
        { key: 'quality', label: 'Quality', mono: true },
        { key: 'psnr', label: 'PSNR (dB)', mono: true },
        { key: 'ssim', label: 'SSIM', mono: true },
    ],
    rows: [RESIZE_FIRST, FULL_SIZE].map((entry) => ({
        lane: entry.label,
        bytes: `${count(entry.output.bytes)} (${kb(entry.output.bytes)})`,
        pixels: box(entry.output),
        quality: String(entry.output.quality),
        psnr: decibels(entry.psnr),
        ssim: structural(entry.ssim),
    })),
};

const largePhotoTo20Kb = {
    slug: 'large-photo-to-20-kb',
    title: 'What Happens When a Large Photo Must Reach 20 KB | Resizo',
    h1: 'What happens when a large photo must reach 20 KB',
    description:
        `Measured with nothing uploaded: a ${box(FIT.input)} sample reached ${TARGET_KB} KB only by shrinking to `
        + `${box(FIT.output)} at quality ${FIT.output.quality}. What the fit policy costs, and when to shrink first.`,

    answer:
        `A ${box(FIT.input)} synthetic test scene of ${count(FIT.input.bytes)} bytes came out of the ${TARGET_KB} KB `
        + `page at ${count(FIT.output.bytes)} bytes, and it got there by giving up pixels rather than quality: `
        + `${box(FIT.output)} at quality ${FIT.output.quality}, in ${seconds(FIT.wallMs)}. The quality dial alone `
        + `stops at a floor of ${FIT_MIN_QUALITY}, so ${SHRINK_STEPS} shrink steps did the rest and the picture `
        + `finished at ${WIDTH_KEPT} of the width it started with. A second measurement at a looser ceiling runs the `
        + `other way: asked for ${LOOSE_TARGET_KB} KB, compressing the full ${FIT.input.width} px frame scored `
        + `${decibels(FULL_SIZE.psnr)} dB PSNR and ${structural(FULL_SIZE.ssim)} SSIM, against `
        + `${decibels(RESIZE_FIRST.psnr)} dB and ${structural(RESIZE_FIRST.ssim)} for resizing to `
        + `${REFERENCE_WIDTH} px first, both judged at ${REFERENCE_WIDTH} px. So shrinking first is what a tight `
        + 'ceiling forces, not a trick that improves a loose one.',

    author: 'Sucheet Boppana',
    published: '2026-09-09',
    modified: '2026-09-09',

    /** Nothing external is cited: the finding is this repository's own run. */
    basedOnOfficialRequirements: false,
    sources: [],

    /**
     * The measurement the tables and the prose are rendered from, carried on
     * the entry so the page and its evidence travel together. Committed under
     * benchmarks/results/ and re-derivable with the commands below.
     */

    methodology: [
        {
            type: 'p',
            text: 'Every figure here came from driving the real page in a real browser. Chromium opened '
                + `[the ${TARGET_KB} KB page](/compress-image-to-20kb), picked the sample through the file input, `
                + 'pressed the button and caught the download; the sentence quoted further down is the one it read '
                + 'off the screen. Nothing in the run calls the compressor directly, because a number produced that '
                + 'way describes a module rather than the thing a visitor uses.',
        },
        {
            type: 'p',
            text: `The build and the machine: commit ${ENVIRONMENT.commit.slice(0, 7)} on branch `
                + `${ENVIRONMENT.branch}, Chromium ${ENVIRONMENT.chromium}, Node ${ENVIRONMENT.node}, on an `
                + `${ENVIRONMENT.cpu} running ${ENVIRONMENT.os} ${ENVIRONMENT.arch} with ${ENVIRONMENT.cores} cores, `
                + `serving a production build at ${ENVIRONMENT.baseUrl}.`,
        },
        {
            type: 'ul',
            items: [
                'Build what ships, because a development build measures the wrong bundle: npm run build',
                `Serve it: npx next start -p 3910 — this run answered on port ${new URL(ENVIRONMENT.baseUrl).port}, `
                    + 'which BENCH_URL selects',
                'Drive it from a second terminal, leaving the build alone while it runs: npm run bench',
            ],
        },
        {
            type: 'p',
            text: 'Three caveats travel with these numbers. The sample is a synthetic photograph-like scene drawn by '
                + 'a seeded generator and committed to the repository, not a photograph anybody took, and it is '
                + 'chosen to give an encoder grain and gradients to argue with. Times come from one machine in one '
                + `thermal state, and this one was busy — the one-minute load average was ${ENVIRONMENT.loadAtStart[0]} `
                + `across ${ENVIRONMENT.cores} cores when the run began — so read the seconds as an upper bound. `
                + 'Bytes, dimensions and quality settings are deterministic for a given build; the seconds are not.',
        },
        {
            type: 'p',
            text: 'The two quality scores are computed over BT.601 luma with both sides decoded by the same library, '
                + 'so a browser codec and the reference decoder cannot disagree their way into looking like a quality '
                + 'difference. SSIM here uses an 8×8 uniform window and is not the multi-scale variant, so a figure '
                + 'from this page is not comparable with a paper reporting MS-SSIM.',
        },
    ],

    sections: [
        {
            id: 'where-the-bytes-go',
            heading: `Where ${TARGET_KB} KB has to go on a picture this size`,
            blocks: [
                {
                    type: 'p',
                    text: `The ceiling is a byte count, but the thing that decides the outcome is how many pixels are `
                        + `sharing it. The sample arrived carrying ${bitsPerPixel(FIT.input.bytes, FIT.input)} bits `
                        + `for each of its ${count(pixelsIn(FIT.input))} pixels. Holding every one of them under `
                        + `${count(TARGET_BYTES)} bytes would have left ${BITS_AT_FULL_SIZE} bits apiece — one bit `
                        + `shared between ${PIXELS_PER_BIT} pixels — and no encoder turns that back into a picture.`,
                },
                FIT_TABLE,
                {
                    type: 'p',
                    text: `What the page settled on instead was ${bitsPerPixel(FIT.output.bytes, FIT.output)} bits `
                        + `for each pixel, bought by removing ${PIXELS_DROPPED} of them. Those two lines are the `
                        + 'whole trade: the byte count landed almost exactly where it was asked to, and the pixel '
                        + 'count did all of the moving.',
                },
            ],
        },
        {
            id: 'the-steps-it-took',
            heading: 'The steps it actually took to get there',
            blocks: [
                {
                    type: 'p',
                    text: `Two levers, spent in a fixed order. Quality goes first and halts at ${FIT_MIN_QUALITY}, `
                        + 'because further down a JPEG shows the blocking and ringing nobody wants on a document. '
                        + 'The width and height only start moving once an encode at that floor is still over the '
                        + 'line.',
                },
                {
                    type: 'p',
                    text: `Each step then takes ${SIDE_LOST}% off both sides, and — this is the part that is easy to `
                        + 'get wrong — every step resamples from the original file rather than from the step before '
                        + `it. Stacking ${FIT_MAX_STEPS} rounds of filtering on top of each other comes out visibly `
                        + 'softer than one round straight to the same size, for identical dimensions and identical '
                        + 'bytes.',
                },
                {
                    type: 'p',
                    text: `${FIT.output.width} is exactly the ${SHRINK_STEPS}th rung of that ladder, so `
                        + `${SHRINK_STEPS} shrinks ran before anything fit. The quality that finally won was `
                        + `${FIT.output.quality}, which is above the floor, and that is the search climbing back: the `
                        + `floor only binds while the picture is too big. At ${box(FIT.output)} an encode at `
                        + `${FIT_MIN_QUALITY} fit with room to spare, so the search spent the room on looking better.`,
                },
                {
                    type: 'p',
                    text: `The walk stops after ${FIT_MAX_STEPS} steps, or when the short side would fall under `
                        + `${FIT_MIN_DIMENSION} pixels, or when it runs out of time. This one needed `
                        + `${SHRINK_STEPS} of the ${FIT_MAX_STEPS} and finished in ${seconds(FIT.wallMs)}.`,
                },
            ],
        },
        {
            id: 'what-the-page-reported',
            heading: 'What the page said it had done, and the number worth re-reading',
            blocks: [
                {
                    type: 'p',
                    text: `Under the finished picture it printed: "${FIT.panel}"`,
                },
                {
                    type: 'p',
                    text: 'Two things in that sentence repay a second look. It names the size it stopped at, because '
                        + 'a page that quietly hands back a smaller picture gets found out by the form rather than '
                        + `by you. And ${kb(FIT.output.bytes)} is ${count(FIT.output.bytes)} bytes: a kilobyte is `
                        + '1,024 bytes here, exactly as it is in the file size your computer shows you.',
                },
                {
                    type: 'p',
                    text: `So the file that met a ${TARGET_KB} KB ceiling sits above a round twenty thousand. A field `
                        + 'written against the round number will refuse it, and the fix is to set the figure a little '
                        + 'lower and run it again rather than to argue with the form.',
                },
            ],
        },
        {
            id: 'shrink-first-or-not',
            heading: 'Is it better to shrink the picture yourself first?',
            blocks: [
                {
                    type: 'p',
                    text: `Not at every ceiling, and the second measurement says so plainly. The same source was `
                        + `taken to ${LOOSE_TARGET_KB} KB twice: once by [resizing to ${REFERENCE_WIDTH} px](/resize) `
                        + `and compressing after, once by compressing the full ${FIT.input.width} px frame and `
                        + `downscaling the result to ${REFERENCE_WIDTH} px afterwards. Both were scored against one `
                        + `reference, the source at ${REFERENCE_WIDTH} px, which is what somebody displaying the `
                        + 'picture at that width would actually see.',
                },
                LANE_TABLE,
                {
                    type: 'p',
                    text: `The full-size lane won on both scores, by ${PSNR_GAP} dB and ${SSIM_GAP} SSIM, and it did `
                        + `it at the lower quality setting of the two — ${FULL_SIZE.output.quality} against `
                        + `${RESIZE_FIRST.output.quality}. The explanation the numbers point to is the downscale at `
                        + 'the end: it averages several encoded pixels into every displayed one, and averaging hides '
                        + 'compression noise. Resizing first hands the encoder fewer pixels to spend the budget on, '
                        + 'but buys none of that help afterwards.',
                },
                {
                    type: 'p',
                    text: 'Read that narrowly. It is one sample, one ceiling, one machine, and a drawn scene rather '
                        + 'than a photograph — not a statement about JPEG and not a statement about every target. '
                        + `At ${TARGET_KB} KB the same source could not stay at full size at all, which is the far `
                        + 'end of the same dial. Shrinking is what a tight ceiling forces, not a trick that improves '
                        + 'a loose one.',
                },
            ],
        },
        {
            id: 'filling-in-a-form',
            heading: 'If a form is what sent you here',
            blocks: [
                {
                    type: 'p',
                    text: 'Settle the pixel box before the byte count when the field states both. The fit policy '
                        + 'chooses a size in order to satisfy the ceiling and knows nothing about the box the form '
                        + 'wanted, so compare the width printed under your result against what was asked for before '
                        + 'you attach anything.',
                },
                {
                    type: 'p',
                    text: 'Crop before you compress when the subject is small in the frame. Margin costs the same '
                        + 'bits as a face does, and at this ceiling there are very few bits to spend on anything '
                        + 'nobody will look at. [Cutting the frame down first](/crop) is often the entire fix, and it '
                        + 'leaves the size of what remains under your control instead of the policy’s.',
                },
                {
                    type: 'p',
                    text: 'And start looser if the requirement allows it. A ceiling that the quality dial can reach '
                        + 'on its own leaves the width and height untouched, which is the outcome to prefer whenever '
                        + 'the form will accept it; coming back down later costs you nothing but the second run.',
                },
            ],
        },
    ],

    relatedTools: [
        {
            slug: 'compress-image-to-20kb',
            nextJob: `Run the same ${TARGET_KB} KB ceiling on your own file and read the size it stopped at.`,
        },
        {
            slug: 'compress-image-to-50kb',
            nextJob: 'Try the looser ceiling first, where the quality dial often gets there with the pixels intact.',
        },
        {
            slug: 'resize',
            nextJob: 'Pick the width yourself, rather than letting the fit policy choose it for you.',
        },
        {
            slug: 'signature-resizer',
            nextJob: 'Fit a scanned signature to a pixel box and a byte ceiling in a single pass.',
        },
    ],

    faqs: [
        {
            question: `Why did it come back at quality ${FIT.output.quality} when the floor is ${FIT_MIN_QUALITY}?`,
            answer: `Because the floor only binds while the picture is still too big. At each size the page encodes `
                + `once at ${FIT_MIN_QUALITY} to find out whether that size can fit at all; when ${box(FIT.output)} `
                + `did, the search climbed back up and stopped at the best quality still under the ceiling, which was `
                + `${FIT.output.quality}.`,
        },
        {
            question: 'Would a different picture have kept more of its pixels?',
            answer: 'Very likely, and it has little to do with how big the file was to begin with. The search is '
                + 'driven by what the encoder produces at each size, so a flat graphic or a tightly cropped signature '
                + 'fits at a far larger size than a grainy scene does. Grain is the expensive thing, because it is '
                + 'detail with no pattern in it to exploit.',
        },
        {
            question: 'Should I compress at full size every time, then?',
            answer: `No. The ${LOOSE_TARGET_KB} KB result above is one sample at one ceiling on one machine, and it `
                + `turns over completely at ${TARGET_KB} KB, where staying at full size was never on the table. Take `
                + 'it as a reason to try the ceiling before reaching for the resize tool, not as a rule about which '
                + 'order always wins.',
        },
        {
            question: 'Are these times what I would see?',
            answer: 'Treat them as an upper bound rather than a typical figure. The run used one laptop in one '
                + `thermal state with a one-minute load average of ${ENVIRONMENT.loadAtStart[0]} across `
                + `${ENVIRONMENT.cores} cores, and your own hardware decides the rest. The byte counts and quality `
                + 'settings are reproducible for a given build; the seconds are not.',
        },
        {
            question: 'Was the sample a real photograph?',
            answer: 'No, and it is never described as one. It is a drawn scene — a sky gradient, a low sun, ridge '
                + 'lines, broken water highlights and fine grain over the whole frame — produced by a seeded '
                + 'generator so that a rerun uses byte-identical inputs. It behaves like a photograph for an encoder, '
                + 'which is what the measurement needed, and it carries no licence question with it.',
        },
    ],

    indexable: true,
};

export default largePhotoTo20Kb;
