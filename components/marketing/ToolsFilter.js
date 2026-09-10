'use client';

/**
 * ToolsFilter
 *
 * The one client island on /tools. The directory is thirty-odd server-rendered
 * rows today and will be a long scroll at fifty, so a visitor needs to be able
 * to type "heic" or "50 kb" and see only what that means.
 *
 * It does NOT own the rows, and that is the whole design. /tools is a page a
 * crawler reads for its links, so every row has to be in the HTML and visible
 * before any JavaScript runs; and a filter that rendered the rows would have to
 * import the catalogue, which is the barrel — every intent's page copy — in the
 * first load of the page (CLAUDE.md, rule 6). So the server passes down a small
 * searchable index — `[{ href, parent, terms }]`, three short strings a row —
 * and this narrows what is already painted by setting the `hidden` attribute on
 * the rows that do not match.
 *
 * Which rows survive is worked out from that index alone, during render. The
 * effect is only the write: it copies the answer onto the DOM, because the rows
 * belong to a server component this one must not import. `hidden` is the
 * smallest possible mutation — no class strings, no inline styles, nothing left
 * behind if the island never hydrates — and the rows are found by the
 * `data-filter-key` / `data-filter-group` attributes ToolsDirectory writes,
 * which a test holds the two files to.
 *
 * Matching rule, in the order a visitor would expect it:
 *   · every word typed has to appear somewhere in a row's terms;
 *   · an intent stays when its own row matches OR its parent tool does, so
 *     "convert" keeps the pages under Convert Format;
 *   · a tool stays when its own row matches OR any page beneath it does, so
 *     "50 kb" keeps Compress Image as the heading its match sits under;
 *   · a category disappears once every row inside it has gone.
 */
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import Field from '@/components/ui/Field';

const words = (value) => value.toLowerCase().split(/\s+/).filter(Boolean);

export default function ToolsFilter({ index = [], className = '' }) {
    const id = useId();
    const inputId = `${id}-filter`;
    const [query, setQuery] = useState('');
    const rootRef = useRef(null);

    /**
     * The hrefs that survive the current query, or `null` for "everything" —
     * which is not the same as "all of them" to the effect below, because an
     * empty query must leave the DOM exactly as it was served.
     */
    const visible = useMemo(() => {
        const typed = words(query);
        if (typed.length === 0) return null;

        const hit = new Map(index.map((entry) => [
            entry.href,
            typed.every((word) => entry.terms.includes(word)),
        ]));

        const keep = new Set();
        for (const entry of index) {
            const parentHit = entry.parent ? hit.get(entry.parent) === true : false;
            const childHit = index.some((other) => other.parent === entry.href && hit.get(other.href));
            if (hit.get(entry.href) || parentHit || childHit) keep.add(entry.href);
        }

        return keep;
    }, [index, query]);

    useEffect(() => {
        const doc = rootRef.current?.ownerDocument;
        if (!doc) return;

        for (const row of doc.querySelectorAll('[data-filter-key]')) {
            row.hidden = visible !== null && !visible.has(row.getAttribute('data-filter-key'));
        }

        for (const group of doc.querySelectorAll('[data-filter-group]')) {
            group.hidden = [...group.querySelectorAll('[data-filter-key]')].every((row) => row.hidden);
        }
    }, [visible]);

    const shown = visible === null ? index.length : visible.size;
    const empty = query.trim() !== '' && shown === 0;

    return (
        <div ref={rootRef} className={className}>
            <Field id={inputId} label="Filter tools" className="max-w-sm">
                <input
                    id={inputId}
                    type="search"
                    value={query}
                    autoComplete="off"
                    placeholder="heic, 50 kb, pdf…"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') setQuery('');
                    }}
                    className="w-full rounded-input border border-line bg-surface-raised px-3 py-2 text-base text-ink placeholder:text-ink-muted"
                />
            </Field>

            {/* One live region for both sentences: a screen reader that hears
                "0 of 26 shown" needs the way back in the same announcement. */}
            <div role="status" className="mt-2">
                <p className="font-data text-micro text-ink-muted">
                    {shown} of {index.length} shown
                </p>

            {empty ? (
                <p className="mt-1 text-ui text-ink-muted">
                    Nothing here matches that. Press Escape to clear it, or browse{' '}
                    <Link
                        href="/tools"
                        onClick={() => setQuery('')}
                        className="rounded-input text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2"
                    >
                        every tool
                    </Link>
                    .
                </p>
            ) : null}
            </div>
        </div>
    );
}
