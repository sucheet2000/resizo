/**
 * ConsentSettingsLink
 *
 * Google's Privacy & messaging program requires a footer link that lets a user
 * revoke ad-cookie consent and re-opens the consent message. The link must:
 *  - carry Google's documented label, which /privacy already points users to;
 *  - re-open whichever CMP is on the page (Google's googlefc, or a generic IAB
 *    TCF __tcfapi);
 *  - fall back to the cookies section of the privacy policy where no CMP exists
 *    (e.g. /privacy and /terms, where the ad tag is excluded).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConsentSettingsLink from '@/components/legal/ConsentSettingsLink';

vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

afterEach(() => {
    delete window.__tcfapi;
    delete window.googlefc;
});

describe('ConsentSettingsLink', () => {
    it('carries the documented label and points at the cookies section', () => {
        render(<ConsentSettingsLink />);
        const link = screen.getByRole('link', { name: 'Privacy and cookie settings' });

        expect(link).toHaveAttribute('href', '/privacy#cookies');
    });

    it('re-opens the IAB TCF consent dialog when __tcfapi is present', async () => {
        const user = userEvent.setup();
        const tcfapi = vi.fn();
        window.__tcfapi = tcfapi;

        render(<ConsentSettingsLink />);
        await user.click(screen.getByRole('link', { name: 'Privacy and cookie settings' }));

        expect(tcfapi).toHaveBeenCalledWith('displayConsentUi', 2, expect.any(Function));
    });

    it('prefers the Google CMP revocation entry when googlefc is present', async () => {
        const user = userEvent.setup();
        const show = vi.fn();
        window.__tcfapi = vi.fn();
        window.googlefc = { showRevocationMessage: show };

        render(<ConsentSettingsLink />);
        await user.click(screen.getByRole('link', { name: 'Privacy and cookie settings' }));

        expect(show).toHaveBeenCalledTimes(1);
        expect(window.__tcfapi).not.toHaveBeenCalled();
    });
});
