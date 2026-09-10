/**
 * /resize-png — the resizer with PNG-specific copy.
 *
 * PNG is the opposite case to /resize-jpg: no re-compression to worry about,
 * but an alpha channel to preserve, a file size that follows content rather
 * than pixel count, and a set of icon dimensions people are actually looking
 * for when they search this. The tool takes no preset: the format select sits
 * on Original, so a PNG in is a PNG out, and what is specific to this page is
 * the writing.
 */
import { formatFileSize } from '@/lib/format/bytes';
import { MAX_DIMENSION, MAX_FILE_SIZE, MAX_PIXELS } from '@/lib/limits';

const resizePng = {
    slug: 'resize-png',
    tool: 'resize',
    kind: 'format',
    preset: null,
    label: 'Resize a PNG',
    blurb: 'Logo, icon or screenshot, where the transparency and the hard edges have to survive',
    title: 'Resize PNG Online — Transparency Kept, Lossless | Resizo',
    h1: 'Resize a PNG',
    intro: 'Exact pixels or a percentage, with the transparency intact and no compression artefacts.',
    description: 'Resize a PNG online free, without uploading it. Exact pixel dimensions or a '
        + 'percentage, transparency kept, and no compression artefacts because PNG is lossless. Icons, logos '
        + 'and screenshots, resized on your own device. No account.',
    ogImage: '/og-resize.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'Resizing a PNG is a different job from resizing a photograph: a logo, an icon or a '
        + 'screenshot has to come out the other side with its transparent areas and its hard edges '
        + 'intact. On Resizo you type the new width in pixels, add the PNG, and press Resize image — '
        + 'the result is a PNG again, still see-through where it was see-through, and written without '
        + "any loss, because nothing here reduces a PNG's colours. The resampling and the rewrite are "
        + 'both done by your own browser, on code the page carries with it, so the file stays on your '
        + 'machine from start to finish.',

    /** What this page changes about a file, and what it leaves alone. */
    changes: {
        does: [
            'Resamples the alpha channel alongside the colour, so a half-transparent pixel on an '
                + 'anti-aliased curve keeps its exact opacity.',
            'Writes a fresh full-colour PNG with nothing quantised away, because the encoder in this build '
                + 'has no quality control at all.',
            'Moves the byte count only as far as the content allows: flat interface colour collapses, '
                + 'photographic detail barely shifts.',
        ],
        doesNot: [
            'Adds no blocking or ringing of the kind a re-saved JPEG picks up, however many times the same '
                + 'file goes through.',
            'Cannot restore what a step down removed — scaling 1024 pixels to 256 and back gives a soft '
                + 'copy, never the master again.',
            'Holds no nearest-neighbour mode, so pixel art comes back with its hard single-pixel steps '
                + 'blended into soft gradients.',
        ],
    },

    application: {
        name: 'PNG Image Resizer',
        features: [
            'Resize a PNG to exact pixel dimensions',
            'Scale by percentage',
            'Keeps the alpha channel',
            'Lossless, full-colour PNG output with no palette reduction',
            'Aspect-ratio lock',
        ],
    },

    howTo: {
        id: 'how-to-resize-png',
        heading: 'How to resize a PNG',
        description: 'Resize a PNG to exact pixel dimensions or a percentage on your own device, with the '
            + 'transparency intact.',
        steps: [
            {
                name: 'Set the size you want',
                text: 'Type a width and a height in pixels, or switch to Percent. The sizes further down the page are '
                    + 'the ones favicons, app icons and logos are usually asked for at.',
            },
            {
                name: 'Choose the PNG on your device',
                text: `Drag it onto the panel above or press Choose an image, up to ${formatFileSize(MAX_FILE_SIZE)}. `
                    + 'Nothing about it is sent anywhere.',
            },
            {
                name: 'Press Resize image',
                text: 'Your device redraws the picture at the new size and writes a new PNG. The alpha channel comes '
                    + 'through, and nothing is quantised away.',
            },
            {
                name: 'Download the new PNG',
                text: 'The panel prints the size before and after and the dimensions produced. A PNG that grows rather '
                    + 'than shrinks is normal on a resize up, and the numbers show it.',
            },
        ],
    },

    sections: [
        {
            id: 'lossless',
            heading: 'Lossless, but not reversible',
            blocks: [
                {
                    type: 'p',
                    text: 'PNG stores every pixel exactly. Nothing is approximated on the way in or out, so a '
                        + 'resized PNG carries none of the blocking or ringing that a re-saved JPEG picks up, and '
                        + 'you can open and re-save it as often as you like without any accumulating damage. The '
                        + 'PNG encoder in this page has no quality setting to get wrong: the output is always '
                        + 'full colour, with nothing quantised away.',
                },
                {
                    type: 'p',
                    text: 'Lossless is not the same as reversible, though. Going from 1024 pixels to 256 throws '
                        + 'away three quarters of the information in each direction, and it is gone — scaling the '
                        + 'result back up produces a soft 1024-pixel image, not the one you started with. Keep the '
                        + 'largest version you have as the master and export the smaller sizes from it.',
                },
            ],
        },
        {
            id: 'transparency',
            heading: 'Transparency and hard edges',
            blocks: [
                {
                    type: 'p',
                    text: 'The alpha channel is resampled along with the colour, so transparency survives the '
                        + 'resize completely: fully clear stays clear, and the partly transparent pixels along an '
                        + 'anti-aliased curve keep their exact degree of transparency. A logo shrunk here still '
                        + 'drops cleanly onto any background.',
                },
                {
                    type: 'p',
                    text: 'The one thing to keep an eye on is very fine detail. Thin one-pixel outlines and small '
                        + 'text baked into an image are close to the limit of what any resampler can represent '
                        + 'once the image is small; below roughly 100 pixels they tend to go faint. If the artwork '
                        + 'exists as a vector file, exporting from that at the target size beats resizing a '
                        + 'bitmap every time.',
                },
            ],
        },
        {
            id: 'size-follows-content',
            heading: 'PNG file size follows content, not pixel count',
            blocks: [
                {
                    type: 'p',
                    text: 'Halving both sides of a JPEG reliably takes most of the bytes with it. PNG does not '
                        + 'behave that way, because it compresses by finding repetition rather than by discarding '
                        + 'detail. A screenshot of a mostly-flat interface can shrink dramatically. A photograph '
                        + 'saved as a PNG stays heavy at any size, because there is no repetition to find.',
                },
                {
                    type: 'p',
                    text: 'If that is the situation you are in, the format is the problem rather than the '
                        + 'dimensions. Send the photograph to [PNG to JPG](/png-to-jpg) if it has no transparency, '
                        + 'or to [PNG to WebP](/png-to-webp) if it does.',
                },
            ],
        },
        {
            id: 'icon-sizes',
            heading: 'The PNG sizes people usually need',
            blocks: [
                {
                    type: 'table',
                    caption: 'Common PNG icon and asset dimensions',
                    columns: [
                        { key: 'use', label: 'Use', rowHeader: true },
                        { key: 'pixels', label: 'Pixels', mono: true },
                        { key: 'note', label: 'Notes' },
                    ],
                    rows: [
                        { use: 'Favicon', pixels: '32×32', note: 'The one browsers show in a tab. 16×16 is the fallback.' },
                        { use: 'Apple touch icon', pixels: '180×180', note: 'Saved to the home screen on an iPhone or iPad.' },
                        { use: 'Web app icon, small', pixels: '192×192', note: 'The Android home-screen size in a web manifest.' },
                        { use: 'Web app icon, large', pixels: '512×512', note: 'Splash screens and app listings.' },
                        { use: 'Avatar or profile mark', pixels: '512×512', note: 'Large enough for every service to downscale from.' },
                    ],
                },
                {
                    type: 'p',
                    text: 'Type the number into the width field with the ratio lock on and the height fills itself '
                        + 'in. Square icons are easiest to get right if the source is already square — otherwise '
                        + 'setting both sides scales the image up to cover the frame and trims the overflow, which '
                        + 'is a crop rather than a squash.',
                },
            ],
        },
        {
            id: 'limits',
            heading: 'What happens to your file',
            blocks: [
                {
                    type: 'p',
                    text: `${formatFileSize(MAX_FILE_SIZE)} per file and ${MAX_DIMENSION} pixels on the longest `
                        + 'side. Resizing a [JPG instead](/resize-jpg) involves a re-encode and has its own page.',
                },
                {
                    type: 'p',
                    text: 'The resizing is done by your own device. The PNG is opened where it already is and '
                        + 'the resized one is written on the same machine, so nothing is transmitted and there '
                        + 'is no copy of it anywhere else. The output is built from raw pixels, which is why it '
                        + 'carries no EXIF or GPS data. A very large PNG needs a lot of memory to open, so the '
                        + 'panel checks what this device can spare before it starts.',
                },
            ],
        },
    ],

    limitations: [
        'A palette PNG is rewritten as a full-colour RGBA image, so an eight-colour icon can come back '
            + 'heavier than it went in.',
        'A 16-bit-per-channel PNG comes back at 8 bits a channel, because the pixels cross from decoder to '
            + 'encoder through an 8-bit buffer.',
        `An output past ${Math.round(MAX_PIXELS / 1_000_000)} megapixels is refused, so `
            + `${MAX_DIMENSION}×${MAX_DIMENSION} is turned down even though neither side breaks the `
            + 'per-side cap.',
    ],

    faqs: [
        {
            question: 'Does resizing a PNG lose quality?',
            answer: 'There is no compression loss — PNG is lossless, so the file is stored exactly as it is '
                + 'written, and saving it a hundred times changes nothing. What you do lose is pixels: shrinking '
                + 'an image throws away detail permanently, and enlarging it later cannot bring that detail back.',
        },
        {
            question: 'Does the transparent background survive?',
            answer: 'Yes, as long as the output format stays PNG or WebP. The alpha channel is resampled along '
                + 'with the colour, so a cut-out keeps its clean edge and a soft shadow stays soft. Choosing JPEG '
                + 'as the output is the one thing that destroys it — JPEG has no alpha channel, so every '
                + 'transparent pixel is filled with white, or with whatever colour you pick instead.',
        },
        {
            question: 'Why is my resized PNG still so large?',
            answer: 'PNG size follows what is in the picture, not just how many pixels there are. Flat colour '
                + 'compresses enormously; photographic detail barely compresses at all. If the image is a '
                + 'photograph that happens to be saved as a PNG, no amount of resizing will fix the file size — '
                + 'convert it to JPG or WebP instead.',
        },
        {
            question: 'Can I enlarge a PNG logo without it going fuzzy?',
            answer: 'Not from the PNG. A PNG is a grid of pixels, and enlarging one spreads the pixels it has '
                + 'across a bigger grid. If the logo was drawn in a vector program, go back to that file and '
                + 'export at the size you need — a vector master can be exported at any size perfectly sharp.',
        },
        {
            question: 'Will pixel art stay crisp?',
            answer: 'No. The resampler here is a smooth one, which is right for photographs and logos and wrong '
                + 'for pixel art: the hard single-pixel steps get blended into soft gradients. Pixel art needs a '
                + 'nearest-neighbour resize, which is a different job from the one this tool does.',
        },
        {
            question: 'Can I resize a PNG without uploading it?',
            answer: 'That is the only way this tool works. The resizing software is loaded into the page, and '
                + 'your PNG is read, scaled and saved by your own device, so it never reaches us and there is '
                + 'nothing for us to keep. The new file is written from raw pixels, so it carries no EXIF or '
                + 'GPS data.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-09-09',
    indexable: true,
};

export default resizePng;
