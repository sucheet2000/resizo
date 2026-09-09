/**
 * /heic-to-jpg — the query, spelled the way people type it.
 *
 * It runs the same converter as /heic and deliberately does NOT repeat it.
 * /heic explains the format: what a HEIC is, why Windows will not open one, how
 * to stop the camera writing them. This page is about the file you get back —
 * what survives the conversion, what does not, and where a JPG is the only
 * thing that will be accepted.
 */
const heicToJpg = {
    slug: 'heic-to-jpg',
    tool: 'heic',
    kind: 'conversion',
    preset: null,
    label: 'HEIC to JPG',
    blurb: 'An iPhone photo that Windows, Android and most upload forms refuse',
    title: 'HEIC to JPG — Convert iPhone Photos, No Upload | Resizo',
    h1: 'HEIC to JPG',
    intro: 'Drop a .heic or .heif photo from an iPhone and get a full-resolution .jpg back.',
    description: 'Convert HEIC to JPG online free, without uploading the photo. Drop an iPhone .heic or '
        + '.heif file and your own device writes a full-resolution .jpg — the format Windows, Android, print '
        + 'shops and upload forms accept. No account, nothing to install.',
    ogImage: '/og-heic.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: "Windows, Android and plenty of web forms simply refuse an iPhone's .heic file, and "
        + 'converting it to .jpg gives you the same photo at the same resolution in the format all of '
        + 'them accept. On Resizo you drop the .heic or .heif onto the panel and press Convert to JPG; '
        + 'nothing is cropped, scaled or rotated, and the JPG is written at quality 90. The decoder '
        + 'that reads the HEIC runs inside your own browser, on a module the page downloads, so the '
        + 'photo never leaves the device it was taken on.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Decodes the HEIF picture on your own device, through a WebAssembly module the page downloads.',
            'Applies the rotation the container stores, so a photo shot sideways arrives upright.',
            'Writes the JPEG at quality 90, a step above the 80 the other converters here use.',
            'Composites any alpha the file carries onto black first, because JPEG has nowhere to keep it.',
        ],
        doesNot: [
            'No scaling happens at any point, so every pixel the camera recorded is in the JPG.',
            'The motion behind a Live Photo, the Portrait depth map and the other burst frames are left '
                + 'behind.',
            'Date taken, camera model and GPS coordinates are not copied, because the JPEG is built from '
                + 'pixels alone.',
        ],
    },

    application: {
        name: 'HEIC to JPG Converter',
        features: [
            'Converts .heic and .heif to .jpg',
            'Converts on your own device — the photo is never uploaded',
            'Keeps the full pixel dimensions of the original photo',
            'Writes the JPG at quality 90',
            'Carries no EXIF or GPS metadata into the JPG',
        ],
    },

    howTo: {
        id: 'how-to-heic-to-jpg',
        heading: 'How to convert a HEIC to JPG',
        description: 'Turn an iPhone .heic or .heif photo into a full-resolution .jpg, on your own device.',
        steps: [
            {
                name: 'Choose the photo on your device',
                text: 'Drop a .heic or .heif file onto the panel above, or press Browse photos. On an iPhone you can '
                    + 'pick it straight out of your camera roll.',
            },
            {
                name: 'Press Convert to JPG',
                text: 'There is nothing to set. The decoder is already in the page, so the photo keeps every pixel it '
                    + 'had, is written at quality 90, and never leaves the device it is on.',
            },
            {
                name: 'Download the JPG',
                text: 'The panel shows the new size next to the original. Expect roughly double, because JPEG is about '
                    + 'half as efficient as HEIC at the same picture.',
            },
        ],
    },

    sections: [
        {
            id: 'what-comes-back',
            heading: 'What comes back',
            blocks: [
                {
                    type: 'p',
                    text: 'One JPG, at exactly the pixel dimensions the photo already had. Nothing is scaled, '
                        + 'cropped or rotated, and the file is written at quality 90 — high enough that you would '
                        + 'struggle to tell it from the original at full zoom.',
                },
                {
                    type: 'p',
                    text: 'A HEIC file can hold more than one picture. Live Photos, Portrait depth maps and burst '
                        + 'frames all live in the same container, and only the main image is converted. The JPG '
                        + 'you download is the frame you see in your camera roll, on its own.',
                },
                {
                    type: 'p',
                    text: 'The download keeps the original name inside a Resizo prefix, so a photo that arrived '
                        + 'as IMG_4821.HEIC leaves as resizo-converted-IMG_4821.jpg — still recognisable, and '
                        + 'obvious which file it came from.',
                },
            ],
        },
        {
            id: 'renaming',
            heading: 'Renaming the file to .jpg does not work',
            blocks: [
                {
                    type: 'p',
                    text: 'This is the first thing almost everyone tries, and it is worth saying plainly: changing '
                        + 'the extension changes the label on the file, not the bytes inside it. A HEIC renamed to '
                        + '.jpg is still HEIF-encoded data, and any program that opens it reads the first few '
                        + 'bytes of the file rather than trusting the name.',
                },
                {
                    type: 'p',
                    text: 'What you get is either nothing at all or an error about a damaged file — and on an '
                        + 'upload form, a rejection after the upload has already finished. The drop zone on this '
                        + 'page reads those same first bytes the moment the file lands, so a renamed file is '
                        + 'named for what it actually is instead of failing halfway through.',
                },
            ],
        },
        {
            id: 'where-jpg-is-required',
            heading: 'Where a JPG is the only thing that works',
            blocks: [
                {
                    type: 'ul',
                    items: [
                        'Application forms — jobs, visas, universities, insurance claims. Most of them list '
                            + 'JPG and PNG and stop there.',
                        'Print. Photo kiosks in shops, online print labs and office printers driven from '
                            + 'older software mostly do not know what a HEIC is.',
                        'Documents. Dropping a HEIC into Word, PowerPoint or a slide deck someone else will '
                            + 'open tends to leave a placeholder where the picture should be.',
                        'Anything you are sending to a mixed audience. A JPG opens on a fifteen-year-old '
                            + 'laptop; a HEIC needs software from the last few years.',
                        'Older Android handsets and the apps on them, which read HEIF inconsistently even '
                            + 'when the system supports it.',
                    ],
                },
            ],
        },
        {
            id: 'size',
            heading: 'The JPG will be bigger — plan for it',
            blocks: [
                {
                    type: 'p',
                    text: 'HEIC is roughly twice as efficient as JPEG, so the same picture written as a JPG is '
                        + 'usually about twice the size. A 2 MB photo off an iPhone commonly lands somewhere near '
                        + '4 MB. That is not a fault in the conversion; it is the cost of a format everything can '
                        + 'read.',
                },
                {
                    type: 'p',
                    text: 'If the form you are filling in has a size cap, deal with it after the conversion rather '
                        + 'than before. Compress the JPG to a byte target — the '
                        + '[200 KB](/compress-image-to-200kb) and [100 KB](/compress-image-to-100kb) '
                        + 'pages are set up for exactly that — or cut the pixel dimensions first with the resizer, '
                        + 'which shrinks a file faster than any quality setting can.',
                },
            ],
        },
        {
            id: 'one-at-a-time',
            heading: 'One photo at a time, and what to do about a folder',
            blocks: [
                {
                    type: 'p',
                    text: 'This converter handles a single photo per pass, up to 20 MB, which covers every still '
                        + 'an iPhone produces with room to spare. There is no batch mode for HEIC — the bulk '
                        + 'resizer takes JPEG, PNG and WebP only, so a folder of HEICs has to come through '
                        + 'here one at a time. Since your own device does the decoding, a run of them is only as '
                        + 'fast as the machine you are on, and there is no queue to wait in.',
                },
                {
                    type: 'p',
                    text: 'If you are converting the same photos every week, the better fix is upstream — the '
                        + '[HEIC tool page](/heic) '
                        + 'walks through the camera setting that stops your iPhone writing HEIC in the first '
                        + 'place, and what it costs you in storage.',
                },
            ],
        },
    ],

    limitations: [
        'The HEIF decoder is a WebAssembly module the page downloads on first use, so the first conversion of '
            + 'a session waits for that download.',
        'A full-resolution decode followed by a JPEG encode needs room for several copies of the photo at '
            + 'once, and a phone that is short of it is told the job will not fit.',
        'The drop zone reads one photo per pass and refuses anything past 20 MB, so a camera roll has to be '
            + 'worked through file by file.',
    ],

    faqs: [
        {
            question: 'Can I just rename the file from .heic to .jpg?',
            answer: 'No. The extension is a label; the bytes inside are still HEIF, and every program that '
                + 'matters reads the bytes. Renaming usually produces a file that will not open at all, or an '
                + 'error saying the file is damaged. The picture has to be decoded and written out again as JPEG, '
                + 'which is what this page does.',
        },
        {
            question: 'Does the JPG keep the date and location of the photo?',
            answer: 'No. Nothing from the HEIC metadata is copied into the JPG, so the date taken, the camera '
                + 'model and the GPS coordinates are all gone. That is good if you are posting the photo '
                + 'somewhere public and inconvenient if you were sorting a library by date, so keep the original '
                + 'HEIC if the date matters to you.',
        },
        {
            question: 'Does a Live Photo keep its movement?',
            answer: 'No. A Live Photo is a still image plus a short video, and only the still is converted. The '
                + 'JPG is the frame you see in your camera roll, at full resolution. The motion, the depth map '
                + 'from Portrait mode and any burst frames stay behind in the original file.',
        },
        {
            question: 'Can I convert several HEIC photos at once?',
            answer: 'This converter takes one photo per pass. For a whole camera roll it is faster to change what '
                + 'the phone writes: on your iPhone open Settings, tap Camera, tap Formats and choose Most '
                + 'Compatible, and every new photo is a JPEG from then on.',
        },
        {
            question: 'Is the JPG good enough to print?',
            answer: 'Yes. The photo keeps every pixel it had — nothing is scaled down — and it is written at '
                + 'quality 90, which is high enough that the difference from the original is very hard to see. A '
                + '12-megapixel iPhone photo at that setting prints cleanly well past A4.',
        },
        {
            question: 'Is the photo sent anywhere to convert it?',
            answer: 'No. The HEIC decoder is loaded into the page, and your photo is read, converted and saved '
                + 'by your own device, so it never reaches us and there is nothing for us to keep. The JPG that '
                + 'comes back carries no EXIF or GPS data at all — which is worth knowing either way, because an '
                + 'iPhone photo normally records exactly where it was taken.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default heicToJpg;
