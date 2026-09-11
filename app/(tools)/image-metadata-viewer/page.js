import Link from 'next/link';

import MetadataViewerTool from './MetadataViewerTool';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

const PATH = '/image-metadata-viewer';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Image Metadata Viewer', path: PATH },
];

const DESCRIPTION = 'See the EXIF, GPS, XMP and colour-profile data a JPEG, PNG or WebP carries — read '
    + 'without uploading it, in your own browser. No file is changed, and nothing is sent anywhere.';

export const metadata = buildMetadata({
    title: 'Image Metadata Viewer — View EXIF, GPS, XMP Online | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-image.jpg',
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'Image metadata is the information a camera, a phone or an editor writes into a file beside '
    + 'the picture: the make and model, the date and time, the exposure settings, sometimes the GPS '
    + 'coordinates of where it was taken, an XMP block of editing history and a colour profile. Choose a '
    + 'photo and Resizo reads all of it from the file’s own bytes in your browser, with the same container readers its '
    + 'metadata remover uses; the page loads that code once and the file never leaves your device. '
    + 'What comes back is a report of what is present, a plain warning when location data is found and '
    + 'a link to remove it, while the picture itself is never decoded, changed or written anywhere.';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const FAQS = [
    {
        question: 'Does looking at a photo here change it in any way?',
        answer: 'No. Nothing is decoded, nothing is rewritten and nothing is saved — the file is read once, '
            + 'a report is built from what its bytes already say, and the original stays exactly as it was on '
            + 'your device. There is no Download image button here, only a Download report (JSON) button, '
            + 'because this tool never produces a picture of its own.',
    },
    {
        question: 'Can I see the exact GPS coordinates a photo carries?',
        answer: 'Yes, and that is worth pausing on before you paste a screenshot of this page anywhere: the '
            + 'latitude and longitude print in full, in the Location (GPS) section, with a Copy coordinates '
            + 'button beside them. If you are checking a photo before sending it to someone, that is exactly '
            + 'the point; if you are checking it on a screen other people can see, read the summary first and '
            + 'decide whether to open that section at all.',
    },
    {
        question: 'Why does this page show a different DPI than the one printed on my scan?',
        answer: 'DPI is a note in the file’s header about print size, not a property of the pixels, and a '
            + 'JPEG can carry that note in two different places — a JFIF header and an EXIF block — that do '
            + 'not always agree. The Resolution section names which one it read the value from. Change Image '
            + 'DPI writes a number you choose into every resolution field the file has, without touching a '
            + 'pixel.',
    },
    {
        question: 'Can I inspect a HEIC photo straight from my iPhone?',
        answer: 'Not here. HEIC stores its picture inside a different kind of container, one this reader '
            + 'does not walk. Convert HEIC to JPG first — the JPEG it writes carries its own EXIF and GPS '
            + 'blocks, and this page reads those the same way it reads any other JPEG.',
    },
    {
        question: 'Is the photo I check here uploaded anywhere?',
        answer: 'No. The code that reads the file is loaded into the page and runs on your own device, so '
            + 'the photo — and whatever it carries, coordinates included — never reaches us. That is the '
            + 'reason this tool can exist at all: reading a file’s location data is only safe to offer when '
            + 'reading it never leaves the device it is already sitting on.',
    },
];

const HOW_TO_ID = 'how-to-view-image-metadata';
const HOW_TO_HEADING = 'How to view the metadata stored in an image';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Choose the photo you want to check',
        text: 'Drop a JPEG, PNG or WebP onto the panel, or press Browse images. No photo to hand? Try the '
            + 'sample photo instead. The file is read where it already sits.',
    },
    {
        name: 'Read What this file contains',
        text: 'The summary names the format, the pixel size, the file size, and whether EXIF, GPS, XMP, an '
            + 'ICC profile and a recorded resolution are present, with a warning glyph beside GPS when '
            + 'location data is found.',
    },
    {
        name: 'Open a section for the detail behind any row',
        text: 'Camera and capture (EXIF), Location (GPS), Colour profile (ICC), XMP, and Comments and text '
            + 'each expand into their own values, and All detected fields shows the raw tags underneath '
            + 'them.',
    },
    {
        name: 'Copy a value, download the report, or remove what you found',
        text: 'Copy buttons sit beside the pixel size, the coordinates, the capture date and the camera '
            + 'model. Download report (JSON) saves the whole reading. If the file carries anything '
            + 'removable, Remove metadata goes straight to the tool that takes it out.',
    },
];

