import JpgToPdfTool from './JpgToPdfTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/jpg-to-pdf';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'JPG to PDF', path: PATH },
];

const DESCRIPTION = 'Combine JPG photos into one PDF online free, without uploading them. Add PNG, WebP '
    + 'and HEIC too, drag the pages into the order you want, choose A4, Letter or a page shaped to each '
    + 'photo, and aim for a maximum PDF size — all on your own device. 20 images, no account.';

export const metadata = buildMetadata({
    title: 'JPG to PDF — Combine Photos Into One PDF, No Upload | Resizo',
    description: DESCRIPTION,
    path: PATH,
    keywords: [
        'jpg to pdf',
        'jpeg to pdf',
        'image to pdf',
        'photos to pdf',
        'png to pdf',
        'combine images into pdf',
    ],
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Turning photos into a PDF means wrapping each picture in its own page of one document, in '
    + 'a fixed order, so a single file can be printed, emailed or attached to a form. On Resizo you drop '
    + 'the images in, move them into the order you want, choose whether each page is shaped to its photo '
    + 'or set to A4 or Letter, and press Make PDF. The document is put together by your own device, '
    + 'because the PDF writer is a script the page fetches from this site and runs inside the tab — so '
    + 'the photos stay on your computer, which is not possible for a converter that has to receive them '
    + 'before it can start.';

const FAQS = [
    {
        question: 'Does the order of the images matter?',
        answer: 'Yes, and it is the whole point of the list. The first row becomes page one and the last '
            + 'row becomes the last page, with no sorting of any kind in between — not by name, not by '
            + 'date. Every row has a Move up and a Move down button, so the order can be set with the '
            + 'keyboard alone, and the number on the left is the page that row will become.',
    },
    {
        question: 'Are my photos uploaded anywhere?',
        answer: 'No. The PDF writer is a script that comes down with the page and runs in this browser '
            + 'tab, so your device reads the photos and writes the document itself. Nothing is transmitted, '
            + 'there is no account, and there is nothing on our side to keep. This is the reason people '
            + 'use it for passports, certificates and bank statements.',
    },
    {
        question: 'Can I mix JPG, PNG, WebP and HEIC in one PDF?',
        answer: 'Yes, in any combination. A JPG is the cheapest by a wide margin: a PDF stores a JPG '
            + 'exactly as it already is, so the picture is copied in without ever being opened. A PNG, a '
            + 'WebP or an iPhone HEIC has to be opened and re-drawn as a JPG first, because that is the '
            + 'only kind of photo a page can carry, and the panel tells you how many will be re-drawn '
            + 'before you press the button.',
    },
    {
        question: 'What page size should I choose?',
        answer: 'Fit each page to its photo is the default and the right answer when the PDF is going to '
            + 'be read on a screen: the page becomes the shape of the picture, edge to edge, with no white '
            + 'border and nothing cropped. Choose A4 or US Letter when it will be printed or when a form '
            + 'demands a paper size, and the photo is scaled to fit inside the margin with its shape kept '
            + 'and centred on the sheet.',
    },
    {
        question: 'Is there a limit on how many images or how big they can be?',
        answer: 'Twenty images per PDF, 20 MB per image and 80 MB in total. Beyond those, the real limit '
            + 'is your own hardware: the panel works out what the document will cost in memory before it '
            + 'starts, and if this device cannot hold it you are told so and asked to make the PDF from '
            + 'fewer images rather than losing the tab halfway through.',
    },
    {
        question: 'Can I make the PDF a specific size?',
        answer: 'You can set a maximum. The budget is split across the images in proportion to what each '
            + 'already weighs, and each one is re-drawn smaller until the finished file fits. The verdict '
            + 'is measured on the document that came out, not estimated, and if the number cannot be '
            + 'reached you get the PDF anyway with a line saying how close it got — the pictures are never '
            + 'shrunk in pixel size to fake a hit.',
    },
    {
        question: 'Does the PDF still carry the EXIF and GPS data from my photos?',
        answer: 'No. The camera model, the timestamp and the coordinates of wherever the photo was taken '
            + 'are dropped before the picture goes into the document. That matters here more than anywhere '
            + 'else on the site, because a PDF of a scan is the kind of file people email to a bank or a '
            + 'passport office.',
    },
    {
        question: 'Will a photo taken sideways come out sideways?',
        answer: 'No. A phone stores a portrait photo as a landscape picture plus a tag telling the viewer '
            + 'to turn it, and no PDF reader looks for that tag. So a photo carrying one is turned in the '
            + 'pixels before it becomes a page. It costs that photo the cheap route through the tool, '
            + 'which is a fair trade for a page that is the right way up.',
    },
];

const HOW_TO_ID = 'how-to-jpg-to-pdf';
const HOW_TO_HEADING = 'How to combine photos into a PDF';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the images on your device',
        text: 'Drop the JPG, PNG, WebP or HEIC files onto the panel above, or press Choose images. Up to '
            + '20 at a time, 20 MB each, and the files stay where they are — there is no transfer step.',
    },
    {
        name: 'Put them in page order',
        text: 'The number beside each row is the page it will become. Use the Move up and Move down '
            + 'buttons on a row to shift it, and the remove button to drop one out of the set.',
    },
    {
        name: 'Set the page size',
        text: 'Leave it on Fit each page to its photo for edge-to-edge pages, or pick A4 or US Letter and '
            + 'a margin when the document has to be printed or a form demands a paper size.',
    },
    {
        name: 'Press Make PDF',
        text: 'Your device reads the photos one at a time and writes each of them into the document. If '
            + 'you set a maximum size, the pictures are re-drawn smaller until the finished file fits it.',
    },
    {
        name: 'Download the PDF',
        text: 'The panel prints the page count and what the document really weighs. Download it, open it '
            + 'to check the order, and run it again with a different order if you need to.',
    },
];

