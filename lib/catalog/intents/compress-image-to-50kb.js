/**
 * /compress-image-to-50kb — the page about pixels as much as bytes.
 *
 * Not the 100 KB page with a smaller number. At 100 KB a full-size photograph
 * is merely uncomfortable; at 50 KB it is arithmetically impossible, so this
 * page is the one that opens with the shrinking policy already selected and
 * spends its copy on the consequence: what pixel size a 50 KB budget can
 * actually carry, how to find the size a form wants before compressing, and
 * why a plain background is worth more here than any encoder setting. The
 * pictures it is written for are small and documentary — an application
 * portrait, a certificate scan, a photographed ID page.
 */
const compressImageTo50kb = {
    slug: 'compress-image-to-50kb',
    tool: 'compress',
    kind: 'target',
    preset: { targetKb: 50, policy: 'fit' },
    label: 'Compress to 50 KB',
    blurb: 'A 50 KB ceiling on an application photo or a scan, where the pixel size matters as much as the bytes',
    title: 'Compress Image to 50KB for Application Forms | Resizo',
    h1: 'Compress a Photo to 50 KB',
    intro: 'The target reads 50 KB and the policy is set to fit underneath it: quality comes down first, then '
        + 'the pixel size, and the panel tells you which.',
    description: 'Compress an image to 50 KB on your own device — nothing is uploaded. The target and the '
        + 'fit-under policy are already set, so an application photo or a document scan comes back below '
        + '51,200 bytes with its finished pixel size printed beside it.',
    ogImage: '/og-compress.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'A 50 KB ceiling is really two limits in one, because the bytes a picture needs depend on how '
        + 'many pixels it keeps: 51,200 bytes is generous across a 600 by 800 head-and-shoulders photo and '
        + 'hopeless across a 12-megapixel phone frame. On Resizo the target opens at 50 KB with the '
        + 'fit-under-the-target policy already chosen: add the picture and quality is worked down first, with '
        + 'the picture stepped smaller only once quality alone cannot reach the number, and the finished '
        + 'dimensions, the finished bytes and the quality used all printed together. The encoders are code '
        + 'the page carries with it, and they run in this tab on your own device, so the certificate or the '
        + 'identity page you are shrinking stays on the machine in front of you.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Works the quality of a JPEG or WebP down as far as 50, which is where the blocking starts to '
                + 'show around eyes and lettering.',
            'Takes a fifth off each side once that floor is reached, so an untouched phone frame gets under '
                + '51,200 bytes by giving up pixels.',
            'Reports the pixel size it finished on beside the byte figure, so you can check it against the '
                + 'box an application form asked for.',
        ],
        doesNot: [
            'Cannot land on an exact width a portal demands, because the steps are fixed — [type those '
                + 'pixels in first](/resize) when one is named.',
            'Never moves the width or height under Keep the dimensions; quality becomes the only lever, at '
                + 'the size the picture arrived at.',
            'Applies no lossy pass to a PNG scan: the PNG encoder here is lossless, so a certificate gives '
                + 'up pixels rather than fidelity.',
        ],
    },

    application: {
        name: 'Compress Image to 50 KB',
        features: [
            'Opens at a 50 KB target with the fit-under policy already selected',
            'Works the quality down first and the pixel size second',
            'Holds JPEG and WebP quality at 50 or above, so a face never turns to blocks; a PNG is shrunk losslessly instead',
            'Prints the finished dimensions, the finished bytes and the quality used',
            'Runs on the device in front of you; the picture is never sent anywhere',
        ],
    },

    howTo: {
        id: 'how-to-compress-50kb',
        heading: 'How to compress a photo to 50 KB',
        description: 'Get an application photo or a document scan below 50 KB on the device you are sitting at, '
            + 'and read what it cost in pixels.',
        steps: [
            {
                name: 'Start from the numbers the form gives you',
                text: 'Note the byte ceiling, and note any width and height beside it. If exact pixels are named, '
                    + 'set those before you compress anything; if only the ceiling is stated, this page can pick the '
                    + 'dimensions for you.',
            },
            {
                name: 'Add the photo or the scan',
                text: 'Drag a JPEG, PNG or WebP into the panel above, or pick one from your files. It is read where '
                    + 'it already sits, so there is no waiting for a transfer.',
            },
            {
                name: 'Run it with fit under the target',
                text: 'The target already reads 50 KB and the policy already reads fit, so press the Compress image '
                    + 'button. Quality is searched first, and the picture is only stepped down if the search runs out '
                    + 'of room.',
            },
            {
                name: 'Read the dimensions, not only the size',
                text: 'The result gives you three figures: how many pixels the picture ended up with, how many bytes '
                    + 'it weighs, and the quality that got it there. Check the pixel size is still big enough for '
                    + 'whatever you are filling in, then download it.',
            },
        ],
    },

    sections: [
        {
            id: 'fifty-kilobytes-in-pixels',
            heading: 'What a 50 KB budget works out to, pixel by pixel',
            blocks: [
                {
                    type: 'p',
                    text: '50 KB is 51,200 bytes, and eight bits to the byte makes 409,600 bits for the whole '
                        + 'picture — every pixel of it, colour included. Share that out across the pixels you plan '
                        + 'to keep and you have the real answer to whether 50 KB is generous or absurd, long before '
                        + 'any encoder is involved.',
                },
                {
                    type: 'table',
                    caption: 'How far 409,600 bits stretch across the picture sizes this page is written for',
                    columns: [
                        { key: 'picture', label: 'What the picture is', rowHeader: true },
                        { key: 'size', label: 'Example size in pixels', mono: true },
                        { key: 'budget', label: 'Bits each pixel gets', mono: true },
                        { key: 'outcome', label: 'How that tends to turn out' },
                    ],
                    rows: [
                        {
                            picture: 'Passport-style head and shoulders',
                            size: '413×531',
                            budget: '1.9',
                            outcome: 'Room to spare against a plain wall',
                        },
                        {
                            picture: 'Application portrait',
                            size: '600×800',
                            budget: '0.85',
                            outcome: 'The comfortable middle of this page',
                        },
                        {
                            picture: 'Identity page photographed close up',
                            size: '1000×1500',
                            budget: '0.27',
                            outcome: 'Crop away the desk and it holds together',
                        },
                        {
                            picture: 'Certificate scanned at 150 dpi',
                            size: '1240×1754',
                            budget: '0.19',
                            outcome: 'Flat white paper survives what a face would not',
                        },
                        {
                            picture: 'Untouched phone frame',
                            size: '4032×3024',
                            budget: '0.03',
                            outcome: 'Out of reach at full size, which is why this page shrinks',
                        },
                    ],
                },
                {
                    type: 'p',
                    text: 'Those sizes are illustrations, not rules — read whatever you are filling in for the '
                        + 'figures it actually wants. What the arithmetic settles is the direction of travel: below '
                        + 'roughly half a bit per pixel a photographed face starts to smear, and no compressor '
                        + 'invents its way out of that. Fewer pixels, described properly, beat a lot of pixels '
                        + 'described badly.',
                },
            ],
        },
        {
            id: 'pixel-size-first',
            heading: 'Find the width and height the form wants, then set them',
            blocks: [
                {
                    type: 'p',
                    text: 'Plenty of application forms name two numbers rather than one: a ceiling in kilobytes and '
                        + 'a photo size in pixels, sometimes with a minimum as well as a maximum. Some portals show '
                        + 'the pixel figure only in a help sheet beside the field, or in a note under the file '
                        + 'picker, so it is worth a look before anything is compressed.',
                },
                {
                    type: 'p',
                    text: 'Where an exact width and height are asked for, dial them in with [the resizer](/resize) '
                        + 'first and bring the finished file back here. The shrinking on this page moves in fixed '
                        + 'steps and aims only at the byte figure, so it has no way of stopping on somebody else’s '
                        + 'number — when a portal is checking the pixels too, [type them in yourself](/resize) '
                        + 'rather than hoping the automatic steps land on them.',
                },
                {
                    type: 'p',
                    text: 'Where only a byte ceiling is given, there is nothing to look up and nothing to set. Add '
                        + 'the picture and let the policy choose the dimensions; the figures it settles on are '
                        + 'printed with the result, so you can still see what you are about to attach.',
                },
            ],
        },
        {
            id: 'quality-then-pixels',
            heading: 'Quality first, pixels second, and never behind your back',
            blocks: [
                {
                    type: 'p',
                    text: 'Two policies sit above the target. Fit under the target, which is the one selected here, '
                        + 'is allowed to make the picture smaller. Keep dimensions is one tap away and refuses to '
                        + 'touch the width and height at all.',
                },
                {
                    type: 'p',
                    text: 'Under the fit policy the quality dial of a JPEG or WebP is searched first, and it stops at 50: below that '
                        + 'the tell-tale squares appear around eyes and lettering, and a portrait that has gone '
                        + 'mottled is no more use to a form than one that is too big. If quality 50 at the original '
                        + 'size still overshoots, a fifth is taken off each side, the search runs again at the new '
                        + 'size, and that repeats — eight steps at most, and never past 32 pixels on the short side.',
                },
                {
                    type: 'p',
                    text: 'Nothing about that happens quietly. The policy is a control you can see and change, and '
                        + 'the result states in plain words when the dimensions came down, alongside the pixel '
                        + 'figures, the byte figure and the quality that produced them. Switch to keep dimensions '
                        + 'and the width and height are guaranteed instead: quality alone moves, and if 50 KB '
                        + 'genuinely cannot be reached that way you are given the smallest size the picture managed '
                        + 'rather than a file that misses the ceiling.',
                },
            ],
        },
        {
            id: 'plain-backgrounds',
            heading: 'Why a blank wall behind you is worth thousands of bytes',
            blocks: [
                {
                    type: 'p',
                    text: 'An encoder spends its bits where neighbouring pixels disagree with each other. A face '
                        + 'lit evenly against a blank wall is mostly gentle gradient, which costs almost nothing to '
                        + 'describe, so nearly the whole budget goes on the eyes, the hairline and the mouth — the '
                        + 'parts anyone looking at the photo will actually judge.',
                },
                {
                    type: 'p',
                    text: 'Put a bookcase, a patterned curtain or a busy street behind the same head and every one '
                        + 'of those edges competes for the same 51,200 bytes. That is why two portraits at identical '
                        + 'dimensions can come out at very different sizes, and why moving a step in front of a '
                        + 'plain wall does more for a tight target than any setting on this page. Even lighting '
                        + 'helps for the same reason: a hard shadow across the background is detail too.',
                },
            ],
        },
        {
            id: 'scans-and-png',
            heading: 'Certificate scans, and what to do when yours is a PNG',
            blocks: [
                {
                    type: 'p',
                    text: 'A scan usually arrives with things around the document that nobody asked for: the lid of '
                        + 'the scanner, a strip of desk, the shadow down one edge, the corner of whatever was '
                        + 'underneath. All of it is texture, all of it is charged for, and none of it is the '
                        + 'certificate. [Trim it to the document](/crop) before compressing and the same 50 KB is '
                        + 'spent entirely on the part that has to stay readable.',
                },
                {
                    type: 'p',
                    text: 'A PNG has no quality dial in this build — the encoder is lossless, so there is no knob '
                        + 'to turn down and a search would hand back the same file every time. Under the fit policy '
                        + 'a PNG is therefore stepped down in size instead, losslessly, until it fits, which suits '
                        + 'flat black-on-white lettering better than it suits a face. Choose keep dimensions and '
                        + 'WebP is offered instead, which reaches the number at the full pixel size.',
                },
                {
                    type: 'p',
                    text: 'If what you have is really a photograph that happens to be saved as a PNG, it is worth '
                        + 'changing it over first: [make it a JPEG](/png-to-jpg) and the quality search becomes '
                        + 'available again, which usually means keeping more pixels than the lossless route can.',
                },
            ],
        },
    ],

    limitations: [
        'The automatic shrink moves in fixed steps, so it cannot land on an exact width and height a form has asked for.',
        'JPEG and WebP quality is held at 50 or above under this policy, so a very large photograph gets under 50 KB by giving up pixels rather than by turning blocky; a PNG has no quality dial and is shrunk losslessly.',
        'The stepping stops after eight goes, or once the short side reaches 32 pixels, and you are told plainly if the target was still missed.',
    ],

    faqs: [
        {
            question: 'What pixel size should an application photo be for 50 KB?',
            answer: 'Whatever the form asks for — that number belongs to whoever is collecting the photo, not to '
                + 'the compressor. If nothing is stated, a head-and-shoulders picture somewhere around 600 by 800 '
                + 'sits comfortably inside 50 KB with quality left over, and stays large enough to look at. Set it '
                + 'in the resizer first when an exact figure is demanded.',
        },
        {
            question: 'The result says my photo was made smaller. Can I stop that?',
            answer: 'Yes. The policy above the target is the switch: move it to keep dimensions and the width and '
                + 'height are left exactly as they were, with only the quality dial moving. The trade is that 50 KB '
                + 'may then be unreachable, in which case you are shown the smallest size that picture could manage '
                + 'and can decide for yourself what to do about it.',
        },
        {
            question: 'Why does quality stop at 50 instead of going lower?',
            answer: 'Because past that point the damage shows in exactly the places a reviewer looks. Blocks form '
                + 'around eyelashes, ringing appears along printed letters, and skin goes patchy. Taking pixels away '
                + 'is the kinder trade at that stage: a smaller picture that still looks like a photograph beats a '
                + 'full-size one that has fallen apart.',
        },
        {
            question: 'My scan is a PNG and it will not come down to 50 KB.',
            answer: 'PNG here is lossless, so there is no quality to lower and only the pixel count is left to give. '
                + 'Under the fit policy the scan is stepped down until it fits, which flat lettering tolerates well. '
                + 'Keep dimensions instead and WebP is offered at the original size. A scan that is really a '
                + 'photograph does better as a JPEG.',
        },
        {
            question: 'How much smaller does each step make the picture?',
            answer: 'A fifth off each side, so roughly a third of the pixels go with every step and the shape of the '
                + 'picture is kept. Eight steps at most, which takes a side to about a sixth of what it started at, '
                + 'and it never goes below 32 pixels on the short side. The dimensions you finish with are on screen '
                + 'next to the file size.',
        },
        {
            question: 'Is it safe to compress a photo of my ID here?',
            answer: 'The compressing code is fetched by the page and then does its work inside this tab, on your own '
                + 'device, which is the whole reason a document like that can be handled here at all — it never '
                + 'travels. The picture that comes out is rebuilt from the pixels alone, so the date, the camera '
                + 'model and any location tag your phone attached do not come with it.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default compressImageTo50kb;
