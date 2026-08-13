import MergePdfTool from './MergePdfTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/merge-pdf';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Merge PDF', path: PATH },
];

const DESCRIPTION = 'Merge PDF files into one document, free and without adding them to a server. Put the '
    + 'files in the order you want, take every page or only the pages you name, and combine up to 20 PDFs '
    + 'on your own device. No account, no watermark, nothing to install.';

export const metadata = buildMetadata({
    title: 'Merge PDF — Combine PDF Files Into One, No Upload | Resizo',
    description: DESCRIPTION,
    path: PATH,
    keywords: [
        'merge pdf',
        'combine pdf',
        'merge pdf files',
        'join pdf',
        'combine pdf files into one',
        'merge pdf without uploading',
    ],
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Merging PDFs means writing the pages of several documents into one new file, in an order '
    + 'you decide, so a whole set can go out as a single attachment. On Resizo you choose the PDFs, move '
    + 'the rows into the order you want, say which pages to take from each if you do not want all of them, '
    + 'and press Combine. Your own computer does the copying, because the code that reads a PDF is loaded '
    + 'into your browser along with the page and runs there — so a contract, a bank statement or a scan of '
    + 'your passport stays on the machine in front of you.';

const FAQS = [
    {
        question: 'Do the pages come out in the order I put the files in?',
        answer: 'Yes, and the list is the order. The first row becomes the front of the document and the '
            + 'last row becomes the back, with no sorting of any kind in between — not by name, not by '
            + 'date. Every row has a Move up and a Move down button, so the order can be set with the '
            + 'keyboard alone, and the number beside each row is the position it holds.',
    },
    {
        question: 'Can I merge a password-protected PDF?',
        answer: 'No, and it is refused rather than half-done. A locked PDF has encrypted page contents, '
            + 'and the library used here can be told to open one anyway — which succeeds, copies the pages '
            + 'and produces a document a reader shows as blank, while reporting that everything worked. '
            + 'That is worse than a refusal, so the file is named and the fix is stated: take the password '
            + 'off in the app that made it, save a copy, and add that copy instead.',
    },
    {
        question: 'Can I take only some pages out of a file?',
        answer: 'Yes. Each row has a page box that takes numbers and ranges — 1-3, 7 — and the numbers are '
            + 'the ones your PDF reader shows. The order you type is the order they land in, so 5-3 puts '
            + 'those three pages in backwards, and naming the same page twice puts it in twice. The row '
            + 'says how many pages the file has, so a number that is not in there is caught as you type '
            + 'rather than after the button.',
    },
    {
        question: 'Are my documents uploaded anywhere?',
        answer: 'No. The code that reads and writes a PDF comes down with this page and runs in the '
            + 'browser tab, so your device opens the files and builds the new one itself. There is no '
            + 'account, no transfer and nothing on our side that could hold a copy. That is the whole '
            + 'reason to use it for a signed contract, a payslip or a bank statement.',
    },
    {
        question: 'Does combining files change the quality of the pages?',
        answer: 'No. A page is copied across as the object it already is: its text stays text, a scanned '
            + 'image inside it stays exactly the same image, and nothing is opened, re-drawn or '
            + 'compressed. Page size and rotation come across too, so a landscape sheet stays landscape '
            + 'and a page a scanner turned on its side arrives still turned. The merged file is normally '
            + 'about the size of the files that went into it added together.',
    },
    {
        question: 'How many PDFs can I combine, and how big can they be?',
        answer: 'Twenty files at a time, 20 MB per file and 80 MB in total. Past those the real limit is '
            + 'the device in your hand: the panel works out what the job will cost in memory before it '
            + 'starts and says plainly if this phone or laptop cannot hold it, rather than losing the tab '
            + 'halfway through. Merging is cheap, though — nothing is decoded — so the ceiling is rarely '
            + 'what stops anyone.',
    },
    {
        question: 'What happens to the names and dates stored inside the files?',
        answer: 'They are not carried over. A PDF keeps a title, an author, a subject and the name of the '
            + 'program that produced it, and on a real document those are a person, their employer and '
            + 'the scanner in their office. The combined file is created fresh with those fields cleared '
            + 'and Resizo named as the producer — the same promise the image tools make about EXIF and '
            + 'GPS data.',
    },
    {
        question: 'What if one of my files is damaged?',
        answer: 'It is named as you add it, not after you press the button. Every file is opened and its '
            + 'pages counted the moment it lands, so a file that is not really a PDF, one that has been '
            + 'truncated mid-download, and one with no pages in it are each refused there with a sentence '
            + 'saying which file and what to try. The rest of your list is left exactly as it was.',
    },
];

const HOW_TO_ID = 'how-to-merge-pdf';
const HOW_TO_HEADING = 'How to combine PDFs into one file';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the PDFs on your device',
        text: 'Drop the files onto the panel above, or press Choose PDFs. Up to 20 at a time, 20 MB each, '
            + 'and they stay where they are — there is no transfer step.',
    },
    {
        name: 'Let each file report its pages',
        text: 'Every file is opened as it lands and its page count is shown on its row. A file that is '
            + 'locked, damaged or empty is named right there instead of failing later.',
    },
    {
        name: 'Put the documents in order',
        text: 'The number beside each row is the position it holds in the finished file. Use the Move up '
            + 'and Move down buttons on a row to shift it, and the remove button to drop one out.',
    },
    {
        name: 'Pick pages, if you only want some',
        text: 'Leave a row on All pages to take the whole file. Switch it to Some pages and type numbers '
            + 'or ranges — 1-3, 7 — to take only those, in the order you typed them.',
    },
    {
        name: 'Press Combine and download',
        text: 'Your device copies the pages into one new document and prints what it holds and what it '
            + 'weighs. Download it, open it to check the order, and run it again if you want it different.',
    },
];

