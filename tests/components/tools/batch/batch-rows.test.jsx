/**
 * BatchRows (shared) — the operation-agnostic list renderer extracted from
 * the bulk compressor.
 *
 * This component knows nothing about compression or conversion: every fact
 * about a row — its status text, its data cells, its note, its failure
 * sentence and whether it offers a download — comes from the `describe(row)`
 * callback the caller supplies. This suite proves the RENDERING contract
 * (list semantics, data-* hooks, truncation, the download button's shape)
 * using a deliberately generic `describe`, so a real tool's own describe
 * function is free to be tested on its own without re-proving any of this.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BatchRows from '@/components/tools/batch/BatchRows';

function row(overrides = {}) {
    return { id: 'row-1', name: 'photo.jpg', status: 'success', ...overrides };
}

/** A minimal, generic describe() — no knowledge of any real tool's statuses. */
function describeRow(row) {
    return {
        status: row.status === 'success' ? 'Done' : 'Waiting',
        cells: row.size ? [{ field: 'size', label: 'Size', value: row.size }] : [],
        note: row.note ?? null,
        error: row.error ?? null,
        download: row.status === 'success' ? `Download ${row.filename ?? row.name}` : null,
    };
}

describe('BatchRows (shared)', () => {
    it('renders nothing for an empty list', () => {
        const { container } = render(<BatchRows rows={[]} describe={describeRow} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the list with the required accessible name', () => {
        render(<BatchRows rows={[row()]} describe={describeRow} />);
        expect(screen.getByRole('list', { name: 'Results' })).toBeInTheDocument();
    });

    it('marks each row with its status and name as data attributes', () => {
        render(<BatchRows rows={[row({ id: 'a', name: 'one.jpg' })]} describe={describeRow} />);
        const item = screen.getByRole('listitem');
        expect(item).toHaveAttribute('data-status', 'success');
        expect(item).toHaveAttribute('data-name', 'one.jpg');
    });

    it('truncates the filename visually but keeps the full name in a title attribute', () => {
        render(<BatchRows rows={[row({ name: 'a-very-long-original-filename-from-a-camera.jpg' })]} describe={describeRow} />);
        expect(screen.getByText('a-very-long-original-filename-from-a-camera.jpg'))
            .toHaveAttribute('title', 'a-very-long-original-filename-from-a-camera.jpg');
    });

    it('renders the status text from describe(), wrapped in a data-field="status" cell', () => {
        render(<BatchRows rows={[row()]} describe={describeRow} />);
        expect(screen.getByText('Done').closest('[data-field="status"]')).toBeInTheDocument();
    });

    it('renders each entry in describe().cells as its own labelled, data-field cell', () => {
        render(<BatchRows rows={[row({ size: '200 KB' })]} describe={describeRow} />);
        const cell = document.querySelector('[data-field="size"]');
        expect(cell).toHaveTextContent('200 KB');
        expect(cell.previousElementSibling).toHaveTextContent('Size');
    });

    it('renders no cell at all when describe() returns an empty cells array', () => {
        render(<BatchRows rows={[row({ id: 'rejected-1', status: 'unsupported' })]} describe={describeRow} />);
        expect(document.querySelector('[data-field="size"]')).toBeNull();
    });

    it('renders the note when describe() returns one, and none when it does not', () => {
        const { rerender } = render(<BatchRows rows={[row({ note: 'Kept unchanged.' })]} describe={describeRow} />);
        const note = screen.getByText('Kept unchanged.');
        expect(note.tagName).toBe('P');
        expect(note).toHaveClass('text-ink-muted');

        rerender(<BatchRows rows={[row({ id: 'row-2' })]} describe={describeRow} />);
        expect(screen.queryByText('Kept unchanged.')).toBeNull();
    });

    it('renders the error sentence when describe() returns one', () => {
        render(<BatchRows rows={[row({ status: 'unsupported', error: 'Not a JPEG, PNG or WebP.' })]} describe={describeRow} />);
        expect(screen.getByText('Not a JPEG, PNG or WebP.')).toBeInTheDocument();
    });

    it('offers a download button named after describe().download, wired to onDownload(row.id)', async () => {
        const user = userEvent.setup();
        const onDownload = vi.fn();
        render(<BatchRows rows={[row({ id: 'row-9', filename: 'holiday-converted.webp' })]} describe={describeRow} onDownload={onDownload} />);

        const button = screen.getByRole('button', { name: 'Download holiday-converted.webp' });
        await user.click(button);

        expect(onDownload).toHaveBeenCalledWith('row-9');
    });

    it('bounds the download button to its row and truncates a long filename inside it, keeping the full name as the accessible name', () => {
        const longName = 'IMG_20260910_073951_HDR_PORTRAIT_ORIGINAL_EDITED-converted.webp';
        render(<BatchRows rows={[row({ filename: longName })]} describe={describeRow} />);

        const button = screen.getByRole('button', { name: `Download ${longName}` });
        expect(button).toHaveClass('min-w-0', 'max-w-full', 'min-h-11');
        expect(button).toHaveAttribute('title', `Download ${longName}`);

        const label = within(button).getByText(`Download ${longName}`);
        expect(label.tagName).toBe('SPAN');
        expect(label).toHaveClass('truncate', 'min-w-0');
    });

    it('renders no download button when describe().download is null', () => {
        render(<BatchRows rows={[row({ status: 'unsupported', error: 'Nope.' })]} describe={describeRow} />);
        expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
    });

    it('renders one row per entry, in list order, each described independently', () => {
        render(<BatchRows
            rows={[
                row({ id: 'a', name: 'a.jpg' }),
                row({ id: 'b', name: 'b.txt', status: 'unsupported', error: 'Not a JPEG, PNG or WebP.' }),
                row({ id: 'c', name: 'c.jpg' }),
            ]}
            describe={describeRow}
        />);

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items.map((item) => item.dataset.name)).toEqual(['a.jpg', 'b.txt', 'c.jpg']);
    });
});
