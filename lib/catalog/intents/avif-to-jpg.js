/**
 * /avif-to-jpg — the file the browser reads and nothing else will.
 *
 * AVIF arrives from the far end of the pipe. Nobody exports one on purpose:
 * a site negotiated it, the browser accepted it, and a right-click left the
 * visitor holding a container their own software has never heard of. So the
 * page answers "why will this not open" rather than selling a format, and it
 * is honest about the one thing that makes this conversion unusual — the JPG
 * comes back heavier, because AVIF is the more efficient format by a wide
 * margin and unwinding it costs bytes.
 *
 * The decoder here is the BROWSER'S. This build ships no AVIF decoder of its
 * own (see docs/rfc/avif-codec-review-2026-09-11.md), which is why the page
 * carries a browser requirement no other conversion page has, cited to MDN
 * rather than asserted. The sibling /avif-to-png is about keeping a
 * transparent background and an exact copy; this one is about a file that
 * opens everywhere.
 */
const avifToJpg = {
    slug: 'avif-to-jpg',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'avif', to: 'jpeg' },
    label: 'AVIF to JPG',
    blurb: 'A picture saved off a modern web page that your editor, your print shop or a form will not open',
    title: 'AVIF to JPG — Convert AVIF Images to JPG Free | Resizo',
    h1: 'Convert AVIF to JPG',
    intro: 'The AVIF decoder is already inside the browser you are reading this in. It opens the file here and '
        + 'writes a .jpg of the same picture at the same width and height.',
    description: 'Convert AVIF to JPG online free, without uploading the file. Your browser opens the .avif and '
        + 'writes a .jpg of the same picture at the same pixel dimensions, with no account and no watermark.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'An .avif is what a modern website serves a modern browser, so saving a picture off a page now '
        + 'often leaves you holding a file your own software will not open. The conversion to JPG swaps the '
        + 'container and leaves the picture alone: the same frame, the same width and height, in the format '
        + 'every editor, print counter and web form already reads. Resizo fixes the pair at AVIF to JPEG, so '
        + 'you add the file and press one button — the browser\'s own AVIF decoder reads it, and the JPEG '
        + 'encoder, a WebAssembly module the page downloads, writes it, both on your own device. What does '
        + 'not come across is everything around the picture: no capture fields, no colour profile, and a '
        + '10-bit source lands as an ordinary 8-bit JPG.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Decodes the .avif with the browser\'s own decoder and writes those pixels as JPEG at quality 80.',
            'Flattens any see-through area onto white, or onto the colour set beside the button, before the '
                + 'JPEG is written.',
            'Hands back 8-bit sRGB samples, so a 10- or 12-bit source arrives at the depth every JPEG has.',
        ],
        doesNot: [
            'Nothing is resampled: the JPG carries the width and height the AVIF recorded.',
            'Nothing stored around the picture travels — no capture fields, no colour profile, no print '
                + 'resolution.',
            'An animated AVIF is turned away before any decoding starts, so no single frame is quietly kept.',
        ],
    },

    application: {
        name: 'AVIF to JPG Converter',
        features: [
            'Converts AVIF to JPG at quality 80',
            'Reads the file with the browser\'s own decoder, on your own device',
            'Keeps the pixel dimensions the AVIF recorded',
            'Fills see-through areas with a background colour you choose',
            'Writes 8-bit sRGB pixels with no EXIF, GPS or colour profile',
        ],
    },

    howTo: {
        id: 'how-to-avif-to-jpg',
        heading: 'How to convert an AVIF to JPG',
        description: 'Turn a .avif saved from a web page into a .jpg other software will open, using the decoder '
            + 'your browser already has.',
        steps: [
            {
                name: 'Add the .avif file',
                text: 'Drop it on the panel above or press Browse files. The pair is fixed, so the panel takes '
                    + 'AVIF and turns away anything else at the moment it is chosen.',
            },
            {
                name: 'Pick what sits behind the see-through parts',
                text: 'JPEG has no alpha channel, so anything transparent has to land on something. White is '
                    + 'the default; black and a colour picker sit beside it for the files where white is wrong.',
            },
            {
                name: 'Press Convert to JPEG',
                text: 'Your browser decodes the picture and the JPEG encoder the page downloaded writes it at '
                    + 'quality 80. Both halves run here, in this tab, on the machine in front of you.',
            },
            {
                name: 'Download the .jpg and read the weight',
                text: 'It will almost certainly be heavier than the file that went in. The panel prints both '
                    + 'figures side by side so the jump is not a surprise later.',
            },
        ],
    },

    sections: [
        {
            id: 'where-it-came-from',
            heading: 'Where a .avif on your computer came from',
            blocks: [
                {
                    type: 'p',
                    text: 'Almost nobody sets out to make one. A site offers AVIF to a browser that says it can '
                        + 'read AVIF, you right-click a picture and save it, and what lands in your downloads '
                        + 'folder is whatever was served. Image delivery networks do this per visitor, from a '
                        + 'single URL, so the format you end up with was decided by a negotiation between two '
                        + 'machines rather than by anyone who published the page.',
                },
                {
                    type: 'p',
                    text: 'Other routes lead to the same place. A few phones write AVIF screenshots, design tools '
                        + 'have started offering it in their export menus, and a content system that rewrites '
                        + 'everything on ingest will hand one back to the person who supplied a JPEG. However it '
                        + 'got there, the file is not broken: it is an ordinary picture at ordinary dimensions '
                        + 'that displays perfectly in the browser it arrived through.',
                },
            ],
        },
        {
            id: 'what-refuses-it',
            heading: 'What still refuses to open one',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Desktop photo editors. Support is arriving, but a copy more than a couple of years old '
                            + 'will not have it, and several of the smaller editors have none at all.',
                        'Print. Photo labs, kiosk machines and the counter at a print shop accept a short, '
                            + 'conservative list of formats, and this one is rarely on it.',
                        'Upload forms — job applications, marketplaces, government portals. Most name JPG and PNG '
                            + 'and stop there, and the error they give is usually no help.',
                        'Documents and slide decks that somebody else will open on an older machine, where the '
                            + 'picture turns into an empty placeholder rather than an error.',
                        'Older operating systems and their file managers. A folder full of files with no '
                            + 'thumbnails is normally the first sign of what you are holding.',
                    ],
                },
            ],
        },
        {
            id: 'what-the-jpg-holds',
            heading: 'What the JPG holds, and what it drops',
            blocks: [
                {
                    type: 'p',
                    text: 'The browser hands its decoder\'s output over as plain 8-bit sRGB samples and the JPEG '
                        + 'encoder writes those. That is the whole transaction, and it settles every question '
                        + 'below before the button is even pressed.',
                },
                {
                    type: 'ul',
                    items: [
                        'Depth. AVIF can hold 10 or 12 bits a channel. The decode returns 8, which is all a JPEG '
                            + 'could have stored in any case, so nothing is lost twice.',
                        'Colour. A wide-gamut or HDR picture is normalised to ordinary sRGB by the browser before '
                            + 'this page sees a pixel, so the .jpg matches what was on your screen rather than '
                            + 'what the master held.',
                        'Metadata. Nothing that sat around the picture survives: no capture date, no camera, no '
                            + 'coordinates, no XMP packet, no embedded profile, no print resolution.',
                        'Transparency. JPEG has no alpha channel, so see-through pixels are filled in first. When '
                            + 'that is the part you needed, take [AVIF to PNG](/avif-to-png) instead.',
                    ],
                },
            ],
        },
        {
            id: 'expect-it-heavier',
            heading: 'Expect the .jpg to be heavier',
            blocks: [
                {
                    type: 'p',
                    text: 'This conversion runs against the grain. AVIF exists because it beats JPEG at the same '
                        + 'visible quality, so undoing it spends bytes rather than saving them, and a file '
                        + 'arriving several times heavier than the one that went in is the ordinary outcome '
                        + 'rather than a fault. The gap widens with the size of the picture.',
                },
                {
                    type: 'p',
                    text: 'What you are buying with those bytes is somewhere to use the file. If the destination '
                        + 'caps the weight as well as naming the format, convert here first and then take the '
                        + '.jpg through the [compressor](/compress), so the size search is run against the file '
                        + 'you are actually going to hand over rather than against the one before it.',
                },
            ],
        },
        {
            id: 'browser-requirement',
            heading: 'This page needs a browser that reads AVIF',
            blocks: [
                {
                    type: 'p',
                    text: 'No AVIF decoder ships in this site\'s code, and that is a decision rather than an '
                        + 'omission: a WebAssembly one is a heavy download that does a worse job than the '
                        + 'decoder already installed a few millimetres away. The conversion therefore works '
                        + 'exactly where your browser does, and nowhere else.',
                },
                {
                    type: 'p',
                    text: 'By [MDN\'s image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types), '
                        + 'that means Chrome from version 85, Firefox from 93, and Safari 16 — which ships with '
                        + 'the operating system, so iOS 16 or macOS Ventura and later. Anything older is told '
                        + 'plainly in the panel that it cannot read the file, rather than being left to fail '
                        + 'halfway through.',
                },
            ],
        },
    ],

    limitations: [
        'One file per run, up to 20 MB, and no batch mode: the [bulk converter](/bulk-image-converter) works '
            + 'on JPG, PNG and WebP, so a folder of these comes through here one at a time.',
        'Quality is fixed at 80 and no byte target can be set here, so a .jpg that has to fit a size ceiling '
            + 'needs a pass through the [compressor](/compress) afterwards.',
        'An animated AVIF is refused outright. Nothing on this site exports its frames, and taking the first '
            + 'one without being asked would be a substitution rather than a conversion.',
        'A browser with no AVIF support of its own cannot be helped from here, because the decoder belongs to '
            + 'the browser rather than to this page.',
    ],

    faqs: [
        {
            question: 'Why will nothing open my .avif file?',
            answer: 'Because support outside a web browser is still thin. The format is young next to the ones '
                + 'your software grew up on, and the places most likely to refuse it — an older photo editor, a '
                + 'print counter, a form somebody built years ago — are exactly the places that update slowly. '
                + 'The picture inside is perfectly ordinary; the wrapper is what nothing recognises.',
        },
        {
            question: 'Will the JPG be smaller than the AVIF?',
            answer: 'Almost certainly not, and the gap is usually wide. The whole point of the newer format is '
                + 'to beat JPEG at the same visible quality, so travelling backwards costs bytes — that is the '
                + 'trade for a file that opens everywhere. When the weight matters as much as the format, '
                + 'convert here and then bring the result under a ceiling in the [compressor](/compress).',
        },
        {
            question: 'Does converting lose quality?',
            answer: 'A little, in the way every re-encode does. The source was already lossy and writing a JPEG '
                + 'at quality 80 lays a second generation over the first, which at normal viewing size is hard '
                + 'to see. The more noticeable change is depth: a 10-bit picture with a smooth sky in it can '
                + 'show faint banding once it has been reduced to 8-bit.',
        },
        {
            question: 'My AVIF has a transparent background — what happens to it?',
            answer: 'It is filled in, because JPEG has no alpha channel to put it in. White is the default and '
                + 'the control beside the button holds black and a colour picker for the files where white is '
                + 'wrong. When the transparency is the reason you have the file at all, take the '
                + '[AVIF to PNG](/avif-to-png) route instead: that output is written losslessly and the alpha '
                + 'channel arrives intact.',
        },
        {
            question: 'Can I convert an animated AVIF?',
            answer: 'No. A file carrying a sequence is recognised from the brand in its header and turned away '
                + 'before anything is decoded, instead of being quietly reduced to one still frame you never '
                + 'asked for. If the movement is the thing worth keeping, this is the wrong tool and no setting '
                + 'on the page changes that.',
        },
        {
            question: 'Does the picture leave my computer?',
            answer: 'No. Your browser already contains the AVIF decoder, and the JPEG encoder is a WebAssembly '
                + 'module the page downloads into the same tab, so both halves of the work happen on your own '
                + 'device. That matters more here than on most pages: a picture saved off a web page is '
                + 'frequently somebody else\'s, and where it travels next should be a decision you make.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },

    /**
     * The browser-support claim is the one thing on this page that is not a
     * fact about the build, so it carries the document it came from and the
     * day it was read. The AVIF specification is cited for the animation and
     * bit-depth facts the copy states above.
     */
    sources: [
        {
            title: 'Image file type and format guide',
            publisher: 'MDN Web Docs',
            url: 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types',
            verifiedAt: '2026-09-11',
        },
        {
            title: 'AV1 Image File Format (AVIF)',
            publisher: 'Alliance for Open Media',
            url: 'https://aomediacodec.github.io/av1-avif/',
            verifiedAt: '2026-09-11',
        },
    ],
    lastModified: '2026-09-11',
    indexable: true,
};

export default avifToJpg;
