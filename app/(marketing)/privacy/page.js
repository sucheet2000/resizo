import Link from 'next/link';

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
        'What Resizo stores and what it does not. Images are processed in memory and discarded when the request ends; signed-in accounts keep a row of history metadata you can export or delete at any time.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Your images', value: 'Never stored' },
    { label: 'Image metadata', value: 'Stripped' },
    { label: 'History rows', value: 'Signed in only' },
    { label: 'Reviews', value: 'If you post one' },
    { label: 'IP address', value: '60 s counter' },
    { label: 'Export / delete', value: 'One click' },
];

export default function PrivacyPage() {
    return (
        <>
            <JsonLd id="privacy-schema" data={breadcrumbList(BREADCRUMB)} />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="Privacy Policy"
                intro="The short version: your pictures are processed in memory on our server and are gone when the request ends. The only things we keep are a few lines of text, and only if you sign in."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="At a glance" rows={SPEC_ROWS} />}
            >
                <DocSection id="images" heading="1. Your images">
                    <p>
                        Every tool on this site sends your file over HTTPS to our server, where the
                        Sharp imaging library decodes it, applies the operation and encodes the
                        result. The processed bytes come back as the body of that same HTTP
                        response — that response is your download.
                    </p>
                    <p>
                        While this is happening the file exists only as a buffer in memory. It is
                        not written to disk, not placed in object storage, not inserted into any
                        database, and not passed to any other company. When the request finishes,
                        the memory is released and no copy of the picture remains. We cannot show
                        you an image you processed yesterday because we do not have it.
                    </p>
                    <p>
                        Output files are re-encoded without their metadata. EXIF, IPTC and XMP
                        blocks — which on a phone photo typically include GPS coordinates, the
                        capture timestamp and the device identifier — are dropped from every file
                        the tools produce.{' '}
                        <Link href="/about" className={docLinkClass}>
                            The about page
                        </Link>{' '}
                        explains the pipeline in more detail.
                    </p>
                </DocSection>

                <DocSection id="account" heading="2. What we store if you create an account">
                    <p>
                        An account is optional. Every tool works without one, at the same limits. If
                        you do create one, we store the following and nothing else.
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Your login.</strong> Your
                            email address and, if you signed up with a password, a hash of that
                            password — both held by our authentication provider, never in plain
                            text. If you signed in with Google instead, we receive the basic profile
                            Google returns: your email address, your name and your profile picture
                            URL. We never receive your Google password.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Resize history.</strong> One
                            row per image you process while signed in, containing the original
                            filename, the width and height before and after, the output format, the
                            file size before and after, and the date and time. No pixels, no
                            thumbnail, no copy of the file.
                        </li>
                    </ul>
                    <p>
                        The history exists so the dashboard can show you what you have done and how
                        much size you have saved. It is visible only to you. Note that the original
                        filename is stored as you supplied it, so if your filenames describe their
                        contents, the history describes them too.
                    </p>
                </DocSection>

                <DocSection id="reviews" heading="3. Reviews you post">
                    <p>
                        If you leave a review, we store the name and role you type, your star
                        rating, the text of the review, the date, and the account it came from.
                        Reviews are published on the site with the name and role you chose, so treat
                        those fields as public. Your email address is never shown.
                    </p>
                    <p>
                        Deleting your account deletes your reviews along with it.
                    </p>
                </DocSection>

                <DocSection id="abuse" heading="4. Rate limiting and server logs">
                    <p>
                        To stop one visitor from consuming the whole service, each tool allows ten
                        requests a minute from one address. To count them we take your IP address
                        from the request headers and use it as the key of a counter in a Redis
                        store. The counter expires after the one-minute window and is not linked to
                        your account, your history or anything else.
                    </p>
                    <p>
                        Our hosting provider also records ordinary web-server logs — timestamp,
                        path, response status, IP address, user agent — for a short period. These
                        are operational records used to diagnose faults and abuse. They never
                        contain image data.
                    </p>
                </DocSection>

                <DocSection id="cookies" heading="5. Cookies">
                    <p>
                        Signed out, Resizo sets no cookies of its own. Signing in sets a session
                        cookie so that you stay signed in between page loads; signing out clears it.
                        Our advertising partner sets its own cookies, described in the next section.
                    </p>
                </DocSection>

                <DocSection id="ads" heading="6. Advertising">
                    <p>
                        The site is funded by Google AdSense. Google and its partners may use
                        cookies and similar identifiers to select and measure the ads you see,
                        including on the basis of your previous visits to this and other sites. This
                        processing is Google&rsquo;s, under Google&rsquo;s policies, and Resizo never
                        sends them your images, your history or your email address.
                    </p>
                    <p>
                        You can control or turn off personalised advertising in{' '}
                        <a
                            href="https://myadcenter.google.com/"
                            className={docLinkClass}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            Google My Ad Center
                        </a>
                        , and read how Google uses data from sites that use its services at{' '}
                        <a
                            href="https://policies.google.com/technologies/partner-sites"
                            className={docLinkClass}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            policies.google.com
                        </a>
                        .
                    </p>
                </DocSection>

                <DocSection id="processors" heading="7. Who else handles this data">
                    <p>
                        Three services process data on our behalf, none of which receives an image:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Supabase</strong> — hosts the
                            database and the authentication system, so it holds your login, your
                            history rows and your reviews.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Upstash</strong> — hosts the
                            Redis instance that holds the one-minute rate-limit counters.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Our hosting provider</strong>{' '}
                            — runs the application and the functions that process images, and keeps
                            the short-lived request logs described above.
                        </li>
                    </ul>
                    <p>
                        Google AdSense is not a processor acting for us; it is an independent
                        controller of the advertising data it collects.
                    </p>
                </DocSection>

                <DocSection id="legal-basis" heading="8. Why we are allowed to hold it">
                    <p>
                        Where UK or EU data protection law applies, our legal bases are: performance
                        of a contract, for the account and the history that the account exists to
                        provide; legitimate interests, for rate limiting and server logs, which are
                        needed to keep a free service available; and consent, for advertising
                        cookies, which you can withdraw through the controls linked above.
                    </p>
                </DocSection>

                <DocSection id="retention" heading="9. How long we keep things">
                    <p>
                        Images: not kept at all. Rate-limit counters: one minute. Server logs: a
                        short operational window set by our hosting provider. Account, history and
                        reviews: until you delete them — we do not expire them on a timer, and we do
                        not keep a shadow copy after a deletion.
                    </p>
                </DocSection>

                <DocSection id="rights" heading="10. Your rights, and the two buttons that honour them">
                    <p>
                        You have the right to see the personal data we hold about you, to have it
                        corrected, to have it erased, to receive it in a portable format, to
                        restrict or object to how we use it, and to complain to your data protection
                        authority. In the UK that is the Information Commissioner&rsquo;s Office.
                    </p>
                    <p>
                        Two of those are self-service, on your{' '}
                        <Link href="/dashboard" className={docLinkClass}>
                            dashboard
                        </Link>
                        , and neither requires you to ask us:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Export my data</strong>{' '}
                            downloads a CSV of every history row and every review on your account.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Delete account</strong>{' '}
                            removes your login, your history and your reviews. It happens
                            immediately and it cannot be undone, so export first if you want a copy.
                        </li>
                    </ul>
                    <p>
                        For anything else — a correction, a restriction, a question about this
                        policy — write to{' '}
                        <a href="mailto:iamepicwin80@gmail.com" className={docLinkClass}>
                            iamepicwin80@gmail.com
                        </a>{' '}
                        and we will respond within one month.
                    </p>
                </DocSection>

                <DocSection id="children" heading="11. Children">
                    <p>
                        Resizo is not directed at children and we do not knowingly create accounts
                        for anyone under 13. If you believe a child has registered, write to the
                        address above and we will delete the account.
                    </p>
                </DocSection>

                <DocSection id="changes" heading="12. Changes to this policy">
                    <p>
                        If this policy changes, the date at the top of the page changes with it. We
                        will not quietly start storing something this page says we do not store; a
                        change of that kind would come with a new version of this document.
                    </p>
                </DocSection>
            </DocPage>
        </>
    );
}
