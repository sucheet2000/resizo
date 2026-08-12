import Link from 'next/link';

import HeicTool from './HeicTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';

const PATH = '/heic';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Convert HEIC', path: PATH },
];

const DESCRIPTION = 'Convert HEIC and HEIF photos from your iPhone to JPG online free. Open iPhone photos on '
    + 'Windows, Android or any upload form that rejects HEIC. Nothing to install, no account.';

export const metadata = buildMetadata({
    title: 'HEIC to JPG Converter — Convert iPhone Photos Online | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-heic.jpg',
});

const FAQS = [
    {
        question: 'What is a HEIC file?',
        answer: 'HEIC is the file extension Apple uses for photos stored in the HEIF container. It has been '
            + 'the default on iPhone since iOS 11 in 2017. The picture inside is encoded with HEVC, which is '
            + 'roughly twice as efficient as JPEG, so the same photo takes about half the space.',
    },
    {
        question: 'Why will my HEIC file not open on Windows?',
        answer: 'Windows 10 and 11 can only show HEIC once the HEIF Image Extensions package is installed '
            + 'from the Microsoft Store, and on many machines the accompanying video extension is a paid '
            + 'add-on. Without them, File Explorer shows a blank thumbnail and Photos refuses to open it.',
    },
    {
        question: 'Does converting HEIC to JPG lose quality?',
        answer: 'One generation of loss, which is very hard to see. The HEIC is decoded to raw pixels and '
            + 're-encoded as a JPEG at quality 90. Nothing is cropped, scaled or rotated, and the full '
            + 'resolution of the original is kept.',
    },
    {
        question: 'Why is the JPG larger than the HEIC I uploaded?',
        answer: 'Because JPEG is an older and less efficient format. Roughly doubling in size is normal and '
            + 'expected — you are trading bytes for a file that Windows, Android, Word, older photo editors '
            + 'and every upload form can read. Compress the JPG afterwards if the size matters.',
    },
    {
        question: 'Can I stop my iPhone making HEIC files?',
        answer: 'Yes. Open Settings, tap Camera, tap Formats and choose Most Compatible. New photos are '
            + 'saved as JPEG from then on. Photos already in your library stay HEIC — this only changes what '
            + 'the camera writes next.',
    },
    {
        question: 'Do you keep my photos?',
        answer: 'No. The file is sent over HTTPS, converted on our server, and never kept. '
            + 'It is discarded the moment your download starts, and EXIF and GPS metadata are stripped '
            + 'from the JPG, so the converted photo no longer carries the location it was taken.',
    },
];

