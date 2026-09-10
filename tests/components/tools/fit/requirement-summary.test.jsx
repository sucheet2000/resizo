/**
 * RequirementSummary, at its shared home under components/tools/fit/.
 *
 * Moved from app/(tools)/passport-photo/RequirementSummary.js so
 * /image-size-fitter can render the same checklist. Behaviour is unchanged —
 * these assertions are the ones tests/pages/passport.test.jsx already made of
 * the pre-move component, run again against the new import path.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import RequirementSummary from '@/components/tools/fit/RequirementSummary';

const US_PRINT = {
    name: 'US passport photo (printed 2 × 2 in)',
    cannotVerify: ['Eyes open and mouth closed, with no exaggerated expression', 'Head not tilted'],
    source: {
        label: 'U.S. Department of State, Passport Photos',
        url: 'https://travel.state.gov/en/passports/apply/help/photos.html',
        verifiedAt: '2026-09-10',
    },
};

describe('RequirementSummary names its columns for a screen reader', () => {
    it('separates the heading from its count, and labels each cell with the same words the visible header uses', () => {
        render(
            <RequirementSummary
                checks={[{ key: 'dimensions', label: 'Dimensions', required: '600 × 600 px', actual: '600 × 600 px', ok: true }]}
                preset={null}
            />,
        );
        expect(screen.getByText('What was checked')).toBeInTheDocument();
        expect(screen.getByText('1 of 1 met')).toBeInTheDocument();
        expect(screen.getByText('Requested', { selector: '.sr-only' })).toBeInTheDocument();
        expect(screen.getByText('Result', { selector: '.sr-only' })).toBeInTheDocument();
        expect(screen.queryByText('required', { selector: '.sr-only' })).toBeNull();
        expect(screen.queryByText('actual', { selector: '.sr-only' })).toBeNull();
    });

    it('shows a visible Requested / Result / Status header above the rows', () => {
        render(
            <RequirementSummary
                checks={[{ key: 'dimensions', label: 'Dimensions', required: '600 × 600 px', actual: '600 × 600 px', ok: true }]}
                preset={null}
            />,
        );
        expect(screen.getByText('Requested', { selector: ':not(.sr-only)' })).toBeInTheDocument();
        expect(screen.getByText('Result', { selector: ':not(.sr-only)' })).toBeInTheDocument();
        expect(screen.getByText('Status', { selector: ':not(.sr-only)' })).toBeInTheDocument();
    });

    it('leaves the row text nodes unchanged — the required/actual/status values sit as plain text beside the sr-only prefix', () => {
        const { container } = render(
            <RequirementSummary
                checks={[{ key: 'dimensions', label: 'Dimensions', required: '600 × 600 px', actual: '600 × 600 px', ok: true }]}
                preset={null}
            />,
        );
        const dd = container.querySelector('dl > div > dd');
        const spans = [...dd.children];
        expect(spans[0].textContent.replace(/^Requested\s*/, '')).toBe('600 × 600 px');
        expect(spans[1].textContent.replace(/^Result\s*/, '')).toBe('600 × 600 px');
        expect(spans[2].textContent).toBe('Meets');
    });
});

describe('RequirementSummary states its verdict in words, not colour alone', () => {
    it('renders Meets, Fails and Not required as literal text', () => {
        render(
            <RequirementSummary
                checks={[
                    { key: 'dimensions', label: 'Dimensions', required: '600×750 px', actual: '600×750 px', ok: true },
                    { key: 'maxBytes', label: 'Maximum file size', required: '≤ 40 KB', actual: '45 KB', ok: false },
                    { key: 'dpi', label: 'DPI', required: 'Not requested', actual: '—', ok: null },
                ]}
                preset={US_PRINT}
            />,
        );

        expect(screen.getByText('Meets')).toBeInTheDocument();
        expect(screen.getByText('Fails')).toBeInTheDocument();
        expect(screen.getByText('Not required')).toBeInTheDocument();
    });

    it('lists the cannotVerify rules and the source only for a named preset', () => {
        const { rerender } = render(
            <RequirementSummary
                checks={[{ key: 'dimensions', label: 'Dimensions', required: '51×51 mm', actual: '51×51 mm', ok: true }]}
                preset={US_PRINT}
            />,
        );
        expect(screen.getByText('Eyes open and mouth closed, with no exaggerated expression')).toBeInTheDocument();
        expect(screen.getByRole('link')).toHaveAttribute('href', US_PRINT.source.url);

        rerender(
            <RequirementSummary
                checks={[{ key: 'dimensions', label: 'Dimensions', required: '600×600 px', actual: '600×600 px', ok: true }]}
                preset={null}
            />,
        );
        expect(screen.queryByText('Eyes open and mouth closed, with no exaggerated expression')).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('renders nothing for an empty result, rather than an empty shell', () => {
        const { container } = render(<RequirementSummary checks={[]} preset={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});
