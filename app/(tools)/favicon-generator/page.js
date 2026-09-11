import FaviconTool from './FaviconTool';
import benchmark from '@/benchmarks/results/latest.json';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import Figure from '@/components/content/Figure';
import HowToSteps from '@/components/content/HowToSteps';
import JsonLd from '@/components/seo/JsonLd';
import { ICON_SOURCES } from '@/lib/catalog/icon-sources';
import { formatFileSize } from '@/lib/format/bytes';
import { GITHUB_REPO_URL, buildMetadata } from '@/lib/seo';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/**
 * The figure is the tool's own output, never a mock-up. benchmarks/run.js
 * drives this page with the sample logo under its defaults (Crop to square,
 * Transparent) and records every file of the package; scripts/generate-demos.js
 * copies four of those files and the source into public/demos byte for byte,
 * and this page reads the same case out of benchmarks/results/latest.json for
 * the numbers under them. Until that scenario has been measured and committed,
 * MEASURED is null and the section renders no figure rather than a stale one.
 */
const SCENARIO = benchmark.scenarios.find((scenario) => scenario.id === 'favicon') ?? null;
const MEASURED = SCENARIO?.cases?.find((entry) => entry.id === 'favicon-crop-to-square') ?? null;

const BENCHMARK_URL = `${GITHUB_REPO_URL}/blob/main/benchmarks/README.md`;

/** One recorded file of the measured package, by the name the tool gave it. */
const measuredAsset = (filename) => (MEASURED?.assets ?? []).find((asset) => asset.filename === filename) ?? null;

const FIGURE_IMAGES = MEASURED ? [
    {
        src: '/demos/favicon-source-640x400.png',
        width: 640,
        height: 400,
        alt: 'The sample logo mark at its original 640 by 400 pixels, a blue rounded plate carrying a '
            + 'yellow disc and a red wedge on a transparent ground, before any crop has been applied.',
        label: 'Source, 640 × 400',
    },
    {
        src: '/demos/favicon-16x16.png',
        width: 16,
        height: 16,
        alt: 'The generated 16 by 16 favicon, the browser-tab size, cut from the centred square of the '
            + 'sample mark and shown at its real size.',
        label: '16 × 16',
    },
    {
        src: '/demos/favicon-32x32.png',
        width: 32,
        height: 32,
        alt: 'The generated 32 by 32 favicon, the size a higher-density tab or a bookmark bar asks for, '
            + 'shown at its real size.',
        label: '32 × 32',
    },
    {
        src: '/demos/favicon-192x192.png',
        width: 192,
        height: 192,
        alt: 'The generated 192 by 192 icon that the web app manifest lists for an install prompt, '
            + 'shown at its real size.',
        label: '192 × 192',
    },
    {
        src: '/demos/favicon-512x512.png',
        width: 512,
        height: 512,
        alt: 'The generated 512 by 512 icon, enlarged from the 400 pixel square the default frame keeps '
            + 'on the sample mark, shown at its real size.',
        label: '512 × 512',
    },
] : [];

const PATH = '/favicon-generator';

const LINK = 'rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2';

const DESCRIPTION = 'Generate favicon.ico, five PNG icons and a web app manifest from one logo, entirely in '
    + 'your browser — nothing is uploaded.';

export const metadata = buildMetadata({
    title: 'Favicon & App Icon Generator | Resizo',
    description: DESCRIPTION,
    path: PATH,
});

/** The direct answer, written to stand on its own away from this page. */
const ANSWER = 'A favicon.ico, five PNG icons and a web app manifest, generated from one logo you choose. '
    + 'favicon.ico bundles 16 × 16, 32 × 32 and 48 × 48 into the single file most browsers still look for at '
    + 'the site root; separate 16, 32, 180, 192 and 512 pixel PNGs cover a browser tab, an iPhone home screen '
    + 'and Chrome’s own install check; the manifest points at the two Chrome needs. Resizo crops your logo to '
    + 'a square or fits the whole thing inside one, composites it onto a background you pick or leaves it '
    + 'transparent, and writes every file with the decoder and encoder this page loads into your own browser '
    + 'tab. It does not judge the logo itself — enlarging a small one increases its pixel dimensions but '
    + 'cannot invent detail a smaller original never had.';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Favicon & App Icon Generator', path: PATH },
];