export default function JpgToPdfPage() {
    return (
        <>
            <JsonLd
                id="jpg-to-pdf-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo JPG to PDF Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Builds the PDF on your own device — the photos are never uploaded',
                            'Combines up to 20 JPG, PNG, WebP or HEIC images into one document',
                            'Page order is set by hand, with keyboard-operable move controls',
                            'Pages fitted to each photo, or A4 and US Letter with a margin',
                            'Aim the whole document at a maximum file size',
                            'EXIF and GPS metadata are stripped from every page',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Combine JPG, PNG, WebP and HEIC photos into one PDF, in the order '
                            + 'you choose, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <JpgToPdfTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="no-upload" heading="The photos never leave your computer">
                    <p>
                        Most JPG-to-PDF converters take a copy of your pictures first and build the document
                        on a machine somewhere else. That is a reasonable way to write software and a poor
                        fit for what this tool is actually used for: passport scans, birth certificates,
                        payslips, bank statements and medical letters.
                    </p>
                    <p>
                        Here the PDF writer is a script that arrives with the page and runs in this browser
                        tab. Your device opens the photos, assembles the document and hands you the finished
                        file, so there is no copy of your paperwork anywhere but on your own computer. The
                        only thing that ever travels is the code, in one direction, on its way to you.
                    </p>
                </ContentSection>

                <ContentSection id="why-jpg-is-cheap" heading="Why a JPG costs almost nothing and a PNG does not">
                    <p>
                        A PDF does not store pixels. It stores streams, and a JPG is already a stream of
                        exactly the kind a page wants, so the picture is copied straight in — the reader
                        opens the same bytes your camera wrote. Nothing is decoded, so twenty photos cost
                        this tool about as much memory as one.
                    </p>
                    <p>
                        A PNG, a WebP and an iPhone HEIC get no such shortcut. Each has to be opened into
                        raw pixels and written back out as a JPG before it can be a page. Packing a PNG in
                        unchanged is possible in theory and worse in practice: it costs the memory of a full
                        decode and usually produces a document larger than the sum of the pictures that went
                        into it. The panel counts these files and tells you before you start, and the result
                        reports how many were actually re-drawn.
                    </p>
                    <p>
                        There is one exception on the cheap side. A photo taken sideways carries a tag
                        telling a viewer to rotate it, and no PDF reader reads that tag, so a tagged photo is
                        turned in the pixels first. It is the difference between a portrait page and a page
                        lying on its side.
                    </p>
                </ContentSection>

                <ContentSection id="pdf-size" heading="Aiming the whole document at a size">
                    <p>
                        Forms and email systems put a ceiling on the file, not on the photos. So the maximum
                        applies to the finished PDF: the budget is divided across the images in proportion to
                        what each one already weighs, and whatever a page does not spend is handed to the
                        next one rather than thrown away.
                    </p>
                    <p>
                        The verdict is then measured on the document that actually came out, never guessed
                        from the plan. If the number cannot be reached you still get the PDF, with a line
                        saying how close it got and what the smallest achievable size is, and the pictures
                        keep their full pixel dimensions — a document that quietly shrank your scans to hit a
                        number would be unreadable at exactly the moment it mattered.
                    </p>
                </ContentSection>

                <ContentSection id="use-cases" heading="When people need photos in one PDF">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>Visa and passport applications, which want every scanned document as a single PDF.</li>
                        <li>Job applications and university forms that accept one attachment and no more.</li>
                        <li>Expense claims, where a set of receipt photos has to go in as one file.</li>
                        <li>Bank and insurance uploads that reject an image but accept a document.</li>
                        <li>Sending a phone-camera scan of a signed contract back to whoever sent it.</li>
                        <li>Keeping a set of photographs in a fixed order that a folder of files cannot hold.</li>
                    </ul>
                </ContentSection>

                <ContentSection id="limits" heading="What this tool accepts, and where the limit comes from">
                    <p>
                        Up to 20 images in one PDF, 20 MB per image and 80 MB across the set. JPG, PNG, WebP
                        and HEIC all go in; the output is always a PDF, one page per image, in your order.
                    </p>
                    <p>
                        Past those numbers the binding limit is the device in your hand, not a policy. A
                        photo has to be unpacked into raw pixels before it can be re-drawn, which takes
                        several times the file size in memory, so the panel costs the whole document before
                        it starts and refuses in plain words if this phone or laptop cannot hold it — with
                        the suggestion to build it from fewer images at a time. It is the honest answer:
                        there is nowhere else for the work to go.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="jpg-to-pdf-faq" />
            </JpgToPdfTool>
        </>
    );
}
