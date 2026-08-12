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
        'The terms for using Resizo: a free image tool with no accounts, the upload and rate limits, '
        + 'what you keep the rights to, and the warranty and liability position of a free service.',
    path: PATH,
});

const SPEC_ROWS = [
    { label: 'Price', value: 'Free' },
    { label: 'Accounts', value: 'None' },
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
                intro="Resizo is a free image tool with no account and no paid tier. These terms set out what it does, what we ask of you, and what we cannot promise. They are meant to be short and plain."
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
                        converts iPhone HEIC photos to JPEG. Files are sent over HTTPS to our server,
                        processed by the Sharp imaging library, and returned in the response.
                        They are not kept. There are no accounts and nothing
                        to buy.{' '}
                        <Link href="/privacy" className={docLinkClass}>
                            The privacy policy
                        </Link>{' '}
                        is the authoritative description of the data handling and forms part of these
                        terms.
                    </p>
                </DocSection>

                <DocSection id="operator" heading="3. Who operates Resizo and how to reach us">
                    <p>
                        Resizo is operated by an individual developer, based in{' '}
                        <strong className="font-semibold text-ink">
                            India
                        </strong>
                        . You can reach a real person, in English, at{' '}
                        <a href="mailto:contact@resizo.net" className={docLinkClass}>
                            contact@resizo.net
                        </a>
                        .
                    </p>
                </DocSection>

                <DocSection id="your-files" heading="4. Your files stay yours">
                    <p>
                        You keep every right you already had in the images you process. Uploading a
                        file grants us only a worldwide, non-exclusive, royalty-free licence to decode,
                        transform, encode and return that specific file — limited to the duration of
                        that single request and ending when the response is delivered. We acquire no
                        other rights, and no licence survives the request.
                    </p>
                    <p>
                        We do not use your files to train any model, we do not keep derivatives, and we
                        do not share them with anyone. In return, you confirm you are entitled to
                        process what you upload — that it is yours, or that you have the rights or
                        permission you need for it.
                    </p>
                </DocSection>

                <DocSection id="acceptable-use" heading="5. Acceptable use">
                    <p>Do not use Resizo to:</p>
                    <ul className="flex list-disc flex-col gap-3 pl-5 marker:text-ink-muted">
                        <li>
                            process material that is unlawful under any law that applies to you or to
                            us, including child sexual abuse material, or material that infringes
                            someone else&rsquo;s rights;
                        </li>
                        <li>
                            work around the published limits, whether by scripting the endpoints,
                            spreading requests across addresses, or otherwise;
                        </li>
                        <li>
                            probe, overload or interfere with the service;
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
                        The API routes exist to serve this website. There is no public API, and we may
                        block traffic that treats them as one. Because images are processed on our
                        server and never kept, there is nothing hosted here to report or take down.
                    </p>
                </DocSection>

                <DocSection id="limits" heading="6. Limits and fair use">
                    <p>
                        One upload may be up to {formatFileSize(MAX_FILE_SIZE)} and{' '}
                        {MAX_DIMENSION.toLocaleString('en-US')} pixels on its longest side, with an
                        output budget of {MAX_PIXELS / 1_000_000} megapixels. A batch may contain up to{' '}
                        {MAX_BULK_FILES} files totalling {formatFileSize(MAX_BULK_TOTAL_BYTES)}. Each
                        tool accepts about ten requests a minute from one address, and requests over
                        that limit are refused until the minute is up.
                    </p>
                    <p>
                        We may change these limits to keep the service running. They exist for
                        capacity, not to sell you a way around them.
                    </p>
                </DocSection>

                <DocSection id="availability" heading="7. Availability, changes and discontinuation">
                    <p>
                        We may change, suspend or discontinue any part of the service at any time.
                        Because your files are never kept, an outage cannot lose your work — but it
                        can interrupt it, so keep your originals. The Resizo source code is licensed
                        separately under the MIT licence; if you run your own copy from the Docker
                        image, that deployment is your responsibility and these terms do not govern it.
                    </p>
                </DocSection>

                <DocSection id="no-warranty" heading="8. No warranty">
                    <p>
                        The service is provided as it is, without warranty of any kind. We do not
                        promise that it will be available, that it will be uninterrupted, or that the
                        output will meet a particular standard. Image conversion is lossy by nature and
                        results vary with the source file.
                    </p>
                    <p>
                        If you are a consumer in the UK or the EEA, nothing here removes rights you have
                        under consumer law that cannot be removed by contract.
                    </p>
                </DocSection>

                <DocSection id="liability" heading="9. Limitation of liability">
                    <p>
                        Nothing in these terms limits any liability that cannot lawfully be limited —
                        including liability for death or personal injury caused by negligence, for
                        fraud, or for gross negligence.
                    </p>
                    <p>
                        Subject to that, and to the extent the law allows, we are not liable for lost
                        data, lost profit, business interruption or any indirect or consequential loss
                        arising from using or being unable to use Resizo, and our total liability to you
                        for all claims is limited to the greater of the amount you have paid to use
                        Resizo (which is nothing) or US$100. Keep your own copy of any original you care
                        about before processing it.
                    </p>
                </DocSection>

                <DocSection id="governing-law" heading="10. Governing law and disputes">
                    <p>
                        These terms are governed by the laws of the{' '}
                        <strong className="font-semibold text-ink">
                            State of California, United States
                        </strong>
                        , without regard to its conflict-of-law rules. The state and federal courts
                        located in California have non-exclusive jurisdiction over disputes arising
                        from these terms.
                    </p>
                    <p>
                        If you are a consumer resident in the UK or the EEA, this choice does not
                        deprive you of the protection of the mandatory law of the country where you
                        live: you may bring proceedings in the courts where you live, and we will bring
                        any claim against you only there. There is no arbitration requirement and no
                        class-action waiver.
                    </p>
                </DocSection>

                <DocSection id="general" heading="11. General">
                    <p>
                        If any part of these terms is found unenforceable, the rest stays in force. Not
                        enforcing a term is not a waiver of it. You may not transfer your rights under
                        these terms; we may transfer ours to a successor of the service. We may revise
                        these terms, and the date at the top of the page shows when they last changed.
                        These terms are written in English, and the English version governs. Questions
                        go to{' '}
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
