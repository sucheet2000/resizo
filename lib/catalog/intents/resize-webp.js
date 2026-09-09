/**
 * /resize-webp — the resizer with WebP-specific copy.
 *
 * No preset: the output format select sits on Same as the original, so a WebP
 * in is a WebP out, and forcing it would only mean that dropping a PNG here
 * quietly converted it. What belongs to this page is the writing, and the one
 * fact neither sibling has to admit — the encoder here writes the lossy kind of
 * WebP at DEFAULT_QUALITY, so a lossless WebP does not come back lossless.
 */
import { formatFileSize } from '@/lib/format/bytes';
import { DEFAULT_QUALITY, MAX_BULK_FILES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';

const resizeWebp = {
    slug: 'resize-webp',
    tool: 'resize',
    kind: 'format',
    preset: null,
    label: 'Resize a WebP',
    blurb: 'An image saved off a web page, at the wrong size for wherever it is going next',
    title: 'Resize WebP Online — Any Width, Still a WebP | Resizo',
    h1: 'Resize a WebP',
    intro: 'Give it a width in pixels, a percentage or a platform size. A WebP goes in and a WebP comes back.',
    description: 'Resize a WebP online free, without uploading it. Set an exact pixel width, scale by '
        + 'percentage or pick a platform size, and your own device does the work. The transparency survives '
        + 'and a WebP stays a WebP.',
    ogImage: '/og-resize.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'Making a WebP smaller means decoding it, redrawing the picture at the size you asked for and '
        + 'writing a new WebP, so what you get back is the right dimensions and one compression pass '
        + 'further along than it started. On Resizo you type the width, add the file and press Resize '
        + `image; the format select stays on Same as the original, so a WebP goes in and a WebP at `
        + `quality ${DEFAULT_QUALITY} comes out. The decoding and the encoding both happen on your own `
        + 'device, on codecs the page brings with it, so the image is never sent anywhere.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Decodes the stored picture, redraws it on the new grid and squeezes it back into a WebP at '
                + `quality ${DEFAULT_QUALITY}.`,
            'Turns a lossless WebP into a lossy one, since the only mode the encoder here has is the lossy one.',
            'Keeps a cut-out subject cut out, because WebP stores its alpha beside the colour data rather '
                + 'than inside it.',
        ],
        doesNot: [
            'Converts nothing into this format — a JPEG or PNG dropped on the panel comes back in the '
                + 'format it arrived in.',
            'Carries no lossless switch to turn on; send the file through [WebP to PNG](/webp-to-png) when '
                + 'the pixels have to stay exact.',
            'Chases no byte figure: the dimensions you type decide the size, so use [the compressor]'
                + '(/compress) when a ceiling is the requirement.',
        ],
    },

    application: {
        name: 'WebP Image Resizer',
        features: [
            'Resize a WebP to an exact width and height in pixels',
            'Scale by percentage, with the two sides locked together',
            `Writes the new file as a WebP at quality ${DEFAULT_QUALITY}`,
            'Resamples the alpha channel, so transparency survives',
            `Batch mode for up to ${MAX_BULK_FILES} files in one pass`,
        ],
    },

    howTo: {
        id: 'how-to-resize-webp',
        heading: 'How to resize a WebP',
        description: 'Set a new width for a WebP and get a WebP back, at a size you choose, on your own device.',
        steps: [
            {
                name: 'Add the file and set a width',
                text: `Drag the .webp onto the panel above, up to ${formatFileSize(MAX_FILE_SIZE)}, then type the `
                    + 'width you want. With the ratio lock on, the height follows by itself. Switch to Percent to '
                    + 'scale by a fraction instead, or take one of the platform sizes and both fields fill in.',
            },
            {
                name: 'Press Resize image',
                text: `The picture is redrawn at the new dimensions and encoded again as a WebP at quality `
                    + `${DEFAULT_QUALITY}. Because the format select is left on Same as the original, the file type `
                    + 'and the extension are unchanged.',
            },
            {
                name: 'Check the numbers and download',
                text: 'The panel prints the dimensions it actually produced next to the size before and after, so '
                    + 'what the second encode cost is a figure you see rather than one you assume.',
            },
        ],
    },

    sections: [
        {
            id: 'second-pass',
            heading: 'Every resize squeezes the picture again',
            blocks: [
                {
                    type: 'p',
                    text: 'A picture has to be taken apart to be made smaller. The stored file becomes pixels '
                        + 'again, those pixels are redrawn on a smaller grid, and the result is squeezed back into '
                        + `a WebP at quality ${DEFAULT_QUALITY}. That last squeeze is the part worth thinking `
                        + 'about, because it is lossy every single time.',
                },
                {
                    type: 'p',
                    text: 'Most WebP files have already had one. WebP is what a site serves, which means somebody '
                        + 'compressed the image before it ever reached you, and the copy you saved becomes a copy '
                        + 'of a copy the moment you resize it. Once is fine and you will not spot it. The habit to '
                        + 'avoid is going round again and again, each pass starting from last week’s output — find '
                        + 'the largest version that exists and take a single step from there.',
                },
            ],
        },
        {
            id: 'lossless-in-lossy-out',
            heading: 'A lossless WebP does not stay lossless',
            blocks: [
                {
                    type: 'p',
                    text: 'WebP has two modes, and this is the one place the difference bites. A file written in '
                        + 'the lossless mode stores its pixels precisely, much as a PNG does. The encoder in this '
                        + `build has a single setting, quality ${DEFAULT_QUALITY}, and it is the lossy one — so a `
                        + 'lossless WebP put through a resize here comes back as a lossy WebP. That is worth '
                        + 'saying plainly rather than leaving you to discover it.',
                },
                {
                    type: 'p',
                    text: 'On a photograph it is a non-event. On flat artwork with hard edges, held as a lossless '
                        + 'master, it is a genuine change, and the answer is to stop treating WebP as the master: '
                        + 'send the file through [WebP to PNG](/webp-to-png) and work from the PNG instead, which '
                        + 'stays exact however many times it is opened.',
                },
            ],
        },
        {
            id: 'the-width-that-matters',
            heading: 'Resize to the width the image is shown at',
            blocks: [
                {
                    type: 'p',
                    text: 'A WebP normally has a next stop in mind, and that stop has a width. An image dropped '
                        + 'into a 720-pixel column has no use for 3000 pixels of picture. A listing photograph is '
                        + 'displayed at whatever the marketplace displays it at. A header image is cut to the '
                        + 'width of the header. Everything above that number is weight a reader pays for and '
                        + 'never sees.',
                },
                {
                    type: 'p',
                    text: 'So the working rule is to match the display width, double it if the image has to stay '
                        + 'crisp on a high-density screen, and stop. The platform sizes in the panel cover the '
                        + 'common social and video frames if you would rather not work the number out, and '
                        + 'choosing one sets both fields at once.',
                },
            ],
        },
        {
            id: 'what-survives',
            heading: 'Transparency survives, and so does the format',
            blocks: [
                {
                    type: 'p',
                    text: 'The alpha channel is resampled alongside the colour, so a WebP with a cut-out subject '
                        + 'comes back still cut out, and the partly transparent pixels along its edge keep their '
                        + 'degree of transparency. WebP stores alpha beside its lossy colour data rather than '
                        + 'inside it, which is why this holds even though the colour is being written afresh.',
                },
                {
                    type: 'p',
                    text: 'The format select above sits on Same as the original, which is what gives you a WebP '
                        + 'back with the extension it arrived with. Overriding it in the same pass is allowed: '
                        + 'JPEG produces a file almost anything will open, at the price of the transparency, and '
                        + 'PNG produces an exact one that will be a good deal heavier. Those two formats have '
                        + 'pages of their own as inputs — [resize a JPG](/resize-jpg) and '
                        + '[resize a PNG](/resize-png).',
                },
            ],
        },
        {
            id: 'batches-and-limits',
            heading: 'Batches, limits and where the work happens',
            blocks: [
                {
                    type: 'p',
                    text: `A batch tab sits beside the single-file one and takes up to ${MAX_BULK_FILES} files at `
                        + 'once, which is the shape this job usually has: a folder of product shots pulled off a '
                        + 'site, every one of them needing the same width. One size covers the set, individual '
                        + 'files can be pinned to a target of their own, and the results arrive as a single '
                        + 'archive.',
                },
                {
                    type: 'p',
                    text: `A single file may be up to ${formatFileSize(MAX_FILE_SIZE)}, and neither side of the `
                        + `finished picture may pass ${MAX_DIMENSION} pixels. The work itself is `
                        + 'done by the browser tab you are reading this in: the file is opened where it already '
                        + 'sits and the new one is written beside it, so there is no transfer at either end and '
                        + 'no second copy of your image anywhere. The output is rebuilt from raw pixels, which is '
                        + 'why it carries no EXIF or GPS data. An image big enough to strain what this device can '
                        + 'spare is refused before it starts, with the reason.',
                },
            ],
        },
    ],

    limitations: [
        'The format select reads Same as the original, so a JPEG or PNG dropped here comes back as a JPEG or '
            + 'PNG — this page keeps a WebP a WebP; it does not turn other files into one.',
    ],

    faqs: [
        {
            question: 'Does resizing a WebP lose quality?',
            answer: 'A little, from two directions. Redrawing the picture on a smaller grid drops pixels on '
                + 'purpose, which is the thing you came here to do. Writing the result out costs a second, '
                + `smaller amount, because this build encodes WebP lossily at quality ${DEFAULT_QUALITY}. `
                + 'Shrinking a photograph hides both fairly well. Start from the largest copy you have and take '
                + 'one step rather than several.',
        },
        {
            question: 'Will the resized WebP still be transparent?',
            answer: 'Yes. The alpha channel is scaled along with everything else, so clear areas stay clear and a '
                + 'soft edge keeps its softness. The one way to lose it is to switch the output to JPEG on the '
                + 'way through: JPEG has nowhere to put transparency, so each see-through pixel is filled with a '
                + 'flat colour instead.',
        },
        {
            question: 'Can I resize a WebP and keep it lossless?',
            answer: 'Not as a WebP. The encoder loaded into this page writes the lossy kind, at quality '
                + `${DEFAULT_QUALITY}, and there is no lossless switch on it to turn on. Where exactness matters `
                + 'more than file size, convert the image to PNG first and resize that: PNG has no lossy mode at '
                + 'all, so it comes through any number of passes unchanged.',
        },
        {
            question: 'Should I resize this WebP or convert it?',
            answer: 'They answer different complaints. Converting changes which software will open the file; '
                + 'resizing changes how many pixels are in it. If the image will not open at all, the format is '
                + 'your problem. If it opens perfectly well but is far bigger than the space it has to fill, or '
                + 'too heavy for the page it is going on, the dimensions are the problem and this is the tool.',
        },
        {
            question: 'Can I resize several WebP files at once?',
            answer: `Yes. The batch tab takes up to ${MAX_BULK_FILES} files, applies one width and height across `
                + 'the whole set — or a pinned size on individual files — and hands back one archive with every '
                + 'before and after figure listed. It is the same engine as the single-file panel, working '
                + 'through the files one after another on this device.',
        },
        {
            question: 'Can I resize a WebP without uploading it?',
            answer: 'There is nowhere for the file to go, so yes. The resizing code arrives as part of the page, '
                + 'and from that point your own machine reads the image, redraws it and saves the new one; '
                + 'nothing about the picture crosses the network. It is useful for images that are not public '
                + 'yet, and it also means the speed depends on this device rather than on how busy anything '
                + 'else is.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default resizeWebp;
