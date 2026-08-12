import DocPage, { DocSection, DocSpecList, docLinkClass } from '@/components/marketing/DocPage';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/privacy';

const LAST_UPDATED = '2026-08-11';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Privacy', path: PATH },
];

export const metadata = buildMetadata({
    title: 'Privacy Policy — Resizo',
    description:
        'How Resizo handles data: images are processed on our server and never kept, IP addresses are used '
        + 'only for rate limiting, there are no accounts and no cookies, and nothing is sold.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Your images', value: 'Never kept' },
    { label: 'Image metadata', value: 'Stripped' },
    { label: 'Accounts', value: 'None' },
    { label: 'IP address', value: 'Rate limit only' },
    { label: 'Cookies', value: 'None' },
    { label: 'Error tracking', value: 'Optional' },
    { label: 'Data sold', value: 'Never' },
];

export default function PrivacyPage() {
    return (
        <>
            <JsonLd id="privacy-schema" data={breadcrumbList(BREADCRUMB)} />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="Privacy Policy"
                intro="Resizo is a free image tool with no accounts and no history. Your pictures are processed on our server and deleted as soon as the work is done — never kept. This page says what that leaves — which is almost nothing — and how to reach us."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="At a glance" rows={SPEC_ROWS} />}
            >
                <DocSection id="who" heading="1. Who runs Resizo, and how to reach us">
                    <p>
                        Resizo is run by Sucheet Boppana, an individual developer. There is no company
                        behind it. For anything about privacy — a question or a concern — email{' '}
                        <a href="mailto:contact@resizo.net" className={docLinkClass}>
                            contact@resizo.net
                        </a>
                        .
                    </p>
                </DocSection>

                <DocSection id="images" heading="2. Your images">
                    <p>
                        Every tool sends your file over HTTPS to our server, where the Sharp imaging
                        library decodes it, applies the operation and encodes the result. The processed
                        bytes come back as the body of that same response — that response is your
                        download.
                    </p>
                    <p>
                        Where the file sits while this happens depends on its size. A file up to about
                        4.5 MB stays only as a buffer in memory. A larger one is first uploaded to Vercel
                        Blob — a temporary object store — because the platform will not accept a bigger
                        file in a single request; our server reads it back from there, processes it, and
                        deletes it right after. Either way the file is never inserted into a database,
                        never kept once the work is done, and never used for anything but the operation
                        you asked for. We cannot show you an image you processed a minute ago because we
                        do not have it.
                    </p>
                    <p>
                        Output files are re-encoded without their metadata. EXIF, IPTC and XMP blocks —
                        which on a phone photo typically include GPS coordinates, the capture timestamp
                        and the device identifier — are dropped from every file the tools produce.
                    </p>
                </DocSection>

                <DocSection id="accounts" heading="3. No accounts, no profile, no history">
                    <p>
                        There are no accounts on Resizo — nothing to sign up for and nothing to log in to.
                        We do not keep your images, hold a history of what you processed, ask for your
                        name or email, or build any profile of you. There is no personal data at rest to
                        export, correct or delete, because none is kept in the first place.
                    </p>
                </DocSection>

                <DocSection id="rate-limiting" heading="4. Rate limiting and IP addresses">
                    <p>
                        To stop one visitor from consuming the whole service, each tool allows about ten
                        requests a minute from one address. To count them we read your IP address from the
                        request and use it as the key of a short-lived counter in a Redis store. The
                        counter clears within about a minute and is not linked to anything else. An IP
                        address is personal data, which is why it is named here. Vercel, which runs the
                        application, also keeps ordinary short-lived server logs for diagnosing faults and
                        abuse; they never contain image data.
                    </p>
                </DocSection>

                <DocSection id="error-tracking" heading="5. Error tracking (optional)">
                    <p>
                        When error tracking is enabled, Sentry receives a diagnostic report if something
                        breaks — the technical details of the fault, which can include your IP address.
                        That data is stored in the United States and never contains image data. It is used
                        only to find and fix bugs.
                    </p>
                </DocSection>

                <DocSection id="cookies" heading="6. Cookies">
                    <p>
                        Resizo sets no cookies. There is no sign-in cookie (there is no sign-in), no
                        advertising cookies (there are no ads) and no analytics cookies (we run no
                        analytics). Because nothing here needs consent, there is no cookie banner.
                    </p>
                </DocSection>

                <DocSection id="questions" heading="7. Questions and changes">
                    <p>
                        We do not sell data and there is none to sell. If this policy changes, the date at
                        the top of the page changes with it, and we will not quietly start storing
                        something this page says we do not. You can contact us with any privacy question
                        at{' '}
                        <a href="mailto:contact@resizo.net" className={docLinkClass}>
                            contact@resizo.net
                        </a>
                        .
                    </p>
                </DocSection>
            </DocPage>
        </>
    );
}
