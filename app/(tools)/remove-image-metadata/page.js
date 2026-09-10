import Link from 'next/link';

import MetadataTool from './MetadataTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { formatFileSize } from '@/lib/format/bytes';
import { GITHUB_REPO_URL, buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/remove-image-metadata';

const BENCHMARK_URL = `${GITHUB_REPO_URL}/blob/main/benchmarks/README.md`;

/**
 * THE ONE FIGURE ON THIS SITE THAT IS NOT A PICTURE.
 *
 * A screenshot of a metadata readout would be a picture of text: unreadable to
 * anyone using a screen reader, unselectable, unsearchable, wrong in the other
 * theme, and stale the day the panel changes a word. The evidence here is a
 * list of category names and two byte counts, so the honest medium is a table.
 *
 * The rows are split out of the sentence the panel printed during the run
 * rather than typed underneath it. tests/app/demo-assets.test.js pins that
 * sentence's shape, so a reworded panel fails there instead of rendering an
 * empty table in production.
 */
const MEASURED = benchmark.scenarios
    .find((scenario) => scenario.id === 'demo-outputs')
    .cases.find((entry) => entry.id === 'metadata-stripped');

const REMOVED = MEASURED.panel.match(/Removed: (.+?)\. Kept:/)[1].split(', ');
const KEPT = MEASURED.panel.match(/Kept: (.+?), because/)[1].split(', ');

const STRIP_ROWS = [
    ...REMOVED.map((category) => ({ category, before: 'Present', after: 'Gone' })),
    ...KEPT.map((category) => ({ category, before: 'Present', after: 'Still there' })),
    {
        category: 'The compressed picture itself',
        before: `${MEASURED.input.width} × ${MEASURED.input.height}`,
        after: `${MEASURED.output.width} × ${MEASURED.output.height}, the same bytes`,
    },
];

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Remove Image Metadata', path: PATH },
];

const DESCRIPTION = 'Remove EXIF, GPS, XMP and IPTC data from a JPEG, PNG or WebP without uploading '
    + 'it — the rewrite runs on your own device. The compressed picture is copied through byte for '
    + 'byte, so nothing is re-encoded and no quality is lost. See what a file carries before you strip it.';

export const metadata = buildMetadata({
    title: 'Remove Image Metadata Online — EXIF, GPS, XMP | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-convert.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Image metadata is the descriptive text a camera or an editor writes into a file '
    + 'alongside the picture: the camera model and serial number, the date, the GPS coordinates of '
    + 'wherever the shutter was pressed, editing history, captions and often a small preview '
    + 'thumbnail. Removing it means rewriting the file without those blocks and copying the '
    + 'compressed picture across untouched, so the photograph itself does not change at all. On '
    + 'Resizo you drop a JPEG, PNG or WebP, read the list of what it turns out to carry, then press '
    + 'Remove metadata. Both the reading and the rewriting are done by your own device, on code the '
    + 'page hands to your browser, which is why a photo whose coordinates point at your home can be '
    + 'handled here in the first place.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const FAQS = [
    {
        question: 'Is my photo uploaded anywhere to have its metadata removed?',
        answer: 'No. The code that reads the file and the code that rewrites it are both loaded into '
            + 'the page and run by your own device, so the photo never reaches us and there is nothing '
            + 'for us to hold. That is the reason this particular tool can work at all: a file whose '
            + 'coordinates give away where you live is the last thing anyone should hand to a stranger '
            + 'to have those coordinates taken out.',
    },
    {
        question: 'Will the picture look any different afterwards?',
        answer: 'No, and not in the "you would never notice" sense. The compressed image data is copied '
            + 'from the old file to the new one byte for byte, so the pixels are identical rather than '
            + 'visually identical. The one visible change is possible on a phone photo that was stored '
            + 'sideways and relied on the EXIF orientation tag to be turned upright, because that tag '
            + 'sits inside the block being removed — see the question below.',
    },
    {
        question: 'My photo came out rotated. Why, and how do I fix it?',
        answer: 'A phone does not turn the sensor when you hold it upright. It stores the pixels '
            + 'sideways and writes an EXIF orientation tag telling viewers how far to turn them. That '
            + 'tag lives in the same EXIF block as the camera and the GPS coordinates, so it goes when '
            + 'they go, and the sideways pixels are what is left. Run the photo through Resize, Compress '
            + 'or Convert first: those tools decode the picture, turn the pixels upright for real and '
            + 'write it out with no metadata at all.',
    },
    {
        question: 'Does it remove the date the photo was taken?',
        answer: 'Yes. The capture date, the camera make and model, the lens, the exposure settings and '
            + 'the serial number are all fields inside the EXIF block, and the whole block is removed '
            + 'rather than edited field by field. The file system still records when the file itself was '
            + 'written, which is a property of your disk and not something inside the image.',
    },
    {
        question: 'Can I remove metadata from a HEIC photo from my iPhone?',
        answer: 'Not here. A HEIC stores its picture inside a box tree that would have to be rebuilt, '
            + 'and the only shortcut — decoding the photo and encoding it again — would throw away the '
            + 'lossless promise this tool is built on. Convert HEIC to JPG first: that path decodes and '
            + 're-encodes anyway, and the JPG it writes carries no metadata to begin with.',
    },
    {
        question: 'Do screenshots and PNG exports carry metadata too?',
        answer: 'Often, though less of it than a phone photo. A PNG can hold text chunks naming the '
            + 'software that made it and sometimes the path it was exported from, an XMP block with '
            + 'editing history, a last-modified time, and on newer phones a full EXIF chunk with '
            + 'coordinates. The readout tells you which of those your particular file has before you '
            + 'decide to strip it.',
    },
];

const HOW_TO_ID = 'how-to-remove-metadata';
const HOW_TO_HEADING = 'How to remove metadata from an image';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the photo you want cleaned',
        text: 'Drop a JPEG, PNG or WebP onto the panel above, or press Browse images. The file is read '
            + 'where it already sits, and all of it is read rather than the first few kilobytes, because '
            + 'a second picture can be stapled on after the first one ends.',
    },
    {
        name: 'Read what the file turns out to carry',
        text: 'The panel lists it under What this file carries: camera and capture data, location, an '
            + 'embedded preview thumbnail, editing history, captions and credits, comments, text chunks '
            + 'and anything appended after the picture, with a count beside a category found more than '
            + 'once. Only the categories are named — no value out of your file is put on screen.',
    },
    {
        name: 'Press Remove metadata',
        text: 'There is nothing to set. Every block that can go, goes; the colour profile stays so the '
            + 'colours still display the way they were meant to; and the compressed picture is copied '
            + 'across rather than re-encoded, which is why there is no quality control here.',
    },
    {
        name: 'Download clean image',
        text: 'The result says what was removed, what was kept and how much smaller the file is now. '
            + 'Press Download clean image to save it. The original on your device is left exactly as it '
            + 'was, so you can keep both.',
    },
];

