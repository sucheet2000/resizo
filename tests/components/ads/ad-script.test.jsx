/**
 * AdScript
 *
 * Google forbids the ad tag on the privacy-policy URL registered in Privacy &
 * messaging (and /terms rides along), so the loader that used to sit in the
 * root layout — and therefore ran on every route — must render nothing there.
 * That is the assertion that keeps the policy contradiction from coming back.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AdScript, { isAdFreePath } from '@/components/ads/AdScript';

const pathname = { current: '/resize' };

vi.mock('next/navigation', () => ({
    usePathname: () => pathname.current,
}));

vi.mock('next/script', () => ({
    default: ({ src }) => <div data-testid="adsense-loader" data-src={src} />,
}));

describe('isAdFreePath', () => {
    it.each([
        '/privacy',
        '/privacy/',
        '/privacy/cookies',
        '/terms',
        '/terms/anything',
    ])('treats the legal path %s as ad-free', (path) => {
        expect(isAdFreePath(path)).toBe(true);
    });

    it.each([
        '/',
        '/resize',
        '/compress',
        '/privacy-explained',
        '/termsly',
        null,
        undefined,
    ])('leaves %s monetisable', (path) => {
        expect(isAdFreePath(path)).toBe(false);
    });
});

describe('AdScript', () => {
    it('loads the AdSense tag on a monetising route', () => {
        pathname.current = '/resize';
        const { getByTestId } = render(<AdScript />);
        const loader = getByTestId('adsense-loader');

        expect(loader).toBeInTheDocument();
        expect(loader.getAttribute('data-src')).toContain('adsbygoogle.js');
        expect(loader.getAttribute('data-src')).toContain('ca-pub-6415707599096942');
    });

    it.each(['/privacy', '/terms'])('renders nothing on %s, where Google forbids the ad tag', (route) => {
        pathname.current = route;
        const { container } = render(<AdScript />);

        expect(container).toBeEmptyDOMElement();
    });
});
