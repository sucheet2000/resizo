/**
 * JsonLd
 *
 * Renders one schema object, or an array of them, as a single ld+json block.
 *
 * Three characters are escaped on the way out. `<` because a review body
 * containing "</script>" would otherwise close the tag and inject markup into
 * the page; U+2028 and U+2029 because JSON.stringify leaves them raw and both
 * count as line terminators inside a script body. The pattern is built from a
 * string so no raw line separator ever sits in this file.
 *
 * The root CSP already allows inline script, so this needs no nonce.
 */
const UNSAFE = new RegExp('[<\\u2028\\u2029]', 'g');

function escapeChar(char) {
    return '\\u' + char.codePointAt(0).toString(16).padStart(4, '0');
}

function serialise(data) {
    return JSON.stringify(data).replace(UNSAFE, escapeChar);
}

export default function JsonLd({ data, id }) {
    const nodes = (Array.isArray(data) ? data : [data]).filter(Boolean);
    if (nodes.length === 0) return null;

    return (
        <script
            id={id}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serialise(nodes.length === 1 ? nodes[0] : nodes) }}
        />
    );
}
