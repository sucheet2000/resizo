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
        'Who runs Resizo, what it stores and what it does not. Images are processed in memory and discarded when the request ends; signed-in accounts keep a row of history metadata you can export or delete at any time.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Your images', value: 'Never stored' },
    { label: 'Image metadata', value: 'Stripped' },
    { label: 'History rows', value: 'Signed in only' },
    { label: 'Reviews', value: 'If you post one' },
    { label: 'IP address', value: '~1 min counter' },
    { label: 'Ad cookies', value: 'Only with consent' },
    { label: 'Where data lives', value: 'Ask us' },
    { label: 'Export / delete', value: 'One click' },
];

export default function PrivacyPage() {
    return (
        <>
            <JsonLd id="privacy-schema" data={breadcrumbList(BREADCRUMB)} />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="Privacy Policy"
                intro="The short version: your pictures are processed in memory on our server and are gone when the request ends. The only things we keep are a few lines of text, and only if you sign in. This page names who is responsible, what we hold, why, and how to make us stop."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="At a glance" rows={SPEC_ROWS} />}
            >
                <DocSection id="who" heading="1. Who runs Resizo, and how to reach us">
                    <p>
                        Resizo is run by Sucheet Boppana, an individual developer. There is no company
                        behind it. Under UK and EU data protection law, that means Sucheet is the{' '}
                        <strong className="font-semibold text-ink">data controller</strong> for the
                        personal data described on this page — the person legally responsible for it.
                    </p>
                    <p>
                        The operator is based in{' '}
                        <strong className="font-semibold text-ink">
                            [COUNTRY — to be set by the operator]
                        </strong>
                        . For anything about your data — a question, a correction, a request to see or
                        delete what we hold — email{' '}
                        <a href="mailto:privacy@resizo.net" className={docLinkClass}>
                            privacy@resizo.net
                        </a>
                        . We reply within one month.
                    </p>
                    <p>
                        If the law requires us to appoint a representative in the EU or the UK because
                        the operator is not established there, that representative&rsquo;s name and
                        address will be listed here.
                    </p>
                </DocSection>

                <DocSection id="images" heading="2. Your images">
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
                    <p>
                        If you upload a picture of someone else, you are the one deciding what happens
                        to it — in data-protection terms you are its controller, and Resizo is only a
                        transient processor of those bytes for the few moments it takes to return your
                        download.
                    </p>
                </DocSection>

                <DocSection id="account" heading="3. What we store if you create an account">
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

                <DocSection id="reviews" heading="4. Reviews you post">
                    <p>
                        If you leave a review, we store the name and role you type, your star
                        rating, the text of the review, the date, and the account it came from.
                        Reviews are published on the site with the name and role you chose, so treat
                        those fields as public. Your email address is never shown.
                    </p>
                    <p>
                        You have to be signed in to post, which is our reasonable step against fake
                        reviews. We do not verify the name or role you type, and we neither pay for nor
                        reward reviews. You can ask us to take a review down at any time. Deleting your
                        account deletes your reviews along with it.
                    </p>
                </DocSection>

                <DocSection id="abuse" heading="5. Rate limiting, IP addresses and server logs">
                    <p>
                        To stop one visitor from consuming the whole service, each tool allows about
                        ten requests a minute from one address (five for batch). To count them we take
                        your IP address from the request headers and use it as the key of a counter in
                        a Redis store. The counter clears within about a minute and is not linked to
                        your account, your history or anything else. An IP address is personal data,
                        which is why it is named here.
                    </p>
                    <p>
                        Vercel, which runs the application, also records ordinary web-server logs —
                        timestamp, path, response status, IP address, user agent — for a short
                        operational window (currently on the order of one day, set by our hosting
                        plan). These are used to diagnose faults and abuse. They never contain image
                        data.
                    </p>
                </DocSection>

                <DocSection id="cookies" heading="6. Cookies and similar technologies">
                    <p>
                        Resizo uses as little of this as it can. There are two kinds, and they are not
                        treated the same.
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">
                                Strictly necessary — no consent needed.
                            </strong>{' '}
                            Signing in sets a session cookie so you stay signed in between page loads;
                            signing out clears it. A small cookie also remembers your own cookie
                            choice so we do not ask again on every visit. These keep the site working
                            and the law does not require your consent for them, so they are not behind
                            the banner.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">
                                Advertising — only with your consent.
                            </strong>{' '}
                            Our advertising partner sets its own cookies and similar storage, described
                            in the next section. In the UK, the EEA and Switzerland these are not set
                            until you agree, and you can change or withdraw that choice at any time with
                            the &ldquo;Privacy and cookie settings&rdquo; link in the footer.
                        </li>
                    </ul>
                    <p>
                        Signed out and before you have made an advertising choice, Resizo sets no
                        cookies of its own.
                    </p>
                </DocSection>

                <DocSection id="ads" heading="7. Advertising and Google AdSense">
                    <p>
                        The site is funded by Google AdSense. Third-party vendors, including Google,
                        use cookies to serve ads based on your prior visits to this website or other
                        websites. Google&rsquo;s use of advertising cookies enables it and its
                        partners to serve ads to you based on your visit to this and other sites on
                        the internet. Third parties may also place and read cookies on your browser,
                        and use web beacons, IP addresses and other identifiers, as a result of ads
                        served on this site.
                    </p>
                    <p>
                        This processing is Google&rsquo;s and its partners&rsquo;, under their own
                        policies. For it, Google is an independent controller, not a processor acting
                        for us. Resizo never sends them your images, your history or your email
                        address.
                    </p>
                    <p>You can control or turn off personalised advertising here:</p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            opt out of personalised ads in{' '}
                            <a
                                href="https://www.google.com/settings/ads"
                                className={docLinkClass}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                Google Ads Settings
                            </a>{' '}
                            (also reachable through{' '}
                            <a
                                href="https://myadcenter.google.com/"
                                className={docLinkClass}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                Google My Ad Center
                            </a>
                            );
                        </li>
                        <li>
                            opt out of some third-party vendors&rsquo; use of cookies at{' '}
                            <a
                                href="https://www.aboutads.info"
                                className={docLinkClass}
                                rel="noopener noreferrer"
                                target="_blank"
                            >
                                www.aboutads.info
                            </a>
                            ;
                        </li>
                        <li>
                            change or withdraw your consent to ad cookies with the{' '}
                            &ldquo;Privacy and cookie settings&rdquo; link in the footer — the full
                            list of advertising partners is shown inside that dialog.
                        </li>
                    </ul>
                    <p>
                        If you decline ad cookies you will still see ads; they will just be
                        non-personalised. Read how Google uses data from sites that use its services
                        at{' '}
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

                <DocSection id="processors" heading="8. Who else handles your data">
                    <p>
                        Three services process data on our behalf, under written data-processing
                        contracts, and none of them receives an image:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Vercel</strong> — runs the
                            application and the serverless functions that process images, and keeps
                            the short-lived request logs described above.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Supabase</strong> — hosts the
                            database and the authentication system, so it holds your login, your
                            history rows and your reviews.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Upstash</strong> — hosts the
                            Redis instance that holds the short-lived rate-limit counters.
                        </li>
                    </ul>
                    <p>
                        Google, for advertising, is not a processor acting for us; it is an
                        independent controller of the advertising data it collects, as described in
                        the advertising section above.
                    </p>
                </DocSection>

                <DocSection id="transfers" heading="9. Where your data goes">
                    <p>
                        Our providers are US-headquartered, so some of the data described here may be
                        handled outside the UK and the EEA. Ask us and we will tell you the region our
                        database and functions are configured to run in.
                    </p>
                    <p>
                        Where data reaches the United States, the safeguard is the Standard
                        Contractual Clauses (with the UK Addendum) built into each provider&rsquo;s
                        data-processing agreement, and — where the provider is also certified — the
                        EU&ndash;US Data Privacy Framework and its UK extension. You can ask us for a
                        copy of the relevant safeguard at{' '}
                        <a href="mailto:privacy@resizo.net" className={docLinkClass}>
                            privacy@resizo.net
                        </a>
                        .
                    </p>
                </DocSection>

                <DocSection id="legal-basis" heading="10. Why we are allowed to hold it">
                    <p>
                        Where UK or EU data protection law applies, each thing we do has its own legal
                        basis:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Processing your image</strong> —
                            performance of the service you asked for (contract).
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">
                                Your account and history
                            </strong>{' '}
                            — performance of the service the account provides (contract).
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">
                                Rate limiting and server logs
                            </strong>{' '}
                            — our legitimate interest in keeping a free service available and
                            preventing abuse.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Reviews</strong> — your consent,
                            given by choosing to post one.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Advertising cookies</strong> —
                            your consent, which you can withdraw at any time.
                        </li>
                    </ul>
                </DocSection>

                <DocSection id="retention" heading="11. How long we keep things">
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            <strong className="font-semibold text-ink">Images</strong> — the duration
                            of one HTTP request. Nothing is persisted.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Rate-limit counters</strong> —
                            about a minute, then they clear.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Server logs</strong> — Vercel&rsquo;s
                            retention window for our plan, currently on the order of a day.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">
                                Account, history and reviews
                            </strong>{' '}
                            — until you delete them. We do not expire them on a timer and we do not
                            keep a shadow copy after a deletion. Where our database provider keeps
                            short-term backups for disaster recovery, a deleted row may linger in those
                            backups until they roll off on the provider&rsquo;s short cycle.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Your ad-consent choice</strong>{' '}
                            — kept by the consent tool for as long as it retains that record (typically
                            up to about 13 months), then you are asked again.
                        </li>
                    </ul>
                </DocSection>

                <DocSection id="rights" heading="12. Your rights, and how to use them">
                    <p>
                        You have the right to see the personal data we hold about you, to have it
                        corrected, to have it erased, to receive it in a portable format, and to
                        restrict or object to how we use it.
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
                            downloads a machine-readable CSV of every history row and every review on
                            your account — that covers your right to a portable copy.
                        </li>
                        <li>
                            <strong className="font-semibold text-ink">Delete account</strong>{' '}
                            removes your login, your history and your reviews. It happens immediately
                            and it cannot be undone, so export first if you want a copy.
                        </li>
                    </ul>
                    <p>
                        Where we rely on your consent — for advertising cookies and for a review you
                        posted — you can withdraw it at any time: use the &ldquo;Privacy and cookie
                        settings&rdquo; link in the footer for ad cookies, or ask us to take a review
                        down. Withdrawing stops future processing but does not make what already
                        happened unlawful.
                    </p>
                    <p>
                        You do not have to give us anything to use any tool on this site — every tool
                        works signed out, at the same limits. An email address is only needed if you
                        want an account, because that is what the account is keyed to; without it we
                        cannot give you history. We do not make automated decisions about you and we do
                        not profile you: the rate limiter counts requests, it does not judge you.
                    </p>
                    <p>
                        For anything that is not a button — a correction, a restriction, a question
                        about this policy — write to{' '}
                        <a href="mailto:privacy@resizo.net" className={docLinkClass}>
                            privacy@resizo.net
                        </a>{' '}
                        and we will respond within one month.
                    </p>
                </DocSection>

                <DocSection id="complaints" heading="13. Complaints">
                    <p>
                        If you think we have handled your data badly, tell us first — but you can
                        complain to a regulator regardless. In the UK that is the Information
                        Commissioner&rsquo;s Office (
                        <a
                            href="https://ico.org.uk/make-a-complaint/"
                            className={docLinkClass}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            ico.org.uk/make-a-complaint
                        </a>
                        ). In the EEA it is the data protection authority for the country you live in;
                        the full list is at{' '}
                        <a
                            href="https://www.edpb.europa.eu/contact/contact-dpas_en"
                            className={docLinkClass}
                            rel="noopener noreferrer"
                            target="_blank"
                        >
                            edpb.europa.eu
                        </a>
                        .
                    </p>
                </DocSection>

                <DocSection id="children" heading="14. Children">
                    <p>
                        Resizo is not directed at children and we do not knowingly create accounts for
                        anyone under 13 (or the higher age set by your country&rsquo;s law, up to 16 in
                        parts of the EU). We do not ask your age or date of birth. If you believe a
                        child has registered, write to{' '}
                        <a href="mailto:privacy@resizo.net" className={docLinkClass}>
                            privacy@resizo.net
                        </a>{' '}
                        and we will delete the account and any reviews on it.
                    </p>
                </DocSection>

                <DocSection id="california" heading="15. If you are in California">
                    <p>
                        Resizo is not currently a &ldquo;business&rdquo; under the California Consumer
                        Privacy Act — it is a free tool run by one person and comes nowhere near the
                        law&rsquo;s revenue threshold. If that changes, or if traffic from California
                        grows to the point where the law&rsquo;s other tests are met, we will add the
                        notice and the opt-out controls it requires and say so here.
                    </p>
                </DocSection>

                <DocSection id="security" heading="16. Security, and what happens if something goes wrong">
                    <p>
                        Data is encrypted in transit (HTTPS) and encrypted at rest by our providers.
                        Access to the account database is limited to the operator. Security reports go
                        to{' '}
                        <a href="mailto:security@resizo.net" className={docLinkClass}>
                            security@resizo.net
                        </a>
                        .
                    </p>
                    <p>
                        No system is perfect. If a breach of your personal data happens and it is
                        likely to put you at risk, we will tell you promptly and, where the law
                        requires, notify the relevant supervisory authority.
                    </p>
                </DocSection>

                <DocSection id="self-host" heading="17. If you self-host Resizo">
                    <p>
                        This policy covers resizo.net only. Resizo can be run from a Docker image; if
                        you run your own copy, you are the controller of whatever your copy processes
                        and you need your own policy. Nothing on your instance reports back to us.
                    </p>
                </DocSection>

                <DocSection id="changes" heading="18. Changes to this policy">
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