export default function MergePdfPage() {
    return (
        <>
            <JsonLd
                id="merge-pdf-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Merge PDF',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Combines the PDFs on your own device — the documents are never uploaded',
                            'Up to 20 PDFs in one file, in the order you set',
                            'Order is set by hand, with keyboard-operable move controls',
                            'Take every page, or only the pages and ranges you name',
                            'Pages are copied, never re-drawn, so nothing loses quality',
                            'Title, author and producer fields are not carried over from the files',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Combine several PDF files into one document, in the order you '
                            + 'choose, on your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <MergePdfTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps id={HOW_TO_ID} heading={HOW_TO_HEADING} steps={STEPS} />

                <ContentSection id="no-upload" heading="The documents never leave your computer">
                    <p>
                        Combining PDFs is normally done by taking a copy of your files first and doing the
                        work on a machine somewhere else. That is a reasonable way to build software and a
                        poor fit for what people actually merge — signed contracts, bank statements,
                        payslips, medical letters and scans of a passport. Those are the files where the
                        question is not how fast the tool is, but who else ends up holding a copy.
                    </p>
                    <p>
                        Here the code that reads and writes a PDF arrives with the page and runs in this
                        browser tab. Your device opens the files, copies the pages across and hands you the
                        finished document, so there is no copy of your paperwork anywhere but on your own
                        computer. The only thing that ever travels is the code, in one direction, on its way
                        to you.
                    </p>
                </ContentSection>

                <ContentSection id="how-pages-move" heading="Why nothing loses quality">
                    <p>
                        A PDF page is not a picture. It is a small program — draw this text in this font at
                        this position, paint this image into this rectangle — stored as a compressed stream
                        alongside the resources it refers to. Combining files moves that whole object across
                        into a new document exactly as it is.
                    </p>
                    <p>
                        So nothing is decoded and nothing is re-encoded. Text stays selectable text rather
                        than becoming a picture of text. A scan embedded in a page arrives as the same
                        image, byte for byte, at the same resolution. The page size and any rotation the
                        page carries come across with it, which is what keeps a landscape sheet landscape
                        and a page a scanner turned 90 degrees still turned. The finished file weighs about
                        what its parts weighed added together, because that is essentially what it is.
                    </p>
                </ContentSection>

                <ContentSection id="locked-files" heading="A locked PDF is refused, not faked">
                    <p>
                        A password-protected PDF has encrypted page contents. The library used here throws
                        an error on one, and its error message suggests a flag that carries on regardless.
                        That flag was tried and measured: the file opens, the pages copy, the merge reports
                        success — and the pages that land are still encrypted, so a reader shows them blank.
                    </p>
                    <p>
                        A tool that did that would hand somebody an empty contract and tell them it worked.
                        So the flag is never used, there is a test that re-proves why, and a locked file is
                        refused by name with the only fix there is: take the password off in the app that
                        made the file, save a copy, and add that copy instead.
                    </p>
                </ContentSection>

                <ContentSection id="choosing-pages" heading="Taking only the pages you want">
                    <p>
                        Each row can take the whole file or a list of pages. The box accepts single numbers
                        and ranges together — 1-3, 7 — and the numbers are the ones your reader shows,
                        counting from 1.
                    </p>
                    <p>
                        The order you type is the order the pages land in, which makes two useful things
                        fall out of the same rule rather than needing switches of their own. A descending
                        range reverses a section, so 5-3 gives you pages 5, 4 and 3 in that order — the
                        answer to a stack that went through a scanner the wrong way up. And naming a page
                        twice puts it in twice, so a cover page can also
                        close the document. Anything outside the file is caught as you type, against the
                        page count that file actually reported.
                    </p>
                </ContentSection>

                <ContentSection id="use-cases" heading="When people need several PDFs as one">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>A visa or mortgage application that wants every document as a single file.</li>
                        <li>Six months of bank statements that arrived as one PDF per month.</li>
                        <li>A contract, its annexes and a signature page that have to go back together.</li>
                        <li>An invoice and its receipts, submitted as one attachment to an expense system.</li>
                        <li>Scans made in two sittings, where the second half needs to follow the first.</li>
                        <li>A report assembled from sections different people wrote separately.</li>
                    </ul>
                </ContentSection>

                <ContentSection id="limits" heading="What this tool accepts, and where the limit comes from">
                    <p>
                        Up to 20 PDFs at once, 20 MB per file and 80 MB across the set. PDFs only, and each
                        one is checked by its first bytes rather than by its name — so a file renamed to
                        end in .pdf is refused for what it really is.
                    </p>
                    <p>
                        Past those numbers the binding limit is the device in your hand, not a policy. It is
                        a generous limit here, though, because a merge costs far less than an image job:
                        no page is ever turned into pixels, so the whole thing is priced in bytes, and the
                        panel refuses in plain words before it starts if this phone or laptop genuinely
                        cannot hold it. It is the honest answer — there is nowhere else for the work to go.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="merge-pdf-faq" />
            </MergePdfTool>
        </>
    );
}
