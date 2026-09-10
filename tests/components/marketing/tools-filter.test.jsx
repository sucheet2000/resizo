/**
 * ToolsFilter — the one client island on /tools.
 *
 * The directory is server-rendered rows and stays that way: at fifty tools a
 * filter is what makes the page usable, and a filter that owns the rows would
 * mean shipping the whole catalogue — titles, descriptions, every intent blurb
 * — into a client chunk on a page a crawler reads. So the island receives a
 * small searchable index as a prop and toggles the `hidden` attribute on rows
 * that are already in the HTML.
 *
 * That design has exactly one failure mode worth a test: a row that is only
 * visible once JavaScript has run. Every assertion below therefore starts from
 * the rendered directory with nothing hidden, and the filter is proved to
 * SUBTRACT from it rather than to produce it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ToolsDirectory, { filterIndex } from '@/components/marketing/ToolsDirectory';
import ToolsFilter from '@/components/marketing/ToolsFilter';
import { INTENTS, TOOLS } from '@/lib/catalog';

function renderDirectory() {
    return render(
        <>
            <ToolsFilter index={filterIndex()} />
            <ToolsDirectory />
        </>,
    );
}

const row = (key) => document.querySelector(`[data-filter-key="${key}"]`);
const shown = (key) => {
    const node = row(key);
    expect(node, `${key} has no row in the directory`).toBeTruthy();
    return !node.hidden;
};

describe('filterIndex', () => {
    const index = filterIndex();

    it('covers every tool and every intent, once each', () => {
        const hrefs = index.map((entry) => entry.href);
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs).toHaveLength(TOOLS.length + INTENTS.length);
    });

    it('carries only an href, its parent row and its search terms — never the page copy twice', () => {
        for (const entry of index) {
            expect(Object.keys(entry).sort()).toEqual(['href', 'parent', 'terms']);
            expect(typeof entry.terms).toBe('string');
        }
    });

    it('nests every intent under the tool it preconfigures, and no tool under anything', () => {
        const byHref = new Map(index.map((entry) => [entry.href, entry.parent]));

        for (const tool of TOOLS) expect(byHref.get(tool.href)).toBeNull();
        for (const intent of INTENTS) {
            const parent = TOOLS.find((tool) => tool.slug === intent.tool);
            expect(byHref.get(intent.path)).toBe(parent.href);
        }
    });

    it('folds in the format tokens and the byte ceilings a visitor would type', () => {
        const byHref = new Map(index.map((entry) => [entry.href, entry.terms]));

        expect(byHref.get('/heic')).toMatch(/heic/);
        expect(byHref.get('/compress-image-to-50kb')).toMatch(/50 kb/);
        expect(byHref.get('/compress-image-to-50kb')).toMatch(/50kb/);
        expect(byHref.get('/jpg-to-pdf')).toMatch(/pdf/);
        expect(byHref.get('/png-to-jpg')).toMatch(/jpeg/);
        // The category a tool sits in is searchable too: someone typing
        // "privacy" is looking for the metadata tools.
        expect(byHref.get('/remove-image-metadata')).toMatch(/privacy/);
    });
});

describe('ToolsFilter', () => {
    it('is a labelled control, not a bare box with a placeholder', () => {
        renderDirectory();
        expect(screen.getByLabelText('Filter tools')).toHaveAttribute('type', 'search');
    });

    it('leaves every row visible before anything is typed', () => {
        renderDirectory();

        for (const entry of filterIndex()) {
            expect(shown(entry.href), `${entry.href} starts hidden`).toBe(true);
        }
    });

    it('counts what is shown out of what exists', () => {
        renderDirectory();
        const total = filterIndex().length;
        const status = screen.getByRole('status');

        expect(status).toHaveTextContent(`${total} of ${total} shown`);
    });

    it('narrows to a byte ceiling, keeping the tool the match sits under', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), '50 kb');

        expect(shown('/compress-image-to-50kb')).toBe(true);
        expect(shown('/compress')).toBe(true);
        expect(shown('/compress-image-to-20kb')).toBe(false);
        expect(shown('/resize')).toBe(false);
        expect(shown('/merge-pdf')).toBe(false);
    });

    it('hides a category whose every row went away', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), '50 kb');

        expect(document.querySelector('[data-filter-group="compress"]').hidden).toBe(false);
        expect(document.querySelector('[data-filter-group="combine"]').hidden).toBe(true);
    });

    it('matches a format token and keeps that tool’s own pages with it', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), 'heic');

        expect(shown('/heic')).toBe(true);
        expect(shown('/heic-to-jpg')).toBe(true);
        expect(shown('/heic-to-png')).toBe(true);
        expect(shown('/crop')).toBe(false);
    });

    it('updates the count as it narrows', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), 'heic');

        const total = filterIndex().length;
        expect(screen.getByRole('status')).toHaveTextContent(`3 of ${total} shown`);
    });

    it('says so when nothing matches, and offers the way back', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), 'watermark remover');

        expect(screen.getByRole('status')).toHaveTextContent(`0 of ${filterIndex().length} shown`);
        expect(screen.getByText(/nothing here matches/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /every tool/i })).toHaveAttribute('href', '/tools');
    });

    it('clears on Escape and puts every row back', async () => {
        const user = userEvent.setup();
        renderDirectory();
        const input = screen.getByLabelText('Filter tools');

        await user.type(input, 'heic');
        expect(shown('/crop')).toBe(false);

        await user.type(input, '{Escape}');

        expect(input).toHaveValue('');
        for (const entry of filterIndex()) {
            expect(shown(entry.href), `${entry.href} stayed hidden after Escape`).toBe(true);
        }
    });

    it('is case- and space-insensitive about what a visitor types', async () => {
        const user = userEvent.setup();
        renderDirectory();

        await user.type(screen.getByLabelText('Filter tools'), '  PNG  ');

        expect(shown('/png-to-jpg')).toBe(true);
        expect(shown('/convert')).toBe(true);
        expect(shown('/merge-pdf')).toBe(false);
    });
});
