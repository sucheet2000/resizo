/**
 * Logo, Spinner, FilePreviewCard
 *
 * The small primitives. Each one has exactly one rule that matters:
 * decorative graphics stay out of the accessibility tree, and the file card
 * sets its numbers through the one byte formatter.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import FilePreviewCard from '@/components/ui/FilePreviewCard';
import Logo from '@/components/ui/Logo';
import Spinner from '@/components/ui/Spinner';
import { formatFileSize } from '@/lib/format/bytes';

describe('Logo', () => {
    it('shows the wordmark as text and hides the graphic', () => {
        const { container } = render(<Logo />);

        expect(screen.getByText('Resizo')).toBeInTheDocument();
        expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('can render the mark alone', () => {
        render(<Logo withWordmark={false} />);
        expect(screen.queryByText('Resizo')).toBeNull();
    });
});

describe('Spinner', () => {
    it('is always hidden from assistive technology', () => {
        const { container } = render(<Spinner />);
        const svg = container.querySelector('svg');

        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('focusable', 'false');
    });
});

describe('FilePreviewCard', () => {
    const base = {
        name: 'holiday-in-lisbon.jpg',
        size: 2_411_724,
        format: 'jpeg',
        width: 4032,
        height: 3024,
    };

    it('sets dimensions, bytes and format through the one formatter', () => {
        render(<FilePreviewCard {...base} />);

        expect(screen.getByText(`4032×3024 · ${formatFileSize(base.size)} · JPEG`)).toBeInTheDocument();
    });

    it('omits facts it does not have', () => {
        render(<FilePreviewCard name="unknown.bin" />);
        expect(screen.getByText('unknown.bin')).toBeInTheDocument();
    });

    it('names the remove control after the file it removes', async () => {
        const user = userEvent.setup();
        const onRemove = vi.fn();
        render(<FilePreviewCard {...base} onRemove={onRemove} />);

        await user.click(screen.getByRole('button', { name: `Remove file: ${base.name}` }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('labels the include checkbox with the file name', async () => {
        const user = userEvent.setup();
        const onToggleSelected = vi.fn();
        render(<FilePreviewCard {...base} selected onToggleSelected={onToggleSelected} />);

        const checkbox = screen.getByRole('checkbox', { name: `Include ${base.name}` });
        expect(checkbox).toBeChecked();

        await user.click(checkbox);
        expect(onToggleSelected).toHaveBeenCalledWith(false);
    });

    it('leaves the thumbnail alt empty — the file name is already text', () => {
        const { container } = render(<FilePreviewCard {...base} previewUrl="blob:http://localhost:3000/x" />);
        const image = container.querySelector('img');

        expect(image).toHaveAttribute('alt', '');
        expect(image).toHaveAttribute('src', 'blob:http://localhost:3000/x');
    });

    it('falls back to the format token when no preview can be decoded', () => {
        const { container } = render(<FilePreviewCard name="IMG_0421.HEIC" format="heic" />);

        expect(container.querySelector('img')).toBeNull();
        // The thumbnail well shows the format token, and the facts line repeats
        // it — the placeholder is decorative and marked as such.
        expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('HEIC');
        expect(screen.getAllByText('HEIC')).toHaveLength(2);
    });
});
