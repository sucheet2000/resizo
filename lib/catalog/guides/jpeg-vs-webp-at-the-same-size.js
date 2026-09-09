/**
 * /guides/jpeg-vs-webp-at-the-same-size — the second guide, and the one that
 * answers a question the tool pages deliberately do not.
 *
 * /jpg-to-webp and /png-to-webp are about a conversion: one file in, one file
 * out, and how much lighter it lands. This page asks the opposite question —
 * hold the BYTES equal and see which format spends them better — and the
 * answer turned out to be "on a photograph, WebP, by a wide margin; on flat
 * art, the question does not survive contact with the tool", because a byte
 * target is a ceiling and three of the four samples were already under it.
 *
 * EVERY NUMBER IS READ OUT OF THE JSON. Nothing below is retyped: the table
 * rows are built from the sixteen cases, and the figures the prose quotes come
 * from the same objects through the helpers at the top. A re-run that moves a
 * score moves the sentence with it, which is the only arrangement under which
 * a measured claim stays true after the measurement changes.
 */
import results from '@/benchmarks/results/latest.json';
import { formatFileSize } from '@/lib/format/bytes';

const SCENARIO_ID = 'jpeg-vs-webp';

const scenario = results.scenarios.find((entry) => entry.id === SCENARIO_ID) ?? { cases: [] };
const cases = scenario.cases;
const environment = results.environment ?? {};

const SAMPLES = [
    { file: 'photo-1600x1067.jpg', name: 'Photograph', article: 'the photograph' },
    { file: 'screenshot-1440x900.png', name: 'Screenshot', article: 'the screenshot' },
    { file: 'graphic-800x800.png', name: 'Graphic', article: 'the graphic' },
    { file: 'illustration-1200x900.png', name: 'Illustration', article: 'the illustration' },
];

const CEILINGS = [100, 50];

function find(file, format, targetKb) {
    return cases.find((entry) => entry.sample === file
        && entry.output.format === format
        && entry.settings.targetKb === targetKb);
}

const formatName = (format) => (format === 'webp' ? 'WebP' : 'JPEG');

const bytes = (entry) => formatFileSize(entry.output.bytes);

const sourceBytes = (entry) => formatFileSize(entry.input.bytes);

const psnr = (entry) => (typeof entry.psnr === 'number' ? entry.psnr.toFixed(2) : '—');

const ssim = (entry) => (typeof entry.ssim === 'number' ? entry.ssim.toFixed(4) : '—');

const quality = (entry) => (typeof entry.output.quality === 'number' ? String(entry.output.quality) : '—');

const wall = (entry) => (entry.wallMs >= 1000 ? `${(entry.wallMs / 1000).toFixed(2)} s` : `${entry.wallMs} ms`);

/** Percentage of the ORIGINAL sample the output came back at, as the report prints it. */
const ratio = (entry) => `${(entry.ratio * 100).toFixed(1)}%`;

const photoJpeg100 = find('photo-1600x1067.jpg', 'jpeg', 100);
const photoJpeg50 = find('photo-1600x1067.jpg', 'jpeg', 50);
const photoWebp100 = find('photo-1600x1067.jpg', 'webp', 100);
const photoWebp50 = find('photo-1600x1067.jpg', 'webp', 50);

const shotJpeg100 = find('screenshot-1440x900.png', 'jpeg', 100);
const shotJpeg50 = find('screenshot-1440x900.png', 'jpeg', 50);
const shotWebp100 = find('screenshot-1440x900.png', 'webp', 100);

const graphicJpeg100 = find('graphic-800x800.png', 'jpeg', 100);
const graphicWebp100 = find('graphic-800x800.png', 'webp', 100);
const graphicWebp50 = find('graphic-800x800.png', 'webp', 50);

const illoJpeg100 = find('illustration-1200x900.png', 'jpeg', 100);
const illoJpeg50 = find('illustration-1200x900.png', 'jpeg', 50);
const illoWebp100 = find('illustration-1200x900.png', 'webp', 100);

/**
 * The eight pairings, so "WebP scored higher by between X and Y" is arithmetic
 * over the file rather than two numbers somebody read off a table once.
 */
const PAIRINGS = SAMPLES.flatMap((sample) => CEILINGS.map((targetKb) => {
    const jpeg = find(sample.file, 'jpeg', targetKb);
    const webp = find(sample.file, 'webp', targetKb);
    return { sample, targetKb, jpeg, webp, gain: webp.psnr - jpeg.psnr };
}));

