/**
 * What a crawler reads off a rendered page, as plain data.
 *
 * The intent pages used to be ten hand-written page.js files and are now one
 * renderer reading one registry. The only proof that nothing was lost on the
 * way is a before/after comparison of what each page actually renders, and
 * comparing raw HTML is useless — React's generated ids and the class strings
 * change with the tree. So this reads the HTML the way a crawler would and
 * keeps the parts that carry meaning: the metadata object, the headline and
 * intro, the direct answer, every heading, paragraph, list, table and link, the
 * controls the page preconfigures inside the tool panel, and the structured
 * data. Whitespace is collapsed the way a browser collapses it.
 *
 * Runs in the jsdom project: it needs DOMParser.
 */
const collapse = (value) => (value ?? '').replace(/\s+/g, ' ').trim();

/**
 * React's useId() output depends on where a component sits in the tree, so a
 * radio group named by it changes name when a wrapper is added above it. That
 * is not content, and a snapshot that tracked it would fail on every
 * restructure while catching nothing. Every generated id shape React has
 * shipped is folded to one token.
 */
const GENERATED_ID = /^(_R_[a-z0-9_]*_|«[^»]*»|:[^:]*:)$/i;

const stableName = (value) => (value && GENERATED_ID.test(value) ? '(generated)' : value);

function labelOf(document, element) {
    const id = element.getAttribute('id');
    if (id) {
        const label = [...document.querySelectorAll('label')].find((node) => node.getAttribute('for') === id);
        if (label) return collapse(label.textContent);
    }

    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const names = labelledBy
            .split(/\s+/)
            .map((ref) => document.getElementById(ref))
            .filter(Boolean)
            .map((node) => collapse(node.textContent));
        if (names.length > 0) return names.join(' ');
    }

    return element.getAttribute('aria-label') ?? null;
}

function controlValue(element) {
    if (element.tagName === 'SELECT') return element.value;
    if (element.tagName === 'TEXTAREA') return collapse(element.textContent);
    return element.getAttribute('value') ?? element.value ?? null;
}

function controlFacts(document, panel) {
    return [...panel.querySelectorAll('input, select, textarea')].map((element) => {
        const type = element.getAttribute('type');
        const checkable = type === 'checkbox' || type === 'radio';
        return {
            tag: element.tagName.toLowerCase(),
            type,
            name: stableName(element.getAttribute('name')),
            label: labelOf(document, element),
            value: controlValue(element),
            checked: checkable ? element.hasAttribute('checked') : null,
        };
    });
}

/**
 * @param {string} html   the page's static markup
 * @param {object|null} metadata   the metadata object Next would render, if any
 */
export function pageFacts(html, metadata = null) {
    const document = new DOMParser().parseFromString(
        `<!doctype html><html><body>${html}</body></html>`,
        'text/html',
    );
    const body = document.body;
    const text = (node) => (node ? collapse(node.textContent) : null);
    const all = (selector, root = body) => [...root.querySelectorAll(selector)];

    const h1 = body.querySelector('h1');
    const header = h1?.closest('header') ?? null;
    const afterHeader = header?.nextElementSibling ?? null;
    const intro = afterHeader?.tagName === 'P' ? text(afterHeader) : null;

    const panel = body.querySelector('section[aria-label$=" tool"]');
    const afterPanel = panel?.parentElement?.nextElementSibling ?? null;
    const answer = afterPanel?.tagName === 'P' ? text(afterPanel) : null;

    return {
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
        h1: text(h1),
        intro,
        answer,
        breadcrumb: all('nav[aria-label="Breadcrumb"] li').map((item) => ({
            text: text(item),
            href: item.querySelector('a')?.getAttribute('href') ?? null,
        })),
        headings: all('h2, h3, h4, h5, h6').map((heading) => ({
            level: Number(heading.tagName.slice(1)),
            text: text(heading),
        })),
        paragraphs: all('p').map(text).filter(Boolean),
        lists: all('ul, ol').map((list) => ({
            ordered: list.tagName === 'OL',
            items: [...list.children].filter((child) => child.tagName === 'LI').map(text),
        })),
        tables: all('table').map((table) => ({
            caption: text(table.querySelector('caption')),
            head: all('thead th', table).map(text),
            rows: all('tbody tr', table).map((row) => [...row.children].map(text)),
        })),
        links: all('a[href]').map((anchor) => ({
            href: anchor.getAttribute('href'),
            text: text(anchor),
        })),
        settings: panel ? controlFacts(document, panel) : [],
        panelText: panel ? all('p', panel).map(text).filter(Boolean) : [],
        jsonLd: all('script[type="application/ld+json"]').map((script) => JSON.parse(script.textContent)),
    };
}
