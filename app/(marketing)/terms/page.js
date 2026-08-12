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
        'The terms for using Resizo: what the service does, the upload and rate limits it enforces, what you keep the rights to, and the warranty and liability position of a free tool.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Price', value: 'Free' },
    { label: 'Account', value: 'Optional' },
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
                intro="Resizo is a free image tool with no account requirement and no paid tier. These terms set out what it does, what we ask of you, and what we cannot promise."
                updated={LAST_UPDATED}
                aside={<DocSpecList heading="The terms in numbers" rows={SPEC_ROWS} />}
            >
                <DocSection id="acceptance" heading="1. Accepting these terms">
                    <p>
                        Using Resizo means agreeing to what follows. If you do not agree, do not use
                        the site. If you use it on behalf of an organisation, you are confirming you
                        may agree on its behalf.
                    </p>
                </DocSection>

                <DocSection id="service" heading="2. What the service is">
                    <p>
                        Resizo resizes, compresses, converts, crops and batch-processes images, and
                        converts iPhone HEIC photos to JPEG. Files are sent over HTTPS to our
                        server, processed in memory by the Sharp imaging library, and returned in
                        the response. They are not written to disk and not stored.{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            The privacy policy
                        </Link>{' '}
                        is the authoritative description of the data handling and forms part of
                        these terms.
                    </p>
                    <p>
                        The service is free. There is no paid tier, no subscription and nothing to
                        buy. It is funded by the advertising on the page.
                    </p>
                </DocSection>

                <DocSection id="your-files" heading="3. Your files stay yours">
                    <p>
                        You keep every right you already had in the images you process. Uploading a
                        file to Resizo grants us no licence to it beyond the one thing we need:
                        permission to decode, transform and return that specific file, for the
                        duration of that single request. Nothing else, and nothing afterwards.
                    </p>
                    <p>
                        In return, you confirm you are entitled to process what you upload — that it
                        is yours, or that you have the rights or permission you need for it.
                    </p>
                </DocSection>

                <DocSection id="acceptable-use" heading="4. Acceptable use">
                    <p>Do not use Resizo to:</p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            process material that is unlawful where you are, including child sexual
                            abuse material, or material that infringes someone else&rsquo;s rights;
                        </li>
                        <li>
                            work around the published limits, whether by scripting the endpoints,
                            spreading requests across addresses, or otherwise;
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
                </DocSection>

                <DocSection id="limits" heading="5. Limits">
                    <p>
                        One upload may be up to {formatFileSize(MAX_FILE_SIZE)} and{' '}
                        {MAX_DIMENSION.toLocaleString('en-US')} pixels on its longest side, with an
                        output budget of {MAX_PIXELS / 1_000_000} megapixels. A batch may contain up
                        to {MAX_BULK_FILES} files totalling {formatFileSize(MAX_BULK_TOTAL_BYTES)}.
                        Each tool accepts ten requests a minute from one address, and requests over
                        that limit are refused until the minute is up.
                    </p>
                    <p>
                        We may change these limits to keep the service running. They exist for
                        capacity, not to sell you a way around them.
                    </p>
                </DocSection>

                <DocSection id="accounts" heading="6. Accounts">
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
                        . We may suspend or remove an account that breaches section 4.
                    </p>
                </DocSection>

                <DocSection id="reviews" heading="7. Reviews">
                    <p>
                        If you post a review, you allow us to publish it on the site with the name
                        and role you supplied, and you confirm it is your own honest opinion. We may
                        decline to publish or later remove a review that is abusive, false,
                        promotional or unrelated to the tools. Deleting your account removes your
                        reviews.
                    </p>
                </DocSection>

                <DocSection id="advertising" heading="8. Advertising">
                    <p>
                        Ads on this site are served by Google AdSense. What is advertised is not
                        chosen or endorsed by us, and dealings with an advertiser are between you
                        and them. Ad behaviour and the cookies involved are covered in the{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            privacy policy
                        </Link>
                        .
                    </p>
                </DocSection>

                <DocSection id="availability" heading="9. Availability and no warranty">
                    <p>
                        The service is provided as it is, without warranty of any kind. We do not
                        promise that it will be available, that it will be uninterrupted, or that
                        the output will meet a particular standard. Image conversion is lossy by
                        nature and results vary with the source file.
                    </p>
                    <p>
                        We may change, suspend or discontinue any part of the service at any time.
                        Because your files are never stored, an outage cannot lose your work — but
                        it can interrupt it, so keep your originals.
                    </p>
                </DocSection>

                <DocSection id="liability" heading="10. Limitation of liability">
                    <p>
                        To the extent the law allows, we are not liable for lost data, lost profit,
                        business interruption or any indirect or consequential loss arising from
                        using or being unable to use Resizo. Nothing here limits liability that
                        cannot lawfully be limited, including for death or personal injury caused by
                        negligence, or for fraud.
                    </p>
                    <p>
                        Keep your own copy of any original you care about before processing it.
                    </p>
                </DocSection>

                <DocSection id="changes" heading="11. Changes to these terms">
                    <p>
                        We may revise these terms. The date at the top of the page shows when they
                        last changed, and continuing to use the site after a change means accepting
                        the revised version.
                    </p>
                </DocSection>

                <DocSection id="contact" heading="12. Contact">
                    <p>
                        Questions about these terms, or a notice you need to send us, go to{' '}
                        <a href="mailto:iamepicwin80@gmail.com" className={docLinkClass}>
                            iamepicwin80@gmail.com
                        </a>
                        .
                    </p>
                </DocSection>
            </DocPage>
        </>
    );
}
