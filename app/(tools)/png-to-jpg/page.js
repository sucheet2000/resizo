/**
 * /png-to-jpg — the busiest of the pair routes.
 *
 * The pair is locked in the converter, so the drop zone rejects anything that
 * is not a PNG at the point of drop, before any work starts. The copy is
 * about this one conversion: why the JPG is so much smaller, what happens to
 * the alpha channel, and when the PNG is the file you should be keeping.
 */
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/png-to-jpg';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: '/convert' },
    { name: 'PNG to JPG', path: PATH },
];

const DESCRIPTION = 'Convert PNG to JPG online free, without uploading the file. A photograph saved as a '
    + 'PNG usually drops to a fraction of its size as a JPG, at the same pixel dimensions. 20 MB per file, '
    + 'no account, no watermark.';

export const metadata = buildMetadata({
    title: 'PNG to JPG — Convert PNG Images to JPG Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A photograph saved as a PNG stores every pixel exactly and is many times heavier than it '
    + 'needs to be; turning it into a JPG keeps the same picture at the same dimensions but stores '
    + 'it with compression built for photographs, usually for a fraction of the bytes. On Resizo '
    + 'the pair is already fixed at PNG to JPEG, so you add the PNG and press Convert to JPEG. '
    + 'Anything transparent is filled in, because a JPG has no transparency to keep — black by '
    + 'default, or white or a colour you pick. The whole conversion is done by your own device on '
    + 'codecs the page downloads, so the file never leaves it.';

const FAQS = [
    {
        question: 'Does converting PNG to JPG lose quality?',
        answer: 'It adds one generation of lossy compression, written here at quality 80. On a photograph '
            + 'that is very hard to see at normal viewing size. On a screenshot full of small text, or a flat '
            + 'graphic with hard edges, it is much easier to spot — those are the files worth keeping as PNG.',
    },
    {
        question: 'Why did my transparent background turn black?',
        answer: 'JPEG has no alpha channel, so transparency cannot survive the conversion. Every transparent '
            + 'pixel has to be filled in, and the fill is black unless you say otherwise — the '
            + '\u201cTransparent areas become\u201d control above the button switches it to white or any colour '
            + 'you choose, which is usually what a logo on a white page wants. If the transparency itself '
            + 'matters, convert the PNG to WebP instead, which keeps the alpha channel and is still smaller '
            + 'than the PNG.',
    },
    {
        question: 'How much smaller will the JPG be?',
        answer: 'It depends entirely on the picture. A 12-megapixel photograph saved as a PNG can sit above '
            + '20 MB and usually comes back under 2 MB as a JPG. A flat graphic with a handful of colours is '
            + 'the opposite case: PNG already stores it efficiently, and the JPG can come out no smaller, or '
            + 'even slightly larger.',
    },
    {
        question: 'Can I convert the JPG back to PNG afterwards?',
        answer: 'You can, and the file will be a valid PNG, but it will not undo anything. The detail JPEG '
            + 'discarded is gone, and the PNG faithfully stores the compressed result — usually at several '
            + 'times the size. Keep the original PNG if you might need it again.',
    },
    {
        question: 'What are the limits?',
        answer: 'One PNG per pass, up to 20 MB, and 8000 pixels on the longest side. The pixel dimensions are '
            + 'never changed by this tool — if you also need the image smaller on screen, resize it first and '
            + 'then convert.',
    },
    {
        question: 'Can I convert PNG to JPG without uploading the file?',
        answer: 'Yes — this page uploads nothing. The PNG decoder and the JPEG encoder are downloaded into '
            + 'the tab as code the first time you use it, and from then on your file is read, converted and '
            + 'saved by your own machine. PNGs are very often screenshots, which is exactly the kind of file '
            + 'you would rather not hand to a stranger, and this one goes nowhere. The JPG is written from '
            + 'raw pixels and carries no EXIF or GPS data.',
    },
];

const HOW_TO_ID = 'how-to-png-to-jpg';
const HOW_TO_HEADING = 'How to convert a PNG to JPG';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the PNG on your device',
        text: 'Drop it onto the panel above or press Browse files. The pair is already set, so anything that is '
            + 'not a PNG is refused at the drop rather than after the work has started.',
    },
    {
        name: 'Press Convert to JPEG',
        text: 'Your device decodes the PNG and writes a JPG at quality 80, at the same pixel dimensions. '
            + 'Transparent areas are filled with the colour set above the button — black unless you '
            + 'change it — because JPEG has no alpha channel to put them in.',
    },
    {
        name: 'Download the JPG',
        text: 'The panel shows the new size next to the old one, which on a photograph is usually the whole '
            + 'point of the conversion.',
    },
];

