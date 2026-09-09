/**
 * /compress-image-to-20kb — the tiny-ceiling page.
 *
 * Not the 100 KB page with a smaller number. At 100 KB and 200 KB the quality
 * dial alone gets a full-size photograph there and the dimensions survive; at
 * 20 KB it does not, for anything much larger than a small square. So this
 * page is about the trade the other two never have to make: it opens on the
 * policy that is allowed to shrink the picture, and the copy is about the
 * things that genuinely live at this size — signature strips, avatars and
 * thumbnail fields — and about telling you exactly what was given up.
 */
import { FIT_MAX_STEPS, FIT_MIN_DIMENSION, FIT_MIN_QUALITY, FIT_SCALE_STEP } from '@/lib/limits';

/** The shrink step and where eight of them land, read off the engine's own constants. */
const SHRINK_STEP_PERCENT = Math.round(FIT_SCALE_STEP * 100);
const SMALLEST_SHARE_PERCENT = Math.round(FIT_SCALE_STEP ** FIT_MAX_STEPS * 100);

const compressImageTo20kb = {
    slug: 'compress-image-to-20kb',
    tool: 'compress',
    kind: 'target',
    preset: { targetKb: 20, policy: 'fit' },
    label: 'Compress to 20 KB',
    blurb: 'A 20 KB ceiling — signature strips, avatars and thumbnail fields, where the picture usually has to get smaller too',
    title: 'Compress Image to 20KB for Signatures and Thumbnails | Resizo',
    h1: 'Compress an Image to 20 KB',
    intro: 'The ceiling is set to 20 KB and this page may shrink the picture to reach it. Add a JPEG, PNG or WebP and it '
        + 'tells you exactly what it did.',
    description: 'Compress an image to 20 KB with nothing leaving your own device. The ceiling is preset and the page '
        + 'will reduce the pixels when quality alone cannot get a signature, avatar or thumbnail under 20,480 bytes.',
    ogImage: '/og-compress.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'Twenty kilobytes is 163,840 bits, which is roomy for a signature strip and nothing whatsoever for a '
        + 'phone photograph, so a ceiling this low is normally met by making the picture smaller rather than by '
        + 'grinding the quality down. On Resizo this page starts at 20 KB with shrinking permitted: add the picture '
        + `and the quality search runs first and stops at ${FIT_MIN_QUALITY}, and only then do the width and height begin stepping `
        + 'down, with the dimensions, the byte count and the quality all named underneath the finished picture. The '
        + 'compressor is code this page carries with it and runs in the tab you are reading, on your own device, '
        + 'so the scan you are about to attach never leaves your computer.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Searches the quality of a JPEG or WebP downward first and halts at '
                + `${FIT_MIN_QUALITY}, measuring the real length of every encode it writes.`,
            `Scales the picture to ${SHRINK_STEP_PERCENT}% of its width and height when that floor is still `
                + 'over the line, then searches the new size again.',
            'Prints the finished width, height, byte count and quality under the result, and says in a '
                + 'sentence when the picture was made smaller.',
        ],
        doesNot: [
            'Resizes nothing under Keep the dimensions: the pixel box you started with is held, and the '
                + 'quality search does all of the work.',
            'Never re-encodes a PNG lossily, because there is no quality dial for one here — under this '
                + 'policy it steps down in size instead.',
            'Hands back no file that quietly misses the ceiling; a target it cannot reach is reported with '
                + 'the smallest size the picture managed.',
        ],
    },

    application: {
        name: 'Compress Image to 20 KB',
        features: [
            'Opens at a 20 KB ceiling with shrinking already permitted',
            `Searches quality down to ${FIT_MIN_QUALITY}, then reduces the pixels in steps`,
            'States the final width, height, byte count and quality',
            'A keep-dimensions option that changes quality only',
            'Every step happens in this tab; the picture is not sent anywhere',
            'JPEG, PNG and WebP',
        ],
    },

    howTo: {
        id: 'how-to-compress-20kb',
        heading: 'How to compress an image to 20 KB',
        description: 'Reach a 20 KB ceiling on your own hardware, and be told what it cost in pixels and in quality.',
        steps: [
            {
                name: 'Decide whether the pixels may move',
                text: 'The ceiling is already 20 KB and the page is already allowed to make the picture smaller if it '
                    + 'has to. Where a field states a pixel box as firmly as it states the bytes, switch to keep '
                    + 'dimensions before you start.',
            },
            {
                name: 'Add the picture',
                text: 'Drag a JPEG, PNG or WebP into the panel above, or pick one from your files. It is read where it '
                    + 'already sits, so there is no transfer to wait through.',
            },
            {
                name: 'Let it search',
                text: `Quality is tried first and goes no lower than ${FIT_MIN_QUALITY}. If the ceiling is still out `
                    + `of reach, the picture is scaled to ${SHRINK_STEP_PERCENT}% of its width and height and the `
                    + `search begins again, up to ${FIT_MAX_STEPS} times.`,
            },
            {
                name: 'Read the three figures under the result',
                text: 'You get the width and height you finished on, the real byte count and the quality that produced '
                    + 'it, with a sentence saying so whenever the picture was made smaller. Download it once those figures '
                    + 'suit the field you are filling in.',
            },
        ],
    },

    sections: [
        {
            id: 'what-20kb-holds',
            heading: 'What 20 KB actually holds',
            blocks: [
                {
                    type: 'p',
                    text: 'Twenty kilobytes is 20,480 bytes, or 163,840 bits. That is the entire budget for describing '
                        + 'every pixel in the picture, and whether it is generous or absurd depends on nothing except '
                        + 'how many pixels there are to describe.',
                },
                {
                    type: 'table',
                    caption: 'A 20 KB budget across the pixel boxes small upload fields tend to use',
                    columns: [
                        { key: 'field', label: 'Kind of field', rowHeader: true },
                        { key: 'box', label: 'Pixel box', mono: true },
                        { key: 'budget', label: 'Bits per pixel', mono: true },
                        { key: 'reading', label: 'How it lands' },
                    ],
                    rows: [
                        { field: 'Signature strip', box: '300×100', budget: '5.5', reading: 'Ample; the ink stays crisp' },
                        { field: 'Small photograph', box: '200×230', budget: '3.6', reading: 'Ample for a face on plain backing' },
                        { field: 'Profile square', box: '400×400', budget: '1.0', reading: 'Workable; hair softens slightly' },
                        { field: 'Larger thumbnail', box: '600×600', budget: '0.45', reading: 'Fine detail begins to break up' },
                        { field: 'Web-sized photo', box: '1200×900', budget: '0.15', reading: 'Blocky whatever the encoder does' },
                        { field: 'Straight off a phone', box: '4000×3000', budget: '0.014', reading: 'Out of the question at this size' },
                    ],
                },
                {
                    type: 'p',
                    text: 'Those figures are before the file’s own headers take their cut, which on a JPEG is most of a '
                        + 'kilobyte before a single pixel is stored. Read the bottom two rows as the reason this page '
                        + 'behaves the way it does: past roughly half a bit for each pixel a photograph stops looking '
                        + 'like one, so anything much beyond a few hundred pixels a side has to give up pixels rather '
                        + 'than fidelity.',
                },
            ],
        },
        {
            id: 'signature-scans',
            heading: 'Scanned signatures, and why PNG often wins here',
            blocks: [
                {
                    type: 'p',
                    text: 'A signature is two tones doing all the work: dark ink, pale paper. PNG stores that kind of '
                        + 'picture by describing runs of identical colour, so a clean scan of a name frequently lands '
                        + 'in a couple of kilobytes with every stroke exactly as it was drawn.',
                },
                {
                    type: 'p',
                    text: 'JPEG works the other way round. It approximates, and approximation shows worst against a '
                        + 'hard edge — the grey halo that creeps around each stroke at low quality is the encoder '
                        + 'guessing at an edge it cannot afford to store. At the pixel boxes signature fields use, PNG '
                        + 'is regularly both smaller and cleaner, so try it that way first and change only if it will '
                        + 'not fit.',
                },
                {
                    type: 'p',
                    text: 'Either way, take the paper off before you compress. A photographed page is mostly margin, '
                        + 'and margin costs pixels this budget cannot spare — trimming to the ink alone is often the '
                        + 'whole fix. [The signature resizer](/signature-resizer) is the page built for that job; come '
                        + 'here when the crop is already right and only the number is wrong.',
                },
            ],
        },
        {
            id: 'how-it-gets-there',
            heading: 'How the ceiling is met, and where the page stops',
            blocks: [
                {
                    type: 'p',
                    text: 'Quality goes first. The encoder runs, the real length is measured, and the setting is '
                        + 'narrowed towards the best-looking version that still fits underneath the ceiling — but it '
                        + `halts at quality ${FIT_MIN_QUALITY}. Lower than that a JPEG shows blocking and ringing that `
                        + 'nobody wants on a document, so the floor is treated as a floor instead of grinding on '
                        + 'towards single digits.',
                },
                {
                    type: 'p',
                    text: `When quality ${FIT_MIN_QUALITY} at full size is still over the line, the picture is scaled `
                        + `to ${SHRINK_STEP_PERCENT}% of its width and height and searched again. That repeats at most `
                        + `${FIT_MAX_STEPS} times and never takes the short side under ${FIT_MIN_DIMENSION} pixels. `
                        + `All ${FIT_MAX_STEPS} steps land at roughly ${SMALLEST_SHARE_PERCENT}% of the width you `
                        + 'started with, which is enough to bring most photographs beneath a very small number.',
                },
                {
                    type: 'p',
                    text: 'None of that is silent. Permission to shrink is granted on this page before anything runs, '
                        + 'and the finished picture is labelled with the width and height it ended on next to the '
                        + 'bytes and the quality, in a sentence as well as in figures.',
                },
            ],
        },
        {
            id: 'keep-dimensions',
            heading: 'When the width and height cannot move',
            blocks: [
                {
                    type: 'p',
                    text: 'Switch to keep dimensions and only the quality is allowed to change: same width, same '
                        + 'height, and where 20 KB is genuinely beyond that picture you are told the smallest it could '
                        + 'be made rather than handed something over the line.',
                },
                {
                    type: 'p',
                    text: 'That answer is worth having on its own. Learning that a scan bottoms out at 34 KB tells you '
                        + 'the crop is too generous or the scan was made at too high a resolution, both of which you '
                        + 'can fix, whereas a file that quietly missed the requirement gets discovered by the form '
                        + 'instead of by you.',
                },
                {
                    type: 'p',
                    text: 'PNG needs a note of its own here. The PNG encoder in this build is lossless and carries no '
                        + 'quality control at all, so under keep dimensions there is nothing for a search to turn '
                        + 'down and WebP is offered instead, which reaches far smaller numbers at the same pixel size. '
                        + 'With shrinking permitted a PNG steps down in dimensions instead, and the encoding stays '
                        + 'lossless at every step even though there are fewer pixels left to encode.',
                },
            ],
        },
        {
            id: 'photographs',
            heading: 'A photograph will fight a ceiling this low',
            blocks: [
                {
                    type: 'p',
                    text: 'The last row of the table is the honest bad news: a twelve-megapixel picture has about a '
                        + 'hundredth of a bit for each of its pixels at this ceiling. No encoder turns that back into '
                        + 'a photograph, and a page that promised otherwise would simply be handing you a grey mess '
                        + 'with the right file size.',
                },
                {
                    type: 'p',
                    text: 'What works instead is being clear about what the field is for. If it wants a face, cut down '
                        + 'to the face and let the result be a couple of hundred pixels wide, where 20 KB is '
                        + 'comfortable. If it wants a document, a flat scan is far kinder to the encoder than a '
                        + 'hand-held photograph of the same page, where shadow, paper texture and a slight blur all '
                        + 'eat the budget before the writing does.',
                },
                {
                    type: 'p',
                    text: '[Trim the frame first](/crop) when the subject is buried in a wider shot. Halving each side '
                        + 'removes three quarters of the pixels, and every one of those is budget handed back to the '
                        + 'part of the picture anybody is going to look at.',
                },
            ],
        },
        {
            id: 'other-ceilings',
            heading: 'If the ceiling is not 20 KB',
            blocks: [
                {
                    type: 'p',
                    text: 'The figure above can be edited, so anything from 10 KB to 20 MB can be reached from this '
                        + 'page. [100 KB](/compress-image-to-100kb) and [200 KB](/compress-image-to-200kb) have pages '
                        + 'of their own because they behave differently: at those ceilings quality on its own usually '
                        + 'arrives, and the picture keeps the dimensions it came with. Where a slider suits you better '
                        + 'than a number, use the [main compressor](/compress).',
                },
            ],
        },
    ],

    limitations: [
        'Shrinking is a one-way trade — the pixels a step removes are gone from the file you download, though the '
            + 'original on your device is left alone.',
        `The short side is never taken below ${FIT_MIN_DIMENSION} pixels, so a picture that still misses the ceiling `
            + 'at that size is reported rather than reduced any further.',
        'A PNG cannot be made smaller by quality, because the encoder here has none; under keep dimensions the '
            + 'alternative offered is WebP.',
    ],

    faqs: [
        {
            question: 'Why did my picture come back smaller than I gave it?',
            answer: 'Because this page opens on the setting that permits it. At a ceiling this low the quality search '
                + `runs out on anything much bigger than a small square, so once it reaches ${FIT_MIN_QUALITY} the `
                + 'width and height start coming down in steps. The finished picture names the size it stopped at. '
                + 'Choose keep dimensions instead when the pixel box matters more to you than the ceiling does.',
        },
        {
            question: 'Is 20 KB enough for a passport-style photograph?',
            answer: 'At the pixel boxes those photographs are usually collected in, comfortably. Small photograph '
                + 'fields often sit around 200 by 230 pixels, which leaves roughly three and a half bits for each '
                + 'pixel — plenty for a face against plain backing. Hand the same ceiling a full-frame camera file '
                + 'and it comes back a fraction of the width it went in at.',
        },
        {
            question: 'Should a signature be saved as a PNG or a JPEG?',
            answer: 'Start with PNG. Ink on paper is mostly flat colour, which is the case PNG stores efficiently and '
                + 'exactly, and a tightly cropped signature usually fits without any argument. Move to JPEG when the '
                + 'scan is a photograph of a page rather than a scan of one, or when PNG will not come down far '
                + 'enough. Some fields accept only one of the two, so read what is asked for before you decide.',
        },
        {
            question: 'Does 20 KB mean 20,000 bytes or 20,480?',
            answer: '20,480. Kilo means 1024 in this context, exactly as it does in the file size your operating '
                + 'system shows you. A field written against a round twenty thousand is therefore asking for a little '
                + 'less than this page aims at, so set the figure to 19 KB if you suspect that is what you are up '
                + 'against.',
        },
        {
            question: 'The field refused my file even though it is under 20 KB. What now?',
            answer: 'Then the byte ceiling was not the only rule. Small upload fields commonly state a pixel box or a '
                + 'permitted format alongside it, and a few count a kilobyte as a round thousand. Compare the width '
                + 'and height printed under your result with what the field asked for, check it wants the format you '
                + 'saved, and if both match, run it again at a slightly lower figure.',
        },
        {
            question: 'Does the file leave my computer at any point?',
            answer: 'No. The compressor arrives as code alongside the page and does all of its work inside this tab, '
                + 'so a signature, an identity crop or a payslip is read and rewritten by your own machine and by '
                + 'nothing else. What you save is written out of raw pixels, which means it carries no EXIF or GPS '
                + 'data from the camera or scanner that made it.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default compressImageTo20kb;
