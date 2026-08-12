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
        'How Resizo handles data: images are processed on our server and never kept, there are no accounts '
        + 'and no cookies, and nothing is sold.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Your images', value: 'Never kept' },
    { label: 'Image metadata', value: 'Stripped' },
    { label: 'Accounts', value: 'None' },
    { label: 'Cookies', value: 'None' },
    { label: 'Data sold', value: 'Never' },
];

export default function PrivacyPage() {
    return (
        <>
            <JsonLd id="privacy-schema" data={breadcrumbList(BREADCRUMB)} />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="Privacy Policy"
                intro="Resizo is a free image tool with no accounts and no history. Your pictures are processed on our server and deleted as soon as the work is done — never kept. This page says what that leaves — which is almost nothing."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="At a glance" rows={SPEC_ROWS} />}
            >
                <DocSection id="images" heading="1. Your images">
                    <p>
                        When you use a tool, your file is sent securely to our server, processed, and
                        sent straight back as your download. Small files are handled in memory. Bigger
                        files (over about 4.5 MB) are held in temporary storage for the few seconds it
                        takes to process them, then deleted. Either way your file is never saved, never
                        added to a database, and never used for anything but the job you asked for — a
                        minute later we no longer have it.
                    </p>
                    <p>
                        Every file we hand back has its hidden metadata removed. Details like the GPS
                        location, the date, and the camera or phone a photo was taken with are stripped
                        from every output.
                    </p>
                </DocSection>

                <DocSection id="accounts" heading="2. No accounts, no profile, no history">
                    <p>
                        There are no accounts on Resizo — nothing to sign up for and nothing to log in to.
                        We do not keep your images, hold a history of what you processed, ask for your
                        name or email, or build any profile of you. There is no personal data at rest to
                        export, correct or delete, because none is kept in the first place.
                    </p>
                    <p>
                        The one thing we read is your IP address, and only to stop any single person from
                        overloading the tools. It is checked in the moment and never stored.
                    </p>
                </DocSection>

                <DocSection id="cookies" heading="3. Cookies">
                    <p>
                        Resizo sets no cookies and runs no analytics. There is no sign-in cookie
                        (there is no sign-in), no advertising cookies (there are no ads) and nothing
                        counting your visit. Because nothing here needs consent, there is no cookie
                        banner.
                    </p>
                </DocSection>
            </DocPage>
        </>
    );
}