export default function HeicPage() {
    return (
        <>
            <JsonLd
                id="heic-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo HEIC to JPG Converter',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Convert HEIC and HEIF to JPG',
                            'Keeps the full resolution of the original photo',
                            'Strips EXIF and GPS metadata from the JPG',
                            'Nothing to install, works on iPhone, Android, Windows and Mac',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <HeicTool breadcrumb={BREADCRUMB}>
                <ContentSection id="what-is-heic" heading="What is a HEIC file?">
                    <p>
                        HEIC is the extension Apple gives to a photo stored in the HEIF container — High
                        Efficiency Image File Format. Inside, the picture is encoded with HEVC, the same
                        compression family used for 4K video, and that is what makes it so much better than
                        JPEG at the same visual quality: about half the file size for the same photo.
                    </p>
                    <p>
                        Apple switched the iPhone camera to it in iOS 11, released in 2017, and it has been
                        the default on every iPhone since. A HEIC can also hold more than one image, which is
                        how Live Photos, bursts and depth data are stored in a single file. This converter
                        takes the main photo out of that file and writes it as a JPG.
                    </p>
                    <p>
                        You may also see the extension .heif. It is the same container, and both are accepted
                        here.
                    </p>
                </ContentSection>

                <ContentSection id="why-heic-will-not-open" heading="Why will my HEIC file not open?">
                    <p>
                        Because almost nothing outside the Apple ecosystem reads it without help. The usual
                        places it fails:
                    </p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            <span className="text-ink">Windows 10 and 11.</span> Support needs the HEIF Image
                            Extensions package from the Microsoft Store, and on many machines the matching
                            HEVC video extension is a paid add-on. Without them, File Explorer shows an empty
                            thumbnail and Photos throws an error.
                        </li>
                        <li>
                            <span className="text-ink">Older Android phones.</span> Android has read HEIF
                            since version 10, but plenty of apps on older devices still cannot decode one.
                        </li>
                        <li>
                            <span className="text-ink">Photo editors.</span> Photoshop versions before 2019
                            have no HEIC support at all, and several older editors still refuse it today.
                        </li>
                        <li>
                            <span className="text-ink">Web upload forms.</span> Job applications, visa
                            portals, insurance claims and school systems overwhelmingly accept JPG and PNG
                            only. This is the single most common reason people convert.
                        </li>
                        <li>
                            <span className="text-ink">Office documents and email.</span> Dropping a HEIC into
                            Word or an older mail client usually produces a placeholder rather than a picture.
                        </li>
                    </ul>
                </ContentSection>

                <ContentSection id="how-to-convert" heading="How to convert HEIC to JPG">
                    <ol className="flex list-decimal flex-col gap-2 pl-5">
                        <li>
                            Drop the .heic or .heif file onto the panel above, or press Browse photos. On an
                            iPhone you can pick it straight out of your camera roll. The limit is 20 MB, which
                            is far more than any iPhone still photo.
                        </li>
                        <li>
                            Press Convert to JPG. There is nothing to configure — the photo keeps its full
                            resolution and is written at quality 90.
                        </li>
                        <li>
                            The JPG appears in the panel with its size next to the original, and the download
                            button saves it. Now it will open anywhere.
                        </li>
                    </ol>
                    <p>
                        For the practical side of the result — what the JPG keeps, what it leaves behind, and
                        why renaming a .heic file to .jpg never works — see{' '}
                        <Link
                            href="/heic-to-jpg"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            HEIC to JPG
                        </Link>
                        .
                    </p>
                </ContentSection>

                <ContentSection id="stop-heic" heading="Stop your iPhone making HEIC files">
                    <p>
                        If you convert the same photos every week, change what the camera writes instead. On
                        your iPhone open <span className="text-ink">Settings</span>, tap{' '}
                        <span className="text-ink">Camera</span>, tap <span className="text-ink">Formats</span>{' '}
                        and choose <span className="text-ink">Most Compatible</span>. From that point on the
                        camera saves JPEG, and video saves as H.264.
                    </p>
                    <p>
                        The trade is real: JPEG files are roughly twice the size, so your phone storage fills
                        up faster, and Most Compatible caps some of the higher frame-rate video modes. Photos
                        already in your library are not converted — the setting only affects what is written
                        next.
                    </p>
                    <p>
                        There is a second setting worth knowing about. In{' '}
                        <span className="text-ink">Settings</span> →{' '}
                        <span className="text-ink">Photos</span>, at the bottom, the{' '}
                        <span className="text-ink">Transfer to Mac or PC</span> option can be set to{' '}
                        <span className="text-ink">Automatic</span>, which converts photos to JPEG as they
                        copy across a cable. Set to <span className="text-ink">Keep Originals</span> it hands
                        over the HEIC untouched, which is how most people end up with files their computer
                        cannot read.
                    </p>
                </ContentSection>

                <ContentSection id="quality" heading="Does converting lose quality?">
                    <p>
                        A little, and only once. The HEIC is decoded back to raw pixels and then re-encoded as
                        a JPEG at quality 90 — a high setting where the difference from the source is very
                        hard to see even side by side at full zoom. Nothing is scaled, cropped or rotated, and
                        the output has exactly the pixel dimensions the original had.
                    </p>
                    <p>
                        What does change noticeably is the file size, and in the wrong direction. Expect the
                        JPG to be roughly twice the size of the HEIC, because JPEG simply cannot pack the same
                        picture as tightly. That is the price of a format everything can open. If the result
                        is too big for wherever you are sending it, run it through the compressor afterwards
                        and set a target size in KB.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="Limits and what happens to your photo">
                    <p>
                        HEIC and HEIF files up to 20 MB. The file is checked by its actual signature rather
                        than its name, so a renamed file is rejected with a reason instead of failing halfway
                        through. Live Photos convert to their still frame; the motion is not kept.
                    </p>
                    <p>
                        Your photo is sent over HTTPS and converted on our server — never kept,
                        deleted the moment your download starts. EXIF and GPS metadata are stripped from
                        the JPG, which matters more here than anywhere else on the site: iPhone photos carry
                        the exact coordinates where they were taken.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="heic-faq" />
            </HeicTool>
        </>
    );
}
