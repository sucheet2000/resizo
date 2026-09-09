/**
 * /png-to-webp — the conversion that shrinks a graphic WITHOUT throwing the
 * alpha channel away, which is the one thing /png-to-jpg cannot do.
 *
 * The honest catch, and the reason this page is not a copy of that one: the
 * converter writes WebP at quality 80, so a PNG going through it is being made
 * lossy. For a photograph that is the point. For crisp artwork it is a trade,
 * and the copy says so.
 */
const pngToWebp = {
    slug: 'png-to-webp',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'png', to: 'webp' },
    label: 'PNG to WebP',
    blurb: 'A transparent graphic that has to get smaller and stay transparent',
    title: 'PNG to WebP — Convert PNG to WebP, Transparency Kept | Resizo',
    h1: 'Convert PNG to WebP',
    intro: 'One PNG in, one WebP out at the same pixel dimensions. The transparency comes with it.',
    description: 'Convert PNG to WebP online free, without uploading anything. The transparency '
        + 'survives, unlike PNG to JPG, and a heavy PNG usually drops to a fraction of its size at the same '
        + 'pixel dimensions. 20 MB per file.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'WebP is how a transparent graphic gets smaller without giving up the transparency: it keeps '
        + 'the alpha channel that a JPG would fill in with black, and it stores the same picture in '
        + 'far fewer bytes than a PNG can. On Resizo the pair is fixed at PNG to WebP — add the PNG, '
        + 'press Convert to WebP, and the same pixels come back see-through where they were '
        + 'see-through. Your own device does the conversion with code the page downloads from this '
        + 'site, so the graphic is never sent anywhere.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Writes a lossy WebP at quality 80, which is where the saving on a heavy PNG actually comes from.',
            'Keeps the alpha channel, so fully clear pixels and the half-clear ones along a soft edge both '
                + 'survive.',
            'Rebuilds the file from the decoded pixels, so what you download is a real WebP rather than a '
                + 'renamed PNG.',
        ],
        doesNot: [
            'Nothing is scaled or cropped, so the WebP arrives at the width and height the PNG already had.',
            'It cannot write a lossless WebP: the encoder in this build takes a quality number and nothing '
                + 'else.',
            'No EXIF or GPS fields travel with it, because the output is built from raw pixels alone.',
        ],
    },

    application: {
        name: 'PNG to WebP Converter',
        features: [
            'Keeps the PNG alpha channel, including partial transparency',
            'Converts on your own device — the file is never uploaded',
            'Writes WebP at quality 80',
            'Keeps the original pixel dimensions',
            'Strips EXIF and GPS metadata from the WebP',
        ],
    },

    howTo: {
        id: 'how-to-png-to-webp',
        heading: 'How to convert a PNG to WebP',
        description: 'Turn a PNG into a smaller WebP with the transparency intact, on your own device.',
        steps: [
            {
                name: 'Choose the PNG on your device',
                text: 'Drop it onto the panel above or press Browse files. The pair is already set, so anything that is '
                    + 'not a PNG is refused at the drop.',
            },
            {
                name: 'Press Convert to WebP',
                text: 'Your device writes a WebP at quality 80 with the alpha channel carried across, so both fully and '
                    + 'partly transparent pixels survive.',
            },
            {
                name: 'Download the WebP',
                text: 'The panel prints both sizes. On a photograph saved as a PNG the drop is usually large; on flat '
                    + 'artwork it is smaller, and quality 80 is a trade worth looking at.',
            },
        ],
    },

    sections: [
        {
            id: 'alpha-survives',
            heading: 'The transparency comes through',
            blocks: [
                {
                    type: 'p',
                    text: 'This is the conversion to use when a PNG is too heavy but the see-through parts have to '
                        + 'stay see-through. WebP carries a full alpha channel, so a cut-out product shot keeps '
                        + 'its clean edge, a logo keeps its empty corners, and the half-transparent pixels along '
                        + 'an anti-aliased curve stay half transparent instead of turning into a fringe.',
                },
                {
                    type: 'p',
                    text: 'It is the whole reason this page exists separately from PNG to JPG. JPEG has no alpha '
                        + 'channel at all: send the same logo there and every transparent pixel comes back black. '
                        + 'If the file has transparency in it and you want it smaller, WebP is the only one of the '
                        + 'two answers that works.',
                },
            ],
        },
        {
            id: 'lossy-trade',
            heading: 'It is lossy, and for artwork that is a trade',
            blocks: [
                {
                    type: 'p',
                    text: 'WebP can be written losslessly or lossily. This converter writes it lossy, at quality '
                        + '80, which is what makes the saving worth having. For a photograph or a detailed '
                        + 'illustration stored as a PNG, that is exactly the right bargain — the file collapses '
                        + 'and nothing visible changes.',
                },
                {
                    type: 'p',
                    text: 'For crisp vector-style artwork it is a real trade rather than a free win. Lossy '
                        + 'compression simplifies detail, and the first place it shows is a one-pixel outline, a '
                        + 'small caption baked into the image, or a hard boundary between two flat colours. Look '
                        + 'at the result at display size before you commit, and keep the PNG if the artwork has to '
                        + 'be pixel-exact.',
                },
            ],
        },
        {
            id: 'how-much',
            heading: 'How much you get back depends on the PNG',
            blocks: [
                {
                    type: 'p',
                    text: 'A photograph that somebody saved as a PNG is the best case by a wide margin. PNG has no '
                        + 'good way to compress photographic detail, so those files are enormous, and the WebP can '
                        + 'easily be a tenth of the size with nothing visibly different.',
                },
                {
                    type: 'p',
                    text: 'A small flat icon is the other extreme: PNG is already efficient on large areas of '
                        + 'identical colour, so there may be very little left to take, and a tiny PNG can even '
                        + 'come back marginally larger. The panel prints both byte counts, so you can see which '
                        + 'case you are in before downloading.',
                },
            ],
        },
        {
            id: 'where-png-wins',
            heading: 'Where the PNG is still the file you need',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Favicons and app icons. The tooling around them expects PNG, and the files are small '
                            + 'enough that the saving would not matter anyway.',
                        'Email. Mail clients handle WebP inconsistently, and an image that does not render is '
                            + 'worse than one that is 20 KB heavier.',
                        'Upload forms and older desktop software that list PNG and JPG and stop there.',
                        'Your working master. Edit in PNG, export WebP for the site, and you never have to '
                            + 're-compress a copy of a copy.',
                    ],
                },
            ],
        },
    ],

    limitations: [
        'One PNG per run, up to 20 MB, and no folder mode on this page — bulk work belongs to the resizer '
            + 'panel.',
        'Quality is fixed at 80 with no slider to raise it, so artwork that needs a gentler setting is better '
            + 'left as the PNG.',
        'A very large PNG needs room for the decoded picture and the encoder at once, and a device short of '
            + 'memory is refused with the reason rather than risking the tab.',
    ],

    faqs: [
        {
            question: 'Does transparency survive the conversion?',
            answer: 'Yes. WebP has a full alpha channel, so both fully transparent pixels and partly transparent '
                + 'ones — the soft edge of a shadow, the anti-aliasing around a letter — come through intact. '
                + 'This is the difference between converting a logo to WebP and converting it to JPG, which has '
                + 'to fill every transparent pixel with a flat colour.',
        },
        {
            question: 'Is the WebP lossless?',
            answer: 'No. WebP can be written either way, and this converter writes it lossy, at quality 80. That '
                + 'is the right choice for anything photographic and a trade for hard-edged artwork. If you need '
                + 'the pixels stored exactly, keep the PNG — it is lossless by definition.',
        },
        {
            question: 'Why did my small PNG barely shrink?',
            answer: 'A flat icon with a handful of colours is already close to as small as it can be: PNG stores '
                + 'that kind of image very efficiently. The saving from WebP grows with the complexity of the '
                + 'picture, so a photograph or a detailed illustration saved as PNG has an enormous amount to '
                + 'gain and a 3 KB glyph has almost none.',
        },
        {
            question: 'Will my logo still look sharp?',
            answer: 'At quality 80 it usually does, but check it at the size you will actually display it. Lossy '
                + 'compression works by simplifying detail, and the hardest edges — one-pixel outlines, small '
                + 'text inside the artwork — are where any softening appears first.',
        },
        {
            question: 'Can I convert it back to PNG?',
            answer: 'Yes, and the transparency comes back with it, but the compression that happened on the way '
                + 'to WebP is baked in and cannot be undone. Keep the original PNG as your master and treat the '
                + 'WebP as the copy you publish.',
        },
        {
            question: 'Can I convert PNG to WebP without uploading the file?',
            answer: 'Yes — this page uploads nothing. The alpha channel never leaves the machine it is on, '
                + 'because neither does anything else: the codecs are downloaded into the page and your PNG is '
                + 'read, converted and saved by your own device. Unreleased artwork, a client logo, a product '
                + 'cut-out that is not public yet — none of it goes anywhere. The WebP carries no EXIF or GPS '
                + 'data.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default pngToWebp;
