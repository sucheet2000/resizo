/**
 * /compress-image-to-100kb — the form-filling page.
 *
 * The compressor opens in target mode with 100 KB already typed in, so the
 * first drop is the whole job. The copy is about the requirement behind the
 * query: who imposes a 100 KB ceiling, why the result lands just under rather
 * than exactly on it, and what to do when a photograph cannot get there without
 * falling apart.
 */
import { TARGET_SEARCH_ITERATIONS } from '@/lib/limits';

const compressImageTo100kb = {
    slug: 'compress-image-to-100kb',
    tool: 'compress',
    kind: 'target',
    preset: { targetKb: 100 },
    label: 'Compress to 100 KB',
    blurb: 'A form that rejects anything over 100 KB — job portals and government uploads mostly',
    title: 'Compress Image to 100KB Without Uploading | Resizo',
    h1: 'Compress an Image to 100 KB',
    intro: 'The target is already set to 100 KB. Drop a JPEG, PNG or WebP and the result comes back at or under it.',
    description: 'Compress an image to 100 KB without uploading it. The target is already set — drop a '
        + 'JPEG, PNG or WebP and your own device searches the encoder until the result fits under 100 KB. For '
        + 'the portals and forms that reject anything larger.',
    ogImage: '/og-compress.jpg',

    /** The direct answer, written to stand on its own away from this page. */
    answer: 'When a form refuses anything over 100 KB, guessing at a quality setting is the slow way '
        + 'round: the picture has to be encoded, measured against the limit — 102,400 bytes — and '
        + 'encoded again until it lands at or under it. On Resizo that target is already filled in at '
        + '100 KB, so you add the photo, press Compress image, and the panel tells you the size it '
        + 'actually reached. The search costs up to eight full-resolution encodes on a JPEG and every '
        + 'one of them runs on your own device, on a compressor the page downloads, so the document '
        + 'you are about to submit is never sent anywhere.',

    application: {
        name: 'Compress Image to 100 KB',
        features: [
            'Target size preset to 100 KB',
            'Runs on your own device — the file is never uploaded',
            'Binary-searches the encoder and reports the size achieved',
            'Never returns a file above the target',
            'JPEG, PNG and WebP',
        ],
    },

    howTo: {
        id: 'how-to-compress-100kb',
        heading: 'How to compress an image to 100 KB',
        description: 'Bring a JPEG, PNG or WebP under a hard 100 KB limit on your own device, with the size '
            + 'reached reported back.',
        steps: [
            {
                name: 'Leave the target where it is',
                text: 'The panel opens in target mode with 100 KB already typed in, so there is nothing to set unless '
                    + 'the form you are filling in asks for a different number.',
            },
            {
                name: 'Choose the image on your device',
                text: 'Drop a JPEG, PNG or WebP onto the panel above, or press Browse files. The file stays on your '
                    + 'machine — there is no transfer step to sit through.',
            },
            {
                name: 'Press Compress image',
                text: 'Your device encodes the picture and measures the real byte length, up to '
                    + `${TARGET_SEARCH_ITERATIONS} times, keeping the best-looking version that still fits `
                    + 'under 100 KB.',
            },
            {
                name: 'Download the file and check the number',
                text: 'The panel prints the size it reached. If even the smallest encode overshoots you are told the '
                    + 'smallest size that image can reach, rather than handed a file that misses the limit.',
            },
        ],
    },

    sections: [
        {
            id: 'why-100kb',
            heading: 'Why so many forms stop at 100 KB',
            blocks: [
                {
                    type: 'p',
                    text: 'A 100 KB ceiling is almost never an aesthetic decision. It comes from the system on the '
                        + 'other side: a recruitment portal storing photographs for hundreds of thousands of '
                        + 'applicants, an examination board with a fixed field size, a government service built '
                        + 'against a database column that was sized years ago and never revisited.',
                },
                {
                    type: 'p',
                    text: 'Examination and recruitment portals are the most common source of it. They typically '
                        + 'ask for a passport-style photograph somewhere between 20 KB and 100 KB, and a scanned '
                        + 'signature between 10 KB and 20 KB, with the file rejected outright above the stated '
                        + 'figure. University applications, visa services and insurance claim uploads use the same '
                        + 'pattern. In every case the number is a hard ceiling rather than a suggestion, which is '
                        + 'why landing just underneath it is the only useful behaviour.',
                },
            ],
        },
        {
            id: 'at-or-under',
            heading: 'Why the result lands just under, not exactly on',
            blocks: [
                {
                    type: 'p',
                    text: 'No image encoder takes a byte count as an instruction. You can ask a JPEG encoder for '
                        + 'quality 62; you cannot ask it for 102,400 bytes, because the size that comes out '
                        + 'depends on the picture — a plain studio background and a photo of a forest produce '
                        + 'wildly different files from the same setting.',
                },
                {
                    type: 'p',
                    text: 'So the tool measures rather than predicting. It encodes at a probe quality, reads the '
                        + 'real length of the result, and bisects the quality range from there, up to '
                        + `${TARGET_SEARCH_ITERATIONS} times, keeping the best-looking version whose size still `
                        + 'fits. What you download is the largest file that stays under your number. It is '
                        + 'reported back to you in the panel next to the original size, so you can check it before '
                        + 'you submit anything.',
                },
            ],
        },
        {
            id: 'resize-first',
            heading: 'If it cannot reach 100 KB, cut the pixels first',
            blocks: [
                {
                    type: 'p',
                    text: 'There is a floor to what any image can be compressed to, and it is set by how many '
                        + 'pixels it has. A 12-megapixel photograph has twelve million pixels to describe; '
                        + 'squeezing that into 100 KB leaves well under a tenth of a bit per pixel, and the result '
                        + 'is visibly blocky whatever the encoder does.',
                },
                {
                    type: 'p',
                    text: 'When that happens the tool tells you the smallest size it could actually reach for your '
                        + 'file. The fix is to reduce the dimensions and try again — around 1000 to 1200 pixels on '
                        + 'the long side is a comfortable home for a 100 KB photograph, and it is more than enough '
                        + 'for any form that displays a headshot. [Resize it first](/resize), then come back here.',
                },
            ],
        },
        {
            id: 'photos-and-signatures',
            heading: 'Photographs and scanned signatures behave differently',
            blocks: [
                {
                    type: 'p',
                    text: 'A photograph is continuous tone, so lowering the JPEG quality is the right lever and '
                        + 'the search above finds it in a few encodes. A scanned signature is the opposite: black '
                        + 'ink on white paper, two colours doing almost all the work.',
                },
                {
                    type: 'p',
                    text: 'If that scan is a PNG there is nothing to turn down: the PNG encoder in this page is '
                        + 'lossless and has no quality setting, so the same bytes come out however many times you '
                        + 'run it. A signature scan is usually small enough that it fits anyway. When it does not, '
                        + 'the answer offered is WebP — which reaches the number at the full picture size — rather '
                        + 'than quietly handing you a smaller picture. If the scan is a JPEG, consider raising the '
                        + 'scanner contrast instead: clean white paper compresses far better than a grey, '
                        + 'speckled background.',
                },
            ],
        },
        {
            id: 'other-targets',
            heading: 'If the limit is not 100 KB',
            blocks: [
                {
                    type: 'p',
                    text: 'The number in the panel above is editable, so any target from 10 KB up to 20 MB works '
                        + 'on this page. There is also a [200 KB](/compress-image-to-200kb) version, which is the '
                        + 'other limit forms ask for most often and gives a full-size photo noticeably more room, '
                        + 'and the [main compressor](/compress) if you would rather work with a quality slider '
                        + 'than a byte target.',
                },
            ],
        },
    ],

    limitations: [],

    faqs: [
        {
            question: 'Will the file be exactly 100 KB?',
            answer: 'It will be at or just under, never over. There is no encoder setting that means "produce '
                + '102,400 bytes" — quality is the only dial, and what it produces depends on the picture. The '
                + 'tool encodes, measures, adjusts and repeats on your own device until it has the '
                + 'best-looking version that still fits, which is what a form with a ceiling actually needs.',
        },
        {
            question: 'What happens if my image cannot get down to 100 KB?',
            answer: 'You get told, with a number. Rather than handing back a file that misses the requirement, '
                + 'the tool reports the smallest size it could actually achieve for that image and asks you to '
                + 'raise the target. The usual fix is to reduce the pixel dimensions first and then compress '
                + 'again.',
        },
        {
            question: 'Does 100 KB mean 100,000 bytes or 102,400?',
            answer: '102,400 — one kilobyte is 1024 bytes here, which is what Windows, macOS and almost every '
                + 'upload form mean by KB as well. If a portal is strict to the byte and rejects the file anyway, '
                + 'set the target slightly lower, at 95 KB, and try again.',
        },
        {
            question: 'Will the photo still look acceptable at 100 KB?',
            answer: 'That depends almost entirely on the pixel dimensions, not on the compressor. Around 1000 to '
                + '1200 pixels on the long side, 100 KB is comfortable. Force a 4000-pixel photograph into the '
                + 'same 100 KB and the quality has to fall a long way to get there, so resize first.',
        },
        {
            question: 'Which formats can I compress?',
            answer: 'JPEG, PNG and WebP, up to 20 MB each. The output keeps the format it came in with. JPEG and '
                + 'WebP are compressed by lowering the encoder quality, which is the dial the search turns. PNG '
                + 'has no such dial — it is lossless and the encoder here has no quality setting at all — so a '
                + 'PNG is written once and either it fits or the panel offers you WebP instead.',
        },
        {
            question: 'Can I compress to 100 KB without uploading the file?',
            answer: 'Yes — nothing is uploaded here. The compressing software is downloaded into the page and '
                + 'runs there, so your file is read, re-encoded and saved by your own device and never reaches '
                + 'us. That matters more on this page than on most: the things people compress to 100 KB are '
                + 'passport scans, payslips and signatures, and none of them go anywhere. The output carries no '
                + 'EXIF or GPS data either.',
        },
    ],

    siblingLinks: null,
    sources: [],
    lastModified: '2026-08-12',
    indexable: true,
};

export default compressImageTo100kb;
