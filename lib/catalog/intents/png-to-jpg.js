/**
 * /png-to-jpg — the busiest of the pair routes.
 *
 * The pair is locked in the converter, so the drop zone rejects anything that
 * is not a PNG at the point of drop, before any work starts. The copy is
 * about this one conversion: why the JPG is so much smaller, what happens to
 * the alpha channel, and when the PNG is the file you should be keeping.
 */
const pngToJpg = {
    slug: 'png-to-jpg',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'png', to: 'jpeg' },
    label: 'PNG to JPG',
    blurb: 'A photograph saved as a PNG, many times heavier than it needs to be',
    title: 'PNG to JPG — Convert PNG Images to JPG Free | Resizo',
    h1: 'Convert PNG to JPG',
    intro: 'One PNG in, one JPG out at the same pixel dimensions. Transparent areas are filled with black, or a colour you choose.',
    description: 'Convert PNG to JPG online free, without uploading the file. A photograph saved as a '
        + 'PNG usually drops to a fraction of its size as a JPG, at the same pixel dimensions. 20 MB per file, '
        + 'no account, no watermark.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A photograph saved as a PNG stores every pixel exactly and is many times heavier than it '
        + 'needs to be; turning it into a JPG keeps the same picture at the same dimensions but stores '
        + 'it with compression built for photographs, usually for a fraction of the bytes. On Resizo '
        + 'the pair is already fixed at PNG to JPEG, so you add the PNG and press Convert to JPEG. '
        + 'Anything transparent is filled in, because a JPG has no transparency to keep — black by '
        + 'default, or white or a colour you pick. The whole conversion is done by your own device on '
        + 'codecs the page downloads, so the file never leaves it.',

    application: {
        name: 'PNG to JPG Converter',
        features: [
            'Converts PNG to JPG at quality 80',
            'Keeps the original pixel dimensions',
            'Rejects anything that is not a PNG the moment it is dropped',
            'Converts on your own device — the file is never uploaded',
            'Strips EXIF and GPS metadata from the JPG',
        ],
    },

    howTo: {
        id: 'how-to-png-to-jpg',
        heading: 'How to convert a PNG to JPG',
        description: 'Turn a PNG into a JPG at the same pixel dimensions, on your own device.',
        steps: [
            {
                name: 'Choose the PNG on your device',
                text: 'Drop it onto the panel above or press Browse files. The pair is already set, so anything that is '
                    + 'not a PNG is refused at the drop rather than after the work has started.',
            },
            {
                name: 'Press Convert to JPEG',
                text: 'Your device decodes the PNG and writes a JPG at quality 80, at the same pixel dimensions. '
                    + 'Transparent areas are filled with the colour set above the button — black unless you '
                    + 'change it — because JPEG has no alpha channel to put them in.',
            },
            {
                name: 'Download the JPG',
                text: 'The panel shows the new size next to the old one, which on a photograph is usually the whole '
                    + 'point of the conversion.',
            },
        ],
    },

    sections: [
        {
            id: 'why-smaller',
            heading: 'Why the JPG comes out so much smaller',
            blocks: [
                {
                    type: 'p',
                    text: 'PNG is lossless. It stores every pixel exactly as it was and shrinks the file by '
                        + 'spotting repetition — runs of identical colour, rows that look like the row above. A '
                        + 'screenshot of a spreadsheet is full of that. A photograph has almost none of it, so a '
                        + 'photo saved as a PNG is close to storing the raw pixels.',
                },
                {
                    type: 'p',
                    text: 'JPEG works the other way round. It throws away the detail your eye tracks least '
                        + 'closely, which is exactly the fine random variation a photograph is made of. That is '
                        + 'why the same picture can go from above 20 MB to under 2 MB with no visible change at '
                        + 'normal viewing size.',
                },
            ],
        },
        {
            id: 'transparency',
            heading: 'Transparency becomes black',
            blocks: [
                {
                    type: 'p',
                    text: 'This is the one thing to check before you convert. A PNG can carry an alpha channel — '
                        + 'the per-pixel record of what is see-through. JPEG has no such channel and no way to '
                        + 'represent it, so the transparency has to be filled in with something, and here that '
                        + 'something is black.',
                },
                {
                    type: 'p',
                    text: 'For a photograph it makes no difference: there is nothing transparent to fill. For a '
                        + 'logo, an icon or a product cut-out it is the wrong conversion entirely — you get your '
                        + 'artwork sitting on a black rectangle. Send those to WebP instead, which keeps the alpha '
                        + 'channel and still lands well under the PNG.',
                },
            ],
        },
        {
            id: 'keep-the-png',
            heading: 'When you should keep the PNG',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Screenshots with text in them. JPEG smears the sharp black-on-white edges of '
                            + 'letterforms, and small type is where it shows first.',
                        'Logos, icons, charts and anything drawn rather than photographed. Flat areas of '
                            + 'colour pick up faint blotches around the edges.',
                        'Files you will open, edit and save again. Every JPEG save is another lossy '
                            + 'generation, and the damage accumulates. PNG can be re-saved forever.',
                        'Pixel art and anything where individual pixels are the point. JPEG is built on '
                            + '8-pixel blocks and will blur them together.',
                    ],
                },
            ],
        },
        {
            id: 'what-happens',
            heading: 'What the conversion actually does',
            blocks: [
                {
                    type: 'p',
                    text: 'The PNG is decoded back to raw pixels and written out again as a JPEG at quality 80 — '
                        + 'the setting most of the web uses as its default. Width and height are untouched, so a '
                        + '1920×1080 PNG is a 1920×1080 JPG. Nothing is cropped, scaled or rotated.',
                },
                {
                    type: 'p',
                    text: 'The download keeps the original name inside a Resizo prefix, so logo.png comes back '
                        + 'as resizo-converted-logo.jpg. EXIF and GPS metadata are absent from the JPG, and the '
                        + 'whole thing happens on your own device: the file is read, converted and saved where '
                        + 'it already was, and none of it is transmitted.',
                },
            ],
        },
    ],

    limitations: [],

    faqs: [
        {
            question: 'Does converting PNG to JPG lose quality?',
            answer: 'It adds one generation of lossy compression, written here at quality 80. On a photograph '
                + 'that is very hard to see at normal viewing size. On a screenshot full of small text, or a flat '
                + 'graphic with hard edges, it is much easier to spot — those are the files worth keeping as PNG.',
        },
        {
            question: 'Why did my transparent background turn black?',
            answer: 'JPEG has no alpha channel, so transparency cannot survive the conversion. Every transparent '
                + 'pixel has to be filled in, and the fill is black unless you say otherwise — the '
                + '“Transparent areas become” control above the button switches it to white or any colour '
                + 'you choose, which is usually what a logo on a white page wants. If the transparency itself '
                + 'matters, convert the PNG to WebP instead, which keeps the alpha channel and is still smaller '
                + 'than the PNG.',
        },
        {
            question: 'How much smaller will the JPG be?',
            answer: 'It depends entirely on the picture. A 12-megapixel photograph saved as a PNG can sit above '
                + '20 MB and usually comes back under 2 MB as a JPG. A flat graphic with a handful of colours is '
                + 'the opposite case: PNG already stores it efficiently, and the JPG can come out no smaller, or '
                + 'even slightly larger.',
        },
        {
            question: 'Can I convert the JPG back to PNG afterwards?',
            answer: 'You can, and the file will be a valid PNG, but it will not undo anything. The detail JPEG '
                + 'discarded is gone, and the PNG faithfully stores the compressed result — usually at several '
                + 'times the size. Keep the original PNG if you might need it again.',
        },
        {
            question: 'What are the limits?',
            answer: 'One PNG per pass, up to 20 MB, and 8000 pixels on the longest side. The pixel dimensions are '
                + 'never changed by this tool — if you also need the image smaller on screen, resize it first and '
                + 'then convert.',
        },
        {
            question: 'Can I convert PNG to JPG without uploading the file?',
            answer: 'Yes — this page uploads nothing. The PNG decoder and the JPEG encoder are downloaded into '
                + 'the tab as code the first time you use it, and from then on your file is read, converted and '
                + 'saved by your own machine. PNGs are very often screenshots, which is exactly the kind of file '
                + 'you would rather not hand to a stranger, and this one goes nowhere. The JPG is written from '
                + 'raw pixels and carries no EXIF or GPS data.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },
    sources: [],
    lastModified: '2026-08-14',
    indexable: true,
};

export default pngToJpg;