export default function ImageMetadataViewerPage() {
    return (
        <>
            <JsonLd
                id="image-metadata-viewer-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Image Metadata Viewer',
                        description: DESCRIPTION,
                        path: PATH,
                        features: [
                            'Reads EXIF camera and capture data, GPS location, resolution, XMP and ICC colour profile',
                            'Names which categories of metadata a JPEG, PNG or WebP carries, by category',
                            'Shows every curated field as text, plus a raw, per-container field list',
                            'Copies the pixel size, the coordinates, the capture date and the camera model',
                            'Downloads the full reading as a JSON report',
                            'Never decodes the picture and never writes a file — nothing here can change your photo',
                            'Runs on your own device — the photo is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Read the EXIF, GPS, XMP and colour-profile data a JPEG, PNG or WebP '
                            + 'carries, on your own device, without uploading it.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <MetadataViewerTool
                answer={ANSWER}
                breadcrumb={BREADCRUMB}
            >
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            Every step below runs on your own device. There is no server this file is sent to,
                            so the order is exactly what happens: a read, a report, and then whatever you
                            decide to do with what it says.
                        </p>
                    )}
                />

                <ContentSection id="what-is-exif" heading="What EXIF metadata is">
                    <p>
                        EXIF is a block most cameras and phones write into a JPEG (and sometimes a WebP)
                        alongside the picture: the make and model of the camera, the lens, the exposure
                        settings, the exact date and time the shutter was pressed, and often a serial number
                        that ties every photo from that body together. It can also carry a small, genuinely
                        visible thumbnail of the picture, generated at the moment of capture.
                    </p>
                    <p>
                        None of it is drawn into the picture itself — it sits in a separate part of the file a
                        photo viewer does not usually show you, which is the whole reason a tool like this one
                        exists. This page lists every curated field it finds under Camera and capture (EXIF),
                        and the orientation tag specifically, since that is the one EXIF field that changes how
                        a viewer displays the picture rather than merely describing it.
                    </p>
                </ContentSection>

                <ContentSection id="location-metadata" heading="Can an image contain location data?">
                    <p>
                        Yes. A phone with location services on writes GPS coordinates into a photo’s EXIF block
                        by default — latitude, longitude, often an altitude and the exact time, all inside the
                        same file as the picture. Posting, messaging or emailing the photo carries the
                        coordinates along with it unless something strips them out first.
                    </p>
                    <p>
                        On a photo taken at home, that is a house number. The summary on this page marks a file
                        that carries GPS data with a warning glyph beside the word Present, and the Location
                        (GPS) section prints the coordinates in full, because deciding whether that matters is
                        the reason to check in the first place.
                    </p>
                </ContentSection>

                <ContentSection id="pixels-unchanged" heading="Does removing metadata change the pixels?">
                    <p>
                        Not on this site. The EXIF, GPS and XMP blocks sit outside the compressed picture data
                        a JPEG, PNG or WebP carries — a JPEG’s picture data runs from its SOS marker to its EOI
                        marker, a PNG’s sits in its image chunks with their own CRCs, and a WebP’s sits in its
                        own image chunk — so removing the descriptive blocks around that data and copying it
                        straight through leaves the picture byte for byte the same. The colour profile (ICC)
                        is kept rather than removed, because it is not identity, it is colour: dropping it
                        would shift how the picture displays while claiming the change was about privacy.
                    </p>
                    <p>
                        This page only reads, so it never removes anything itself.{' '}
                        <Link href="/remove-image-metadata" className={LINK}>
                            Want to take out what you just saw? Remove image metadata
                        </Link>{' '}
                        rewrites the file with the same byte-for-byte guarantee, and every report on this page
                        that finds something removable links straight to it.
                    </p>
                </ContentSection>

                <ContentSection id="what-is-dpi" heading="What DPI metadata is">
                    <p>
                        DPI — dots per inch — is a note in a JPEG or PNG header about how large the picture is
                        meant to print. It is not a property of the pixels: a 4000 × 3000 photo is exactly that
                        many pixels whether its header claims 72 DPI or 300, and two files with identical
                        pixels can carry different numbers. A JPEG can even disagree with itself, recording one
                        value in its JFIF header and a different one in its EXIF block.
                    </p>
                    <p>
                        The Resolution section on this page names the number a file carries, which header it
                        came from, and the print size that number implies at the picture’s actual pixel
                        dimensions.{' '}
                        <Link href="/change-image-dpi" className={LINK}>
                            Need a specific number instead of just reading the current one? Change Image DPI
                        </Link>{' '}
                        writes it into every resolution field the file has, without touching a pixel.
                    </p>
                </ContentSection>

                <ContentSection id="what-is-icc" heading="What an ICC profile is">
                    <p>
                        An ICC profile is a small block that tells a screen or a printer what the colour
                        numbers in a picture actually mean — which red is really being asked for, not just
                        which number represents it. A photo edited in a wide colour space and displayed with no
                        profile, or the wrong one, can show duller greens and shifted skin tones even though
                        every pixel value is identical to the original file.
                    </p>
                    <p>
                        The Colour profile (ICC) section on this page names the profile’s description and its
                        colour space when one is present, and its byte size — a profile is data, sometimes
                        several kilobytes of it, sitting in the same file as the picture. It carries no personal
                        information the way EXIF or GPS can, which is why it is the one thing a metadata
                        removal tool keeps rather than strips.
                    </p>
                </ContentSection>

                <ContentSection id="no-upload" heading="Does choosing a photo here expose its metadata?">
                    <p>
                        The viewer never uploads the file: it reads the bytes in your browser and the request
                        log of every test proves only same-origin GET requests. The code that parses EXIF, GPS,
                        XMP and ICC data is downloaded to your device the same way the rest of this page is,
                        and it runs there — a photo carrying coordinates that point at your front door is
                        exactly the file this page is safest to check, because there is nowhere else for those
                        coordinates to go.
                    </p>
                </ContentSection>

                <FaqList items={FAQS} id="image-metadata-viewer-faq" />
            </MetadataViewerTool>
        </>
    );
}
