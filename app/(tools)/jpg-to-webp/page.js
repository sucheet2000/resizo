/**
 * /jpg-to-webp — the page-weight conversion.
 *
 * Distinct from /png-to-webp: that one is about keeping an alpha channel while
 * shrinking a graphic, this one is about photographs on a web page and the
 * second lossy generation you take to get there.
 */
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/jpg-to-webp';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: '/convert' },
    { name: 'JPG to WebP', path: PATH },
];

const DESCRIPTION = 'Convert JPG to WebP online free. Same pixel dimensions, typically 25 to 35 percent off '
    + 'the file size, which is the cheapest page-weight win there is. 20 MB per file, no account.';

export const metadata = buildMetadata({
    title: 'JPG to WebP — Convert JPG Images to WebP Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

const FAQS = [
    {
        question: 'How much smaller is a WebP than a JPG?',
        answer: 'Usually 25 to 35 percent at the same visual quality, though it varies with the picture. '
            + 'Photographs with lots of smooth gradient — skies, skin, studio backdrops — tend to do best. A '
            + 'busy, high-contrast image saves less. The result panel prints the real before and after bytes '
            + 'so you never have to take the estimate on trust.',
    },
    {
        question: 'Do all browsers support WebP?',
        answer: 'Every current one does: Chrome, Edge, Firefox, and Safari since version 14 in 2020, on both '
            + 'desktop and mobile. Browser support stopped being the reason not to use WebP several years '
            + 'ago. What still varies is everything outside a browser.',
    },
    {
        question: 'Will the quality drop?',
        answer: 'A little. The JPG is decoded and re-encoded as WebP at quality 80, which is one more lossy '
            + 'generation on top of whatever the JPEG already cost. At normal viewing size it is very hard to '
            + 'see, but convert from the best original you have rather than from a copy that has already been '
            + 'through several rounds.',
    },
    {
        question: 'Can I convert a WebP back to JPG?',
        answer: 'Yes, and it is a common thing to need when something outside the browser refuses the file. '
            + 'It is another lossy generation, so treat the JPG as a delivery copy rather than as your master.',
    },
    {
        question: 'Can I attach a WebP to an email?',
        answer: 'You can attach one, but do not count on the person at the other end being able to open it. '
            + 'Mail clients, older desktop software and plenty of upload forms still do not recognise WebP. '
            + 'For anything you are handing to another person, JPG remains the safe format.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, decoded and re-encoded on our server, and never '
            + 'kept. It is discarded the moment your download starts, and EXIF and GPS metadata '
            + 'are stripped from the WebP.',
    },
];

export default function JpgToWebpPage() {
    return (
        <>
            <JsonLd
                id="jpg-to-webp-schema"
                data={[
                    softwareApplication({
                        name: 'JPG to WebP Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts JPG to WebP at quality 80',
                            'Keeps the original pixel dimensions',
                            'Reports the real before and after byte counts',
                            'Strips EXIF and GPS metadata from the WebP',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                preset={{ from: 'jpeg', to: 'webp' }}
                title="Convert JPG to WebP"
                intro="One JPG in, one WebP out at the same pixel dimensions — usually 25 to 35 percent lighter."
                breadcrumb={BREADCRUMB}
            >
                <ContentSection id="what-you-save" heading="What you actually save">
                    <p>
                        WebP encodes the same picture with a more modern method than JPEG, and at a matched
                        visual quality it typically lands 25 to 35 percent smaller. On a single photo that is a
                        few hundred kilobytes. On a page carrying twenty of them it is the difference between a
                        gallery that appears immediately on a phone connection and one that fills in while the
                        visitor waits.
                    </p>
                    <p>
                        How much you actually get depends on the picture, not on the format alone. Smooth
                        gradients — sky, water, skin, plain backdrops — compress far better than fine
                        high-contrast texture such as foliage or crowds. The panel above prints the measured
                        before and after sizes, so you can see the real number for your own file rather than an
                        average from somebody else.
                    </p>
                </ContentSection>

                <ContentSection id="where-webp-breaks" heading="Browsers are fine. Everything else is the catch">
                    <p>
                        Support inside the browser has been settled for years: Chrome, Edge, Firefox, and
                        Safari from version 14 in 2020 all display WebP without a fallback. If the image is
                        going onto a web page, there is no compatibility argument left to have.
                    </p>
                    <p>
                        Outside the browser it is a different picture. Mail clients frequently show nothing at
                        all, older desktop editors refuse to open the file, some content systems reject the
                        extension on upload, and a few social platforms will not take it either. The rule that
                        works: WebP for what you publish, JPG for what you hand to a person.
                    </p>
                </ContentSection>

                <ContentSection id="second-generation" heading="This is a second lossy generation">
                    <p>
                        Your JPG has already been through one round of lossy compression. Converting it to WebP
                        decodes it and compresses it again, here at quality 80. One extra round on a
                        good-quality source is close to invisible; four rounds on a file that has been through
                        a chat app and two re-saves is not.
                    </p>
                    <p>
                        So convert from the best original you hold, once, and keep that original. Treat the
                        WebP as a delivery copy — the thing you upload to the site — rather than as the file
                        you go back and edit.
                    </p>
                </ContentSection>

                <ContentSection id="resize-first" heading="Resize first, then convert">
                    <p>
                        Format is the smaller of the two levers. A 4000-pixel-wide photo displayed in a
                        900-pixel column is carrying more than four times the pixels it can ever show, and no
                        encoder can compensate for that. Cutting the dimensions to what is actually displayed
                        usually saves more than the format change does.
                    </p>
                    <p>
                        Do both, in that order: resize to the largest size the image will ever be shown at,
                        then convert the result to WebP. A 4000-pixel JPG taken down to 1600 pixels and written
                        as WebP routinely ends up a tenth of what it started at, with nothing visibly different
                        on the page.
                    </p>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    exclude="jpg-to-webp"
                    id="jpg-to-webp-related"
                    heading="Other conversions"
                />

                <FaqList items={FAQS} id="jpg-to-webp-faq" />
            </ConvertTool>
        </>
    );
}
