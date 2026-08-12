/**
 * /convert
 *
 * Nothing on this page types a format name into a sentence. The intro, the
 * metadata, four of the five FAQ answers, the comparison table and the limits
 * note are all written from lib/constants.js through ./formats.js, because the
 * hand-written versions went stale the moment AVIF left the registry and there
 * was no way to notice. tests/app/convert-formats.test.js reads this file and
 * fails if a format the registry does not carry is named in it again.
 *
 * The three pair sections below are the deliberate exception: they are about one
 * conversion each, they are what people search for, and they name both of their
 * formats on purpose. The same test holds them to the registry too.
 */
import ConvertTool from './ConvertTool';
import {
    alphaFormatsProse,
    formatComparison,
    inputFormatsProse,
    losslessFormatsProse,
    lossyFormatsProse,
    outputFormatsProse,
} from './formats';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { CONVERT_OUTPUT_FORMATS } from '@/lib/constants';
import { formatList } from '@/lib/hooks/upload-helpers';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';

const PATH = '/convert';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: PATH },
];

const TITLE = `Convert Image Format Online — ${formatList(CONVERT_OUTPUT_FORMATS)} | Resizo`;

const DESCRIPTION = `Convert images between ${outputFormatsProse()} online free. PNG to JPG, JPG to WebP, `
    + 'WebP to PNG and every other combination, at the original pixel dimensions. No account.';

export const metadata = buildMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

const FAQS = [
    {
        question: 'Which formats can I convert between?',
        answer: `${inputFormatsProse()}, in any direction. The From menu narrows what the drop zone will `
            + 'accept so a mismatched file is caught before it is uploaded, and the To menu decides what '
            + 'comes back.',
    },
    {
        question: 'Does converting change the size of the image?',
        answer: 'The pixel dimensions stay exactly the same. The file size almost always changes, because '
            + 'each format stores the same picture differently — going from PNG to JPEG on a photograph '
            + 'often cuts the file to a tenth of what it was.',
    },
    {
        question: 'What happens to transparency?',
        answer: `${alphaFormatsProse()} keep an alpha channel. JPEG has none, so when you convert to `
            + 'JPEG the transparent areas are filled with black. If the transparency matters, convert to '
            + 'WebP or stay on PNG.',
    },
    {
        question: 'Does converting lose quality?',
        answer: `Converting to ${losslessFormatsProse()} is lossless. Converting to ${lossyFormatsProse()} `
            + 're-encodes the picture at a sensible default quality, which is visually very close to the '
            + 'original but not bit-identical. Converting the same file back and forth repeatedly will '
            + 'slowly degrade it.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, processed on our server, and never kept. '
            + 'It is discarded the moment your download starts, and EXIF and GPS metadata are stripped '
            + 'from every output.',
    },
];

const FORMATS = formatComparison();

export default function ConvertPage() {
    return (
        <>
            <JsonLd
                id="convert-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            `Convert between ${outputFormatsProse()}`,
                            'Keeps the original pixel dimensions',
                            'Rejects a mismatched file before upload',
                            'Strips EXIF and GPS metadata from every output',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool breadcrumb={BREADCRUMB}>
                <ContentSection id="how-to-convert" heading="How to convert an image">
                    <ol className="flex list-decimal flex-col gap-2 pl-5">
                        <li>
                            Pick the format you want out of the To menu. Leave From on Detect unless you want
                            the drop zone to accept only one kind of file.
                        </li>
                        <li>Drop your image onto the panel above, or press Browse files. Up to 20 MB.</li>
                        <li>
                            Press Convert. The result panel shows the new file next to the old size, and the
                            download keeps the original name with the new extension.
                        </li>
                    </ol>
                </ContentSection>

                <ContentSection id="png-to-jpg" heading="PNG to JPG">
                    <p>
                        This is the most common conversion people need, and it is almost always about size. A
                        photograph saved as PNG stores every pixel exactly, so a 12-megapixel shot can sit at
                        20 MB; the same picture as a JPEG is usually well under 2 MB and looks the same on a
                        screen.
                    </p>
                    <p>
                        The one thing to watch is transparency. JPEG has no alpha channel, so any transparent
                        area is filled with black on the way out. That is fine for a photograph and wrong for
                        a logo — for a logo, convert to WebP instead, which keeps transparency and is smaller
                        than PNG anyway.
                    </p>
                </ContentSection>

                <ContentSection id="jpg-to-webp" heading="JPG to WebP">
                    <p>
                        WebP typically produces a file 25 to 35 percent smaller than a JPEG at the same visual
                        quality, and every current browser displays it. If you are preparing images for a
                        website, this is the conversion that makes the page lighter without changing a single
                        pixel dimension.
                    </p>
                    <p>
                        Keep the JPEG original if the image will be edited later. Converting from one lossy
                        format to another re-encodes the picture, and repeating that many times over will
                        eventually show.
                    </p>
                </ContentSection>

                <ContentSection id="webp-to-jpg" heading="WebP to JPG or PNG">
                    <p>
                        The reason people search for this is almost always the same: they saved an image from
                        a website, and now a form, an older photo editor or a print shop refuses to accept it.
                        WebP is a web format first, and plenty of desktop software still has no idea what to
                        do with one.
                    </p>
                    <p>
                        Convert to JPG for a photograph, or to PNG if the image has transparency you need to
                        keep — a product cut-out or a logo, for example. PNG output is lossless, so nothing is
                        thrown away in the second step.
                    </p>
                </ContentSection>

                <ContentSection id="which-format" heading="Which format should I choose?">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[34rem] border-collapse text-left text-ui">
                            <thead>
                                <tr className="border-b border-line">
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Format</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Transparency</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Compression</th>
                                    <th scope="col" className="py-2 pr-4 font-semibold text-ink">Typical size</th>
                                    <th scope="col" className="py-2 font-semibold text-ink">Best for</th>
                                </tr>
                            </thead>
                            <tbody>
                                {FORMATS.map((row) => (
                                    <tr key={row.format} className="border-b border-line align-top">
                                        <th scope="row" className="py-2 pr-4 font-data font-medium text-ink">
                                            {row.label}
                                        </th>
                                        <td className="py-2 pr-4">{row.transparency}</td>
                                        <td className="py-2 pr-4">{row.compression}</td>
                                        <td className="py-2 pr-4">{row.size}</td>
                                        <td className="py-2">{row.best}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    id="convert-pairs"
                    heading="Pages for one conversion in particular"
                />

                <ContentSection id="limits" heading="Limits and what happens to your file">
                    <p>
                        Up to 20 MB per file and 8000 pixels on the longest side. Animated images are not
                        converted here — only the still formats in the table above.
                    </p>
                    <p>
                        Your file is sent over HTTPS and processed on our server — never kept,
                        deleted the moment your download starts. EXIF and GPS metadata are stripped from
                        every output, so a converted photo no longer carries the location it was taken.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="convert-faq" />
            </ConvertTool>
        </>
    );
}
