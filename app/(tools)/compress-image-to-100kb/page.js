/**
 * /compress-image-to-100kb — the form-filling page.
 *
 * The compressor opens in target mode with 100 KB already typed in, so the
 * first drop is the whole job. The copy is about the requirement behind the
 * query: who imposes a 100 KB ceiling, why the result lands just under rather
 * than exactly on it, and what to do when a photograph cannot get there without
 * falling apart.
 */
import Link from 'next/link';

import CompressTool from '@/app/(tools)/compress/CompressTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import JsonLd from '@/components/seo/JsonLd';
import { TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import { breadcrumbList, faqPage, softwareApplication } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/compress-image-to-100kb';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Compress Image', path: '/compress' },
    { name: 'Compress to 100 KB', path: PATH },
];

const DESCRIPTION = 'Compress an image to 100 KB online free. The target is already set — drop a JPEG, PNG '
    + 'or WebP and the encoder is searched until the result fits under 100 KB. For portals and forms with a '
    + 'hard size limit.';

export const metadata = buildMetadata({
    title: 'Compress Image to 100KB Online Free | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-compress.jpg',
});

const FAQS = [
    {
        question: 'Will the file be exactly 100 KB?',
        answer: 'It will be at or just under, never over. There is no encoder setting that means "produce '
            + '102,400 bytes" — quality is the only dial, and what it produces depends on the picture. The '
            + 'server encodes, measures, adjusts and repeats until it has the best-looking version that still '
            + 'fits, which is what a form with a ceiling actually needs.',
    },
    {
        question: 'What happens if my image cannot get down to 100 KB?',
        answer: 'You get told, with a number. Rather than handing back a file that misses the requirement, '
            + 'the tool reports the smallest size it could actually achieve for that image and asks you to '
            + 'raise the target. The usual fix is to reduce the pixel dimensions first and then compress '
            + 'again.',
    },
    {
        question: 'Does 100 KB mean 100,000 bytes or 102,400?',
        answer: '102,400 — one kilobyte is 1024 bytes here, which is what Windows, macOS and almost every '
            + 'upload form mean by KB as well. If a portal is strict to the byte and rejects the file anyway, '
            + 'set the target slightly lower, at 95 KB, and try again.',
    },
    {
        question: 'Will the photo still look acceptable at 100 KB?',
        answer: 'That depends almost entirely on the pixel dimensions, not on the compressor. Around 1000 to '
            + '1200 pixels on the long side, 100 KB is comfortable. Force a 4000-pixel photograph into the '
            + 'same 100 KB and the quality has to fall a long way to get there, so resize first.',
    },
    {
        question: 'Which formats can I compress?',
        answer: 'JPEG, PNG and WebP, up to 20 MB each. The output keeps the format it came in with. JPEG and '
            + 'WebP are compressed by lowering the encoder quality; PNG is lossless, so it is compressed by '
            + 'reducing the number of colours and, if that is not enough on its own, by scaling the '
            + 'dimensions down.',
    },
    {
        question: 'Do you keep my images?',
        answer: 'No. The file is sent over HTTPS, compressed in memory on our server, and never written to '
            + 'disk. It is discarded the moment your download starts, and EXIF and GPS metadata are stripped '
            + 'from the output — which matters for an identity document or a photo you are about to attach '
            + 'to an application.',
    },
];

