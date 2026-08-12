/**
 * Alert
 *
 * DESIGN.md: errors are inline in the panel, never toasts, and carry an
 * sr-only "Error: " prefix. An empty Alert must render nothing at all — an
 * empty bordered box is worse than no box.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Alert from '@/components/ui/Alert';

describe('Alert error tone', () => {
    it('is announced assertively as an alert', () => {
        render(<Alert>That file is not a JPEG, PNG, WebP image.</Alert>);
        expect(screen.getByRole('alert')).toHaveTextContent('That file is not a JPEG, PNG, WebP image.');
    });

    it('carries the sr-only "Error: " prefix', () => {
        render(<Alert>Pick a smaller file.</Alert>);
        const prefix = within(screen.getByRole('alert')).getByText('Error:', { exact: false, selector: 'span' });

        expect(prefix).toHaveClass('sr-only');
    });

    it('hides the decorative glyph from assistive technology', () => {
        const { container } = render(<Alert>Pick a smaller file.</Alert>);
        expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('!');
    });
});

describe('Alert info tone', () => {
    it('is announced politely as a status', () => {
        render(<Alert tone="info">Account created. Check your inbox.</Alert>);
        expect(screen.getByRole('status')).toHaveTextContent('Account created. Check your inbox.');
    });

    it('does not claim to be an error', () => {
        render(<Alert tone="info">Account created.</Alert>);
        expect(screen.getByRole('status').textContent).not.toContain('Error:');
    });
});

describe('Alert emptiness', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['false', false],
        ['an empty string', ''],
    ])('renders nothing for %s', (_label, children) => {
        const { container } = render(<Alert>{children}</Alert>);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('Alert overrides', () => {
    it('takes an explicit role', () => {
        render(<Alert role="status">Working…</Alert>);
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('takes an id so a control can point aria-describedby at it', () => {
        render(<Alert id="compress-error">Too large.</Alert>);
        expect(screen.getByRole('alert')).toHaveAttribute('id', 'compress-error');
    });
});
