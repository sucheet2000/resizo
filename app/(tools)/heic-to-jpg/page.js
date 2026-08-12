/**
 * /heic-to-jpg — the query, spelled the way people type it.
 *
 * It runs the same converter as /heic and deliberately does NOT repeat it.
 * /heic explains the format: what a HEIC is, why Windows will not open one, how
 * to stop the camera writing them. This page is about the file you get back —
 * what survives the conversion, what does not, and where a JPG is the only
 * thing that will be accepted.
 */
import Link from 'next/link';

import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import JsonLd from '@/components/seo/JsonLd';
import HeicTool from '@/app/(tools)/heic/HeicTool';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/heic-to-jpg';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert HEIC', path: '/heic' },
    { name: 'HEIC to JPG', path: PATH },
];

const DESCRIPTION = 'Convert HEIC to JPG online free. Drop an iPhone .heic or .heif photo and get a '
    + 'full-resolution .jpg back — the format Windows, Android, print shops and upload forms accept. '
    + 'No account, nothing to install.';

export const metadata = buildMetadata({
    title: 'HEIC to JPG — Convert iPhone Photos to JPG Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-heic.jpg',
});

const FAQS = [
    {
        question: 'Can I just rename the file from .heic to .jpg?',
        answer: 'No. The extension is a label; the bytes inside are still HEIF, and every program that '
            + 'matters reads the bytes. Renaming usually produces a file that will not open at all, or an '
            + 'error saying the file is damaged. The picture has to be decoded and written out again as JPEG, '
            + 'which is what this page does.',
    },
    {
        question: 'Does the JPG keep the date and location of the photo?',
        answer: 'No. Nothing from the HEIC metadata is copied into the JPG, so the date taken, the camera '
            + 'model and the GPS coordinates are all gone. That is good if you are posting the photo '
            + 'somewhere public and inconvenient if you were sorting a library by date, so keep the original '
            + 'HEIC if the date matters to you.',
    },
    {
        question: 'Does a Live Photo keep its movement?',
        answer: 'No. A Live Photo is a still image plus a short video, and only the still is converted. The '
            + 'JPG is the frame you see in your camera roll, at full resolution. The motion, the depth map '
            + 'from Portrait mode and any burst frames stay behind in the original file.',
    },
    {
        question: 'Can I convert several HEIC photos at once?',
        answer: 'This converter takes one photo per pass. For a whole camera roll it is faster to change what '
            + 'the phone writes: on your iPhone open Settings, tap Camera, tap Formats and choose Most '
            + 'Compatible, and every new photo is a JPEG from then on.',
    },
    {
        question: 'Is the JPG good enough to print?',
        answer: 'Yes. The photo keeps every pixel it had — nothing is scaled down — and it is written at '
            + 'quality 90, which is high enough that the difference from the original is very hard to see. A '
            + '12-megapixel iPhone photo at that setting prints cleanly well past A4.',
    },
    {
        question: 'Do you keep my photos?',
        answer: 'No. The photo is sent over HTTPS, decoded and re-encoded on our server, and never '
            + 'kept. It is discarded the moment your download starts, and the JPG carries no EXIF '
            + 'or GPS metadata at all.',
    },
];

