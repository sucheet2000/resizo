/**
 * The fact extractor behind the intent-page snapshots.
 *
 * A snapshot is only as good as what it reads. This proves the extractor sees
 * every kind of thing a page can lose in a migration — a heading, a paragraph,
 * a list item, a table cell, a link, a preconfigured control, a JSON-LD node,
 * a metadata field — before the snapshots are trusted to catch that loss.
 */
import { describe, expect, it } from 'vitest';

import { pageFacts } from './helpers/page-facts';

const HTML = `
<nav aria-label="Breadcrumb"><ol>
  <li><a href="/">Home</a></li>
  <li><span aria-current="page">Resize a JPG</span></li>
</ol></nav>
<div>
  <header><h1>Resize   a JPG</h1></header>
  <p>One line under the heading.</p>
  <section aria-label="Resize a JPG tool">
    <label for="w">Width (px)</label><input id="w" name="width" type="number" value="800">
    <label for="fmt">Format</label>
    <select id="fmt" name="format"><option value="original">Original</option><option value="webp" selected>WebP</option></select>
    <input type="checkbox" name="lock" checked aria-label="Keep the aspect ratio">
    <p>Your image never leaves your device.</p>
  </section>
</div>
<p>The direct answer.</p>
<section><h2 id="a">Section A</h2><p>Body with a <a href="/resize-png">link</a>.</p>
  <ul><li>First</li><li>Second</li></ul>
  <table><caption>Sizes</caption><thead><tr><th>Use</th><th>Pixels</th></tr></thead>
  <tbody><tr><th scope="row">Favicon</th><td>32×32</td></tr></tbody></table>
</section>
<section><h2>FAQ</h2><h3>Is it free?</h3><p>Yes.</p></section>
<script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"FAQPage"}]</script>
`;

const METADATA = {
    title: 'Resize JPG | Resizo',
    description: 'Resize a JPG without uploading it.',
    alternates: { canonical: 'https://www.resizo.net/resize-jpg' },
    robots: { index: true, follow: true },
    openGraph: { url: 'https://www.resizo.net/resize-jpg', images: [{ url: '/og-resize.jpg' }] },
};

describe('pageFacts', () => {
    const facts = pageFacts(HTML, METADATA);

    it('reads the headline, the intro line and the direct answer', () => {
        expect(facts.h1).toBe('Resize a JPG');
        expect(facts.intro).toBe('One line under the heading.');
        expect(facts.answer).toBe('The direct answer.');
    });

    it('reads the breadcrumb trail with its links', () => {
        expect(facts.breadcrumb).toEqual([
            { text: 'Home', href: '/' },
            { text: 'Resize a JPG', href: null },
        ]);
    });

    it('reads every heading below the h1, in order and with its level', () => {
        expect(facts.headings).toEqual([
            { level: 2, text: 'Section A' },
            { level: 2, text: 'FAQ' },
            { level: 3, text: 'Is it free?' },
        ]);
    });

    it('reads paragraphs, list items and table cells', () => {
        expect(facts.paragraphs).toContain('Body with a link.');
        expect(facts.paragraphs).toContain('Yes.');
        expect(facts.lists).toContainEqual({ ordered: false, items: ['First', 'Second'] });
        expect(facts.tables).toEqual([
            { caption: 'Sizes', head: ['Use', 'Pixels'], rows: [['Favicon', '32×32']] },
        ]);
    });

    it('reads every link with its text', () => {
        expect(facts.links).toEqual([
            { href: '/', text: 'Home' },
            { href: '/resize-png', text: 'link' },
        ]);
    });

    it('reads the preconfigured controls inside the tool panel, by label', () => {
        expect(facts.settings).toEqual([
            { tag: 'input', type: 'number', name: 'width', label: 'Width (px)', value: '800', checked: null },
            { tag: 'select', type: null, name: 'format', label: 'Format', value: 'webp', checked: null },
            { tag: 'input', type: 'checkbox', name: 'lock', label: 'Keep the aspect ratio', value: 'on', checked: true },
        ]);
    });

    it('reads the panel copy and the JSON-LD', () => {
        expect(facts.panelText).toEqual(['Your image never leaves your device.']);
        expect(facts.jsonLd).toEqual([[{ '@type': 'BreadcrumbList' }, { '@type': 'FAQPage' }]]);
    });

    it('carries the metadata object through untouched', () => {
        expect(facts.metadata).toEqual(METADATA);
    });

    it('folds a React-generated control name to one token, so a wrapper cannot break the snapshot', () => {
        const generated = pageFacts(
            '<section aria-label="X tool">'
            + '<input type="radio" name="_R_a7a_" value="black" checked>'
            + '<input type="radio" name="«r1»" value="white">'
            + '<input type="radio" name=":r2:" value="custom">'
            + '<input type="radio" name="compress-mode" value="quality">'
            + '</section>',
            null,
        );
        expect(generated.settings.map((control) => control.name)).toEqual([
            '(generated)',
            '(generated)',
            '(generated)',
            'compress-mode',
        ]);
    });

    it('reports nothing rather than throwing on a page with no tool panel', () => {
        const bare = pageFacts('<h1>About</h1><p>Prose.</p>', null);
        expect(bare.settings).toEqual([]);
        expect(bare.answer).toBeNull();
        expect(bare.metadata).toBeNull();
    });
});
