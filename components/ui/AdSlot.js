'use client';

/**
 * AdSlot
 *
 * A fixed-height reserved container so a filled unit never pushes the page
 * around — layout shift is a Core Web Vitals input, and Auto Ads injecting
 * into unreserved space is exactly how that score gets lost.
 *
 * Renders nothing at all without a `slot`. The previous build shipped an empty
 * bordered box captioned "Advertisement" on the homepage, which is a worse
 * outcome than blank space.
 *
 * Placement is the caller's responsibility and the rule is binding: never
 * between the headline and the drop zone, never beside the tool, never before
 * the visitor's first result. Below results, bottom of the first viewport, or
 * footer-adjacent.
 */
import { useEffect, useRef } from 'react';

const ADSENSE_CLIENT = 'ca-pub-6415707599096942';

export default function AdSlot({
    slot,
    height = 90,
    format = 'auto',
    responsive = true,
    className = '',
}) {
    const pushedRef = useRef(false);

    useEffect(() => {
        if (!slot || pushedRef.current) return;
        pushedRef.current = true;
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch {
            // The loader is afterInteractive and may not have arrived yet, or an
            // ad blocker removed it. Reserved space stays reserved either way.
        }
    }, [slot]);

    if (!slot) return null;

    return (
        <div
            className={[
                'w-full overflow-hidden rounded-panel bg-surface-sunken',
                className,
            ].filter(Boolean).join(' ')}
            style={{ minHeight: `${height}px` }}
        >
            <ins
                className="adsbygoogle block"
                style={{ display: 'block', minHeight: `${height}px` }}
                data-ad-client={ADSENSE_CLIENT}
                data-ad-slot={slot}
                data-ad-format={format}
                data-full-width-responsive={responsive ? 'true' : 'false'}
            />
        </div>
    );
}