/** 'required-by-chrome' | 'documented-by-apple' | 'common' | 'specification' -> the sentence a page may say about it. */
const STATUS_LABELS = {
    'required-by-chrome': 'Required by Chrome for installability',
    'documented-by-apple': 'Documented by Apple',
    common: 'Common web convention',
    specification: 'Defined by a specification',
};

const HOW_TO_ID = 'how-to-generate-favicons';
const HOW_TO_HEADING = 'How to generate a favicon package';

/** Rendered by HowToSteps and described by howTo() — one array, never two. */
const STEPS = [
    {
        name: 'Drop your logo, or try the sample',
        text: 'JPEG, PNG or WebP, up to 20 MB. No logo to hand yet? Try the sample logo to see the whole '
            + 'workflow first.',
    },
    {
        name: 'Choose Crop to square or Fit inside square',
        text: 'Crop to square keeps the part of the logo inside the frame; Fit inside square keeps the whole '
            + 'logo and pads the rest. Pick a background colour, or leave it transparent.',
    },
    {
        name: 'Check the composed preview',
        text: 'The preview draws the exact square every icon is built from, with an optional circle and '
            + 'rounded-square guide. Fine detail can disappear once an icon is shrunk to 16 × 16.',
    },
    {
        name: 'Press Generate icons, then download the files or the ZIP',
        text: 'Every size, favicon.ico, the manifest, an HTML snippet to paste and one ZIP download appear '
            + 'once the package is ready.',
    },
];

const FAQS = [
    {
        question: 'Does Resizo generate a maskable icon?',
        answer: 'No. A maskable icon is drawn to a 40%-radius safe zone so Android’s own adaptive mask never '
            + 'crops it, which is a design decision about the artwork rather than a resize — this tool '
            + 'declares both manifest icons with purpose "any" and leaves maskable icons for a design tool.',
    },
    {
        question: 'Will favicon.ico decode in every browser?',
        answer: 'The 1995 Microsoft document that defines the ICO container predates PNG-compressed entries, '
            + 'so it says nothing about them either way. Resizo’s own end-to-end tests decode the generated '
            + 'favicon.ico in an image element in Chromium, Firefox and WebKit to prove the PNG payloads '
            + 'render, rather than asserting a rule the original specification never made.',
    },
    {
        question: 'Do I have to use the web app manifest?',
        answer: 'No. The six image files and the HTML snippet work on their own; the manifest only matters if '
            + 'the site wants Chrome to treat it as installable, which is also the one place a size is '
            + 'genuinely required rather than merely common.',
    },
    {
        question: 'Does a chosen background apply to favicon.ico as well as the PNGs?',
        answer: 'Yes. Whichever background is chosen — including staying transparent — is applied to every '
            + 'size the package writes, favicon.ico’s own three PNG payloads included, so a browser tab and a '
            + 'desktop shortcut never disagree about what the icon looks like.',
    },
    {
        question: 'What image formats can I start from?',
        answer: 'JPEG, PNG or WebP, up to 20 MB. HEIC and SVG are not accepted as a source here — convert a '
            + 'HEIC photo with Resizo’s own HEIC tool first if that is what you are starting from. AVIF now '
            + 'opens in the browser on Resizo’s Convert and Resize tools, but not yet on this one — convert '
            + 'it to JPEG, PNG or WebP there first, then bring that file here.',
    },
];