const gains = PAIRINGS.map((pairing) => pairing.gain);
const NARROWEST_GAIN = Math.min(...gains).toFixed(2);
const WIDEST_GAIN = Math.max(...gains).toFixed(2);

/**
 * The diagonal: how far the 50 KB WebP sits from the 100 KB JPEG. Computed
 * rather than eyeballed, because "the same score at half the size" is the one
 * claim on this page a reader is most likely to repeat, and it is only true to
 * the precision printed here.
 */
const DIAGONAL_PSNR_GAP = Math.abs(photoJpeg100.psnr - photoWebp50.psnr).toFixed(2);
const DIAGONAL_SSIM_GAP = Math.abs(photoJpeg100.ssim - photoWebp50.ssim).toFixed(4);

/**
 * Rows where the ceiling sat above the file that went in, so the search filled
 * it and the output came back BIGGER than the source. Counted rather than
 * asserted, because it is the fact the whole page turns on.
 */
const GREW_PAST_SOURCE = cases.filter((entry) => entry.output.bytes > entry.input.bytes).length;

/** The quality the search settled on for JPEG where the ceiling was above the source. */
const overshotJpegQuality = [shotJpeg100, shotJpeg50, graphicJpeg100, find('graphic-800x800.png', 'jpeg', 50), illoJpeg100, illoJpeg50]
    .map((entry) => entry.output.quality);
const LOWEST_FILL_QUALITY = Math.min(...overshotJpegQuality);
const HIGHEST_FILL_QUALITY = Math.max(...overshotJpegQuality);

const ROWS = cases.map((entry) => ({
    sample: SAMPLES.find((sample) => sample.file === entry.sample)?.name ?? entry.sample,
    format: formatName(entry.output.format),
    ceiling: `${entry.settings.targetKb} KB`,
    out: bytes(entry),
    quality: quality(entry),
    psnr: psnr(entry),
    ssim: ssim(entry),
    time: wall(entry),
}));

const COMMIT = String(environment.commit ?? '').slice(0, 7);

