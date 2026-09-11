/**
 * /avif-to-png — the alpha channel, and a copy nothing has compressed twice.
 *
 * The sibling /avif-to-jpg is about a file everything opens. This one exists
 * for the files where the see-through background IS the picture: a logo, an
 * icon, a sticker, a cut-out that a delivery network happened to serve as
 * AVIF. PNG is the output that copies that channel across untouched and
 * applies no quality figure to anything.
 *
 * The honest cost is weight rather than fidelity, so most of the page is about
 * that and about the one qualifier "lossless" needs here: the PNG is an exact
 * record of what the BROWSER'S decoder produced, which is 8-bit sRGB whatever
 * the source stored. See docs/rfc/avif-codec-review-2026-09-11.md — the decode
 * is native, this build ships no AVIF decoder of its own, and both facts are
 * why the browser requirement is stated rather than assumed.
 */
const avifToPng = {
    slug: 'avif-to-png',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'avif', to: 'png' },
    label: 'AVIF to PNG',
    blurb: 'A cut-out or a graphic saved as .avif that has to reach a design tool with its background still see-through',
    title: 'AVIF to PNG — Convert AVIF to Lossless PNG with Transparency | Resizo',
    h1: 'Convert AVIF to PNG',
    intro: 'A .avif decoded once by your browser and stored exactly as a .png, with a see-through background '
        + 'still see-through.',
    description: 'Convert AVIF to PNG online free, without uploading the file. Your browser decodes the .avif and '
        + 'stores every pixel losslessly as a .png, keeping the transparent background, at full size.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A PNG built from an AVIF stores the decoded picture exactly — no quality dial, no second round of '
        + 'lossy compression — and a see-through background stays see-through. That is what a design tool, an '
        + 'icon pipeline or a form naming PNG is actually asking for, and it is the reason to take this route '
        + 'rather than the lighter JPG. Resizo pins the pair at AVIF to PNG, so you add the file and press one '
        + 'button: the decoder already inside your browser reads it and hands the samples to a WebAssembly PNG '
        + 'encoder the page downloads, both running on your own device. The price is weight and a little time, '
        + 'and the colour arrives as 8-bit sRGB whatever the source held.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Stores the decoded frame losslessly, at the width and height the AVIF recorded.',
            'Copies the alpha channel across as the decoder produced it, so a cut-out stays a cut-out.',
            'Writes 8-bit sRGB samples, which is where a 10- or 12-bit source lands after the browser reads it.',
        ],
        doesNot: [
            'No quality figure is applied, because a lossless encoder has nothing for one to change.',
            'The frame is not scaled or trimmed on the way through, so the pixel count is unchanged.',
            'Nothing the container held around the picture survives: capture fields, XMP, the profile, the '
                + 'print resolution.',
        ],
    },

    application: {
        name: 'AVIF to PNG Converter',
        features: [
            'Writes a lossless .png from a .avif file',
            'Keeps a see-through background see-through',
            'Decodes with the browser\'s own decoder, on your own device',
            'Keeps the width and height the AVIF recorded',
            'Applies no quality figure — every decoded sample is stored',
        ],
    },

    howTo: {
        id: 'how-to-avif-to-png',
        heading: 'How to turn an AVIF into a PNG',
        description: 'Decode a .avif once and store the result losslessly as a .png, with its transparency '
            + 'intact, on the machine in front of you.',
        steps: [
            {
                name: 'Add the .avif',
                text: 'Drop it on the panel above or press Browse files. The pair is fixed at AVIF to PNG, so '
                    + 'there is no format menu to get wrong and nothing else is accepted.',
            },
            {
                name: 'Run it',
                text: 'Nothing needs setting first, because a lossless format has no quality to choose. Your '
                    + 'browser decodes the picture and the encoder stores every sample it produced.',
            },
            {
                name: 'Download it, then look through it',
                text: 'Put the download over a dark background if the transparency is the point. A white '
                    + 'rectangle where you expected nothing means the source was already flattened, and that '
                    + 'happened before the file ever reached you.',
            },
        ],
    },

    sections: [
        {
            id: 'why-png',
            heading: 'When PNG is the right thing to ask for',
            blocks: [
                {
                    type: 'p',
                    text: 'For an ordinary photograph it usually is not, and the [JPG route](/avif-to-jpg) will '
                        + 'be both lighter and more widely accepted. Three situations change the answer.',
                },
                {
                    type: 'ul',
                    items: [
                        'The background is see-through and has to stay that way. Logos, app icons, stickers and '
                            + 'cut-outs are what people bring to this page, and PNG is the output that carries '
                            + 'an alpha channel through without composing anything behind it.',
                        'A run of edits is coming. One decode now, with nothing thrown away, beats re-saving a '
                            + 'lossy file until the artefacts stack up on top of each other.',
                        'Something downstream has named PNG and will not negotiate — a design tool, an asset '
                            + 'pipeline, a form written before either format existed. That decision was made '
                            + 'somewhere out of reach, and matching it is the whole job.',
                    ],
                },
            ],
        },
        {
            id: 'the-alpha-channel',
            heading: 'What happens to the see-through background',
            blocks: [
                {
                    type: 'p',
                    text: 'Both formats carry an alpha channel, so the one the decoder produced is written '
                        + 'straight into the result. Nothing is composed behind it and nothing is filled in, and '
                        + 'a soft edge stays soft instead of turning into a hard fringe against a colour it was '
                        + 'never sitting on.',
                },
                {
                    type: 'p',
                    text: 'What this page cannot do is invent the channel. If the source was flattened onto '
                        + 'white by whatever produced it, the download holds a white rectangle, because that '
                        + 'information is gone from the file rather than hidden inside it. Removing a background '
                        + 'is retouching: it needs an editor with a selection tool, and changing the container '
                        + 'around the pixels will never do it for you.',
                },
                {
                    type: 'p',
                    text: 'The opposite journey — a transparent picture that has to become a JPEG — means '
                        + 'choosing a colour for it to sit on, which the [AVIF to JPG](/avif-to-jpg) page does '
                        + 'with a control beside its button.',
                },
            ],
        },
        {
            id: 'depth-and-colour',
            heading: 'Where "lossless" needs a qualifier',
            blocks: [
                {
                    type: 'p',
                    text: 'The encoding step loses nothing. What it is faithful to, though, is the output of '
                        + 'your browser\'s decoder rather than the contents of the file — and those two are not '
                        + 'always the same thing.',
                },
                {
                    type: 'ul',
                    items: [
                        'A source may store 10 or 12 bits a channel. The decode returns 8, so a long smooth '
                            + 'gradient can band very slightly, and the download then records that banding '
                            + 'perfectly.',
                        'A picture tagged with a PQ or HLG transfer curve is brought back to ordinary range by '
                            + 'the browser before this page is handed a single pixel, so the download looks like '
                            + 'what your screen showed rather than like the high-range master.',
                        'A wide-gamut or profile-tagged source is converted to sRGB on the way in, and no '
                            + 'profile is written into the download. The colours are the converted ones, which '
                            + 'is what an ordinary screen would have shown you regardless.',
                    ],
                },
            ],
        },
        {
            id: 'weight-and-time',
            heading: 'A lossless copy of a photograph is heavy',
            blocks: [
                {
                    type: 'p',
                    text: 'The two formats are built for opposite goals: one makes pictures small, the other '
                        + 'makes them exact. Converting between them undoes the first goal entirely. '
                        + 'Photographic detail and sensor grain are close to random, they barely shrink under '
                        + 'lossless compression, and the download routinely lands at many times the weight of '
                        + 'the file that went in. Writing it takes real work too, and a few seconds of an '
                        + 'apparently idle tab on an older phone is the tab compressing rather than stalling.',
                },
                {
                    type: 'p',
                    text: 'Flat graphics are the happy exception, and they are most of what arrives here. A mark '
                        + 'made of a few solid colours and one hard edge is exactly what this compression was '
                        + 'designed for, so a logo can come back at a weight close to the original while a '
                        + 'holiday photograph multiplies.',
                },
                {
                    type: 'p',
                    text: 'Where a ceiling on file size exists, this is the wrong output and no control on the '
                        + 'page changes that. Take the [JPG](/avif-to-jpg), or put the result through the '
                        + '[compressor](/compress) — which, given something lossless, can only rewrite it as '
                        + 'WebP or hand back fewer pixels.',
                },
            ],
        },
    ],

    limitations: [
        'One file per run, up to 20 MB. No page here takes this format in bulk — the '
            + '[bulk converter](/bulk-image-converter) works on JPG, PNG and WebP — so a folder has to be fed '
            + 'through in turn.',
        'There is no quality or compression control, because a lossless encoder has nothing to expose.',
        'How large a picture goes through is a question about your device rather than a policy: a full decode '
            + 'followed by a lossless encode needs room for several copies of the frame at once, and a phone '
            + 'short of free memory is told the job will not fit before anything is allocated.',
        'An animated AVIF is turned away before decoding, and no page here exports the frames of one.',
        'Reading the file at all needs a browser with AVIF support of its own, because this site ships no '
            + 'decoder for it.',
    ],

    faqs: [
        {
            question: 'Does the PNG keep my transparent background?',
            answer: 'Yes, and that is the main reason this route exists. Both formats carry an alpha channel, so '
                + 'the one your browser\'s decoder produced is written straight into the download — full '
                + 'transparency, partial transparency and soft edges alike. Nothing is placed behind the '
                + 'picture, which is precisely what does happen if you take the [JPG route](/avif-to-jpg).',
        },
        {
            question: 'Is the PNG really lossless if the source was lossy?',
            answer: 'The encoding step is lossless; the file it starts from was not. Your browser decodes the '
                + 'picture once and every sample it produces is stored with no quality figure applied, so what '
                + 'you get is an exact record of that decode rather than a recovery of how the image looked '
                + 'before somebody compressed it. No conversion anywhere can undo that first step.',
        },
        {
            question: 'Why is the download so much bigger than the file I started with?',
            answer: 'Because the two formats want opposite things. One borrows its compression from modern video '
                + 'and discards what your eye will not miss; the other discards nothing and has to encode every '
                + 'speck of grain across the whole frame. A photograph converted this way commonly multiplies in '
                + 'size. A flat logo often does not, because large areas of one colour are what this '
                + 'compression handles best.',
        },
        {
            question: 'My browser says it cannot open the file — why?',
            answer: 'Because the decoder belongs to the browser and this site ships none of its own. '
                + '[MDN\'s image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) '
                + 'puts native support at Chrome 85, Firefox 93 and Safari 16, and Safari\'s version travels '
                + 'with the operating system, so that means iOS 16 or macOS Ventura and later. On anything '
                + 'older the panel says so at once instead of failing partway through.',
        },
        {
            question: 'Can I convert an animated AVIF into an animated PNG?',
            answer: 'No. A file whose header says it holds a sequence is recognised and turned away before '
                + 'decoding begins, and an animated PNG is not an output on this site in any case. Taking one '
                + 'still frame out of a sequence nobody asked to flatten is the sort of quiet substitution this '
                + 'site does not make.',
        },
        {
            question: 'Does the picture leave my computer?',
            answer: 'No. The decoder is part of your browser and the encoder arrives as a WebAssembly module the '
                + 'page fetches into the same tab, so the file is read and written where it already sits. '
                + 'Nothing about it travels, and there is nowhere for it to travel to: the build has no image '
                + 'endpoint at all, which is a stronger guarantee than a promise about what happens after it '
                + 'arrives somewhere.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },

    /**
     * The browser-support claim is the one sentence here that is not a fact
     * about this build, so it carries the document it was read from and the
     * day it was read. The format specification is cited for the sequence
     * brand and the bit depths named above.
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

export default avifToPng;
