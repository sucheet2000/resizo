/**
 * /webp-to-jpg — the rescue route.
 *
 * Nobody chooses a WebP; they save an image off a web page and end up with one.
 * So the copy answers the question actually being asked ("why will this file
 * not open") rather than selling a format, and it is honest that this is the
 * one common conversion where the file usually gets BIGGER.
 */
const webpToJpg = {
    slug: 'webp-to-jpg',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'webp', to: 'jpeg' },
    label: 'WebP to JPG',
    blurb: 'You saved an image from a web page and now nothing on your computer will open it',
    title: 'WebP to JPG — Convert WebP Images to JPG Free | Resizo',
    h1: 'Convert WebP to JPG',
    intro: 'One WebP in, one JPG out at the same pixel dimensions — a file the rest of your software will open.',
    description: 'Convert WebP to JPG online free, without uploading the file. Turn an image saved from '
        + 'a web page into a JPG that photo editors, print shops, documents and upload forms will actually open. '
        + '20 MB per file, no account.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A WebP saved from a web page is refused by a lot of desktop software and older phones, and '
        + 'converting it to JPG hands you the same picture, at the same size, in the one format '
        + 'everything opens. On Resizo the pair is already set to WebP to JPEG: add the .webp file, '
        + 'press Convert to JPEG, and save the .jpg that comes back. The reading and the writing are '
        + 'both done in your browser by your own device, on codecs the page brings with it, so the '
        + 'image goes nowhere.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Decodes the WebP and re-encodes those pixels as JPEG at quality 80, a second lossy generation '
                + 'for most files.',
            'Fills in every transparent area before the JPEG is written, on the black or white you choose '
                + 'in the panel.',
            'Hands back a file older editors, print counters and upload forms will open, usually at a '
                + 'larger byte count.',
        ],
        doesNot: [
            'Nothing is resized: the JPG keeps the pixel dimensions the WebP had.',
            'An animated WebP loses everything after the opening frame, because a JPEG holds one still image.',
            'No alpha channel survives, so a cut-out arrives sitting on a solid rectangle.',
        ],
    },

    application: {
        name: 'WebP to JPG Converter',
        features: [
            'Converts WebP to JPG at quality 80',
            'Converts on your own device — the file is never uploaded',
            'Keeps the original pixel dimensions',
            'Accepts both lossy and lossless WebP files',
            'Strips EXIF and GPS metadata from the JPG',
        ],
    },

    howTo: {
        id: 'how-to-webp-to-jpg',
        heading: 'How to convert a WebP to JPG',
        description: 'Turn a WebP saved off a web page into a JPG that other software will open, on your own '
            + 'device.',
        steps: [
            {
                name: 'Choose the WebP on your device',
                text: 'Drop it onto the panel above or press Browse files. The pair is already set, so a file that is '
                    + 'not a WebP is refused at the drop.',
            },
            {
                name: 'Press Convert to JPEG',
                text: 'Your device decodes the WebP and writes a JPG at quality 80, at the same pixel dimensions. Any '
                    + 'transparency is flattened onto black, and an animation keeps only its first frame.',
            },
            {
                name: 'Download the JPG',
                text: 'It will usually be bigger than the WebP was, which is the price of a format that opens '
                    + 'everywhere. The panel prints both sizes.',
            },
        ],
    },

    sections: [
        {
            id: 'why-you-have-one',
            heading: 'Why you ended up with a WebP',
            blocks: [
                {
                    type: 'p',
                    text: 'Almost nobody sets out to make one. You right-clicked an image on a web page and saved '
                        + 'it, and the browser wrote out whatever the site had served — which, on most modern '
                        + 'sites, is WebP. The same thing happens with stickers out of chat apps and with images '
                        + 'pulled from a content system that converts everything on upload.',
                },
                {
                    type: 'p',
                    text: 'So the file is fine. It is a normal image, at normal dimensions, and it displays '
                        + 'perfectly in the browser you saved it from. It simply is not the format the rest of '
                        + 'your software expects.',
                },
            ],
        },
        {
            id: 'what-refuses-it',
            heading: 'What tends to refuse a WebP',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Photo editors older than a few years. Photoshop only gained WebP support in 2022, '
                            + 'and many smaller editors still have none.',
                        'Print. Photo labs, kiosk machines and print shop drop boxes are conservative about '
                            + 'what they accept, and WebP is rarely on the list.',
                        'Documents and slide decks, especially ones that will be opened by someone else on '
                            + 'an older machine.',
                        'Upload forms — applications, marketplaces, portals. JPG and PNG, and that is the '
                            + 'whole list on most of them.',
                        'Older phones and their gallery apps, which sometimes show the thumbnail and then '
                            + 'fail to open the file.',
                    ],
                },
            ],
        },
        {
            id: 'expect-bigger',
            heading: 'Expect the JPG to be bigger',
            blocks: [
                {
                    type: 'p',
                    text: 'This conversion runs against the usual direction. WebP is the more efficient of the two '
                        + 'formats, so unwinding it into a JPEG costs bytes rather than saving them — a 300 KB '
                        + 'WebP might come back as 400 or 500 KB. Nothing has gone wrong; you are buying '
                        + 'compatibility with file size.',
                },
                {
                    type: 'p',
                    text: 'If the destination has a size cap as well as a format requirement, convert first and '
                        + 'then compress the JPG to a byte target. Doing it in that order means the compressor is '
                        + 'working on the file you are actually going to submit.',
                },
            ],
        },
        {
            id: 'alpha-and-animation',
            heading: 'Transparency and animation do not come across',
            blocks: [
                {
                    type: 'p',
                    text: 'A WebP can hold an alpha channel and JPEG cannot, so any transparent area is filled in '
                        + 'on the way out, with black. When the transparency is the point — a logo, a cut-out — '
                        + 'convert to PNG instead. PNG output is lossless and keeps the alpha channel untouched.',
                },
                {
                    type: 'p',
                    text: 'A WebP can also hold an animation. JPEG cannot, so the conversion takes the first frame '
                        + 'and writes that as a single still image. Everything after that frame is left behind.',
                },
            ],
        },
    ],

    limitations: [
        'The panel takes a single file at a time and turns away anything past 20 MB before it is read.',
        'There is no way to export the frames of an animated WebP here; only the opening one reaches the JPG, '
            + 'and the rest stay in the source file.',
        'Quality is fixed at 80 and no byte target can be set, so a JPG that has to fit a size cap needs a '
            + 'pass through the compressor afterwards.',
    ],

    faqs: [
        {
            question: 'Why will my WebP file not open?',
            answer: 'Because WebP was designed for web pages, and support outside a browser is patchy. Photoshop '
                + 'only added it in 2022, plenty of older photo viewers and editors have never had it, print '
                + 'shops and document software frequently reject it, and a lot of upload forms accept JPG and PNG '
                + 'and nothing else.',
        },
        {
            question: 'Will the JPG be smaller than the WebP?',
            answer: 'Almost certainly not. WebP is the more efficient format, so going the other way costs you '
                + 'bytes — expect the JPG to be somewhat larger for the same picture. You are paying that in '
                + 'exchange for a file that opens everywhere, which is usually the whole point of the conversion.',
        },
        {
            question: 'Does converting lose quality?',
            answer: 'A little. Most WebP files on the web are already lossy, so writing a JPG adds a second '
                + 'generation, here at quality 80. At normal viewing size it is hard to see. If the WebP happened '
                + 'to be a lossless one, the JPG is the first lossy step it has taken.',
        },
        {
            question: 'My WebP has a transparent background — what happens to it?',
            answer: 'JPEG has no alpha channel, so the transparent areas are filled with black. If you need the '
                + 'transparency, convert to PNG instead on the main converter page: PNG output is lossless and '
                + 'keeps the alpha channel exactly as it was.',
        },
        {
            question: 'Can I convert an animated WebP?',
            answer: 'Only the first frame. JPEG cannot hold an animation, and the converter takes the still image '
                + 'and writes that. If the movement is the thing you wanted to keep, you need a tool that outputs '
                + 'an animated format rather than a still one.',
        },
        {
            question: 'Can I convert WebP to JPG without uploading the file?',
            answer: 'Yes — this page uploads nothing. The WebP decoder and the JPEG encoder are downloaded into '
                + 'the page and run there, so the file is read, converted and saved by your own device. That is '
                + 'a fair thing to want here: you are usually converting a WebP precisely so you can hand it to '
                + 'a print shop or a form, and it should be your choice when it first travels anywhere. The JPG '
                + 'carries no EXIF or GPS data.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },
    sources: [],
    lastModified: '2026-08-12',
    indexable: true,
};

export default webpToJpg;