export default function RemoveImageMetadataPage() {
    return (
        <>
            <JsonLd
                id="remove-image-metadata-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Metadata Remover',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Removes EXIF, GPS, XMP, IPTC, comments and PNG text chunks from JPEG, PNG and WebP',
                            'Lists what a file carries by category and count, never by value',
                            'Cuts data appended after the picture, including a second embedded image',
                            'Rewrites the container without decoding — the compressed picture is copied byte for byte',
                            'Keeps the ICC colour profile, so colours display unchanged',
                            'Runs on your own device — the photo is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Strip EXIF, GPS, XMP and the rest of the descriptive blocks out of '
                            + 'a JPEG, PNG or WebP on your own device, without re-encoding the picture.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <MetadataTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            The readout arrives before the button does, on purpose. Deciding whether to
                            strip a photo means knowing what is in it, and being told afterwards answers
                            the question too late to be a decision.
                        </p>
                    )}
                />

                <ContentSection id="what-is-removed" heading="What gets taken out of the file">
                    <p>
                        A photograph is a container: the compressed picture sits in the middle of it and
                        everything else is description written around the edges. Each kind of description
                        has its own name, and the readout uses those names so you can see which ones your
                        file actually has.
                    </p>
                    <ul className="flex list-disc flex-col gap-2 pl-5">
                        <li>
                            <strong className="font-semibold text-ink">Camera and capture data (EXIF).</strong>{' '}
                            Make, model, lens, exposure, the capture date, and on many bodies a serial
                            number that ties every photo you have ever published to the same camera.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Location (GPS).</strong>{' '}
                            Latitude and longitude, written by a phone by default. On a photo taken at
                            home, indoors, this is a house number, and it survives being posted, mailed
                            and re-saved.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Embedded preview thumbnail.</strong>{' '}
                            A second, smaller, genuinely visible copy of the picture, stored inside the
                            EXIF block. It is generated when the photo is taken and has more than once
                            shown what a later edit was covering up.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Editing history, keywords and ratings (XMP).</strong>{' '}
                            What software touched the file, sometimes every adjustment made to it, and any
                            tags or star ratings from a photo library.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Captions and credits (IPTC).</strong>{' '}
                            Headline, caption, author, copyright and contact fields, written by newsrooms
                            and by anything that has been through a picture desk.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Extra data after the picture.</strong>{' '}
                            Phones write more once the picture has ended, and every viewer ignores it: an
                            Apple secondary image, which is a whole second photograph with its own camera
                            data and its own coordinates, or the short video behind a motion photo. Those
                            bytes are cut, along with the index that pointed at them.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Comments, text chunks and the last-modified time.</strong>{' '}
                            Free text a compressor or an exporter left behind, the name of the program
                            that wrote the file, sometimes the folder path it came from, and the timestamp
                            a PNG can carry inside itself.
                        </li>
                    </ul>
                    <p>
                        The panel reports categories and counts and nothing else. No value out of your file
                        is ever rendered, because a readout that helpfully printed a pair of coordinates on
                        a shared screen would publish the exact thing you came here to remove.
                    </p>
                    <Figure
                        caption={(
                            <>
                                {`What that run actually changed: ${formatFileSize(MEASURED.input.bytes)} `}
                                {`became ${formatFileSize(MEASURED.output.bytes)}, a difference of `}
                                {`${formatFileSize(MEASURED.input.bytes - MEASURED.output.bytes)} — the `}
                                description blocks and nothing else. There is no picture of this on purpose:
                                a screenshot of a readout is a picture of text, which a screen reader cannot
                                read and a search cannot find.{' '}
                                <a href={BENCHMARK_URL} rel="noopener" className={LINK}>see the benchmark</a>
                            </>
                        )}
                    >
                        <div
                            className="overflow-x-auto"
                            role="region"
                            aria-label="What a camera-shaped JPEG carried before this tool ran and after it"
                            tabIndex={0}
                        >
                            <table className="w-full min-w-[26rem] border-collapse text-left text-ui">
                                <caption className="sr-only">
                                    What a camera-shaped JPEG carried before this tool ran and after it
                                </caption>
                                <thead>
                                    <tr className="border-b border-line">
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">In the file</th>
                                        <th scope="col" className="py-2 pr-4 font-semibold text-ink">Before</th>
                                        <th scope="col" className="py-2 font-semibold text-ink">After</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {STRIP_ROWS.map((row) => (
                                        <tr key={row.category} className="border-b border-line align-top">
                                            <th scope="row" className="py-2 pr-4 font-medium text-ink">
                                                {row.category}
                                            </th>
                                            <td className="py-2 pr-4 font-data text-ink">{row.before}</td>
                                            <td className="py-2 font-data text-ink">{row.after}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Figure>
                </ContentSection>

                <ContentSection id="what-stays" heading="What stays, and why that is the right call">
                    <p>
                        The colour profile (ICC) is kept. A profile is not identity, it is colour: it tells
                        a viewer what the numbers in the picture mean, and a photo edited in a wide-gamut
                        space and then stripped of its profile is displayed by the wrong rulebook, so
                        greens go flat and skin tones shift. Dropping it would change how the picture looks
                        while telling you your privacy had improved. The readout names it and marks it as
                        kept rather than pretending it was not there.
                    </p>
                    <p>
                        Two small JPEG headers stay for the same reason. One records the density the file
                        claims, which is what a printer and a print shop read — though a JPEG that keeps
                        its print size only inside EXIF loses that number along with the EXIF block; the other tells a decoder
                        how the colour channels in the scan are arranged, and removing it turns a normal
                        photo into a colour bug rather than a private one.{' '}
                        <Link href="/change-image-dpi" className={LINK}>
                            Need the print resolution set instead?
                        </Link>{' '}
                        That is a different job, on the same kind of header.
                    </p>
                </ContentSection>

                <ContentSection id="why-no-reencode" heading="Why nothing is decoded or re-encoded">
                    <p>
                        Every other tool here opens the picture, works on pixels and writes it out again.
                        This one never opens it. A JPEG, a PNG and a WebP are all containers with a
                        compressed payload inside, so only the container is rewritten: the descriptive
                        blocks are left out and the compressed picture is copied straight across. What you
                        download is the same picture, not a new rendering of it.
                    </p>
                    <p>
                        That matters because a JPEG loses a little every time it is saved. Open one, save
                        it, open it again, save it again, and the detail wears down pass by pass, even at
                        quality 100 — the encoder throws away the original coefficients and has to guess
                        new ones. A tool that re-encoded to remove metadata would charge you a generation
                        of quality for a privacy fix. Files here only get smaller, by exactly the weight of
                        the blocks that came out.{' '}
                        <Link href="/compress" className={LINK}>
                            Need it smaller as well?
                        </Link>{' '}
                        Compress it afterwards, when losing some detail is the point rather than a side
                        effect.
                    </p>
                </ContentSection>

                <ContentSection id="limits" heading="Formats, limits and what this cannot do">
                    <p>
                        JPEG, PNG and WebP, up to 20 MB per file. HEIC is refused by name: rewriting its
                        box tree is a different piece of work, and faking it by decoding and re-encoding
                        would break the one promise this tool makes.{' '}
                        <Link href="/convert" className={LINK}>
                            Change the format first
                        </Link>{' '}
                        and the file that comes out is already clean, because a picture written from raw
                        pixels has nothing to carry over. An animated PNG keeps its animation, which lives
                        in chunks the picture needs rather than in the ones being removed.
                    </p>
                    <p>
                        This removes description, not content. Anything drawn into the picture itself
                        stays: a visible watermark, a date burned into the corner by a camera, a face, a
                        street sign, a screenshot of a document. Nothing here inspects pixels, so nothing
                        here can find or change what is in them, and a stripped photo is not an anonymous
                        one — it is a photo that no longer says which camera took it or where.
                    </p>
                    <p>
                        The one limit that comes from your own hardware is memory, and it is a light limit
                        here. The file is walked as bytes and copied in pieces rather than unpacked into a
                        full-size pixel buffer, so this is the cheapest job on the site — a 20 MB photo
                        that a resize would have to think about costs little more than reading it.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="remove-image-metadata-faq" />
            </MetadataTool>
        </>
    );
}
