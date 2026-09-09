/**
 * /compress-image-to-200kb — the other target people ask for by name.
 *
 * Deliberately not the 100 KB page with a different number in it. That page is
 * about the requirement (portals, forms, a hard ceiling). This one is about the
 * budget: 200 KB is roughly where a full-size photograph stops being a
 * compromise, and the bits-per-pixel table below is the honest way to show
 * where the line falls.
 */
const compressImageTo200kb = {
    slug: 'compress-image-to-200kb',
    tool: 'compress',
    kind: 'target',
    preset: { targetKb: 200 },
    label: 'Compress to 200 KB',
    blurb: 'A 200 KB ceiling, which is enough for a full-width photo that still looks right',
    title: 'Compress Image to 200KB Online Free | Resizo',
    h1: 'Compress an Image to 200 KB',
    intro: 'The target is already set to 200 KB. Drop a JPEG, PNG or WebP and the result comes back at or under it.',
    description: 'Compress an image to 200 KB online free, with nothing leaving your computer. The '
        + 'target is already set — drop a JPEG, PNG or WebP and the encoder is worked until the result fits '
        + 'under 200 KB, with the size actually achieved reported back.',
    ogImage: '/og-compress.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A 200 KB ceiling is loose enough that a full-width photograph can still look right '
        + 'underneath it, so the job is to find the highest quality that fits inside 204,800 bytes '
        + 'rather than flattening the picture to be safe. On Resizo the target starts at 200 KB — add '
        + 'a JPEG, PNG or WebP, press Compress image, and the before and after figures under the '
        + 'result are read off the finished file. The encoder runs in this browser tab on your own '
        + 'hardware, on code the page loads from this site, so your photo goes nowhere near a network.',

    application: {
        name: 'Compress Image to 200 KB',
        features: [
            'Target size preset to 200 KB',
            'Runs on your own device — the file is never uploaded',
            'Binary-searches the encoder and reports the size achieved',
            'Never returns a file above the target',
            'JPEG, PNG and WebP',
        ],
    },

    howTo: {
        id: 'how-to-compress-200kb',
        heading: 'How to compress an image to 200 KB',
        description: 'Bring a JPEG, PNG or WebP under 200 KB on your own device, with the size reached reported '
            + 'back.',
        steps: [
            {
                name: 'Leave the target where it is',
                text: 'The panel opens in target mode with 200 KB already typed in. Change the number only if your '
                    + 'limit is a different one.',
            },
            {
                name: 'Choose the image on your device',
                text: 'Drop a JPEG, PNG or WebP onto the panel above, or press Browse files. The picture is read where '
                    + 'it already is and goes nowhere else.',
            },
            {
                name: 'Press Compress image',
                text: 'Your device encodes the picture and measures what came out, narrowing the quality range until '
                    + 'the result sits at or just below 200 KB.',
            },
            {
                name: 'Download the file and check the number',
                text: 'The panel prints the size actually achieved, so you can confirm it is under the limit before you '
                    + 'send it anywhere.',
            },
        ],
    },

    sections: [
        {
            id: 'what-200kb-buys',
            heading: 'What 200 KB actually buys you',
            blocks: [
                {
                    type: 'p',
                    text: '200 KB is 1,638,400 bits. Divide that by the number of pixels in your image and you get '
                        + 'the budget the encoder has to describe each one — which is the real answer to '
                        + '“will it still look good”, and it depends on the dimensions rather than on '
                        + 'the compressor.',
                },
                /**
                 * 200 KB is 1,638,400 bits. Dividing that by the pixel count is the only
                 * honest way to answer "will it still look good" — the answer depends on the
                 * dimensions, not on the compressor.
                 */
                {
                    type: 'table',
                    caption: 'Bits available per pixel at a 200 KB target, by image size',
                    columns: [
                        { key: 'size', label: 'Image size', rowHeader: true, mono: true },
                        { key: 'pixels', label: 'Pixels', mono: true },
                        { key: 'bits', label: 'Bits each', mono: true },
                        { key: 'verdict', label: 'What to expect' },
                    ],
                    rows: [
                        { size: '800×600', pixels: '0.5 MP', bits: '3.4', verdict: 'Far more room than the picture needs' },
                        { size: '1280×720', pixels: '0.9 MP', bits: '1.8', verdict: 'Indistinguishable from the original' },
                        { size: '1600×1067', pixels: '1.7 MP', bits: '1.0', verdict: 'Comfortable for any photograph' },
                        { size: '1920×1080', pixels: '2.1 MP', bits: '0.8', verdict: 'Fine on a screen at full width' },
                        { size: '2560×1440', pixels: '3.7 MP', bits: '0.4', verdict: 'Detailed scenes start to soften' },
                        { size: '4000×3000', pixels: '12 MP', bits: '0.1', verdict: 'Visibly blocky — resize instead' },
                    ],
                },
                {
                    type: 'p',
                    text: 'As a rule of thumb, a JPEG at about one bit per pixel is hard to tell from the '
                        + 'original, and half a bit per pixel is where a detailed photograph starts to look '
                        + 'soft. Read the table as a guide rather than a guarantee: a plain portrait against a '
                        + 'studio backdrop stretches further than a picture of a hedge.',
                },
            ],
        },
        {
            id: 'where-the-limit-comes-from',
            heading: 'Where a 200 KB limit usually comes from',
            blocks: [
                {
                    type: 'p',
                    text: 'Unlike a 100 KB cap, which is nearly always imposed on you by a form, 200 KB is often a '
                        + 'budget you set for yourself. It is the size a page-weight target lands on for a hero '
                        + 'image, the rough ceiling a marketplace listing wants so its gallery loads quickly, and '
                        + 'a sensible cap for an image inside a newsletter that has to arrive on a slow phone.',
                },
                {
                    type: 'p',
                    text: 'It also turns up as a hard limit in the same places 100 KB does — forum avatars and '
                        + 'attachments, older content systems with a small upload cap, portals that allow a little '
                        + 'more room for a document scan than for a headshot. Either way the requirement is the '
                        + 'same: at or below, measured in real bytes.',
                },
            ],
        },
        {
            id: 'how-the-target-is-met',
            heading: 'How the target is met, and what you are told',
            blocks: [
                {
                    type: 'p',
                    text: 'Your device encodes the image, measures the actual byte length, and bisects the quality '
                        + 'range to find the best-looking version that still fits under 200 KB. WebP is the quick '
                        + 'case: its encoder can be handed a byte figure directly and aims for it in one pass, so '
                        + 'the search only runs if that first attempt overshoots. JPEG has no such mode and is '
                        + 'probed properly every time.',
                },
                {
                    type: 'p',
                    text: 'Either way the number it settles on is reported back with the file: the panel prints '
                        + 'what you asked for alongside what the encoder landed on, so a result of 187 KB is '
                        + 'visible rather than implied.',
                },
                {
                    type: 'p',
                    text: 'The result is never above the target. If even the lowest quality overshoots, you are '
                        + 'told the smallest size that image can actually reach instead of being handed a file '
                        + 'that fails the requirement.',
                },
            ],
        },
        {
            id: 'versus-100kb',
            heading: '200 KB or 100 KB?',
            blocks: [
                {
                    type: 'p',
                    text: 'If nothing is forcing your hand, take the 200 KB. Halving the budget means the same '
                        + 'number of pixels has to be described in half the bits, and the encoder always pays for '
                        + 'that in the detailed areas first — foliage, hair, fabric texture, anything with fine '
                        + 'contrast.',
                },
                {
                    type: 'p',
                    text: 'If a form does force your hand, the [100 KB page](/compress-image-to-100kb) is set up '
                        + 'for it, and the trick there is to cut the pixel dimensions before compressing '
                        + 'rather than asking the encoder for the impossible. For any other number, the target '
                        + 'field above accepts anything from 10 KB to 20 MB, and the [main compressor](/compress) '
                        + 'has the quality slider if you would rather work that way.',
                },
            ],
        },
    ],

    limitations: [],

    faqs: [
        {
            question: 'Is 200 KB small enough for a web page?',
            answer: 'For a single photograph, comfortably. A full-width hero at 1600 pixels wide and 200 KB is a '
                + 'reasonable budget on any connection. What costs you is quantity: twenty images at 200 KB is 4 '
                + 'MB of page weight, so cut the dimensions of the ones displayed small rather than compressing '
                + 'everything harder.',
        },
        {
            question: 'Why did I get 187 KB instead of 200 KB?',
            answer: 'Because the next quality step up would have gone over. The search keeps the largest output '
                + 'that still fits under your target, and quality moves in whole steps, so the result usually '
                + 'lands a little short. Under is the side you want to be on for anything with a stated limit.',
        },
        {
            question: 'Can I keep the full dimensions and still hit 200 KB?',
            answer: 'Up to roughly two megapixels, yes, with quality to spare. Beyond that the encoder has fewer '
                + 'and fewer bits per pixel to work with, and past about four megapixels it has to take visible '
                + 'detail out to reach the number. The table above shows where the line falls for common sizes.',
        },
        {
            question: 'What happens if my file is a PNG?',
            answer: 'PNG is lossless and the encoder here has no quality setting at all, so there is nothing to '
                + 'turn down and nothing to search. The PNG is written once, at full colour and full size, and '
                + 'either it comes in under 200 KB or it does not. When it does not you are told so and offered '
                + 'WebP, which keeps any transparency and does reach the number without shrinking the picture. A '
                + 'photograph stored as a PNG is better converted to JPEG or WebP first anyway.',
        },
        {
            question: 'Can I compress a whole folder to 200 KB each?',
            answer: 'Not in one pass — the compressor takes one image at a time so it can search the encoder for '
                + 'each file individually, which is what makes an exact target possible. The bulk resizer handles '
                + 'up to 20 files at once, but it works on dimensions rather than byte targets.',
        },
        {
            question: 'Can I compress to 200 KB without uploading the file?',
            answer: 'Yes. The encoders are downloaded into the page as code and every probe runs on your own '
                + 'device, which is why the search is bounded by your processor rather than by how long a large '
                + 'photo would take to send anywhere. Nothing leaves the computer you are on, and the output is '
                + 'written from raw pixels, so it carries no EXIF or GPS data.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-08-12',
    indexable: true,
};

export default compressImageTo200kb;
