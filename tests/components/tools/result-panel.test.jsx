/**
 * ResultPanel
 *
 * The payoff moment. DESIGN.md is specific about what has to be on screen:
 * the real before/after bytes, one oversized reduction numeral, and — for a
 * batch — per-file rows plus a total line. A bare download button is the
 * failure mode this component exists to prevent.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ResultPanel from '@/components/tools/ResultPanel';
import { formatFileSize } from '@/lib/format-bytes';

const SINGLE = {
    originalBytes: 2_411_724,
    resultBytes: 313_524,
    width: 1080,
    height: 810,
    filename: 'holiday-in-lisbon-1080x810.webp',
};

const ROWS = [
    { id: 'a', name: 'one.jpg', originalBytes: 2_000_000, resultBytes: 400_000 },
    { id: 'b', name: 'two.jpg', originalBytes: 1_000_000, resultBytes: 300_000 },
];

describe('ResultPanel single result', () => {
    it('prints the real before and after bytes through the one formatter', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} />);

        expect(screen.getByText(formatFileSize(SINGLE.originalBytes))).toBeInTheDocument();
        expect(screen.getByText(formatFileSize(SINGLE.resultBytes))).toBeInTheDocument();
        expect(screen.getByText('Before')).toBeInTheDocument();
        expect(screen.getByText('After')).toBeInTheDocument();
    });

    it('prints the reduction as one numeral with a real minus sign', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} />);

        // 2,411,724 -> 313,524 is 87% off.
        expect(screen.getByText(/−87%/)).toBeInTheDocument();
    });

    it('spells the numeral out for a screen reader', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} />);
        expect(screen.getByText(/smaller than the original/)).toBeInTheDocument();
    });

    it('shows growth honestly rather than hiding it', () => {
        render(<ResultPanel originalBytes={100_000} resultBytes={104_000} onDownload={vi.fn()} />);

        expect(screen.getByText(/\+4%/)).toBeInTheDocument();
        expect(screen.getByText(/larger than the original/)).toBeInTheDocument();
    });

    it('says so when nothing changed', () => {
        render(<ResultPanel originalBytes={100_000} resultBytes={100_000} onDownload={vi.fn()} />);

        expect(screen.getByText(/0%/)).toBeInTheDocument();
        expect(screen.getByText(/the same size as the original/)).toBeInTheDocument();
    });

    it('prints the output dimensions in mono', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} />);
        expect(screen.getByText('1080×810')).toBeInTheDocument();
    });

    it('omits the dimensions row when the tool does not report them', () => {
        render(<ResultPanel originalBytes={100} resultBytes={50} onDownload={vi.fn()} />);
        expect(screen.queryByText('Size')).toBeNull();
    });

    it('omits the numeral when there is no measurable before', () => {
        render(<ResultPanel originalBytes={null} resultBytes={50} onDownload={vi.fn()} />);

        expect(screen.queryByText(/%$/)).toBeNull();
        expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument();
    });

    it('shows the processed image big, on the checkerboard', () => {
        const { container } = render(
            <ResultPanel {...SINGLE} previewUrl="blob:http://localhost:3000/out" alt="Resized photograph" onDownload={vi.fn()} />,
        );

        expect(screen.getByAltText('Resized photograph')).toHaveAttribute('src', 'blob:http://localhost:3000/out');
        expect(container.querySelector('.checkerboard')).not.toBeNull();
    });
});

describe('ResultPanel download control', () => {
    it('defaults to a single-file label and fires the handler', async () => {
        const user = userEvent.setup();
        const onDownload = vi.fn();
        render(<ResultPanel {...SINGLE} onDownload={onDownload} />);

        const cta = screen.getByRole('button', { name: /Download$/ });
        await user.click(cta);

        expect(onDownload).toHaveBeenCalledTimes(1);
    });

    it('takes an explicit label', () => {
        render(<ResultPanel {...SINGLE} downloadLabel="Download JPG" onDownload={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Download JPG/ })).toBeInTheDocument();
    });

    it('offers a reset only when the caller can handle one', async () => {
        const user = userEvent.setup();
        const onReset = vi.fn();
        const { rerender } = render(<ResultPanel {...SINGLE} onDownload={vi.fn()} />);

        expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();

        rerender(<ResultPanel {...SINGLE} onDownload={vi.fn()} onReset={onReset} />);
        await user.click(screen.getByRole('button', { name: 'Start over' }));

        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('takes a custom reset label', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} onReset={vi.fn()} resetLabel="Resize another" />);
        expect(screen.getByRole('button', { name: 'Resize another' })).toBeInTheDocument();
    });

    it('renders a footnote when one is given', () => {
        render(<ResultPanel {...SINGLE} onDownload={vi.fn()} footnote="Written on your device." />);
        expect(screen.getByText('Written on your device.')).toBeInTheDocument();
    });
});

describe('ResultPanel batch result', () => {
    it('renders one row per file with its own transition and percentage', () => {
        render(<ResultPanel variant="batch" rows={ROWS} onDownload={vi.fn()} />);
        const rows = screen.getAllByRole('listitem');

        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('one.jpg')).toBeInTheDocument();
        expect(rows[0]).toHaveTextContent(formatFileSize(2_000_000));
        expect(rows[0]).toHaveTextContent(formatFileSize(400_000));
        expect(rows[0]).toHaveTextContent('−80%');
        expect(rows[1]).toHaveTextContent('−70%');
    });

    it('reads the arrow out as "to" rather than as a glyph', () => {
        render(<ResultPanel variant="batch" rows={ROWS} onDownload={vi.fn()} />);
        const rows = screen.getAllByRole('listitem');

        expect(within(rows[0]).getByText('→', { exact: false })).toHaveAttribute('aria-hidden', 'true');
        expect(rows[0].textContent).toContain(' to ');
    });

    it('sets the total line large, in real bytes and a real percentage', () => {
        render(<ResultPanel variant="batch" rows={ROWS} onDownload={vi.fn()} />);

        // 3 MB in, 700 KB out.
        expect(screen.getByText(/You saved/)).toHaveTextContent(formatFileSize(2_300_000));
        expect(screen.getByText(/You saved/)).toHaveTextContent('77%');
        expect(screen.getByText(/2 files/)).toBeInTheDocument();
    });

    it('says "file" for a batch that ended up with one measurable row', () => {
        render(<ResultPanel variant="batch" rows={[ROWS[0]]} onDownload={vi.fn()} />);
        expect(screen.getByText(/1 file /)).toBeInTheDocument();
    });

    it('defaults to the ZIP download label', () => {
        render(<ResultPanel variant="batch" rows={ROWS} onDownload={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Download all as ZIP/ })).toBeInTheDocument();
    });

    it('prints an em dash for a row whose reduction cannot be measured', () => {
        render(
            <ResultPanel
                variant="batch"
                rows={[{ id: 'a', name: 'one.jpg', originalBytes: null, resultBytes: 400_000 }]}
                onDownload={vi.fn()}
            />,
        );

        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders nothing for an empty batch', () => {
        const { container } = render(<ResultPanel variant="batch" rows={[]} onDownload={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('drops the total block when no row is measurable', () => {
        render(
            <ResultPanel
                variant="batch"
                rows={[{ id: 'a', name: 'one.jpg', originalBytes: 0, resultBytes: 0 }]}
                onDownload={vi.fn()}
            />,
        );

        expect(screen.queryByText(/You saved/)).toBeNull();
    });
});
