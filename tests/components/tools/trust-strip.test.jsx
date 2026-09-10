/**
 * The trust strip states four facts that are true of every core tool, in the
 * words the design contract requires, and links the page that explains them.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TrustStrip, { TRUST_FACTS } from '@/components/tools/TrustStrip';

describe('TrustStrip', () => {
    it('states the four facts, each once, as a named list', () => {
        render(<TrustStrip />);
        const list = screen.getByRole('list', { name: 'What Resizo promises' });
        expect(list.querySelectorAll('li')).toHaveLength(4);
        for (const fact of TRUST_FACTS) expect(list).toHaveTextContent(fact.label);
        expect(list.textContent).toMatch(/on your device/i);
        expect(list.textContent).toMatch(/no image upload/i);
    });

    it('claims only what the architecture proves', () => {
        render(<TrustStrip detail />);
        const text = document.body.textContent;
        for (const claim of [/cannot be breached/i, /no security risk/i, /no copy anywhere/i, /unlimited/i, /never charge/i]) {
            expect(text).not.toMatch(claim);
        }
    });

    it('links the explanation, and can be rendered without the link', () => {
        const { unmount } = render(<TrustStrip />);
        expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/about');
        unmount();
        render(<TrustStrip link={false} />);
        expect(screen.queryByRole('link', { name: 'How it works' })).toBeNull();
    });
});