export default function CompressTo100KbPage() {
    return (
        <>
            <JsonLd
                id="compress-100kb-schema"
                data={[
                    softwareApplication({
                        name: 'Compress Image to 100 KB',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Target size preset to 100 KB',
                            'Binary-searches the encoder and reports the size achieved',
                            'Never returns a file above the target',
                            'JPEG, PNG and WebP',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    faqPage(FAQS),
                ]}
            />

            <CompressTool
                preset={{ targetKb: 100 }}
                title="Compress an Image to 100 KB"
                intro="The target is already set to 100 KB. Drop a JPEG, PNG or WebP and the result comes back at or under it."
                breadcrumb={BREADCRUMB}
            >
                <ContentSection id="why-100kb" heading="Why so many forms stop at 100 KB">
                    <p>
                        A 100 KB ceiling is almost never an aesthetic decision. It comes from the system on the
                        other side: a recruitment portal storing photographs for hundreds of thousands of
                        applicants, an examination board with a fixed field size, a government service built
                        against a database column that was sized years ago and never revisited.
                    </p>
                    <p>
                        Examination and recruitment portals are the most common source of it. They typically
                        ask for a passport-style photograph somewhere between 20 KB and 100 KB, and a scanned
                        signature between 10 KB and 20 KB, with the file rejected outright above the stated
                        figure. University applications, visa services and insurance claim uploads use the same
                        pattern. In every case the number is a hard ceiling rather than a suggestion, which is
                        why landing just underneath it is the only useful behaviour.
                    </p>
                </ContentSection>

                <ContentSection id="at-or-under" heading="Why the result lands just under, not exactly on">
                    <p>
                        No image encoder takes a byte count as an instruction. You can ask a JPEG encoder for
                        quality 62; you cannot ask it for 102,400 bytes, because the size that comes out
                        depends on the picture — a plain studio background and a photo of a forest produce
                        wildly different files from the same setting.
                    </p>
                    <p>
                        So the tool measures rather than predicting. It encodes at a probe quality, reads the
                        real length of the result, and bisects the quality range from there, up to{' '}
                        {TARGET_SEARCH_ITERATIONS} times, keeping the best-looking version whose size still
                        fits. What you download is the largest file that stays under your number. It is
                        reported back to you in the panel next to the original size, so you can check it before
                        you submit anything.
                    </p>
                </ContentSection>

                <ContentSection id="resize-first" heading="If it cannot reach 100 KB, cut the pixels first">
                    <p>
                        There is a floor to what any image can be compressed to, and it is set by how many
                        pixels it has. A 12-megapixel photograph has twelve million pixels to describe;
                        squeezing that into 100 KB leaves well under a tenth of a bit per pixel, and the result
                        is visibly blocky whatever the encoder does.
                    </p>
                    <p>
                        When that happens the tool tells you the smallest size it could actually reach for your
                        file. The fix is to reduce the dimensions and try again — around 1000 to 1200 pixels on
                        the long side is a comfortable home for a 100 KB photograph, and it is more than enough
                        for any form that displays a headshot.{' '}
                        <Link
                            href="/resize"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            Resize it first
                        </Link>
                        , then come back here.
                    </p>
                </ContentSection>

                <ContentSection id="photos-and-signatures" heading="Photographs and scanned signatures behave differently">
                    <p>
                        A photograph is continuous tone, so lowering the JPEG quality is the right lever and
                        the search above finds it in a few encodes. A scanned signature is the opposite: black
                        ink on white paper, two colours doing almost all the work.
                    </p>
                    <p>
                        If that scan is a PNG, the tool reduces its palette rather than its quality, which on a
                        signature costs practically nothing visually and takes the file a very long way down.
                        Only if the palette alone cannot reach the target does it start scaling the dimensions.
                        If the scan is a JPEG, consider raising the scanner contrast instead — clean white
                        paper compresses far better than a grey, speckled background.
                    </p>
                </ContentSection>

                <ContentSection id="other-targets" heading="If the limit is not 100 KB">
                    <p>
                        The number in the panel above is editable, so any target from 10 KB up to 20 MB works
                        on this page. There is also a{' '}
                        <Link
                            href="/compress-image-to-200kb"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            200 KB
                        </Link>{' '}
                        version, which is the other limit forms ask for most often and gives a full-size photo
                        noticeably more room, and the{' '}
                        <Link
                            href="/compress"
                            className="rounded-input font-medium text-accent underline underline-offset-4"
                        >
                            main compressor
                        </Link>{' '}
                        if you would rather work with a quality slider than a byte target.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="compress-100kb-faq" />
            </CompressTool>
        </>
    );
}
