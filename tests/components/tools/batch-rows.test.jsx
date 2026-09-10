/**
 * BatchRows — one row per file in a bulk-compress run.
 *
 * Rows come from two sources that never touch the engine the same way: rows
 * the engine actually processed (STATUS.success, unmet, unsafe, cancelled),
 * and rows the tool rejected before the engine ever saw the file (unsupported
 * or unsafe by simple size, carrying only {id, name, status, error}). This
 * suite proves both render in the one list, that every [data-field] cell
 * appears only when the row actually carries that data, and that the numbers
 * are formatted the way the rest of the site formats them (real minus sign,
 * '×' between dimensions, an arrow only when the picture was actually resized).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BatchRows from '@/app/(tools)/bulk-image-compressor/BatchRows';
import { STATUS } from '@/lib/upload/compress-batch';

function row(overrides = {}) {
    return {
        id: 'row-1',
        name: 'photo.jpg',
        folder: null,
        status: STATUS.success,
        originalBytes: 500 * 1024,
        resultBytes: 190 * 1024,
        width: 1600,
        height: 1067,
        sourceWidth: 1600,
        sourceHeight: 1067,
        format: 'jpeg',
        targetBytes: 200 * 1024,
        mode: 'preserve',
        filename: 'photo-compressed.jpg',
        error: null,
        resized: false,
        ...overrides,
    };
}

describe('BatchRows', () => {
    it('renders nothing for an empty list', () => {
        const { container } = render(<BatchRows rows={[]} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders the list with the required accessible name', () => {
        render(<BatchRows rows={[row()]} />);
        expect(screen.getByRole('list', { name: 'Results' })).toBeInTheDocument();
    });

    it('marks each row with its status and name as data attributes', () => {
        render(<BatchRows rows={[row({ id: 'a', name: 'one.jpg' })]} />);
        const item = screen.getByRole('listitem');
        expect(item).toHaveAttribute('data-status', STATUS.success);
        expect(item).toHaveAttribute('data-name', 'one.jpg');
    });

    it('truncates the filename visually but keeps the full name in a title attribute', () => {
        render(<BatchRows rows={[row({ name: 'a-very-long-original-filename-from-a-camera.jpg' })]} />);
        expect(screen.getByText('a-very-long-original-filename-from-a-camera.jpg'))
            .toHaveAttribute('title', 'a-very-long-original-filename-from-a-camera.jpg');
    });

    describe('a settled success row', () => {
        it('shows original, result, target (met), dimensions and reduction', () => {
            render(<BatchRows rows={[row()]} />);

            expect(screen.getByText('Success').closest('[data-field="status"]')).toBeInTheDocument();
            expect(document.querySelector('[data-field="original"]')).toHaveTextContent('500 KB');
            expect(document.querySelector('[data-field="result"]')).toHaveTextContent('190 KB');
            expect(document.querySelector('[data-field="target"]')).toHaveTextContent('≤ 200 KB ✓');
            expect(document.querySelector('[data-field="dimensions"]')).toHaveTextContent('1600 × 1067');
            expect(document.querySelector('[data-field="reduction"]')).toHaveTextContent('−62%');
        });

        it('shows the resize arrow only when the row was actually resized', () => {
            render(<BatchRows rows={[row({
                resized: true, width: 1280, height: 853, resultBytes: 190 * 1024,
            })]}
            />);

            expect(document.querySelector('[data-field="dimensions"]')).toHaveTextContent('1600 × 1067 → 1280 × 853');
        });

        it('offers a download button named after the OUTPUT filename', async () => {
            const user = userEvent.setup();
            const onDownload = vi.fn();
            render(<BatchRows rows={[row({ id: 'row-9', filename: 'holiday-compressed.jpg' })]} onDownload={onDownload} />);

            const button = screen.getByRole('button', { name: 'Download holiday-compressed.jpg' });
            await user.click(button);

            expect(onDownload).toHaveBeenCalledWith('row-9');
        });
    });

    describe('a settled unmet row', () => {
        it('shows the ✗ target, no download button, and the failure sentence', () => {
            const unmet = row({
                status: STATUS.unmet,
                resultBytes: 210 * 1024,
                filename: null,
                error: 'Resizo couldn’t reduce photo.jpg below 200 KB without changing its dimensions.',
            });
            render(<BatchRows rows={[unmet]} />);

            expect(document.querySelector('[data-field="target"]')).toHaveTextContent('≤ 200 KB ✗');
            expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
            expect(screen.getByText(
                'Resizo couldn’t reduce photo.jpg below 200 KB without changing its dimensions.',
            )).toBeInTheDocument();
        });
    });

    describe('a row still in flight', () => {
        it('shows no target verdict yet, but does show the size already known', () => {
            const waiting = row({
                status: STATUS.waiting,
                resultBytes: null,
                width: null,
                height: null,
                filename: null,
            });
            render(<BatchRows rows={[waiting]} />);

            expect(screen.getByText('Waiting')).toBeInTheDocument();
            expect(document.querySelector('[data-field="original"]')).toHaveTextContent('500 KB');
            expect(document.querySelector('[data-field="target"]')).toBeNull();
            expect(document.querySelector('[data-field="result"]')).toBeNull();
        });
    });

    describe('a row the tool rejected before the engine ever saw it', () => {
        it('renders name, status and reason only — no byte, target or dimension cells', () => {
            const rejected = {
                id: 'rejected-1',
                name: 'notes.txt',
                status: STATUS.unsupported,
                error: 'Not a JPEG, PNG or WebP.',
            };
            render(<BatchRows rows={[rejected]} />);

            const item = screen.getByRole('listitem');
            expect(item).toHaveAttribute('data-status', 'unsupported');
            expect(screen.getByText('Unsupported')).toBeInTheDocument();
            expect(screen.getByText('Not a JPEG, PNG or WebP.')).toBeInTheDocument();
            expect(document.querySelector('[data-field="original"]')).toBeNull();
            expect(document.querySelector('[data-field="target"]')).toBeNull();
            expect(document.querySelector('[data-field="dimensions"]')).toBeNull();
            expect(document.querySelector('[data-field="reduction"]')).toBeNull();
            expect(screen.queryByRole('button', { name: /download/i })).toBeNull();
        });

        it('renders a too-large rejection with the "Too large for this device" label', () => {
            render(<BatchRows rows={[{
                id: 'rejected-2',
                name: 'huge.jpg',
                status: STATUS.unsafe,
                error: 'That file is 25 MB. The limit is 20 MB — compress it first, or pick a smaller one.',
            }]}
            />);

            expect(screen.getByText('Too large for this device')).toBeInTheDocument();
        });
    });

    it('renders one row per entry, engine rows and rejected rows together, in list order', () => {
        render(<BatchRows rows={[
            row({ id: 'a', name: 'a.jpg' }),
            { id: 'b', name: 'b.txt', status: STATUS.unsupported, error: 'Not a JPEG, PNG or WebP.' },
            row({ id: 'c', name: 'c.jpg', status: STATUS.cancelled, error: 'Cancelled.', resultBytes: null }),
        ]}
        />);

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(items.map((item) => item.dataset.name)).toEqual(['a.jpg', 'b.txt', 'c.jpg']);
    });
});
