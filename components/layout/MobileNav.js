'use client';

/**
 * MobileNav
 *
 * A real disclosure: a <button> with aria-expanded/aria-controls, a panel that
 * closes on Escape and on route change, and focus returned to the toggle. The
 * previous hamburger was a div with an onClick and no keyboard path at all.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function MobileNav({ items = [], className = '' }) {
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

    if (items.length === 0) return null;

    return (
        <div className={`relative ${className}`.trim()}>
            <button
                ref={toggleRef}
                type="button"
                aria-expanded={open}
                aria-controls="mobile-nav-panel"
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-button border border-line px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
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
                    className="absolute right-0 top-full z-40 mt-2 w-56 rounded-panel border border-line bg-surface-raised p-2 shadow-raised"
                >
                    <ul className="flex flex-col">
                        {items.map((item) => (
                            <li key={item.href}>
                                <Link
                                    href={item.href}
                                    className="flex items-center justify-between gap-3 rounded-button px-3 py-2 text-base text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                                >
                                    {item.label}
                                    {item.mark ? (
                                        <span aria-hidden="true" className="font-data text-micro text-ink-muted">
                                            {item.mark}
                                        </span>
                                    ) : null}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