export default function PngToJpgPage() {
    return (
        <>
            <JsonLd
                id="png-to-jpg-schema"
                data={[
                    softwareApplication({
                        name: 'PNG to JPG Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts PNG to JPG at quality 80',
                            'Keeps the original pixel dimensions',
                            'Rejects anything that is not a PNG the moment it is dropped',
                            'Converts on your own device — the file is never uploaded',
                            'Strips EXIF and GPS metadata from the JPG',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Turn a PNG into a JPG at the same pixel dimensions, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                preset={{ from: 'png', to: 'jpeg' }}
                title="Convert PNG to JPG"
                intro="One PNG in, one JPG out at the same pixel dimensions. Transparent areas are filled with black, or a colour you choose."
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="why-smaller" heading="Why the JPG comes out so much smaller">
                    <p>
                        PNG is lossless. It stores every pixel exactly as it was and shrinks the file by
                        spotting repetition — runs of identical colour, rows that look like the row above. A
                        screenshot of a spreadsheet is full of that. A photograph has almost none of it, so a
                        photo saved as a PNG is close to storing the raw pixels.
                    </p>
                    <p>
                        JPEG works the other way round. It throws away the detail your eye tracks least
                        closely, which is exactly the fine random variation a photograph is made of. That is
                        why the same picture can go from above 20 MB to under 2 MB with no visible change at
                        normal viewing size.
                    </p>
                </ContentSection>

                <ContentSection id="transparency" heading="Transparency becomes black">
                    <p>
                        This is the one thing to check before you convert. A PNG can carry an alpha channel —
                        the per-pixel record of what is see-through. JPEG has no such channel and no way to
                        represent it, so the transparency has to be filled in with something, and here that
                        something is black.
                    </p>
                    <p>
                        For a photograph it makes no difference: there is nothing transparent to fill. For a
                        logo, an icon or a product cut-out it is the wrong conversion entirely — you get your
                        artwork sitting on a black rectangle. Send those to WebP instead, which keeps the alpha
                        channel and still lands well under the PNG.
                    </p>
                </ContentSection>

                <ContentSection id="keep-the-png" heading="When you should keep the PNG">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            Screenshots with text in them. JPEG smears the sharp black-on-white edges of
                            letterforms, and small type is where it shows first.
                        </li>
                        <li>
                            Logos, icons, charts and anything drawn rather than photographed. Flat areas of
                            colour pick up faint blotches around the edges.
                        </li>
                        <li>
                            Files you will open, edit and save again. Every JPEG save is another lossy
                            generation, and the damage accumulates. PNG can be re-saved forever.
                        </li>
                        <li>
                            Pixel art and anything where individual pixels are the point. JPEG is built on
                            8-pixel blocks and will blur them together.
                        </li>
                    </ul>
                </ContentSection>

                <ContentSection id="what-happens" heading="What the conversion actually does">
                    <p>
                        The PNG is decoded back to raw pixels and written out again as a JPEG at quality 80 —
                        the setting most of the web uses as its default. Width and height are untouched, so a
                        1920×1080 PNG is a 1920×1080 JPG. Nothing is cropped, scaled or rotated.
                    </p>
                    <p>
                        The download keeps the original name inside a Resizo prefix, so logo.png comes back
                        as resizo-converted-logo.jpg. EXIF and GPS metadata are absent from the JPG, and the
                        whole thing happens on your own device: the file is read, converted and saved where
                        it already was, and none of it is transmitted.
                    </p>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    exclude="png-to-jpg"
                    id="png-to-jpg-related"
                    heading="Other conversions"
                />

                <FaqList items={FAQS} id="png-to-jpg-faq" />
            </ConvertTool>
        </>
    );
}
