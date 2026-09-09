/**
 * A complete, valid guide entry for the suites that need one.
 *
 * The guide registry ships EMPTY — the first real guides are written from
 * measurements that do not exist yet — so unlike the intent suites there is no
 * shipped page to lean on and every guide test runs against this. It describes
 * a page nobody intends to write (what a camera's orientation tag does to a
 * photo), for the same reason tests/helpers/intent-fixture.js describes a page
 * that does not exist: no test here may pass by accident against real copy,
 * and no fixture sentence may later become a doorway twin of a shipped guide.
 *
 * `basedOnOfficialRequirements` is true in the default, because that is the
 * strictest shape: it is the one that must carry sources. A test flips it off
 * to prove the sources become optional again.
 */
export function validGuide(overrides = {}) {
    return {
        slug: 'what-the-orientation-tag-does',
        title: 'What a Camera Orientation Tag Does to a Photo | Resizo',
        h1: 'What a camera orientation tag does to a photo',
        description:
            'A phone writes rotation into a tag rather than into the pixels, and software that ignores '
            + 'the tag shows the photo sideways. Measured on your own device, nothing uploaded.',
        answer:
            'A phone camera almost never rotates the pixels it captures. It records which way up the '
            + 'sensor was in a small tag beside them, and leaves the reader to turn the picture. Software '
            + 'that reads the tag shows the photo upright; software that skips it shows the same bytes on '
            + 'their side. Resizo applies the tag before anything else touches the image, so what you '
            + 'download is already the right way up and carries no tag to be misread twice.',
        author: 'Sucheet Boppana',
        published: '2026-09-02',
        modified: '2026-09-05',
        basedOnOfficialRequirements: true,
        methodology: [
            {
                type: 'p',
                text: 'Eight captures from one handset, held in each of the four positions and mirrored, '
                    + 'were opened in the tool panel and downloaded untouched. The tag was read before and '
                    + 'after with the same reader.',
            },
            {
                type: 'p',
                text: 'Reproduce it with `node benchmarks/run.js --case orientation`; the reader is the '
                    + 'one the suite already uses, so a change in either shows up as a failing case.',
            },
        ],
        sections: [
            {
                id: 'why-a-tag',
                heading: 'Why the rotation is a tag and not the pixels',
                blocks: [
                    {
                        type: 'p',
                        text: 'Turning the pixels costs a decode and an encode at the moment of capture, '
                            + 'which is the one moment a camera has no time to spare. Writing one number '
                            + 'costs nothing, so that is what every handset does.',
                    },
                    {
                        type: 'ul',
                        items: [
                            'The sensor writes its bytes in the order it always writes them.',
                            'One tag records which edge was up.',
                            'Whoever opens the file is expected to turn it.',
                        ],
                    },
                ],
            },
            {
                id: 'what-readers-do',
                heading: 'What different readers do with it',
                blocks: [
                    {
                        type: 'table',
                        caption: 'The eight positions and what each reader showed',
                        columns: [
                            { key: 'position', label: 'Held', rowHeader: true },
                            { key: 'tag', label: 'Tag', mono: true },
                            { key: 'shown', label: 'Shown upright' },
                        ],
                        rows: [
                            { position: 'Portrait', tag: '1', shown: 'Every reader' },
                            { position: 'Rotated left', tag: '6', shown: 'Readers that honour the tag' },
                        ],
                    },
                    {
                        type: 'p',
                        text: 'The practical upshot is that a photo can be correct and still look wrong. '
                            + '[Rotate it once for good](/crop) and the argument goes away.',
                    },
                ],
            },
        ],
        sources: [
            {
                label: 'CIPA DC-008, the Exif specification',
                url: 'https://www.cipa.jp/std/std-sec_e.html',
                verifiedAt: '2026-09-02',
            },
        ],
        relatedTools: [
            {
                slug: 'resize',
                nextJob: 'Resize the photo with the rotation already applied, so the output needs no tag.',
            },
            {
                slug: 'remove-image-metadata',
                nextJob: 'Strip the remaining camera tags before you send the picture anywhere.',
            },
        ],
        faqs: [
            {
                question: 'Does Resizo keep the orientation tag?',
                answer: 'No. The rotation is baked into the pixels and the tag is dropped, so nothing downstream can apply it twice.',
            },
            {
                question: 'Why does the same photo look right on my phone and wrong on a website?',
                answer: 'The phone reads the tag and the website did not.',
            },
        ],
        indexable: true,
        ...overrides,
    };
}
