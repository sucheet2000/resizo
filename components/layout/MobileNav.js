'use client';

/**
 * MobileNav
 *
 * The phone's whole navigation in one disclosure: a <button> with
 * aria-expanded/aria-controls, a panel that closes on Escape, on a click
 * outside and on a route change, and focus returned to the toggle. The
 * hamburger this replaced was a div with an onClick and no keyboard path.
 *
 * It lists the same family the desktop Tools menu does, in the same order and
 * under the same category labels — every tool with a page of its own, exactly
 * once, then the directory, the guides and About. There is no repeat of the
 * bar's three primary tools at the top: the bar does not exist at this width,
 * and a duplicate row of Resize directly above "Resize & Crop → Resize Image"
 * is noise in a list you scroll with a thumb.
 *
 * Rows are 44px tall because a thumb is, and the registry is not imported
 * here — a 'use client' module that reaches @/lib/catalog ships the whole
 * catalogue barrel in the first load of every route. SiteHeader reads it and
 * passes plain arrays down.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const rowClass =
    'flex min-h-11 items-center justify-between gap-3 rounded-button px-3 py-2 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

function Row({ item }) {
    return (
        <Link href={item.href} className={rowClass}>
            <span>
                {item.label}
                {item.arrow ? <span aria-hidden="true">&nbsp;→</span> : null}
            </span>
            {item.mark ? (
                <span aria-hidden="true" className="font-data text-micro text-ink-muted">
                    {item.mark}
                </span>
            ) : null}
        </Link>
    );
}

export default function MobileNav({ groups = [], links = [], className = '' }) {
    // The panel remembers which route it was opened on, so navigating closes
    // it by derivation. An effect that called setOpen(false) on a pathname
    // change would be a cascading render for something the state can express.
    const [openPath, setOpenPath] = useState(null);
    const toggleRef = useRef(null);
    const panelRef = useRef(null);
    const pathname = usePathname();

    const open = openPath !== null && openPath === pathname;
    const setOpen = (next) => setOpenPath(next ? pathname : null);

    useEffect(() => {
        if (!open) return undefined;

        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            setOpenPath(null);
            toggleRef.current?.focus();
        };

        const onPointerDown = (event) => {
            if (panelRef.current?.contains(event.target)) return;
            if (toggleRef.current?.contains(event.target)) return;
            setOpenPath(null);
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    if (groups.length === 0 && links.length === 0) return null;

    // Focus that Tabs out of the panel closes it, for the same reason the
    // desktop disclosure does: an open panel floats over the page, and at
    // phone widths it covers the hero button that receives focus next.
    const onBlur = (event) => {
        const next = event.relatedTarget;
        if (next && !event.currentTarget.contains(next)) setOpenPath(null);
    };

    return (
        <div className={`relative ${className}`.trim()} onBlur={onBlur}>
            <button
                ref={toggleRef}
                type="button"
                aria-expanded={open}
                aria-controls="mobile-nav-panel"
                onClick={() => setOpen(!open)}
                className="flex min-h-11 items-center gap-2 rounded-button border border-line px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
            >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    {open ? (
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    ) : (
                        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    )}
                </svg>
                Menu
            </button>

            {open ? (
                <div
                    ref={panelRef}
                    id="mobile-nav-panel"
                    className="absolute right-0 top-full z-40 mt-2 max-h-[70dvh] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-panel border border-line bg-surface-raised p-2 shadow-raised"
                >
                    <div className="flex flex-col gap-4">
                        {groups.map((group) => (
                            <div key={group.id}>
                                {/*
                                  A paragraph, not a heading: this panel sits
                                  on every route, and six more h2s per page
                                  would rewrite the document outline of the
                                  whole site for a menu. aria-labelledby gives
                                  the list the name a heading would.
                                */}
                                <p
                                    id={`mobile-nav-${group.id}`}
                                    className="px-3 text-micro font-semibold text-ink"
                                >
                                    {group.title}
                                </p>
                                <ul aria-labelledby={`mobile-nav-${group.id}`} className="mt-1 flex flex-col">
                                    {group.tools.map((tool) => (
                                        <li key={tool.href}>
                                            <Row item={tool} />
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {links.length > 0 ? (
                        <ul className="mt-4 flex flex-col border-t border-line pt-2">
                            {links.map((item) => (
                                <li key={item.href}>
                                    <Row item={item} />
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
