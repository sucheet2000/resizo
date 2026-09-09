/**
 * A complete, valid intent entry for the suites that need one and do not want
 * to depend on a shipped page: the contract test breaks one field at a time,
 * the renderer test checks what each field becomes on screen. It describes a
 * page that does not exist — a 50 KB compress target — so no test here can
 * pass by accident against real copy.
 *
 * The body is deliberately the length of a real page rather than the four
 * sentences it once was. The keyword-stuffing rule in lib/catalog/quality.js
 * measures a slug word as a SHARE of the body, and a share taken over eighty
 * words says nothing: the fixture would have failed a rule every shipped page
 * passes comfortably, purely for being short.
 */
export function validIntent(overrides = {}) {
    return {
        slug: 'compress-image-to-50kb',
        tool: 'compress',
        kind: 'target',
        preset: { targetKb: 50 },
        label: 'Compress to 50 KB',
        blurb: 'A form with an even tighter ceiling than the usual hundred kilobytes',
        title: 'Compress Image to 50KB Without Uploading | Resizo',
        h1: 'Compress an Image to 50 KB',
        intro: 'The target is already set to 50 KB.',
        description: 'Compress an image to 50 KB without uploading it. The target is already set.',
        ogImage: '/og-compress.jpg',
        answer: 'A 50 KB ceiling is tight. On Resizo the target is filled in, on your own device.',
        changes: {
            does: [
                'Re-encodes the picture at a lower quality setting until the file lands at or under the ceiling.',
                'Writes a fresh file out of raw pixels, so camera tags and location data do not survive into the copy.',
            ],
            doesNot: [
                'Leaves the width and height alone — nothing on this page scales the picture down.',
                'Touches the original on your machine, which stays where it was at its full size.',
            ],
        },
        application: { name: 'Compress Image to 50 KB', features: ['Target size preset to 50 KB'] },
        howTo: {
            id: 'how-to-compress-50kb',
            heading: 'How to compress an image to 50 KB',
            description: 'Bring a photo under 50 KB on your own device.',
            steps: [
                { name: 'Leave the target where it is', text: 'It opens at 50 KB.' },
                { name: 'Choose the image on your device', text: 'Drop it onto the panel.' },
                { name: 'Download the file', text: 'The panel prints the size reached.' },
            ],
        },
        sections: [
            {
                id: 'why-50kb',
                heading: 'Why a form stops at 50 KB',
                blocks: [
                    { type: 'p', text: 'A ceiling that low is a database column, not a taste. [Resize it first](/resize).' },
                    {
                        type: 'p',
                        text: 'Whoever wrote the form picked a number that fits the storage they had, and then everyone '
                            + 'filling it in has to live inside that number. It is rarely negotiable and it is almost never '
                            + 'explained, which is why a page like this one exists at all: the requirement arrives as a '
                            + 'rejection notice rather than as advice.',
                    },
                    {
                        type: 'p',
                        text: 'The useful thing to know is that the ceiling is about bytes and the picture is about pixels, '
                            + 'and the two only meet through the encoder. A wide photograph carries more pixels than a small '
                            + 'square does, so it needs a harsher setting to fit inside the same allowance, and the harsher '
                            + 'setting is what you see when the result comes back looking soft.',
                    },
                    { type: 'ul', items: ['Signature scans.', 'Thumbnails.'] },
                ],
            },
            {
                id: 'table',
                heading: 'What 50 KB buys',
                blocks: [
                    {
                        type: 'p',
                        text: 'The table underneath is the whole argument in numbers. Divide the allowance by the number of '
                            + 'pixels and you get the budget each one is allowed, and once that budget falls under about half '
                            + 'a bit no encoder alive keeps a photograph looking like a photograph.',
                    },
                    {
                        type: 'table',
                        caption: 'Bits per pixel at 50 KB',
                        columns: [
                            { key: 'size', label: 'Image size', rowHeader: true, mono: true },
                            { key: 'bits', label: 'Bits each', mono: true },
                        ],
                        rows: [{ size: '800×600', bits: '0.9' }],
                    },
                    {
                        type: 'p',
                        text: 'So the fix for a stubborn file is usually fewer pixels rather than a lower setting. Trim away '
                            + 'the margin, cut down to the part anybody is going to look at, and hand the encoder a smaller '
                            + 'problem. Every pixel removed is allowance given back to the ones that remain.',
                    },
                ],
            },
        ],
        limitations: [
            'A lossless source has no quality dial to turn down, so a file that will not fit is offered in another format instead.',
            'A photograph far above the ceiling can bottom out; when it does you are told the smallest size it reached.',
        ],
        faqs: [
            { question: 'Will it be exactly 50 KB?', answer: 'At or just under.' },
            { question: 'What if it cannot get there?', answer: 'You are told the smallest size it reached.' },
            { question: 'Is it uploaded?', answer: 'No — it stays on your own device.' },
        ],
        siblingLinks: null,
        sources: [],
        lastModified: '2026-09-01',
        indexable: true,
        ...overrides,
    };
}
