/**
 * THE SPEC BLOCK
 *
 * "What this tool changes" is the block a visitor reads before they trust the
 * output with a passport photo or a bank statement, so the failures that matter
 * are the quiet ones: a row that renders a tick with no word beside it, a value
 * that reads the same whether the answer was kept or removed, a block that
 * disappears on the page whose tool is least like the others.
 *
 * The values themselves are not asserted here — they are asserted against the
 * engine in tests/lib/catalog/behaviour.test.js, which is the only place that
 * can prove them. This suite is about whether what the registry says survives
 * the render, and whether a preset reaches it.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BehaviourSpec from '@/components/tools/BehaviourSpec';
import { BEHAVIOUR_FIELDS, behaviourFor } from '@/lib/catalog/behaviour';

const rowsOf = (container) => [...container.querySelectorAll('dt')].map((term) => ({
    label: term.textContent,
    value: term.nextElementSibling?.textContent ?? null,
}));

describe('BehaviourSpec', () => {
    it('heads the block with one h2 a crawler and a screen reader can find', () => {
        render(<BehaviourSpec slug="resize" />);

        const heading = screen.getByRole('heading', { level: 2, name: 'What this tool changes' });
        expect(heading).toBeVisible();
        expect(screen.getByRole('region', { name: 'What this tool changes' })).toBeInTheDocument();
    });

    it('renders one row per property, in the registry’s order', () => {
        const { container } = render(<BehaviourSpec slug="resize" />);
        const rows = rowsOf(container);

        expect(rows).toHaveLength(BEHAVIOUR_FIELDS.length);
        expect(rows.map((row) => row.label)).toEqual(
            behaviourFor('resize').rows.map((row) => row.label),
        );
    });

    /**
     * A tick beside "EXIF" does not say whether the EXIF was kept or removed,
     * and neither does a colour. Every row has to be unambiguous read aloud,
     * with no character carrying meaning on its own.
     */
    it('states every value in words, never a symbol', () => {
        const { container } = render(<BehaviourSpec slug="remove-image-metadata" />);

        for (const row of rowsOf(container)) {
            expect(row.value, `${row.label} has no value`).toBeTruthy();
            expect(row.value).toMatch(/[a-z]{3}/i);
            expect(row.value).not.toMatch(/[✓✔✕✗×]/);
        }
    });

    it('says the opposite thing about the colour profile on the two tools that differ', () => {
        const { container: strip } = render(<BehaviourSpec slug="remove-image-metadata" />);
        const kept = rowsOf(strip).find((row) => row.label === 'ICC profile');
        expect(kept.value).toMatch(/kept/i);

        const { container: convert } = render(<BehaviourSpec slug="convert" />);
        const removed = rowsOf(convert).find((row) => row.label === 'ICC profile');
        expect(removed.value).toMatch(/removed/i);
    });

    it('resolves transparency from an intent’s preset', () => {
        const { container: open } = render(<BehaviourSpec slug="convert" />);
        expect(rowsOf(open).find((row) => row.label === 'Transparency').value).toMatch(/png and webp keep it/i);

        const { container: pinned } = render(<BehaviourSpec slug="convert" preset={{ from: 'png', to: 'jpeg' }} />);
        expect(rowsOf(pinned).find((row) => row.label === 'Transparency').value).toMatch(/flattened/i);
    });

    it('renders the note under the list when the entry has one, and nothing when it does not', () => {
        render(<BehaviourSpec slug="remove-image-metadata" />);
        expect(screen.getByText(/the colour profile stays/i)).toBeVisible();

        const { container } = render(<BehaviourSpec slug="resize" />);
        expect(within(container).queryByText(/colour profile stays/i)).toBeNull();
    });

    /**
     * /merge-pdf decodes nothing, so five of the seven questions have no answer
     * for it. A block that printed "EXIF: removed" about a PDF would be a
     * confident, checkable lie.
     */
    it('leaves out the rows a document tool cannot answer', () => {
        const { container } = render(<BehaviourSpec slug="merge-pdf" />);
        const rows = rowsOf(container);

        expect(rows.map((row) => row.label)).toEqual(['Pixels']);
        expect(container.textContent).not.toMatch(/EXIF|GPS|XMP/);
        expect(container.textContent).not.toMatch(/not applicable/i);
    });

    /**
     * The entry whose every row is a reading rather than a change, and the
     * proof that the renderer needed no rule of its own to show it: the words
     * come out of the registry the same way "removed" and "kept" do, so a
     * value added there reaches the page with no edit to this component.
     */
    it('renders the read-only rows of the tool that writes nothing', () => {
        const { container } = render(<BehaviourSpec slug="image-metadata-viewer" />);
        const rows = rowsOf(container);

        expect(rows.map((row) => row.label)).toEqual(
            BEHAVIOUR_FIELDS.map((key) => behaviourFor('image-metadata-viewer').rows.find((row) => row.key === key).label),
        );
        expect(rows[0].value).toBe('Not decoded and not written — the file is only read');
        expect(rows.slice(1).map((row) => row.value))
            .toEqual(Array(BEHAVIOUR_FIELDS.length - 1).fill('Read and shown, never changed'));

        expect(container.textContent).toMatch(/produces no image/);
        expect(container.textContent).not.toMatch(/[✓✗×]/);
    });

    it('renders nothing at all for a slug the registry does not describe', () => {
        const { container } = render(<BehaviourSpec slug="nowhere" />);
        expect(container).toBeEmptyDOMElement();
    });
});
