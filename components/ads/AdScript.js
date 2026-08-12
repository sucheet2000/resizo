'use client';

/**
 * AdScript
 *
 * The AdSense loader, mounted site-wide EXCEPT on the registered legal pages.
 * Google's instruction for the privacy-policy URL registered in Privacy &
 * messaging is that it "doesn't host scripts that require user consent,
 * including ad tags"; /terms rides along for the same reason. The loader used
 * to live in app/layout.js, which put it on every route including /privacy —
 * a direct contradiction of that rule. This gates it on the pathname instead.
 *
 * It stays a single site-wide loader rather than one per monetising layout, so
 * the script is requested once and the certified CMP it delivers initialises
 * once. The client id is kept local to match components/ui/AdSlot.js; both
 * would ideally read one shared constant, but that lives outside this change.
 */
import Script from 'next/script';
import { usePathname } from 'next/navigation';

const ADSENSE_CLIENT = 'ca-pub-6415707599096942';

// Path prefixes Google forbids the ad tag on. Matched as whole segments so a
// future marketing route like /privacy-explained would still be monetised.
const AD_FREE_PREFIXES = ['/privacy', '/terms'];

export function isAdFreePath(pathname) {
    if (typeof pathname !== 'string') return false;
    return AD_FREE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
}

export default function AdScript() {
    const pathname = usePathname();
    if (isAdFreePath(pathname)) return null;

    return (
        <Script
            id="adsbygoogle-loader"
            strategy="afterInteractive"
            crossOrigin="anonymous"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        />
    );
}
