/**
 * Inline links in catalogue copy.
 *
 * A paragraph in an intent entry is plain text with links written as
 * `[label](/path)` — the one piece of markup the copy needs, and the only one
 * it gets. No emphasis, no HTML, no nesting. Keeping the copy as text is what
 * lets a validator read it, a similarity check compare it and the link graph
 * be computed, none of which is possible once a sentence is JSX.
 *
 * A link target is a site path (`/resize`, `/resize#bulk`) or an https URL for
 * an external source; anything else is refused by lib/catalog/validate.js.
 */
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

const TARGET = /^(?:\/[^\s)]*|https:\/\/[^\s)]+)$/;

export function isLinkTarget(href) {
    return typeof href === 'string' && TARGET.test(href);
}

/**
 * Splits text into runs: `{ type: 'text', value }` and
 * `{ type: 'link', label, href }`, in order. Malformed links are returned as
 * link runs too, so the validator can name them; the renderer never sees one
 * because the validator runs first.
 */
export function parseInline(text) {
    const source = typeof text === 'string' ? text : '';
    const runs = [];
    let last = 0;

    for (const match of source.matchAll(LINK)) {
        if (match.index > last) runs.push({ type: 'text', value: source.slice(last, match.index) });
        runs.push({ type: 'link', label: match[1], href: match[2] });
        last = match.index + match[0].length;
    }

    if (last < source.length) runs.push({ type: 'text', value: source.slice(last) });

    return runs;
}

/** Every link in a piece of copy, as `{ label, href }`. */
export function inlineLinks(text) {
    return parseInline(text)
        .filter((run) => run.type === 'link')
        .map(({ label, href }) => ({ label, href }));
}

/** The copy with its link markup reduced to the labels — what a reader sees. */
export function plainText(text) {
    return parseInline(text)
        .map((run) => (run.type === 'link' ? run.label : run.value))
        .join('');
}
