/**
 * The example section is the tool's measured output or nothing. Until the
 * benchmark has run scenario L, MEASURED is null — and an intro that says
 * "The package below" above an empty space is a promise the page cannot keep
 * (the auditor found exactly that). So the whole section is gated, not just
 * the figure. This file mocks the results file to make that state real.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/benchmarks/results/latest.json', () => ({ default: { scenarios: [] } }));

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label }) {
        return <div role="group" aria-label={label} id={id} data-testid="frame-crop" />;
    },
}));

vi.mock('@/lib/hooks/useLocalProcess', () => ({
    default: function useStubbedProcess() {
        return {
            submit: () => {},
            download: () => {},
            reset: () => {},
            cancel: () => {},
            isProcessing: false,
            progress: 0,
            error: null,
            result: null,
            setError: () => {},
            phase: null,
            suggestion: null,
            code: null,
        };
    },
}));

const { default: FaviconGeneratorPage } = await import('@/app/(tools)/favicon-generator/page');

describe('/favicon-generator before scenario L has been measured', () => {
    it('renders no example section at all — no heading, no intro, no figure', () => {
        render(<FaviconGeneratorPage />);
        expect(screen.queryByRole('heading', { name: 'What comes out of the sample logo' })).toBeNull();
        expect(screen.queryByText(/The package below/)).toBeNull();
        expect(document.querySelector('img[src^="/demos/favicon"]')).toBeNull();
    });
});
