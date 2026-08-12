'use client';

/**
 * ConsentSettingsLink
 *
 * The consent-revocation entry point Google's Privacy & messaging program
 * requires: "a link at the bottom of your site that allows users who want to
 * revoke consent to do so, then present the consent message to those users
 * again." Google's documented label for it is "Privacy and cookie settings",
 * which app/(marketing)/privacy/page.js already points users at by name.
 *
 * When a certified CMP is on the page it exposes a way to re-open its dialog —
 * Google's own CMP through window.googlefc, a generic IAB TCF CMP through
 * window.__tcfapi. Clicking asks whichever is present to re-show the consent
 * message. Where neither exists — before the CMP has loaded, or on /privacy and
 * /terms where the ad tag is deliberately excluded — the link falls through to
 * the cookies section of the privacy policy, which describes the same choice.
 */
import Link from 'next/link';

function openConsentUi(event) {
    if (typeof window === 'undefined') return;

    const googlefc = window.googlefc;
    if (googlefc && typeof googlefc.showRevocationMessage === 'function') {
        event.preventDefault();
        googlefc.showRevocationMessage();
        return;
    }

    if (typeof window.__tcfapi === 'function') {
        event.preventDefault();
        window.__tcfapi('displayConsentUi', 2, () => {});
    }
    // Otherwise the anchor navigates to /privacy#cookies on its own.
}

export default function ConsentSettingsLink({ className }) {
    return (
        <Link href="/privacy#cookies" onClick={openConsentUi} className={className}>
            Privacy and cookie settings
        </Link>
    );
}
