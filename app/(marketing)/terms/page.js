import Link from 'next/link';

import DocPage, { DocSection, DocSpecList, docLinkClass } from '@/components/marketing/DocPage';
import JsonLd from '@/components/seo/JsonLd';
import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
    MAX_PIXELS,
} from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';
import { breadcrumbList } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/terms';

const LAST_UPDATED = '2026-08-11';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'Terms', path: PATH },
];

export const metadata = buildMetadata({
    title: 'Terms of Service — Resizo',
    description:
        'The terms for using Resizo: who operates it, what the service does, the upload and rate limits, what you keep the rights to, how to report content, and the warranty and liability position of a free tool.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Price', value: 'Free' },
    { label: 'Account', value: 'Optional' },
    { label: 'Minimum age', value: '16' },
    { label: 'Per file', value: formatFileSize(MAX_FILE_SIZE) },
    { label: 'Longest side', value: `${MAX_DIMENSION.toLocaleString('en-US')} px` },
    { label: 'Output pixels', value: `${MAX_PIXELS / 1_000_000} MP` },
    { label: 'Batch', value: `${MAX_BULK_FILES} files` },
    { label: 'Requests', value: '10 / min' },
];

export default function TermsPage() {
    return (
        <>
            <JsonLd id="terms-schema" data={breadcrumbList(BREADCRUMB)} />

            <DocPage
                breadcrumb={BREADCRUMB}
                title="Terms of Service"
                intro="Resizo is a free image tool with no account requirement and no paid tier. These terms set out who runs it, what it does, what we ask of you, how to report content, and what we cannot promise."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="The terms in numbers" rows={SPEC_ROWS} />}
            >
                <DocSection id="acceptance" heading="1. Accepting these terms, and who may use Resizo">
                    <p>
                        Using Resizo means agreeing to what follows. If you do not agree, do not use
                        the site. If you use it on behalf of an organisation, you are confirming you
                        may agree on its behalf.
                    </p>
                    <p>
                        You must be at least 16 to create an account or use Resizo. If the age of
                        digital consent in your country is lower, you must be at least that age.
                        Resizo is not directed to children, and we do not knowingly create accounts
                        for anyone under that age.
                    </p>
                </DocSection>

                <DocSection id="service" heading="2. What the service is">
                    <p>
                        Resizo resizes, compresses, converts, crops and batch-processes images, and
                        converts iPhone HEIC photos to JPEG. Files are sent over HTTPS to our
                        server, processed in memory by the Sharp imaging library, and returned in
                        the response. They are not written to disk and not stored. Resizo is an
                        automatic pipe: it decodes what you send, transforms it, and returns it, and
                        no copy survives the request.{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            The privacy policy
                        </Link>{' '}
                        is the authoritative description of the data handling and forms part of
                        these terms.
                    </p>
                    <p>
                        The service is free. There is no paid tier, no subscription and nothing to
                        buy. It is funded by the advertising on the page. Because nothing is paid,
                        there is no separate cancellation to make — deleting your account in the{' '}
                        <Link href="/dashboard" className={docLinkClass}>
                            dashboard
                        </Link>{' '}
                        is the whole of it.
                    </p>
                </DocSection>

                <DocSection id="operator" heading="3. Who operates Resizo and how to reach us">
                    <p>
                        Resizo is operated by Sucheet Boppana, an individual, based in{' '}
                        <strong className="font-semibold text-ink">
                            [COUNTRY — to be set by the operator]
                        </strong>
                        . You can reach a real person by email, in English:
                    </p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            general contact —{' '}
                            <a href="mailto:contact@resizo.net" className={docLinkClass}>
                                contact@resizo.net
                            </a>
                        </li>
                        <li>
                            reporting illegal content or abuse —{' '}
                            <a href="mailto:abuse@resizo.net" className={docLinkClass}>
                                abuse@resizo.net
                            </a>
                        </li>
                        <li>
                            copyright complaints —{' '}
                            <a href="mailto:dmca@resizo.net" className={docLinkClass}>
                                dmca@resizo.net
                            </a>
                        </li>
                        <li>
                            security reports —{' '}
                            <a href="mailto:security@resizo.net" className={docLinkClass}>
                                security@resizo.net
                            </a>
                        </li>
                        <li>
                            legal notices, and the point of contact for authorities under Regulation
                            (EU) 2022/2065 (the Digital Services Act) —{' '}
                            <a href="mailto:legal@resizo.net" className={docLinkClass}>
                                legal@resizo.net
                            </a>
                            . The language of communication is English.
                        </li>
                    </ul>
                </DocSection>

                <DocSection id="your-files" heading="4. Your files stay yours">
                    <p>
                        You keep every right you already had in the images you process. Uploading a
                        file grants us only a worldwide, non-exclusive, royalty-free licence to
                        decode, transform, encode and return that specific file — limited to the
                        duration of that single request and ending when the response is delivered. We
                        acquire no other rights, and no licence survives the request.
                    </p>
                    <p>
                        We do not use your files to train any model, we do not keep derivatives, and
                        we do not share them with anyone. In return, you confirm you are entitled to
                        process what you upload — that it is yours, or that you have the rights or
                        permission you need for it.
                    </p>
                </DocSection>

                <DocSection id="acceptable-use" heading="5. Acceptable use">
                    <p>Do not use Resizo to:</p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            process or post material that is unlawful under any law that applies to
                            you or to us, including child sexual abuse material, or material that
                            infringes someone else&rsquo;s rights;
                        </li>
                        <li>
                            create or spread synthetic media or deepfakes intended to deceive, or
                            content that is sexually explicit, hateful, harassing or derogatory, that
                            promotes counterfeit goods, or that distributes malware;
                        </li>
                        <li>
                            work around the published limits, whether by scripting the endpoints,
                            spreading requests across addresses, sharing an account, or otherwise;
                        </li>
                        <li>
                            probe, overload or interfere with the service, or attempt to reach
                            another user&rsquo;s account or history;
                        </li>
                        <li>
                            upload files crafted to exploit the image decoder rather than to be
                            processed by it;
                        </li>
                        <li>
                            resell the service, or present it as your own product.
                        </li>
                    </ul>
                    <p>
                        The API routes exist to serve this website. There is no public API, and we
                        may block traffic that treats them as one.
                    </p>
                    <p>
                        Where content posted to Resizo gives us reason to suspect a criminal offence
                        involving a threat to someone&rsquo;s life or safety, we will report it to law
                        enforcement and, where required, to Europol. If we become aware of child
                        sexual abuse material we will report it as US law requires and preserve the
                        relevant material — which, for an image you process, is nothing, because images
                        are never stored. We do not scan or monitor uploads.
                    </p>
                </DocSection>

                <DocSection id="limits" heading="6. Limits and fair use">
                    <p>
                        One upload may be up to {formatFileSize(MAX_FILE_SIZE)} and{' '}
                        {MAX_DIMENSION.toLocaleString('en-US')} pixels on its longest side, with an
                        output budget of {MAX_PIXELS / 1_000_000} megapixels. A batch may contain up
                        to {MAX_BULK_FILES} files totalling {formatFileSize(MAX_BULK_TOTAL_BYTES)}.
                        Each tool accepts about ten requests a minute from one address, and requests
                        over that limit are refused until the minute is up.
                    </p>
                    <p>
                        We may change these limits to keep the service running. They exist for
                        capacity, not to sell you a way around them.
                    </p>
                </DocSection>

                <DocSection id="accounts" heading="7. Accounts, security and ending your account">
                    <p>
                        An account is optional and adds one feature: a record of what you have
                        processed. You may create one with an email address and a password, or with
                        Google. Keep your credentials to yourself; anything done through your
                        account is treated as done by you.
                    </p>
                    <p>
                        You can export your data or delete your account at any time from the{' '}
                        <Link href="/dashboard" className={docLinkClass}>
                            dashboard
                        </Link>
                        . We may suspend or remove an account that breaches section 5 — and where
                        content is illegal or the service is under attack, we may do so immediately and
                        without notice.
                    </p>
                </DocSection>

                <DocSection id="reviews" heading="8. Reviews and other content you post">
                    <p>
                        If you post a review, you allow us to publish it on the site with the name
                        and role you supplied, and you confirm it is your own honest opinion. Reviews
                        are the views of the people who wrote them, not ours. You have to be signed in
                        to post, and we do not verify the name or role you type, rank reviews by any
                        algorithm, or pay for or reward reviews.
                    </p>
                    <p>
                        We may, in good faith, decline to publish or later remove a review that is
                        abusive, false, promotional, off-topic, illegal or otherwise objectionable.
                        Those decisions are made by the operator personally — there is no automated
                        moderation. If we remove a review or suspend an account, we will tell the
                        account holder what happened and why (see section 11). We terminate the
                        accounts of users who repeatedly post content that infringes copyright.
                    </p>
                </DocSection>

                <DocSection id="report" heading="9. Reporting illegal content">
                    <p>
                        If you believe a review on this site is illegal, you can tell us by email at{' '}
                        <a href="mailto:abuse@resizo.net" className={docLinkClass}>
                            abuse@resizo.net
                        </a>
                        . This is the one part of Resizo where reporting applies: images are processed
                        in memory and never stored, so there is nothing to report and no URL to point
                        at — only published reviews can be.
                    </p>
                    <p>A useful report includes:</p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>enough of an explanation of why you think the content is illegal;</li>
                        <li>the exact location of the review (a link or a clear description);</li>
                        <li>your name and an email address we can reply to;</li>
                        <li>a statement that you believe, in good faith, that the report is accurate.</li>
                    </ul>
                    <p>
                        We will confirm we received your report, look at it carefully and without bias,
                        and tell you what we decided and why. Decisions are made by a person, not by
                        automated means.
                    </p>
                </DocSection>

                <DocSection id="copyright" heading="10. Copyright complaints">
                    <p>
                        <strong className="font-semibold text-ink">Images.</strong> An image you
                        process is decoded in memory and returned, and never stored. There is no hosted
                        file, so a copyright takedown about an image cannot be actioned — there is
                        nothing to take down.
                    </p>
                    <p>
                        <strong className="font-semibold text-ink">Reviews.</strong> Reviews are stored
                        and published, so they can be. If you own a copyright and believe a review
                        infringes it, email{' '}
                        <a href="mailto:dmca@resizo.net" className={docLinkClass}>
                            dmca@resizo.net
                        </a>{' '}
                        with: identification of the work, identification of the material you say
                        infringes it and where it is, your contact details, a statement that you
                        believe in good faith the use is not authorised, a statement that the notice is
                        accurate and that you are the owner or authorised to act, and your signature.
                        We remove infringing reviews, and we terminate the accounts of repeat
                        infringers.
                    </p>
                </DocSection>

                <DocSection id="moderation" heading="11. Our moderation decisions, and how to challenge them">
                    <p>
                        Whenever we remove a review, restrict it, or suspend an account, we email the
                        account holder (the address is on file from sign-up) and tell them: what we
                        did, the facts we relied on, which of these terms or which law was the ground,
                        that the decision was made by a person and not by automated means, and how to
                        reply to contest it. If you think we got it wrong, reply to that email and we
                        will look again.
                    </p>
                </DocSection>

                <DocSection id="advertising" heading="12. Advertising">
                    <p>
                        Ads on this site are served by Google AdSense and are labelled as ads. What is
                        advertised is not chosen or endorsed by us, and dealings with an advertiser are
                        between you and them. Do not click ads artificially or encourage others to. Ad
                        behaviour and the cookies involved are covered in the{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            privacy policy
                        </Link>
                        .
                    </p>
                </DocSection>

                <DocSection id="source-code" heading="13. The Resizo source code is separate">
                    <p>
                        These terms cover the hosted service at resizo.net. The Resizo source code is
                        licensed separately under the MIT licence. If you run your own copy from the
                        Docker image, that deployment is your responsibility, with no support and no
                        warranty from us, and these terms do not govern it.
                    </p>
                </DocSection>

                <DocSection id="availability" heading="14. Availability, changes and discontinuation">
                    <p>
                        We may change, suspend or discontinue any part of the service at any time.
                        Because your files are never stored, an outage cannot lose your work — but
                        it can interrupt it, so keep your originals.
                    </p>
                </DocSection>

                <DocSection id="no-warranty" heading="15. No warranty">
                    <p>
                        The service is provided as it is, without warranty of any kind. We do not
                        promise that it will be available, that it will be uninterrupted, or that
                        the output will meet a particular standard. Image conversion is lossy by
                        nature and results vary with the source file.
                    </p>
                    <p>
                        If you are a consumer in the UK or the EEA, nothing in this section removes
                        rights you have under consumer law that cannot be removed by contract,
                        including your rights where the service does not work as described.
                    </p>
                </DocSection>

                <DocSection id="liability" heading="16. Limitation of liability">
                    <p>
                        Nothing in these terms limits any liability that cannot lawfully be limited —
                        including liability for death or personal injury caused by negligence, for
                        fraud, or for gross negligence.
                    </p>
                    <p>
                        Subject to that, and to the extent the law allows, we are not liable for lost
                        data, lost profit, business interruption or any indirect or consequential loss
                        arising from using or being unable to use Resizo, and our total liability to
                        you for all claims is limited to the greater of the amount you have paid to use
                        Resizo (which is nothing) or US$100.
                    </p>
                    <p>
                        If you are a consumer, this limit does not affect the mandatory consumer rights
                        described in section 15. Keep your own copy of any original you care about
                        before processing it.
                    </p>
                </DocSection>

                <DocSection id="changes" heading="17. Changes to these terms">
                    <p>
                        We may revise these terms. For a significant change we will give notice — by
                        email to account holders and by a notice on the site — a reasonable time before
                        it takes effect, and you may delete your account instead of accepting it. The
                        date at the top of the page shows when the terms last changed, and earlier
                        versions are kept in the project&rsquo;s public source history.
                    </p>
                </DocSection>

                <DocSection id="governing-law" heading="18. Governing law and disputes">
                    <p>
                        <strong className="font-semibold text-ink">
                            [PLACEHOLDER — the operator must set the governing law and the competent
                            courts, with legal advice, before publishing these terms.]
                        </strong>{' '}
                        Once set, the named courts will have non-exclusive jurisdiction over disputes
                        arising from these terms.
                    </p>
                    <p>
                        If you are a consumer resident in the UK or the EEA, this choice does not
                        deprive you of the protection of the mandatory law of the country where you
                        live: you may bring proceedings in the courts where you live, and we will bring
                        any claim against you only there. There is no arbitration requirement and no
                        class-action waiver.
                    </p>
                </DocSection>

                <DocSection id="general" heading="19. General">
                    <p>
                        If any part of these terms is found unenforceable, the rest stays in force. Not
                        enforcing a term is not a waiver of it. You may not transfer your rights under
                        these terms; we may transfer ours to a successor of the service. These terms
                        are the whole agreement between us about the service. Sections about your files,
                        acceptable use, no warranty, liability, and governing law survive the ending of
                        your account. We are not liable for a failure caused by something outside our
                        reasonable control. If you send us feedback or suggestions, we may use them
                        freely, with no obligation to you. These terms are written in English, and the
                        English version governs.
                    </p>
                </DocSection>

                <DocSection id="contact" heading="20. Contact">
                    <p>
                        Questions about these terms, or a notice you need to send us, go to{' '}
                        <a href="mailto:legal@resizo.net" className={docLinkClass}>
                            legal@resizo.net
                        </a>
                        . The role addresses for abuse reports, copyright complaints and security are
                        listed in section 3.
                    </p>
                </DocSection>
            </DocPage>
        </>
    );
}
