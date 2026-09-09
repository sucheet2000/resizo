/**
 * A complete, valid intent entry for the suites that need one and do not want
 * to depend on a shipped page: the contract test breaks one field at a time,
 * the renderer test checks what each field becomes on screen. It describes a
 * page that does not exist — a 50 KB compress target — so no test here can
 * pass by accident against real copy.
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
                    { type: 'ul', items: ['Signature scans.', 'Thumbnails.'] },
                ],
            },
            {
                id: 'table',
                heading: 'What 50 KB buys',
                blocks: [
                    {
                        type: 'table',
                        caption: 'Bits per pixel at 50 KB',
                        columns: [
                            { key: 'size', label: 'Image size', rowHeader: true, mono: true },
                            { key: 'bits', label: 'Bits each', mono: true },
                        ],
                        rows: [{ size: '800×600', bits: '0.9' }],
                    },
                ],
            },
        ],
        limitations: [],
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
