/**
 * /webp-to-png — the escape route that keeps the cut-out.
 *
 * The sibling /webp-to-jpg answers "nothing will open this file". This page
 * answers a narrower question that has one correct format: the WebP has
 * transparent areas, and JPEG would fill them with black. So the copy is built
 * around the alpha channel and around the honest cost of a lossless format —
 * a much heavier file — rather than around compatibility, which the JPG page
 * already covers.
 */
import { formatFileSize } from '@/lib/format/bytes';
import { MAX_FILE_SIZE } from '@/lib/limits';

const webpToPng = {
    slug: 'webp-to-png',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'webp', to: 'png' },
    label: 'WebP to PNG',
    blurb: 'A WebP with a see-through background, headed somewhere that will not take a WebP',
    title: 'WebP to PNG — Convert WebP to PNG With Transparency | Resizo',
    h1: 'Convert WebP to PNG',
    intro: 'One WebP in, one lossless PNG out at the same pixel dimensions, with the see-through parts '
        + 'still see-through.',
    description: 'Convert WebP to PNG online free, without uploading the file. The transparency comes '
        + 'through intact, the PNG is lossless with no quality setting to get wrong, and the pixel dimensions '
        + `are left alone. ${formatFileSize(MAX_FILE_SIZE)} per file, no account.`,
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'PNG is the format to turn a WebP into when part of the picture has to stay see-through and '
        + 'whatever you are handing it to will not accept a WebP at all. On Resizo the converter is '
        + 'fixed at WebP in and PNG out: add the .webp file, press Convert to PNG, and what comes back '
        + 'holds the decoded pixels exactly, alpha channel and all, at the width and height it already '
        + 'had. Both halves run on your own device, on a decoder and an encoder the page downloads from '
        + 'this site, so the file never leaves the machine it is sitting on.',

    application: {
        name: 'WebP to PNG Converter',
        features: [
            'Keeps the alpha channel, including partly transparent pixels',
            'Writes a lossless PNG with no quality dial and no palette reduction',
            'Runs on your own device, so nothing is sent anywhere',
            'Leaves the width and height exactly as they were',
            'Writes the PNG with no EXIF or GPS metadata in it',
        ],
    },

    howTo: {
        id: 'how-to-webp-to-png',
        heading: 'How to convert a WebP to PNG',
        description: 'Turn a WebP into a lossless PNG with its transparency intact, using your own device.',
        steps: [
            {
                name: 'Add the WebP',
                text: `Drag the .webp file onto the panel above, or use the browse button, up to `
                    + `${formatFileSize(MAX_FILE_SIZE)}. Both format boxes are already filled in on this page, and `
                    + 'anything that is not a WebP is turned away before it is read.',
            },
            {
                name: 'Press Convert to PNG',
                text: 'The picture is decoded and those exact pixels are stored in a PNG. The alpha channel travels '
                    + 'with them, so a cut-out arrives still cut out rather than sitting on a black rectangle.',
            },
            {
                name: 'Look at the two byte counts',
                text: 'The panel prints what went in beside what came out. On a photograph the second number is '
                    + 'normally several times the first, which is what exactness costs.',
            },
            {
                name: 'Download the PNG',
                text: 'It arrives at the width and height the WebP had, so nothing further down the line needs '
                    + 're-measuring or re-cropping.',
            },
        ],
    },

    sections: [
        {
            id: 'keep-the-cut-out',
            heading: 'The transparency is the reason to choose PNG',
            blocks: [
                {
                    type: 'p',
                    text: 'One question settles which format you want: is any part of this picture see-through? '
                        + 'Plenty of WebP files have an alpha channel — stickers out of a chat app, a logo lifted '
                        + 'off a site, a product shot with the background already knocked out — and PNG is the '
                        + 'escape format that has one too. Clear pixels arrive clear, and the half-clear pixels '
                        + 'along a soft edge keep the exact amount of transparency they had.',
                },
                {
                    type: 'p',
                    text: 'Take the same file to [WebP to JPG](/webp-to-jpg) and every empty area is filled in with '
                        + 'black instead, because JPEG has nowhere to store it. That page is the right one when the '
                        + 'image is a plain rectangle — a photograph, a screenshot — where the JPG will be a '
                        + 'fraction of the weight and just as widely accepted. See-through, and you want this page. '
                        + 'Solid, and you want that one.',
                },
            ],
        },
        {
            id: 'exact-copy',
            heading: 'A PNG copies the picture. It does not clean it up',
            blocks: [
                {
                    type: 'p',
                    text: 'The encoder loaded into this page is lossless and has no settings at all: no quality '
                        + 'number, no colour reduction, nothing to get wrong. Whatever the WebP decoded to is what '
                        + 'the PNG stores, pixel for pixel. From then on you can open the file and save it as often '
                        + 'as you like and it will not shift.',
                },
                {
                    type: 'p',
                    text: 'Which is a floor, not a repair. Most WebP files on the web were written in the lossy '
                        + 'mode, and the smoothing their encoder applied — softened texture, a gradient stepped '
                        + 'slightly flat — belongs to the picture now and is copied faithfully along with '
                        + 'everything else. A WebP that happened to be written losslessly is the happier case: '
                        + 'there the PNG is a genuine duplicate of the original, in a format far more software '
                        + 'can read.',
                },
            ],
        },
        {
            id: 'weight',
            heading: 'Expect a considerably heavier file',
            blocks: [
                {
                    type: 'p',
                    text: 'WebP is useful because it is small. PNG is useful because it is exact. Trading the first '
                        + 'property for the second is the whole transaction here, and it is not a gentle one: a '
                        + '300 KB WebP photograph can come back well past a megabyte, because photographic texture '
                        + 'is close to random and lossless compression has almost nothing to grip.',
                },
                {
                    type: 'p',
                    text: 'Flat artwork behaves far better. A logo built from a handful of colours, a chart, an '
                        + 'interface screenshot — these are the images PNG was designed around, and the increase is '
                        + 'usually modest. If the weight turns out to be a problem and the destination would have '
                        + 'accepted a WebP after all, the original file is still the better thing to send.',
                },
            ],
        },
        {
            id: 'what-carries-across',
            heading: 'What comes through, and what does not',
            blocks: [
                {
                    type: 'table',
                    caption: 'How each part of the file is treated on the way to PNG',
                    columns: [
                        { key: 'part', label: 'Part of the file', rowHeader: true },
                        { key: 'result', label: 'Result' },
                        { key: 'note', label: 'Notes' },
                    ],
                    rows: [
                        {
                            part: 'Transparency',
                            result: 'Kept',
                            note: 'Fully and partly transparent pixels both survive.',
                        },
                        {
                            part: 'Width and height',
                            result: 'Unchanged',
                            note: 'Nothing is scaled or trimmed on the way through.',
                        },
                        {
                            part: 'Colour',
                            result: 'Exact',
                            note: 'Full colour, with no palette and no quantising.',
                        },
                        {
                            part: 'Compression already applied',
                            result: 'Baked in',
                            note: 'A lossy WebP cannot be un-compressed by copying it.',
                        },
                        {
                            part: 'Animation',
                            result: 'First frame only',
                            note: 'A single still image is written from the opening frame.',
                        },
                        {
                            part: 'EXIF and GPS fields',
                            result: 'Not carried',
                            note: 'The output is rebuilt from raw pixels, so it has none.',
                        },
                    ],
                },
            ],
        },
        {
            id: 'where-png-is-asked-for',
            heading: 'Where a PNG is what you are asked for',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Design tools and slide decks, where a mark has to sit on a coloured background rather '
                            + 'than inside a white box.',
                        'Storefront and marketplace listings that want the product floating on a clear '
                            + 'background, and take PNG or JPG and nothing else.',
                        'Icon and favicon tooling, which is written almost entirely around PNG.',
                        'Forms and document uploads whose accepted-formats line names PNG, with WebP absent '
                            + 'from it.',
                        'Anything you are about to edit. Starting from an exact file means one lossy step at '
                            + 'the very end rather than one on every save.',
                    ],
                },
            ],
        },
    ],

    limitations: [],

    faqs: [
        {
            question: 'Does a transparent background survive the conversion?',
            answer: 'Yes, and so does everything in between. PNG carries a full alpha channel, so a pixel that was '
                + 'completely clear in the WebP is completely clear in the PNG, and the partly clear pixels around '
                + 'a soft shadow or an anti-aliased curve hold their exact degree of transparency. That is the '
                + 'whole reason to send a cut-out here rather than to the JPG page.',
        },
        {
            question: 'Why is the PNG so much larger than the WebP?',
            answer: 'The two formats are built for opposite jobs. WebP discards detail in order to get small; PNG '
                + 'writes down every pixel of whatever is left, texture and all. For a photograph a fivefold '
                + 'increase is unremarkable. For flat artwork the gap is much narrower, because large areas of a '
                + 'single colour are exactly what PNG compresses well.',
        },
        {
            question: 'Will converting to PNG make the image look better?',
            answer: 'No, and nothing downstream can. If the WebP was written lossily, the softening happened when '
                + 'that file was made and there is no record of what used to be there. What you do gain is a '
                + 'stopping point: from the PNG onwards, opening the file and saving it again costs nothing at all.',
        },
        {
            question: 'What happens to an animated WebP?',
            answer: 'You get the opening frame and nothing after it. The PNG written here is a single still image, '
                + 'so the first frame becomes the file and the rest of the sequence stays behind in the original. '
                + 'Hold on to the WebP if the movement is the part that mattered.',
        },
        {
            question: 'Should I convert my WebP to PNG or to JPG?',
            answer: 'Check for transparency first, because it decides the answer on its own. If any part of the '
                + 'image needs to be see-through, PNG is the only one of the two that can hold it and you are on '
                + 'the right page. If the image is a solid rectangle and the file size matters, JPG is the better '
                + 'choice: much lighter, equally well accepted, and nothing is lost that the picture had.',
        },
        {
            question: 'Can I convert WebP to PNG without uploading the file?',
            answer: 'Yes, because there is nowhere for it to be sent. The WebP decoder and the PNG encoder are '
                + 'ordinary code the page fetches from this site, and once they have loaded, your own device reads '
                + 'the file, converts it and writes the result. That is worth having here in particular: a cut-out '
                + 'that is not public yet, a client mark, artwork still under wraps — none of it travels. The PNG '
                + 'that comes out carries no EXIF or GPS data either.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default webpToPng;
