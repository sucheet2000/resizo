/**
 * /heic-to-png — the same iPhone photo, decoded once and then stored exactly.
 *
 * The sibling page /heic-to-jpg is about a file that everything opens. This one
 * is about a file that nothing has compressed twice, and it exists because
 * editors, asset pipelines and a few upload forms name PNG and take nothing
 * else. The honest cost of answering them is weight and time rather than
 * quality, so that is what most of this page is about — and where PNG is not
 * genuinely required, the page says so and points at the JPG route.
 */
const heicToPng = {
    slug: 'heic-to-png',
    tool: 'heic',
    kind: 'conversion',
    preset: { format: 'png' },
    label: 'HEIC to PNG',
    blurb: 'An editor or a form that names PNG and takes nothing else, from a photo the iPhone saved as HEIC',
    title: 'HEIC to PNG — Convert iPhone Photos to Lossless PNG | Resizo',
    h1: 'Convert HEIC to PNG',
    intro: 'An iPhone photo decoded once and stored exactly, at its full width and height, as a .png.',
    description: 'Convert HEIC to PNG online free, without uploading the photo. Your own device decodes the '
        + 'iPhone .heic or .heif and stores every pixel losslessly, at full size, with no quality setting to '
        + 'pick and no account to make.',
    ogImage: '/og-heic.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A PNG made from an iPhone photo holds the decoded picture exactly — no quality dial, no second '
        + 'round of lossy compression — which is what an editor or a form that insists on PNG is really '
        + 'after. On Resizo you add the .heic or .heif file and press Convert to PNG; the result keeps the '
        + 'full width and height of the original, and an alpha channel survives where the file has one. The '
        + 'HEIF decoder is a WebAssembly module the page downloads, and it runs on your own device, so the '
        + 'photograph and the coordinates recorded inside it stay where they are. The cost is weight, because '
        + 'a losslessly stored 12-megapixel frame runs to many times the HEIC.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Stores the decoded frame losslessly, at the full width and height the camera recorded.',
            'Keeps an alpha channel where the HEIF container actually carries one, which a camera photo '
                + 'does not.',
            'Leaves you with a much heavier file, commonly many times the weight of the .heic that went in.',
        ],
        doesNot: [
            'There is no quality dial to set, because a lossless encoder has nothing for one to change.',
            'The frame is not resampled or trimmed on the way through, so the pixel count is unchanged.',
            'One photo goes through per run; this converter has no batch mode.',
        ],
    },

    application: {
        name: 'HEIC to PNG Converter',
        features: [
            'Writes a lossless .png from a .heic or .heif photo',
            'Decoding and encoding both happen on your own device',
            'Keeps the width and height the camera recorded',
            'Stores the decoded pixels with no quality figure applied',
            'Preserves an alpha channel where the file carries one',
        ],
    },

    howTo: {
        id: 'how-to-heic-to-png',
        heading: 'How to turn a HEIC into a PNG',
        description: 'Decode an iPhone .heic or .heif once and store the result losslessly as a .png, on the '
            + 'machine you are already sitting at.',
        steps: [
            {
                name: 'Pick the .heic out of your camera roll',
                text: 'Drag it onto the panel above, or press Browse photos and find it. Nothing renders a HEIC '
                    + 'thumbnail, so what appears is the name, the type and the weight of the file rather than a '
                    + 'picture of it.',
            },
            {
                name: 'Run the conversion to PNG',
                text: 'No slider needs setting, because a lossless format has nothing to set. Your device turns the '
                    + 'HEIF picture back into pixels and writes those pixels out as they are, which is heavier work '
                    + 'than the JPG route and noticeably slower on an older handset.',
            },
            {
                name: 'Download the PNG and look at the weight',
                text: 'Both sizes are printed side by side in the panel. A large jump is the normal outcome here, so '
                    + 'check the figure fits wherever the file has to go before you rely on it.',
            },
        ],
    },

    sections: [
        {
            id: 'when-png',
            heading: 'When a PNG is the right thing to ask for',
            blocks: [
                {
                    type: 'p',
                    text: 'For an ordinary snapshot it usually is not, and it is worth being clear about the '
                        + 'situations that genuinely call for one before you pay for it in megabytes.',
                },
                {
                    type: 'ul',
                    items: [
                        'Something downstream lists PNG and refuses the rest. A design tool, an asset pipeline '
                            + 'or a form built by someone who decided years ago what it would accept. No '
                            + 'argument about formats gets around that decision.',
                        'Editing starts now. Decode once, treat the PNG as the working copy, and export '
                            + 'whatever the finished picture needs at the end, instead of laying one lossy '
                            + 'generation over another every time you save.',
                        'The picture is not a photograph. Screenshots, scanned pages, receipts and flat '
                            + 'graphics land in the camera roll as HEIF too, and large areas of one colour are '
                            + 'exactly what lossless compression handles well.',
                        'The file has a see-through area to protect. Rare from a camera, but a HEIF container '
                            + 'can carry alpha, and PNG is the output here that keeps it.',
                    ],
                },
            ],
        },
        {
            id: 'what-the-png-holds',
            heading: 'What the PNG holds',
            blocks: [
                {
                    type: 'p',
                    text: 'The decoder hands the picture over as raw pixels and the encoder stores them as it '
                        + 'found them. No quality figure is chosen and none is applied, so what reaches your '
                        + 'downloads folder is the HEIF image pixel for pixel, at the width and height the camera '
                        + 'recorded.',
                },
                {
                    type: 'p',
                    text: 'Nothing is scaled, trimmed or turned along the way. The rotation a phone stores as a '
                        + 'property of the file rather than as pixels is applied by the HEIF decoder itself, which '
                        + 'is why a photo shot sideways arrives the right way up with the same pixel count it '
                        + 'always had.',
                },
                {
                    type: 'p',
                    text: 'Transparency comes through where it exists. Almost nothing shot with the camera has a '
                        + 'see-through pixel anywhere in it, so for a normal photograph this changes precisely '
                        + 'nothing — it matters for the occasional graphic that was saved into a HEIF container '
                        + 'with an alpha channel attached.',
                },
            ],
        },
        {
            id: 'weight-and-time',
            heading: 'A lossless copy of a camera photo is heavy',
            blocks: [
                {
                    type: 'p',
                    text: 'A 12-megapixel frame is twelve million pixels and a lossless file has to account for '
                        + 'every one of them. Real photographs are full of fine gradation and sensor grain, which '
                        + 'is close to random and therefore barely shrinks at all, so the result commonly lands at '
                        + 'many times the weight of the HEIC that went in and well above the '
                        + '[JPG version](/heic-to-jpg) of the same picture.',
                },
                {
                    type: 'p',
                    text: 'Writing it takes a while as well. Encoding a full-size lossless image is real work for '
                        + 'the processor in a phone, and several seconds of an apparently idle tab is the normal '
                        + 'experience on an older handset. The tab has not stalled; it is compressing.',
                },
                {
                    type: 'p',
                    text: 'Where there is a ceiling on file size at the other end, a lossless format is the wrong '
                        + 'answer and no control on this page changes that. Take the [JPG](/heic-to-jpg) instead, '
                        + 'or turn the PNG into a JPEG with the [PNG to JPG converter](/png-to-jpg) and bring that '
                        + 'under the ceiling in the [compressor](/compress). A PNG itself has no quality to turn '
                        + 'down, so the only moves the compressor has on one are a WebP rewrite or fewer pixels.',
                },
            ],
        },
        {
            id: 'stays-behind',
            heading: 'What stays behind in the original',
            blocks: [
                {
                    type: 'p',
                    text: 'HEIF is a container and a phone puts several things inside it. The still frame is what '
                        + 'gets converted, while the short clip behind a Live Photo, the depth map Portrait mode '
                        + 'recorded and the other frames of a burst are not part of that picture and do not come '
                        + 'across.',
                },
                {
                    type: 'p',
                    text: 'The metadata does not travel either. A PNG built out of decoded pixels alone has nowhere '
                        + 'to put the day the shutter fired, the lens it fired through or the coordinates it fired '
                        + 'at, so all of that is missing from the file you download. Keep the original if any of it '
                        + 'matters to you; hand over the PNG on its own if you would rather the location did not '
                        + 'travel with the picture.',
                },
            ],
        },
        {
            id: 'png-or-jpg',
            heading: 'PNG or JPG, from the same photo',
            blocks: [
                {
                    type: 'table',
                    caption: 'One iPhone photo written both ways',
                    columns: [
                        { key: 'aspect', label: 'What you are weighing up', rowHeader: true },
                        { key: 'png', label: 'PNG (this page)' },
                        { key: 'jpg', label: 'JPG' },
                    ],
                    rows: [
                        {
                            aspect: 'Pixels',
                            png: 'Stored as decoded, untouched',
                            jpg: 'One further lossy generation, at quality 90',
                        },
                        {
                            aspect: 'Weight',
                            png: 'Many times the original',
                            jpg: 'Roughly double the original',
                        },
                        {
                            aspect: 'See-through areas',
                            png: 'Kept where the file has any',
                            jpg: 'Flattened onto a solid background',
                        },
                        {
                            aspect: 'What accepts it',
                            png: 'Editors, asset pipelines, forms that name PNG',
                            jpg: 'Nearly everything, print shops and old software included',
                        },
                        {
                            aspect: 'Time on a phone',
                            png: 'Slower',
                            jpg: 'Quicker',
                        },
                    ],
                },
                {
                    type: 'p',
                    text: 'Ask for PNG when something has named it, or when this file is the copy you are about to '
                        + 'work on. For everything else — sending a picture to somebody, attaching it to an '
                        + 'application, taking it to be printed — [HEIC to JPG](/heic-to-jpg) is the better answer, '
                        + 'because it is a fraction of the weight and there is nowhere it will not open.',
                },
            ],
        },
        {
            id: 'no-preview',
            heading: 'No preview, and one photo per run',
            blocks: [
                {
                    type: 'p',
                    text: 'No browser can display HEIF, so the panel cannot show you the photograph before it '
                        + 'converts. It names the file, its type and its weight instead, and the first image you '
                        + 'actually see is the PNG that comes back — which is also the moment you find out whether '
                        + 'the right file went in.',
                },
                {
                    type: 'p',
                    text: 'The panel takes a single file per run, with a 20 MB ceiling no iPhone still photo comes '
                        + 'close to, and this converter has no batch mode: the one page that takes several HEIC files '
                        + 'at once is [JPG to PDF](/jpg-to-pdf), which makes a document, not pictures. A folder has '
                        + 'to be fed through in turn, and since these are the slowest conversions here, a holiday '
                        + 'worth of them is a poor fit for this page. Where PNG is not a hard requirement the '
                        + '[JPG route](/heic-to-jpg) is quicker, and the [HEIC page](/heic) has the camera setting '
                        + 'that stops the phone writing HEIF in the first place.',
                },
            ],
        },
    ],

    limitations: [
        'One .heic or .heif photo per run, up to 20 MB, and no batch mode — the bulk resizer takes JPEG, '
            + 'PNG and WebP only.',
        'How big a photo goes through is a question about your device rather than a policy: a full-size '
            + 'decode followed by a lossless encode needs room for several copies of the picture at once, and '
            + 'a phone that is short of free memory is told the job will not fit before anything is allocated.',
        'PNG output is the slowest job on the site, and a low-powered phone will take several seconds over a '
            + 'full-resolution frame.',
    ],

    faqs: [
        {
            question: 'Why would I choose PNG over JPG for an iPhone photo?',
            answer: 'Usually because you have been told to. An editor, a design tool or a form has named PNG and '
                + 'will not take the alternative, and that is a decision made somewhere you cannot argue with. The '
                + 'other good reason is that you are about to start working on the picture and would rather not '
                + 'add a fresh generation of lossy compression before you have even begun.',
        },
        {
            question: 'Will the PNG look better than the JPG would?',
            answer: 'Not to your eye, no. The HEIF picture was itself compressed by the camera, and storing it '
                + 'losslessly preserves what the decoder produced rather than improving on it. What changes is '
                + 'what happens next: this file can be opened and saved as often as you like without losing '
                + 'anything further, which is a promise no lossy format makes.',
        },
        {
            question: 'The PNG is several times the size of the HEIC — is that right?',
            answer: 'Yes, and it is what lossless means in practice. HEIF borrows its compression from modern '
                + 'video and drops what your eye will not miss; the PNG drops nothing whatsoever and has to encode '
                + 'the sensor grain across the whole frame, which is close to random and hardly shrinks. A HEIC '
                + 'measured in single-digit megabytes becoming a PNG measured in tens of them is the ordinary '
                + 'outcome.',
        },
        {
            question: 'Does the PNG give me a transparent background?',
            answer: 'Only if the file already had one, and a photograph taken with the camera does not. The alpha '
                + 'channel is copied when it is there and invented when it is not — which is never. Erasing the '
                + 'sky or the wall behind a subject is retouching rather than converting: it needs an editor with '
                + 'a selection or background tool, and changing which container the pixels sit in cannot do it '
                + 'for you.',
        },
        {
            question: 'Can I put a whole folder of HEIC photos through at once?',
            answer: 'Not here. This panel handles a single file per run, and no page on the site takes HEIF in '
                + 'bulk. If you have a camera roll to get through and nothing has specifically demanded PNG, the '
                + 'JPG route is faster to run and gives you files small enough to move around afterwards; if the '
                + 'same job comes round every week, the fix is the camera setting rather than the converter.',
        },
        {
            question: 'Does the photo leave my phone to be converted?',
            answer: 'No. The HEIF decoder and the PNG encoder both arrive as code the page downloads, and both '
                + 'run against the file on your own device, so the picture is never handed to anything else. That '
                + 'is worth something here in particular: a lossless copy of a full-size photo is a heavy file, '
                + 'and nothing has to carry it anywhere. It also holds no EXIF or GPS, so the coordinates in the '
                + 'original are not passed on with it.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default heicToPng;
