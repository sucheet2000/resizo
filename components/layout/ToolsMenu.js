'use client';

/**
 * ToolsMenu
 *
 * The header's one disclosure. The bar carries the three tools people arrive
 * for; this carries the rest of the family, grouped by the need a visitor
 * came with, and it is what stops the bar growing a link every time a tool
 * ships.
 *
 * Two things make it a menu rather than a dropdown:
 *
 *  1. THE PANEL IS ALWAYS IN THE HTML. It is rendered on the server on every
 *     route and hidden with the `hidden` attribute, never conditionally
 *     rendered. A crawler and a screen reader that ignores the disclosure
 *     still read every tool link; a menu built by JavaScript would hide the
 *     whole family from both. `hidden` is paired with the `hidden` utility on
 *     purpose — the attribute is the semantics, and the class is what actually
 *     wins, because a Tailwind display utility and the UA's `[hidden]` rule
 *     have equal specificity and the utility layer is written later.
 *
 *  2. IT OPENS ON INTENT, NOT ON HOVER. A hover menu is unreachable from a
 *     keyboard and unusable on a phone. This is a button with the disclosure
 *     contract: aria-expanded, aria-controls, Escape closes and gives focus
 *     back, a click outside closes, a route change closes. Opened from the
 *     keyboard it hands focus to the first link, so the panel is one Tab away
 *     from being useful; opened by pointer it leaves focus alone, because a
 *     mouse user is already looking at where they are going.
 *
 * The registry is not imported here. A 'use client' module that reaches
 * @/lib/catalog pulls the whole catalogue barrel — every intent page's copy
 * included — into the first load of every route, which is the boundary
 * tests/architecture/boundaries.test.js exists to hold. The server component
 * above reads the registry and hands down plain arrays.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const PANEL_ID = 'tools-menu-panel';

const rowClass =
    'flex items-center justify-between gap-3 rounded-button px-2 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink';

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

export default function ToolsMenu({ groups = [], links = [], className = '' }) {
    // The panel remembers the route it was opened on, so navigating closes it
    // by derivation rather than by an effect that fires a second render.
    const [openPath, setOpenPath] = useState(null);
    const buttonRef = useRef(null);
    const panelRef = useRef(null);
    const fromKeyboard = useRef(false);
    const pathname = usePathname();

    const open = openPath !== null && openPath === pathname;

    useEffect(() => {
        if (!open) return undefined;

        if (fromKeyboard.current) {
            fromKeyboard.current = false;
            panelRef.current?.querySelector('a[href]')?.focus();
        }

        const onKeyDown = (event) => {
            if (event.key !== 'Escape') return;
            setOpenPath(null);
            buttonRef.current?.focus();
        };

        const onPointerDown = (event) => {
            if (panelRef.current?.contains(event.target)) return;
            if (buttonRef.current?.contains(event.target)) return;
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

    return (
        <div className={`relative ${className}`.trim()}>
            <button
                ref={buttonRef}
                type="button"
                aria-expanded={open}
                aria-controls={PANEL_ID}
                aria-haspopup="true"
                onClick={(event) => {
                    if (open) {
                        setOpenPath(null);
                        return;
                    }
                    // Enter and Space on a button produce a click with no
                    // pointer behind it, and that is the only reliable signal
                    // that focus should follow into the panel.
                    fromKeyboard.current = event.detail === 0;
                    setOpenPath(pathname);
                }}
                className="rounded-button px-3 py-1.5 text-ui text-ink-muted transition-colors duration-120 ease-snap hover:bg-surface-sunken hover:text-ink"
            >
                Tools
            </button>

            <div
                ref={panelRef}
                id={PANEL_ID}
                hidden={!open}
                className={`${open ? 'block' : 'hidden'} absolute right-0 top-full z-40 mt-2 w-[min(42rem,calc(100vw-3rem))] rounded-panel border border-line bg-surface-raised p-5 shadow-raised`}
            >
                <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3">
                    {groups.map((group) => (
                        <div key={group.id}>
                            {/*
                              A paragraph, not a heading: this markup sits on
                              every route, and six more h2s per page would
                              rewrite the document outline of the whole site
                              for a menu. aria-labelledby gives the list the
                              same name a heading would.
                            */}
                            <p id={`tools-menu-${group.id}`} className="px-2 text-micro font-semibold text-ink">
                                {group.title}
                            </p>
                            <ul aria-labelledby={`tools-menu-${group.id}`} className="mt-1 flex flex-col">
                                {group.tools.map((tool) => (
                                    <li key={tool.href}>
                                        <Row item={tool} />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <ul className="mt-5 flex flex-wrap gap-1 border-t border-line pt-4">
                    {links.map((item) => (
                        <li key={item.href}>
                            <Row item={item} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
