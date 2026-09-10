/**
 * TrustStrip
 *
 * The four facts a visitor needs before handing over a file, stated once in
 * one shape everywhere they matter: under every tool panel and on the
 * homepage. Each one is true of every core tool by construction —
 * the engine runs in the visitor's browser (lib/image-client/), nothing is
 * posted anywhere (connect-src 'self', and tests/e2e proves it on every
 * flow), there is no account system and no watermark step.
 *
 * Precision over reach: "processed on your device" is what the architecture
 * proves. It does not say the file can never be copied by the visitor's own
 * browser, or that no security risk exists anywhere — claims nothing here
 * can stand behind. The link goes to the page that explains the mechanism.
 *
 * A server component with no state; the same markup a crawler reads.
 */
import Link from 'next/link';

export const TRUST_FACTS = [
    { id: 'device', label: 'Processed on your device', detail: 'The work happens in this browser tab.' },
    { id: 'upload', label: 'No image upload', detail: 'The file is not sent to Resizo.' },
    { id: 'account', label: 'No account', detail: 'Nothing to sign up for.' },
    { id: 'watermark', label: 'No watermark', detail: 'The output is yours, unmarked.' },
];

export default function TrustStrip({ className = '', detail = false, link = true }) {
    return (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`.trim()}>
            <ul aria-label="What Resizo promises" className="flex flex-wrap gap-x-4 gap-y-1">
                {TRUST_FACTS.map((fact) => (
                    <li key={fact.id} className="flex items-baseline gap-1.5 text-ui text-ink-muted">
                        <span aria-hidden="true" className="font-data text-micro text-accent">✓</span>
                        <span>
                            <span className="text-ink">{fact.label}</span>
                            {detail ? <span className="text-ink-muted"> — {fact.detail}</span> : null}
                        </span>
                    </li>
                ))}
            </ul>
            {link ? (
                <Link href="/about" className="rounded-input text-ui text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
                    How it works
                </Link>
            ) : null}
        </div>
    );
}
