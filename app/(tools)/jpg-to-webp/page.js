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
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/jpg-to-webp';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: '/convert' },
    { name: 'JPG to WebP', path: PATH },
];

const DESCRIPTION = 'Convert JPG to WebP online free, on your own device. Same pixel dimensions, typically '
    + '25 to 35 percent off the file size, which is the cheapest page-weight win there is. 20 MB per file, '
    + 'no account.';

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
        question: 'Can I convert JPG to WebP without uploading the file?',
        answer: 'Yes — this page uploads nothing. The WebP encoder is downloaded into the page and runs '
            + 'there, so your JPG is read and re-encoded by your own device. For the job this page is usually '
            + 'doing, that changes the arithmetic: converting thirty photos for a gallery is limited by your '
            + 'processor rather than by a connection, and none of the thirty is sent anywhere. The WebP '
            + 'carries no EXIF or GPS data.',
    },
];

const HOW_TO_ID = 'how-to-jpg-to-webp';
const HOW_TO_HEADING = 'How to convert a JPG to WebP';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the JPG on your device',
        text: 'Drop it onto the panel above or press Browse files. The pair is already set, so a file that is '
            + 'not a JPEG is refused at the drop.',
    },
    {
        name: 'Press Convert to WebP',
        text: 'Your device decodes the JPEG and writes a WebP at quality 80, at the same pixel dimensions. That '
            + 'is a second lossy generation, which is why you work from the best JPG you have.',
    },
    {
        name: 'Download the WebP',
        text: 'The panel prints the real before and after byte counts, so the saving is measured on your own '
            + 'file rather than quoted from an average.',
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
                            'Converts on your own device — the file is never uploaded',
                            'Keeps the original pixel dimensions',
                            'Reports the real before and after byte counts',
                            'Strips EXIF and GPS metadata from the WebP',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Turn a JPG into a smaller WebP at the same pixel dimensions, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                preset={{ from: 'jpeg', to: 'webp' }}
                title="Convert JPG to WebP"
                intro="One JPG in, one WebP out at the same pixel dimensions — usually 25 to 35 percent lighter."
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

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