/** One row of the sources table, from the real registry — publisher and title share a link, never split apart. */
function SourceRow({ entry }) {
    return (
        <tr className="border-b border-line align-top">
            <th scope="row" className="py-2 pr-4 text-base font-normal text-ink">{entry.asset}</th>
            <td className="py-2 pr-4 text-base text-ink-muted">{entry.sizeLabel}</td>
            <td className="py-2 pr-4 text-base text-ink-muted">{STATUS_LABELS[entry.status] ?? entry.status}</td>
            <td className="py-2 pr-4 text-base text-ink-muted">
                <a href={entry.source.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {entry.source.publisher} — {entry.source.title}
                </a>
            </td>
            <td className="py-2 font-data text-ui text-ink-muted">{entry.source.verifiedAt}</td>
        </tr>
    );
}

function SourcesTable() {
    return (
        <div className="overflow-x-auto" role="region" aria-label="Where each icon size and behaviour comes from" tabIndex={0}>
            <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">Where each icon size and behaviour comes from</caption>
                <thead>
                    <tr className="border-b border-line">
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">File</th>
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">What this establishes</th>
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">Status</th>
                        <th scope="col" className="py-2 pr-4 text-ui text-ink">Source</th>
                        <th scope="col" className="py-2 text-ui text-ink">Verified</th>
                    </tr>
                </thead>
                <tbody>
                    {ICON_SOURCES.map((entry, index) => (
                        <SourceRow key={`${entry.asset}-${index}`} entry={entry} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function FaviconGeneratorPage() {
    return (
        <>
            <JsonLd
                id="favicon-generator-schema"
                data={[
                    softwareApplication({
                        name: 'Resizo Favicon & App Icon Generator',
                        description: DESCRIPTION,
                        path: PATH,
                        category: 'resize-crop',
                        features: [
                            'Builds favicon.ico with 16, 32 and 48 pixel entries, and five loose PNG icons at 16, 32, 180, 192 and 512 pixels',
                            'Crops to a square or fits the whole logo inside one, with a movable crop frame',
                            'Keeps transparency or composites onto a chosen background, across every generated icon',
                            'Writes a site.webmanifest from optional app name, short name and colour fields',
                            'Generates the HTML snippet and the manifest text, each with its own copy button',
                            'Downloads every file individually or as one ZIP',
                            'Runs on your own device — the logo is never uploaded',
                        ],
                    }),
                    breadcrumbList(BREADCRUMB),
                    howTo({
                        name: HOW_TO_HEADING,
                        description: 'Generate favicon.ico, PNG icons and a web app manifest from one logo, on '
                            + 'your own device.',
                        path: PATH,
                        anchor: HOW_TO_ID,
                        steps: STEPS,
                    }),
                    faqPage(FAQS),
                ]}
            />

            <FaviconTool answer={ANSWER} breadcrumb={BREADCRUMB}>
                <HowToSteps
                    id={HOW_TO_ID}
                    heading={HOW_TO_HEADING}
                    steps={STEPS}
                    intro={(
                        <p>
                            Every step happens above, in the tool panel — this is the same four-step order,
                            named on its own for a screen reader or a search result.
                        </p>
                    )}
                />

                {/* The whole section, not just the figure, waits for the
                    measurement: an intro that promises "the package below"
                    above nothing is worse than no section. */}
                {MEASURED ? (
                    <ContentSection id="favicon-example" heading="What comes out of the sample logo">
                        <p>
                            The package below is the tool&rsquo;s own output for the sample logo under the
                            defaults &mdash; Crop to square with the frame where the page puts it, and the
                            transparent ground kept &mdash; copied from a measured run rather than drawn for
                            the page. The 16 and the 32 are shown at their real size, which is the honest way
                            to see what a small icon keeps of a mark and what it loses.
                        </p>
                        <Figure
                            images={FIGURE_IMAGES}
                            caption={(
                                <>
                                    {`A ${MEASURED.input.width}×${MEASURED.input.height} PNG at `}
                                    {`${formatFileSize(MEASURED.input.bytes)} came back as seven files in a `}
                                    {`${formatFileSize(MEASURED.zip.bytes)} ZIP: favicon.ico at `}
                                    {`${formatFileSize(measuredAsset('favicon.ico')?.bytes ?? 0)}, the 16 at `}
                                    {`${formatFileSize(measuredAsset('favicon-16x16.png')?.bytes ?? 0)}, the 32 at `}
                                    {`${formatFileSize(measuredAsset('favicon-32x32.png')?.bytes ?? 0)}, the 192 at `}
                                    {`${formatFileSize(measuredAsset('android-chrome-192x192.png')?.bytes ?? 0)} and the 512 at `}
                                    {`${formatFileSize(measuredAsset('android-chrome-512x512.png')?.bytes ?? 0)}`}
                                    {MEASURED.generateMs ? `, generated in ${MEASURED.generateMs} ms` : ''}
                                    {' on the benchmark machine. The 512 is enlarged from the 400 × 400 square the '}
                                    default frame keeps, which is the warning the page shows for this source.
                                    Measured by{' '}
                                    <a href={BENCHMARK_URL} rel="noopener" target="_blank" className={LINK}>
                                        the benchmark suite
                                    </a>
                                    , scenario L, on the commit the results file names.
                                </>
                            )}
                        />
                    </ContentSection>
                ) : null}

                <ContentSection id="what-favicon-ico-is" heading="What favicon.ico is">
                    <p>
                        favicon.ico is a container rather than a single picture. Microsoft’s own icon
                        documentation describes a short header followed by one directory entry and one image
                        per size the file holds, and says that &ldquo;common sizes include 16, 32, and 48
                        pixels square.&rdquo; Resizo packs exactly those three sizes into the file it writes.
                    </p>
                </ContentSection>

                <ContentSection id="favicon-ico-still-needed" heading="Do modern sites still need favicon.ico?">
                    <p>
                        Most browsers still look for this file at the site root whether or not a page links it
                        at all — MDN notes that many sites do not bother declaring one for exactly that reason.
                        The generated HTML snippet still lists the PNG icons by size, because a browser choosing
                        between several icon links uses their <code>sizes</code> attribute, and falls back to
                        whichever is listed last when more than one looks equally appropriate. This tool does
                        not generate an SVG favicon, and how browsers weigh an SVG against an ICO or a PNG
                        varies enough that no single rule covers all of them.
                    </p>
                </ContentSection>

                <ContentSection id="why-16-and-32" heading="Why 16 × 16 and 32 × 32">
                    <p>
                        16 × 16 is the classic browser-tab size a favicon has carried since the format existed;
                        32 × 32 is the size a higher-density display, a taskbar shortcut or a bookmark bar
                        entry more often asks for. Declaring both, as Resizo does, is what gives a browser
                        something to actually choose between rather than one fixed picture stretched to fit.
                    </p>
                </ContentSection>

                <ContentSection id="apple-touch-icon" heading="What an Apple touch icon is">
                    <p>
                        It is the picture iOS uses when a visitor adds a page to their home screen. Apple’s own
                        example markup names a 180 × 180 file, the largest of the sizes it documents, and
                        Resizo writes exactly that one. Apple’s app-icon guidelines, written for native apps,
                        ask for a full-bleed, opaque background because the system masks an icon’s shape
                        itself; a web clip sits on the same home screen, so the same advice is worth following.
                    </p>
                </ContentSection>

                <ContentSection id="what-192-and-512-are-for" heading="What 192 and 512 are for">
                    <p>
                        Chrome’s own installability criteria name exactly these two sizes as required before it
                        will offer to install a site — nothing smaller and nothing else. Both are listed in the
                        generated site.webmanifest with purpose &ldquo;any,&rdquo; which is the plain drawing
                        Resizo produces rather than a maskable icon built for Android’s adaptive-icon safe
                        zone.
                    </p>
                </ContentSection>

                <ContentSection id="favicon-transparency" heading="Should a favicon have transparency?">
                    <p>
                        It depends on where the icon ends up. A transparent background usually looks fine in a
                        browser tab, which is why Transparent is the default here. A home-screen icon is a
                        different case: Apple’s app-icon guidelines ask for an opaque background because the
                        system masks an icon’s shape itself, and a transparent icon on Android is drawn inside a plain white circle
                        rather than left see-through. Choosing a background composites it onto every generated
                        icon, favicon.ico included, so the two never disagree.
                    </p>
                </ContentSection>

                <ContentSection id="resizing-logo-quality" heading="Does resizing improve a low-resolution logo?">
                    <p>
                        No. Enlarging a small logo to fill a 512 × 512 icon increases its pixel dimensions, and
                        the tool says so before the job runs, but it cannot restore detail a smaller original
                        never captured. The composed preview and the enlarged 16 × 16 and 32 × 32 checks in the
                        result are there so that is visible before a download, not after one.
                    </p>
                </ContentSection>

                <ContentSection id="icons-uploaded" heading="Are icons uploaded?">
                    <p>
                        No. The logo is decoded, composited and re-encoded into every size in this browser tab,
                        using the same code this page loaded to run the tool — there is no server this file is
                        sent to, checked on or held by.
                    </p>
                </ContentSection>

                <ContentSection id="favicon-sources" heading="Where these sizes come from">
                    <p>
                        Not one of the numbers above is Resizo’s own opinion. Each row below names the document
                        that states it, whether that document requires the size or only documents or recommends
                        it, and the day it was last read.
                    </p>
                    <SourcesTable />
                </ContentSection>

                <FaqList items={FAQS} id="favicon-generator-faq" />
            </FaviconTool>
        </>
    );
}
