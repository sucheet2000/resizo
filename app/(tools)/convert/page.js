import ConvertTool from './ConvertTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';

const PATH = '/convert';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: PATH },
];

const DESCRIPTION = 'Convert images between JPEG, PNG, WebP and AVIF online free. PNG to JPG, JPG to WebP, '
    + 'WebP to PNG and every other combination, at the original pixel dimensions. No account.';

export const metadata = buildMetadata({
    title: 'Convert Image Format Online — JPG, PNG, WebP, AVIF | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

const FAQS = [
    {
        question: 'Which formats can I convert between?',
        answer: 'JPEG, PNG, WebP and AVIF, in any direction. The From menu narrows what the drop zone will '
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
        answer: 'PNG, WebP and AVIF all keep an alpha channel. JPEG has none, so when you convert to JPEG '
            + 'the transparent areas are filled with black. If the transparency matters, convert to WebP or '
            + 'stay on PNG.',
    },
    {
        question: 'Does converting lose quality?',
        answer: 'Converting to PNG is lossless. Converting to JPEG, WebP or AVIF re-encodes the picture at a '
            + 'sensible default quality, which is visually very close to the original but not bit-identical. '
            + 'Converting the same file back and forth repeatedly will slowly degrade it.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, processed in memory on our server, and never written to '
            + 'disk. It is discarded the moment your download starts, and EXIF and GPS metadata are stripped '
            + 'from every output.',
    },
];

const FORMATS = [
    {
        format: 'JPEG',
        transparency: 'No',
        compression: 'Lossy',
        size: 'Small',
        best: 'Photographs, and anything an upload form insists on',
    },
    {
        format: 'PNG',
        transparency: 'Yes',
        compression: 'Lossless',
        size: 'Large for photos',
        best: 'Logos, icons, screenshots, flat graphics',
    },
    {
        format: 'WebP',
        transparency: 'Yes',
        compression: 'Lossy or lossless',
        size: '25–35% under JPEG',
        best: 'Anything on a website today',
    },
    {
        format: 'AVIF',
        transparency: 'Yes',
        compression: 'Lossy or lossless',
        size: 'Smallest of the four',
        best: 'Modern sites where every kilobyte counts',
    },
];

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
                            'Convert between JPEG, PNG, WebP and AVIF',
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

                <ContentSection id="avif" heading="AVIF, the newest of the four">
                    <p>
                        AVIF usually beats WebP on file size again, sometimes substantially, and it supports
                        transparency and a wider colour range. Browser support is good now, but support
                        outside the browser is patchy — many desktop applications, older phones and some
                        upload forms still cannot open one.
                    </p>
                    <p>
                        Use AVIF when you control where the image is displayed, such as your own site with a
                        fallback in place. If you are sending the file to someone else, JPEG or PNG remains
                        the safer answer.
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
                                            {row.format}
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
                        Up to 20 MB per file and 8000 pixels on the longest side. Animated GIFs are not
                        converted here — only the four still formats above.
                    </p>
                    <p>
                        Your file is sent over HTTPS and processed in memory on our server — never written to
                        disk, deleted the moment your download starts. EXIF and GPS metadata are stripped from
                        every output, so a converted photo no longer carries the location it was taken.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="convert-faq" />
            </ConvertTool>
        </>
    );
}
