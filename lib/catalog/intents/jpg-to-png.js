/**
 * /jpg-to-png — the conversion people expect the most from and get the least.
 *
 * The honest answer is the content: PNG cannot undo JPEG, the file gets bigger,
 * and no transparency appears. Saying that plainly is more useful than the
 * "improve your image quality" copy this query usually attracts, and it is the
 * only version we can actually stand behind.
 */
const jpgToPng = {
    slug: 'jpg-to-png',
    tool: 'convert',
    kind: 'conversion',
    preset: { from: 'jpeg', to: 'png' },
    label: 'JPG to PNG',
    blurb: 'Something downstream demands a PNG and will not take the JPG you have',
    title: 'JPG to PNG — Convert JPG Images to PNG Free | Resizo',
    h1: 'Convert JPG to PNG',
    intro: 'One JPG in, one lossless PNG out at the same pixel dimensions. Expect a larger file.',
    description: 'Convert JPG to PNG online free, on your own device. Get a lossless, full-colour PNG at '
        + 'the same pixel dimensions — for the forms, editors and asset pipelines that will only take a PNG. '
        + '20 MB per file.',
    ogImage: '/og-convert.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'Converting a JPG to a PNG gives you the lossless file that whatever is asking for one will '
        + 'accept, but it cannot bring back detail the JPEG already threw away, and the PNG will '
        + 'normally be several times larger. On Resizo the pair is fixed at JPG to PNG: add the JPG, '
        + 'press Convert to PNG, and the picture comes back at the same pixel dimensions with no '
        + 'second round of lossy compression. The PNG is written by your own browser, from an encoder '
        + 'the page downloads from this site, so the original stays exactly where you keep it.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Stores the decoded pixels losslessly, so the PNG is an exact copy of what the JPEG decoded to and stops degrading there.',
            'Produces a larger file in most cases, because PNG has to store the JPEG blocking and ringing along with the picture.',
            'Runs with no quality dial and no palette reduction, since the encoder loaded into this page has neither.',
        ],
        doesNot: [
            'Does not restore detail the JPEG already discarded; no copy of it is left in the file to recover.',
            'Does not resize the image, so the pixel dimensions on the way out match the ones on the way in.',
            'Does not add transparency: every pixel of a JPEG is opaque, and every pixel of the result stays that way.',
        ],
    },

    application: {
        name: 'JPG to PNG Converter',
        features: [
            'Converts JPG to a full-colour lossless PNG',
            'Converts on your own device — the file is never uploaded',
            'Keeps the original pixel dimensions',
            'No palette reduction and no quality setting',
            'Strips EXIF and GPS metadata from the PNG',
        ],
    },

    howTo: {
        id: 'how-to-jpg-to-png',
        heading: 'How to convert a JPG to PNG',
        description: 'Turn a JPG into a lossless, full-colour PNG at the same pixel dimensions, on your own '
            + 'device.',
        steps: [
            {
                name: 'Choose the JPG on your device',
                text: 'Drop it onto the panel above or press Browse files. The pair is already set, so a file that is '
                    + 'not a JPEG is refused at the drop.',
            },
            {
                name: 'Press Convert to PNG',
                text: 'Your device decodes the JPEG and stores those exact pixels in a PNG. Nothing further is lost, '
                    + 'and nothing the JPEG already threw away comes back.',
            },
            {
                name: 'Download the PNG',
                text: 'Expect it to be larger than the JPG was. The panel prints both sizes, so the increase is a '
                    + 'number you see rather than a surprise.',
            },
        ],
    },

    sections: [
        {
            id: 'no-quality-gain',
            heading: 'A PNG cannot undo a JPEG',
            blocks: [
                {
                    type: 'p',
                    text: 'This is worth being blunt about, because it is the reason most people arrive here. '
                        + 'Converting a JPG to PNG does not recover detail, sharpen edges or remove compression '
                        + 'artefacts. When the JPEG was first saved, information was discarded and not written '
                        + 'anywhere — there is nothing left to restore it from.',
                },
                {
                    type: 'p',
                    text: 'What a PNG does give you is a floor. From that point on the picture stops degrading: '
                        + 'you can open it, edit it and save it as many times as you like without another '
                        + 'generation of loss. That is a real benefit, and it is a different benefit from the one '
                        + 'the phrase “convert to a lossless format” tends to suggest.',
                },
            ],
        },
        {
            id: 'bigger-file',
            heading: 'Expect the file to get bigger',
            blocks: [
                {
                    type: 'p',
                    text: 'A photograph that arrived as a 1.5 MB JPG commonly leaves as a 5 MB PNG or more. '
                        + 'Nothing has gone wrong. PNG stores every pixel exactly, and it has to store the JPEG '
                        + 'artefacts too — the faint 8-pixel blocking and the ringing around hard edges. That '
                        + 'texture is close to random, and random data does not compress.',
                },
                {
                    type: 'p',
                    text: 'Flat images behave differently. A chart, a logo or a screenshot that was saved as a JPG '
                        + 'by accident can come back as a PNG that is smaller than the original, because now the '
                        + 'large areas of identical colour compress the way they always should have.',
                },
            ],
        },
        {
            id: 'no-transparency',
            heading: 'It does not add transparency',
            blocks: [
                {
                    type: 'p',
                    text: 'PNG is the format people associate with transparent backgrounds, so this catches a lot '
                        + 'of people out: the alpha channel exists in the file format, but the conversion has '
                        + 'nothing to put in it. A JPG is opaque by definition, every pixel of it, and the PNG '
                        + 'that comes out is opaque in exactly the same way.',
                },
                {
                    type: 'p',
                    text: 'Erasing a background means deciding which pixels are the subject and which are not. '
                        + 'That is an editing decision, and it needs an image editor with a selection tool or a '
                        + 'background-removal feature — not a format converter.',
                },
            ],
        },
        {
            id: 'when-it-helps',
            heading: 'When JPG to PNG is the right move',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'An upload form, a theme or an asset pipeline that accepts PNG and nothing else. '
                            + 'This is the most common honest reason.',
                        'You are about to start editing. Convert once, work in PNG, and export a JPG at the '
                            + 'end — one lossy generation instead of one per save.',
                        'You are placing the image somewhere that will compress it again, such as a slide '
                            + 'deck or a document exporter, and you would rather not stack two lossy passes.',
                        'The image is a screenshot, a chart or line art that was saved as a JPG by mistake. '
                            + 'PNG is where it belonged in the first place.',
                    ],
                },
            ],
        },
    ],

    limitations: [
        'One JPEG per run, up to 20 MB, with no folder mode: several files at once is the resizer\'s bulk tab, and that '
            + 'works on pixel dimensions instead.',
        'A 20 MB JPEG decodes to far more than 20 MB of pixels, so the tab is asked whether it has the room first and the '
            + 'job is refused outright when it has not.',
        'A file that is not a JPEG is refused the moment it is dropped, so a PNG renamed to .jpg, or a HEIC straight off '
            + 'an iPhone, will not go through this page.',
    ],

    faqs: [
        {
            question: 'Will converting to PNG improve the quality of my JPG?',
            answer: 'No, and nothing can. The detail JPEG discarded when the file was first saved is gone from '
                + 'the file — there is no copy of it anywhere to recover. PNG stores whatever it is given, '
                + 'exactly, so what you get is a perfect copy of an already-compressed picture.',
        },
        {
            question: 'Why is the PNG so much bigger than the JPG?',
            answer: 'Because it is lossless. PNG has to store every pixel of the decoded image, including the '
                + 'faint blocking and ringing JPEG left behind, and that fine noise is exactly the kind of detail '
                + 'that does not compress. Two to five times the original size is normal for a photograph.',
        },
        {
            question: 'Does converting to PNG give me a transparent background?',
            answer: 'No. PNG supports transparency, but a JPG has none to carry across, so every pixel in the '
                + 'result is fully opaque. Removing a background is an editing job — something has to decide '
                + 'which pixels to erase, and a format conversion cannot.',
        },
        {
            question: 'Is the PNG really lossless?',
            answer: 'Yes, and there is no setting that could make it otherwise. The PNG encoder loaded into this '
                + 'page is lossless with no quality dial and no palette reduction of any kind, so every pixel of '
                + 'the decoded JPG is written out exactly as it was decoded.',
        },
        {
            question: 'Can I convert it back to JPG later?',
            answer: 'Yes, and for a photograph you probably should once the PNG has served its purpose — the JPG '
                + 'will be a fraction of the size. Be aware it is a second lossy generation on top of the first, '
                + 'so do it once at the end rather than repeatedly along the way.',
        },
        {
            question: 'Can I convert JPG to PNG without uploading the file?',
            answer: 'Yes — this page uploads nothing. Both codecs are fetched into the page as code, so the JPG '
                + 'is decoded and the PNG written by your own device and no copy of the picture exists anywhere '
                + 'else. It is worth knowing here in particular, because a PNG of a photograph is several times '
                + 'the size of the JPG it came from — and that weight costs you nothing when there is no '
                + 'transfer. The PNG carries no EXIF or GPS data.',
        },
    ],

    siblingLinks: { heading: 'Other conversions' },
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default jpgToPng;