export default function HeicToJpgPage() {
    return (
        <>
            <JsonLd
                id="heic-to-jpg-schema"
                data={[
                    softwareApplication({
                        name: 'HEIC to JPG Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Converts .heic and .heif to .jpg',
                            'Keeps the full pixel dimensions of the original photo',
                            'Writes the JPG at quality 90',
                            'Carries no EXIF or GPS metadata into the JPG',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <HeicTool
                title="HEIC to JPG"
                intro="Drop a .heic or .heif photo from an iPhone and get a full-resolution .jpg back."
                breadcrumb={BREADCRUMB}
            >
                <ContentSection id="what-comes-back" heading="What comes back">
                    <p>
                        One JPG, at exactly the pixel dimensions the photo already had. Nothing is scaled,
                        cropped or rotated, and the file is written at quality 90 — high enough that you would
                        struggle to tell it from the original at full zoom.
                    </p>
                    <p>
                        A HEIC file can hold more than one picture. Live Photos, Portrait depth maps and burst
                        frames all live in the same container, and only the main image is converted. The JPG
                        you download is the frame you see in your camera roll, on its own.
                    </p>
                    <p>
                        The download keeps the original name with a .jpg extension, so a photo that arrived as
                        IMG_4821.HEIC leaves as a recognisable IMG_4821.jpg.
                    </p>
                </ContentSection>

                <ContentSection id="renaming" heading="Renaming the file to .jpg does not work">
                    <p>
                        This is the first thing almost everyone tries, and it is worth saying plainly: changing
                        the extension changes the label on the file, not the bytes inside it. A HEIC renamed to
                        .jpg is still HEIF-encoded data, and any program that opens it reads the first few
                        bytes of the file rather than trusting the name.
                    </p>
                    <p>
                        What you get is either nothing at all or an error about a damaged file — and on an
                        upload form, a rejection after the upload has already finished. The drop zone on this
                        page reads those same first bytes, so a renamed file is caught before it is sent
                        anywhere, with a reason rather than a failure halfway through.
                    </p>
                </ContentSection>

                <ContentSection id="where-jpg-is-required" heading="Where a JPG is the only thing that works">
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            Application forms — jobs, visas, universities, insurance claims. Most of them list
                            JPG and PNG and stop there.
                        </li>
                        <li>
                            Print. Photo kiosks in shops, online print labs and office printers driven from
                            older software mostly do not know what a HEIC is.
                        </li>
                        <li>
                            Documents. Dropping a HEIC into Word, PowerPoint or a slide deck someone else will
                            open tends to leave a placeholder where the picture should be.
                        </li>
                        <li>
                            Anything you are sending to a mixed audience. A JPG opens on a fifteen-year-old
                            laptop; a HEIC needs software from the last few years.
                        </li>
                        <li>
                            Older Android handsets and the apps on them, which read HEIF inconsistently even
                            when the system supports it.
                        </li>
                    </ul>
                </ContentSection>

                <ContentSection id="size" heading="The JPG will be bigger — plan for it">
                    <p>
                        HEIC is roughly twice as efficient as JPEG, so the same picture written as a JPG is
                        usually about twice the size. A 2 MB photo off an iPhone commonly lands somewhere near
                        4 MB. That is not a fault in the conversion; it is the cost of a format everything can
                        read.
                    </p>
                    <p>
                        If the form you are filling in has a size cap, deal with it after the conversion rather
                        than before. Compress the JPG to a byte target — the{' '}
                        <Link
                            href="/compress-image-to-200kb"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            200 KB
                        </Link>{' '}
                        and{' '}
                        <Link
                            href="/compress-image-to-100kb"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            100 KB
                        </Link>{' '}
                        pages are set up for exactly that — or cut the pixel dimensions first with the resizer,
                        which shrinks a file faster than any quality setting can.
                    </p>
                </ContentSection>

                <ContentSection id="one-at-a-time" heading="One photo at a time, and what to do about a folder">
                    <p>
                        This converter handles a single photo per pass, up to 20 MB, which covers every still
                        an iPhone produces with room to spare. There is no batch mode for HEIC — the bulk
                        resizer takes JPEG, PNG and WebP only, so a folder of HEICs has to come through
                        here one at a time.
                    </p>
                    <p>
                        If you are converting the same photos every week, the better fix is upstream — the{' '}
                        <Link
                            href="/heic"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            HEIC tool page
                        </Link>{' '}
                        walks through the camera setting that stops your iPhone writing HEIC in the first
                        place, and what it costs you in storage.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="heic-to-jpg-faq" />
            </HeicTool>
        </>
    );
}
