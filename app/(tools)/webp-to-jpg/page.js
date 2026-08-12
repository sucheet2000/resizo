/**
 * /webp-to-jpg — the rescue route.
 *
 * Nobody chooses a WebP; they save an image off a web page and end up with one.
 * So the copy answers the question actually being asked ("why will this file
 * not open") rather than selling a format, and it is honest that this is the
 * one common conversion where the file usually gets BIGGER.
 */
import ConvertTool from '@/app/(tools)/convert/ConvertTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/webp-to-jpg';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert Format', path: '/convert' },
    { name: 'WebP to JPG', path: PATH },
];

const DESCRIPTION = 'Convert WebP to JPG online free, without uploading the file. Turn an image saved from '
    + 'a web page into a JPG that photo editors, print shops, documents and upload forms will actually open. '
    + '20 MB per file, no account.';

export const metadata = buildMetadata({
    title: 'WebP to JPG — Convert WebP Images to JPG Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A WebP saved from a web page is refused by a lot of desktop software and older phones, and '
    + 'converting it to JPG hands you the same picture, at the same size, in the one format '
    + 'everything opens. On Resizo the pair is already set to WebP to JPEG: add the .webp file, '
    + 'press Convert to JPEG, and save the .jpg that comes back. The reading and the writing are '
    + 'both done in your browser by your own device, on codecs the page brings with it, so the '
    + 'image goes nowhere.';

const FAQS = [
    {
        question: 'Why will my WebP file not open?',
        answer: 'Because WebP was designed for web pages, and support outside a browser is patchy. Photoshop '
            + 'only added it in 2022, plenty of older photo viewers and editors have never had it, print '
            + 'shops and document software frequently reject it, and a lot of upload forms accept JPG and PNG '
            + 'and nothing else.',
    },
    {
        question: 'Will the JPG be smaller than the WebP?',
        answer: 'Almost certainly not. WebP is the more efficient format, so going the other way costs you '
            + 'bytes — expect the JPG to be somewhat larger for the same picture. You are paying that in '
            + 'exchange for a file that opens everywhere, which is usually the whole point of the conversion.',
    },
    {
        question: 'Does converting lose quality?',
        answer: 'A little. Most WebP files on the web are already lossy, so writing a JPG adds a second '
            + 'generation, here at quality 80. At normal viewing size it is hard to see. If the WebP happened '
            + 'to be a lossless one, the JPG is the first lossy step it has taken.',
    },
    {
        question: 'My WebP has a transparent background — what happens to it?',
        answer: 'JPEG has no alpha channel, so the transparent areas are filled with black. If you need the '
            + 'transparency, convert to PNG instead on the main converter page: PNG output is lossless and '
            + 'keeps the alpha channel exactly as it was.',
    },
    {
        question: 'Can I convert an animated WebP?',
        answer: 'Only the first frame. JPEG cannot hold an animation, and the converter takes the still image '
            + 'and writes that. If the movement is the thing you wanted to keep, you need a tool that outputs '
            + 'an animated format rather than a still one.',
    },
    {
        question: 'Can I convert WebP to JPG without uploading the file?',
        answer: 'Yes — this page uploads nothing. The WebP decoder and the JPEG encoder are downloaded into '
            + 'the page and run there, so the file is read, converted and saved by your own device. That is '
            + 'a fair thing to want here: you are usually converting a WebP precisely so you can hand it to '
            + 'a print shop or a form, and it should be your choice when it first travels anywhere. The JPG '
            + 'carries no EXIF or GPS data.',
    },
];

const HOW_TO_ID = 'how-to-webp-to-jpg';
const HOW_TO_HEADING = 'How to convert a WebP to JPG';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the WebP on your device',
        text: 'Drop it onto the panel above or press Browse files. The pair is already set, so a file that is '
            + 'not a WebP is refused at the drop.',
    },
    {
        name: 'Press Convert to JPEG',
        text: 'Your device decodes the WebP and writes a JPG at quality 80, at the same pixel dimensions. Any '
            + 'transparency is flattened onto black, and an animation keeps only its first frame.',
    },
    {
        name: 'Download the JPG',
        text: 'It will usually be bigger than the WebP was, which is the price of a format that opens '
            + 'everywhere. The panel prints both sizes.',
    },
];

