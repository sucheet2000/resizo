/**
 * /jpg-to-png — the conversion people expect the most from and get the least.
 *
 * The honest answer is the content: PNG cannot undo JPEG, the file gets bigger,
 * and no transparency appears. Saying that plainly is more useful than the
 * "improve your image quality" copy this query usually attracts, and it is the
 * only version we can actually stand behind.
 */
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/jpg-to-png';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: '/convert' },
    { name: 'JPG to PNG', path: PATH },
];

const DESCRIPTION = 'Convert JPG to PNG online free. Get a lossless, full-colour PNG at the same pixel '
    + 'dimensions — for the forms, editors and asset pipelines that will only take a PNG. 20 MB per file.';

export const metadata = buildMetadata({
    title: 'JPG to PNG — Convert JPG Images to PNG Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

const FAQS = [
    {
        question: 'Will converting to PNG improve the quality of my JPG?',
        answer: 'No, and nothing can. The detail JPEG discarded when the file was first saved is gone from '
            + 'the file — there is no copy of it anywhere to recover. PNG stores whatever it is given, '
            + 'exactly, so what you get is a perfect copy of an already-compressed picture.',
    },
    {
        question: 'Why is the PNG so much bigger than the JPG?',
        answer: 'Because it is lossless. PNG has to store every pixel of the decoded image, including the '
            + 'faint blocking and ringing JPEG left behind, and that fine noise is exactly the kind of detail '
            + 'that does not compress. Two to five times the original size is normal for a photograph.',
    },
    {
        question: 'Does converting to PNG give me a transparent background?',
        answer: 'No. PNG supports transparency, but a JPG has none to carry across, so every pixel in the '
            + 'result is fully opaque. Removing a background is an editing job — something has to decide '
            + 'which pixels to erase, and a format conversion cannot.',
    },
    {
        question: 'Is the PNG really lossless?',
        answer: 'Yes. The converter writes a full-colour PNG at the highest compression level, with no '
            + 'palette reduction and no quality setting involved — every pixel of the decoded JPG is stored '
            + 'exactly. The compressor in our compress tool does reduce colours, but a format conversion '
            + 'never does.',
    },
    {
        question: 'Can I convert it back to JPG later?',
        answer: 'Yes, and for a photograph you probably should once the PNG has served its purpose — the JPG '
            + 'will be a fraction of the size. Be aware it is a second lossy generation on top of the first, '
            + 'so do it once at the end rather than repeatedly along the way.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, decoded and re-encoded in memory on our server, and never '
            + 'written to disk. It is discarded the moment your download starts, and EXIF and GPS metadata '
            + 'are stripped from the PNG.',
    },
];

export default function JpgToPngPage() {
    return (
        <>
            <JsonLd
                id="jpg-to-png-schema"
                data={[
                    softwareApplication({
                        name: 'JPG to PNG Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts JPG to a full-colour lossless PNG',
                            'Keeps the original pixel dimensions',
                            'No palette reduction and no quality setting',
                            'Strips EXIF and GPS metadata from the PNG',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                preset={{ from: 'jpeg', to: 'png' }}
                title="Convert JPG to PNG"
                intro="One JPG in, one lossless PNG out at the same pixel dimensions. Expect a larger file."
                breadcrumb={BREADCRUMB}
            >
                <ContentSection id="no-quality-gain" heading="A PNG cannot undo a JPEG">
                    <p>
                        This is worth being blunt about, because it is the reason most people arrive here.
                        Converting a JPG to PNG does not recover detail, sharpen edges or remove compression
                        artefacts. When the JPEG was first saved, information was discarded and not written
                        anywhere — there is nothing left to restore it from.
                    </p>
                    <p>
                        What a PNG does give you is a floor. From that point on the picture stops degrading:
                        you can open it, edit it and save it as many times as you like without another
                        generation of loss. That is a real benefit, and it is a different benefit from the one
                        the phrase &ldquo;convert to a lossless format&rdquo; tends to suggest.
                    </p>
                </ContentSection>

                <ContentSection id="bigger-file" heading="Expect the file to get bigger">
                    <p>
                        A photograph that arrived as a 1.5 MB JPG commonly leaves as a 5 MB PNG or more.
                        Nothing has gone wrong. PNG stores every pixel exactly, and it has to store the JPEG
                        artefacts too — the faint 8-pixel blocking and the ringing around hard edges. That
                        texture is close to random, and random data does not compress.
                    </p>
                    <p>
                        Flat images behave differently. A chart, a logo or a screenshot that was saved as a JPG
                        by accident can come back as a PNG that is smaller than the original, because now the
                        large areas of identical colour compress the way they always should have.
                    </p>
                </ContentSection>

                <ContentSection id="no-transparency" heading="It does not add transparency">
                    <p>
                        PNG is the format people associate with transparent backgrounds, so this catches a lot
                        of people out: the alpha channel exists in the file format, but the conversion has
                        nothing to put in it. A JPG is opaque by definition, every pixel of it, and the PNG
                        that comes out is opaque in exactly the same way.
                    </p>
                    <p>
                        Erasing a background means deciding which pixels are the subject and which are not.
                        That is an editing decision, and it needs an image editor with a selection tool or a
                        background-removal feature — not a format converter.
                    </p>
                </ContentSection>

                <ContentSection id="when-it-helps" heading="When JPG to PNG is the right move">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            An upload form, a theme or an asset pipeline that accepts PNG and nothing else.
                            This is the most common honest reason.
                        </li>
                        <li>
                            You are about to start editing. Convert once, work in PNG, and export a JPG at the
                            end — one lossy generation instead of one per save.
                        </li>
                        <li>
                            You are placing the image somewhere that will compress it again, such as a slide
                            deck or a document exporter, and you would rather not stack two lossy passes.
                        </li>
                        <li>
                            The image is a screenshot, a chart or line art that was saved as a JPG by mistake.
                            PNG is where it belonged in the first place.
                        </li>
                    </ul>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    exclude="jpg-to-png"
                    id="jpg-to-png-related"
                    heading="Other conversions"
                />

                <FaqList items={FAQS} id="jpg-to-png-faq" />
            </ConvertTool>
        </>
    );
}