const jpegVsWebpAtTheSameSize = {
    slug: 'jpeg-vs-webp-at-the-same-size',
    title: 'JPEG vs WebP at the Same File Size — Measured | Resizo',
    h1: 'JPEG vs WebP at the same file size',
    description: 'Four sample images pushed to 100 KB and to 50 KB in both formats, measured on the '
        + 'real tools with nothing uploaded. WebP scored higher every time, but only the photograph '
        + 'was ever a fair fight — the other three sources were already under the ceiling.',

    answer: `On the photograph-like sample the two formats really did land on the same bytes, and WebP `
        + `won: ${psnr(photoWebp100)} dB PSNR and ${ssim(photoWebp100)} SSIM at the 100 KB ceiling against `
        + `JPEG's ${psnr(photoJpeg100)} and ${ssim(photoJpeg100)}, and ${psnr(photoWebp50)} and ${ssim(photoWebp50)} `
        + `at 50 KB — within ${DIAGONAL_PSNR_GAP} dB of what the JPEG needed ${bytes(photoJpeg100)} to reach. `
        + `The screenshot, the graphic and the `
        + `illustration gave no equal-size comparison at all, because a byte target is a ceiling and all three `
        + `sources were already beneath it: at the 100 KB ceiling WebP returned ${bytes(shotWebp100)}, `
        + `${bytes(graphicWebp100)} and ${bytes(illoWebp100)} while JPEG raised its quality to between `
        + `${LOWEST_FILL_QUALITY} and ${HIGHEST_FILL_QUALITY} and filled the ceiling with ${bytes(shotJpeg100)}, `
        + `${bytes(graphicJpeg100)} and ${bytes(illoJpeg100)}. WebP scored higher on all eight pairings, from `
        + `${NARROWEST_GAIN} dB at the narrowest to ${WIDEST_GAIN} dB at the widest, but only the two photograph `
        + `rows compare two files of the same size. The samples are drawn rather than photographed, the run is one `
        + `laptop and one build, and every figure comes from driving the real pages in Chromium with nothing `
        + `uploaded.`,

    author: 'Sucheet Boppana',
    published: '2026-09-09',
    modified: '2026-09-09',
    basedOnOfficialRequirements: false,
    sources: [],

    methodology: [
        {
            type: 'p',
            text: `Sixteen cases: four samples, two byte ceilings and two output formats. Each one drives the `
                + `real pages in Chromium — the file goes through [Convert](/convert) to reach the output format, `
                + `then through [Compress](/compress) with the ceiling typed into the target field — and the `
                + `downloaded file is what gets measured. Nothing here calls the encoder directly, because a `
                + `figure produced that way would describe a module rather than the tool a visitor uses.`,
        },
        {
            type: 'p',
            text: `The convert step runs in every case, including JPEG to JPEG. The compress tool writes the `
                + `format it is handed and cannot pick one, so the format has to come from the converter; letting `
                + `the already-JPEG sample skip that step would hand JPEG one fewer generation of loss than WebP `
                + `and quietly rig the comparison. Both lanes therefore pay the same extra encode, at the `
                + `converter's own default quality of 80.`,
        },
        {
            type: 'p',
            text: `Build ${COMMIT} on ${environment.branch}, Chromium ${environment.chromium}, Node `
                + `${environment.node}, ${environment.cpu} — ${environment.os} ${environment.arch}, served from `
                + `${environment.baseUrl}, which is \`BENCH_URL\` pointing the run off the default port. Reproduce it `
                + `with \`npm run build\` and \`npx next start -p 3910\` in one terminal and \`npm run bench\` in `
                + `another; the runner refuses to start if nothing is serving, and `
                + `it aborts the run if the build changes underneath it.`,
        },
        {
            type: 'p',
            text: `Both scores are computed over BT.601 luma with the alpha channel ignored, and both sides are `
                + `decoded by sharp before comparison so the browser's decoder and libvips cannot disagree their `
                + `way into the result. PSNR is peak signal-to-noise ratio in decibels. SSIM is structural `
                + `similarity — Wang et al. 2004, IEEE TIP 13(4), equation 13 — over an 8x8 uniform window, one `
                + `window per pixel position that fits, averaged over windows. It is not MS-SSIM: there is no `
                + `multi-scale pyramid and no Gaussian weighting, so a figure from this table does not compare `
                + `with a paper reporting MS-SSIM.`,
        },
        {
            type: 'ul',
            items: [
                'The four samples are drawn by a seeded generator, not photographed. They span four content '
                    + 'types on purpose; they are not a sample of what visitors actually open.',
                'One machine, one thermal state, one Chromium build. Bytes and scores are deterministic for a '
                    + 'given build; the times in the last column are not, and are not a product claim.',
                'One encoder per format — MozJPEG and libwebp as this build ships them. Another encoder, or '
                    + 'another set of switches, would move every row.',
                'The run records every request each page made and fails a case if any of them was not a '
                    + 'same-origin GET, so the no-upload promise is checked mechanically rather than asserted.',
            ],
        },
    ],

    sections: [
        {
            id: 'a-ceiling-not-a-goal',
            heading: 'A byte target is a ceiling, so only one sample was a fair fight',
            blocks: [
                {
                    type: 'p',
                    text: 'Both lanes were asked the same thing: put this picture under 100 KB, then under 50 KB. '
                        + 'The tool answers by encoding, reading the real output length back and searching for the '
                        + 'highest quality that still fits underneath the number. It is maximising quality subject '
                        + 'to a limit, not aiming at a size — which means a file that started smaller than the '
                        + 'ceiling comes back larger than it was, at a higher quality than it had.',
                },
                {
                    type: 'p',
                    text: `That is why only one of the four produced a comparison at the same size. The photograph `
                        + `starts at ${sourceBytes(photoJpeg100)}, so both ceilings squeezed both encoders and both `
                        + `landed just under the number. The screenshot starts at ${sourceBytes(shotJpeg100)}, the `
                        + `graphic at ${sourceBytes(graphicJpeg100)} and the illustration at `
                        + `${sourceBytes(illoJpeg100)} — every one of them already beneath the 100 KB ceiling, and `
                        + `only the graphic still above the 50 KB one. Where the ceiling stops constraining `
                        + `anything, the two formats stop answering the same question and go their separate ways.`,
                },
                {
                    type: 'ul',
                    items: [
                        `Photograph, 100 KB ceiling: JPEG came back at ${bytes(photoJpeg100)} and WebP at `
                            + `${bytes(photoWebp100)}. Same question, near enough the same answer size, `
                            + `different scores.`,
                        `Screenshot: WebP returned ${bytes(shotWebp100)} under both ceilings, while JPEG went up `
                            + `to ${bytes(shotJpeg100)} and ${bytes(shotJpeg50)} — ${ratio(shotJpeg100)} of the `
                            + `source PNG at the wider ceiling, for a lower score than the WebP.`,
                        `Illustration: JPEG reached quality ${illoJpeg100.output.quality} and stopped at `
                            + `${bytes(illoJpeg100)}, so its 100 KB row and its 50 KB row are identical in every `
                            + `measured column.`,
                    ],
                },
            ],
        },
        {
            id: 'the-sixteen-cases',
            heading: 'The sixteen results',
            blocks: [
                {
                    type: 'p',
                    text: 'Output size, the quality the panel reported when it reported one, both scores against '
                        + 'the original sample, and the wall time from pressing the button to the download '
                        + 'appearing. Ratios and input sizes are in the paragraphs around this table rather than '
                        + 'in it.',
                },
                {
                    type: 'table',
                    caption: 'Four samples, two byte ceilings and two formats: sixteen measured cases',
                    columns: [
                        { key: 'sample', label: 'Sample' },
                        { key: 'format', label: 'To' },
                        { key: 'ceiling', label: 'Ceiling', mono: true },
                        { key: 'out', label: 'Out', mono: true },
                        { key: 'quality', label: 'Quality', mono: true },
                        { key: 'psnr', label: 'PSNR (dB)', mono: true },
                        { key: 'ssim', label: 'SSIM', mono: true },
                        { key: 'time', label: 'Time', mono: true },
                    ],
                    rows: ROWS,
                },
                {
                    type: 'p',
                    text: `The dashes in the quality column are not missing data. WebP is asked for the ceiling `
                        + `through libwebp's own rate controller, and when that lands underneath it the quality `
                        + `number decided nothing, so the panel refuses to print one. There is one exception in `
                        + `the table: the graphic at the 50 KB ceiling — the only case outside the photograph `
                        + `where a ceiling was still squeezing WebP at all. There the controller overshot, the `
                        + `same bounded quality search JPEG uses took over, and it settled on `
                        + `${graphicWebp50.output.quality} for ${bytes(graphicWebp50)}.`,
                },
            ],
        },
        {
            id: 'what-the-photograph-shows',
            heading: 'What the photograph rows show, and what they do not',
            blocks: [
                {
                    type: 'p',
                    text: `Two files of nearly the same size, one of them measurably closer to the original. At the `
                        + `100 KB ceiling the WebP is ${bytes(photoWebp100)} scoring ${psnr(photoWebp100)} dB and `
                        + `${ssim(photoWebp100)}; the JPEG is ${bytes(photoJpeg100)} scoring ${psnr(photoJpeg100)} `
                        + `and ${ssim(photoJpeg100)}. At 50 KB the gap narrows but holds: ${psnr(photoWebp50)} `
                        + `against ${psnr(photoJpeg50)}, and ${ssim(photoWebp50)} against ${ssim(photoJpeg50)}.`,
                },
                {
                    type: 'p',
                    text: `The interesting row is the diagonal. The 50 KB WebP scores ${psnr(photoWebp50)} dB and `
                        + `${ssim(photoWebp50)}; the 100 KB JPEG scores ${psnr(photoJpeg100)} and `
                        + `${ssim(photoJpeg100)}. That is ${DIAGONAL_PSNR_GAP} dB and ${DIAGONAL_SSIM_GAP} SSIM `
                        + `between them, reached with ${bytes(photoWebp50)} instead of ${bytes(photoJpeg100)}. On `
                        + `this picture, at this size, that is what the newer format buys: roughly half the file `
                        + `for a measured distance from the original the scores cannot separate.`,
                },
                {
                    type: 'p',
                    text: 'What it does not show is a general rule. This is one drawn scene with a lot of fine '
                        + 'grain in it, two ceilings, and one encoder on each side. A picture with smoother '
                        + 'gradients and no grain would move both columns, and probably not by the same amount. '
                        + 'The only figure that describes your own photograph is the one the panel prints when you '
                        + 'run it, so [push your own file to a target](/compress) rather than trusting a row here.',
                },
            ],
        },
        {
            id: 'flat-art-goes-the-other-way',
            heading: 'Screenshots and flat art invert the whole question',
            blocks: [
                {
                    type: 'p',
                    text: 'JPEG was designed for grain and gradient, and a hard boundary between two flat colours '
                        + 'is the case it handles worst: it pays for that edge in bytes, and it rings around it '
                        + 'when it does not pay enough. A screenshot is almost nothing but hard boundaries and '
                        + 'flat areas, so the search has to climb to a very high quality before the ringing stops '
                        + 'showing — and at that quality the file is several times the size of the PNG it came '
                        + 'from.',
                },
                {
                    type: 'p',
                    text: `The numbers make that concrete. The screenshot's JPEG needed quality `
                        + `${shotJpeg100.output.quality} and ${bytes(shotJpeg100)} to score `
                        + `${psnr(shotJpeg100)} dB; its WebP scored ${psnr(shotWebp100)} at `
                        + `${bytes(shotWebp100)}, which is ${ratio(shotWebp100)} of the source and about a quarter `
                        + `of the JPEG. The illustration goes further: its WebP came back at `
                        + `${bytes(illoWebp100)}, ${ratio(illoWebp100)} of the ${sourceBytes(illoJpeg100)} PNG it `
                        + `started as, and did not move when the ceiling was halved. Neither WebP was anywhere `
                        + `near its ceiling, so neither ceiling was doing any work.`,
                },
                {
                    type: 'p',
                    text: `The graphic is the one sample that arrived with an alpha channel, and it needs a `
                        + `caveat rather than a headline. JPEG has no alpha, so the convert step flattened the `
                        + `picture onto black before the compress step ever saw it, and the scoring flattens both `
                        + `sides onto that same black. That is deliberate: the colour underneath a fully `
                        + `transparent pixel is undefined, every encoder writes something different there, and `
                        + `scoring this sample without compositing produced a WebP figure far below the JPEG one — `
                        + `the metric reading the half of the image nobody ever sees, so that number is not in the `
                        + `table. The graphic's `
                        + `${psnr(graphicWebp100)} dB describes what is displayed, and these four rows say nothing `
                        + `about how either format stores transparency. That question belongs to `
                        + `[PNG to WebP](/png-to-webp), where the alpha channel actually survives.`,
                },
            ],
        },
        {
            id: 'choosing-between-them',
            heading: 'Which one to reach for',
            blocks: [
                {
                    type: 'p',
                    text: `For a photograph going onto a web page, the table is one-sided: the same ceiling bought `
                        + `${(photoWebp100.psnr - photoJpeg100.psnr).toFixed(2)} dB more at 100 KB, `
                        + `and half the bytes came within ${DIAGONAL_PSNR_GAP} dB of it. For a file you are `
                        + `handing to a person, the `
                        + `argument runs the other way and has nothing to do with quality — a JPEG opens in `
                        + `everything, and WebP still meets mail clients, older desktop editors and upload forms `
                        + `that will not take it.`,
                },
                {
                    type: 'ul',
                    items: [
                        'Publishing a photograph: WebP, and let the byte ceiling be the thing you argue about.',
                        'Sending a file to someone, or feeding a form: JPEG, because compatibility is the '
                            + 'constraint that actually bites and no score fixes it.',
                        'Flat art or a screenshot: the comparison worth running is not JPEG against WebP but '
                            + 'either of them against the PNG you already have, which may well be the smallest '
                            + 'and is certainly the sharpest.',
                        'Anything that has to stay pixel-exact: not WebP here. The encoder in this build takes a '
                            + 'quality number and has no lossless mode, so a mark with crisp edges stays a PNG.',
                    ],
                },
                {
                    type: 'p',
                    text: 'The three routes that do these jobs are [JPG to WebP](/jpg-to-webp) for photographs, '
                        + '[PNG to WebP](/png-to-webp) for a graphic that has to keep its transparency, and '
                        + '[WebP to JPG](/webp-to-jpg) when something at the other end refuses the newer format.',
                },
            ],
        },
        {
            id: 'reading-a-score',
            heading: 'How to read a PSNR or an SSIM figure without over-reading it',
            blocks: [
                {
                    type: 'p',
                    text: 'PSNR is a single global error term on a logarithmic scale. It says how far the pixels '
                        + 'moved and nothing whatsoever about whether a person would notice: three decibels is '
                        + 'half the mean squared error, not three percent of anything, and an encoder can lose a '
                        + 'few decibels in a place nobody looks or gain them in a place everybody does.',
                },
                {
                    type: 'p',
                    text: `SSIM is closer to how a person compares two pictures, because it looks at local `
                        + `structure rather than at one summed error. The window here is 8x8 and uniform, which `
                        + `is not the Gaussian window the reference implementation uses and not the multi-scale `
                        + `version most papers report, so treat a figure from this table as comparable with the `
                        + `other figures in this table and with nothing else. Rows above 0.99 are all in `
                        + `territory where the two pictures are hard to tell apart at viewing size; the `
                        + `photograph's ${ssim(photoJpeg50)} at 50 KB is not.`,
                },
                {
                    type: 'p',
                    text: 'And the rule that keeps a byte figure honest: a size quoted without a score is half a '
                        + 'sentence, because any encoder can reach 50 KB by throwing the picture away. The '
                        + 'pairing is what carries meaning, which is why the table above never prints one column '
                        + 'without the other.',
                },
            ],
        },
    ],

    relatedTools: [
        {
            slug: 'jpg-to-webp',
            nextJob: 'Run the conversion this guide measured on a photograph of your own, and read the real '
                + 'before and after bytes for your file rather than for a drawn sample.',
        },
        {
            slug: 'png-to-webp',
            nextJob: 'Convert a graphic to WebP with its alpha channel intact, which is the one thing these '
                + 'flattened rows could not measure.',
        },
        {
            slug: 'webp-to-jpg',
            nextJob: 'Go back the other way when the place the picture is going will not open a WebP.',
        },
        {
            slug: 'compress',
            nextJob: 'Type a byte ceiling for your own picture and see the quality the search settles on, '
                + 'measured on that file instead of on this table.',
        },
    ],

    faqs: [
        {
            question: 'Is a WebP always smaller than a JPEG?',
            answer: 'At a fixed byte ceiling neither one is smaller, because both are asked to fit under the same '
                + 'number — what differs is the score they reach at that size. The two go their own ways only '
                + 'when the source is already under the ceiling and nothing is squeezing them: at the 100 KB '
                + `ceiling the graphic came back as ${bytes(graphicWebp100)} of WebP against `
                + `${bytes(graphicJpeg100)} of JPEG, and the illustration as ${bytes(illoWebp100)} against `
                + `${bytes(illoJpeg100)}.`,
        },
        {
            question: 'Why is the quality column empty for most of the WebP rows?',
            answer: 'Because on those rows the quality number decided nothing. WebP is asked for the byte target '
                + 'through libwebp\'s own rate controller, and where that lands under the ceiling the panel prints '
                + 'no quality rather than printing a number the encode ignored. When the controller overshoots, '
                + 'the same bounded quality search JPEG uses takes over and the quality is reported — which is '
                + 'what happened on the graphic at the 50 KB ceiling.',
        },
        {
            question: 'Why did asking for 100 KB make my file bigger?',
            answer: 'The target is a ceiling, not a goal. The search returns the best quality that still fits '
                + 'underneath it, so a file that was already smaller than the number comes back larger and better '
                + `than it went in. That is the whole story of ${GREW_PAST_SOURCE} rows here: the screenshot's `
                + `JPEG went from `
                + `${sourceBytes(shotJpeg100)} to ${bytes(shotJpeg100)} at quality `
                + `${shotJpeg100.output.quality}, because that is the best it could do without breaching 100 KB.`,
        },
        {
            question: 'Can I get a lossless WebP from these tools?',
            answer: 'No. The WebP encoder loaded into these pages takes a quality number and nothing else, so '
                + 'every WebP written here is lossy. For a mark or a screenshot that has to stay pixel-exact, keep '
                + 'the PNG.',
        },
        {
            question: 'Do these numbers describe my own images?',
            answer: 'Only loosely. Four drawn samples on one laptop span four kinds of picture; they are not a '
                + 'sample of what people actually open, and a photograph with less grain or a screenshot at a '
                + 'different scale would move every row. The figure that describes your file is the one the '
                + 'compress panel prints for it, which is measured on your own device with nothing uploaded.',
        },
    ],

    indexable: true,
};

export default jpegVsWebpAtTheSameSize;