export default function WebpToJpgPage() {
    return (
        <>
            <JsonLd
                id="webp-to-jpg-schema"
                data={[
                    softwareApplication({
                        name: 'WebP to JPG Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts WebP to JPG at quality 80',
                            'Converts on your own device — the file is never uploaded',
                            'Keeps the original pixel dimensions',
                            'Accepts both lossy and lossless WebP files',
                            'Strips EXIF and GPS metadata from the JPG',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Turn a WebP saved off a web page into a JPG that other software will open, on your own '
                            + 'device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <ConvertTool
                preset={{ from: 'webp', to: 'jpeg' }}
                title="Convert WebP to JPG"
                intro="One WebP in, one JPG out at the same pixel dimensions — a file the rest of your software will open."
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="why-you-have-one" heading="Why you ended up with a WebP">
                    <p>
                        Almost nobody sets out to make one. You right-clicked an image on a web page and saved
                        it, and the browser wrote out whatever the site had served — which, on most modern
                        sites, is WebP. The same thing happens with stickers out of chat apps and with images
                        pulled from a content system that converts everything on upload.
                    </p>
                    <p>
                        So the file is fine. It is a normal image, at normal dimensions, and it displays
                        perfectly in the browser you saved it from. It simply is not the format the rest of
                        your software expects.
                    </p>
                </ContentSection>

                <ContentSection id="what-refuses-it" heading="What tends to refuse a WebP">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            Photo editors older than a few years. Photoshop only gained WebP support in 2022,
                            and many smaller editors still have none.
                        </li>
                        <li>
                            Print. Photo labs, kiosk machines and print shop drop boxes are conservative about
                            what they accept, and WebP is rarely on the list.
                        </li>
                        <li>
                            Documents and slide decks, especially ones that will be opened by someone else on
                            an older machine.
                        </li>
                        <li>
                            Upload forms — applications, marketplaces, portals. JPG and PNG, and that is the
                            whole list on most of them.
                        </li>
                        <li>
                            Older phones and their gallery apps, which sometimes show the thumbnail and then
                            fail to open the file.
                        </li>
                    </ul>
                </ContentSection>

                <ContentSection id="expect-bigger" heading="Expect the JPG to be bigger">
                    <p>
                        This conversion runs against the usual direction. WebP is the more efficient of the two
                        formats, so unwinding it into a JPEG costs bytes rather than saving them — a 300 KB
                        WebP might come back as 400 or 500 KB. Nothing has gone wrong; you are buying
                        compatibility with file size.
                    </p>
                    <p>
                        If the destination has a size cap as well as a format requirement, convert first and
                        then compress the JPG to a byte target. Doing it in that order means the compressor is
                        working on the file you are actually going to submit.
                    </p>
                </ContentSection>

                <ContentSection id="alpha-and-animation" heading="Transparency and animation do not come across">
                    <p>
                        A WebP can hold an alpha channel and JPEG cannot, so any transparent area is filled in
                        on the way out, with black. When the transparency is the point — a logo, a cut-out —
                        convert to PNG instead. PNG output is lossless and keeps the alpha channel untouched.
                    </p>
                    <p>
                        A WebP can also hold an animation. JPEG cannot, so the conversion takes the first frame
                        and writes that as a single still image. Everything after that frame is left behind.
                    </p>
                </ContentSection>

                <IntentLinks
                    tool="convert"
                    exclude="webp-to-jpg"
                    id="webp-to-jpg-related"
                    heading="Other conversions"
                />

                <FaqList items={FAQS} id="webp-to-jpg-faq" />
            </ConvertTool>
        </>
    );
}
