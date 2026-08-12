/**
 * Breadcrumb + JsonLd
 *
 * These two describe each other: the visible trail and the BreadcrumbList
 * markup have to come from one array, because markup describing a trail the
 * page does not show is a manual-action risk. So the test renders both from
 * the same input and compares them item by item.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Breadcrumb from '@/components/seo/Breadcrumb';
import JsonLd from '@/components/seo/JsonLd';
import { breadcrumbList } from '@/lib/schema';
import { routeExists } from '../helpers.jsx';

const TRAIL = [
    { name: 'Home', path: '/' },
    { name: 'Compress Image', path: '/compress' },
    { name: 'Compress to 100 KB', path: '/compress-image-to-100kb' },
];

function ldFrom(container, index = 0) {
    const scripts = container.querySelectorAll('script[type="application/ld+json"]');
    return JSON.parse(scripts[index].textContent);
}

describe('Breadcrumb', () => {
    it('is a labelled navigation landmark', () => {
        render(<Breadcrumb items={TRAIL} />);
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    });

    it('renders one item per entry, in order', () => {
        render(<Breadcrumb items={TRAIL} />);
        const items = screen.getAllByRole('listitem');

        expect(items.map((item) => item.textContent.replace('/', '').trim()))
            .toEqual(['Home', 'Compress Image', 'Compress to 100 KB']);
    });

    it('links every step except the page you are on', () => {
        render(<Breadcrumb items={TRAIL} />);

        expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
        expect(screen.getByRole('link', { name: 'Compress Image' })).toHaveAttribute('href', '/compress');
        expect(screen.queryByRole('link', { name: 'Compress to 100 KB' })).toBeNull();
    });

    it('marks the last step as the current page', () => {
        render(<Breadcrumb items={TRAIL} />);
        expect(screen.getByText('Compress to 100 KB')).toHaveAttribute('aria-current', 'page');
    });

    it('emits no dead href', () => {
        render(<Breadcrumb items={TRAIL} />);

        for (const link of screen.getAllByRole('link')) {
            expect(routeExists(link.getAttribute('href')), `${link.getAttribute('href')} has no page.js`).toBe(true);
        }
    });

    it('accepts href as well as path', () => {
        render(<Breadcrumb items={[{ name: 'Home', href: '/' }, { name: 'Crop' }]} />);
        expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    });

    it('renders plain text for a step with no route', () => {
        render(<Breadcrumb items={[{ name: 'Home' }, { name: 'Crop' }]} />);
        expect(screen.queryAllByRole('link')).toHaveLength(0);
    });

    it('hides the separators from a screen reader', () => {
        const { container } = render(<Breadcrumb items={TRAIL} />);
        const separators = container.querySelectorAll('[aria-hidden="true"]');

        expect(separators).toHaveLength(2);
        expect(separators[0]).toHaveTextContent('/');
    });

    it.each([
        ['no items', undefined],
        ['an empty array', []],
        ['items with no name', [{ path: '/x' }]],
    ])('renders nothing for %s', (_label, items) => {
        const { container } = render(<Breadcrumb items={items} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('Breadcrumb matches the BreadcrumbList builder', () => {
    it('shows exactly the steps the markup claims, in the same order', () => {
        const { container } = render(
            <>
                <Breadcrumb items={TRAIL} />
                <JsonLd data={breadcrumbList(TRAIL)} />
            </>,
        );

        const markup = ldFrom(container);
        const visible = screen.getAllByRole('listitem').map((item) => item.textContent.replace('/', '').trim());

        expect(markup['@type']).toBe('BreadcrumbList');
        expect(markup.itemListElement.map((entry) => entry.name)).toEqual(visible);
        expect(markup.itemListElement.map((entry) => entry.position)).toEqual([1, 2, 3]);
    });

    it('drops the same nameless step from both halves', () => {
        const items = [{ name: 'Home', path: '/' }, { path: '/nowhere' }, { name: 'Crop Image', path: '/crop' }];
        const { container } = render(
            <>
                <Breadcrumb items={items} />
                <JsonLd data={breadcrumbList(items)} />
            </>,
        );

        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(ldFrom(container).itemListElement.map((entry) => entry.position)).toEqual([1, 2]);
    });
});

describe('JsonLd', () => {
    it('emits valid JSON that round-trips to the object it was given', () => {
        const data = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Resizo' };
        const { container } = render(<JsonLd data={data} />);

        expect(ldFrom(container)).toEqual(data);
    });

    it('emits an array as one block', () => {
        const nodes = [{ '@type': 'WebSite' }, { '@type': 'Organization' }];
        const { container } = render(<JsonLd data={nodes} />);

        expect(container.querySelectorAll('script')).toHaveLength(1);
        expect(ldFrom(container)).toEqual(nodes);
    });

    it('unwraps a single-element array', () => {
        const { container } = render(<JsonLd data={[{ '@type': 'WebSite' }]} />);
        expect(ldFrom(container)).toEqual({ '@type': 'WebSite' });
    });

    it('drops nullish entries', () => {
        const { container } = render(<JsonLd data={[null, { '@type': 'WebSite' }, undefined]} />);
        expect(ldFrom(container)).toEqual({ '@type': 'WebSite' });
    });

    it('escapes a closing script tag inside a review body', () => {
        const data = { '@type': 'Review', reviewBody: 'Nice </script><img src=x onerror=alert(1)>' };
        const { container } = render(<JsonLd data={data} />);
        const script = container.querySelector('script');

        expect(script.textContent).not.toContain('</script>');
        expect(container.querySelector('img')).toBeNull();
        expect(JSON.parse(script.textContent)).toEqual(data);
    });

    it('escapes the two raw line terminators JSON.stringify leaves behind', () => {
        // Built from escapes so no raw line separator sits in this file either.
        const data = { '@type': 'Review', reviewBody: `a\u2028b\u2029c` };
        const { container } = render(<JsonLd data={data} />);
        const script = container.querySelector('script');

        expect(script.textContent).not.toMatch(new RegExp('[\\u2028\\u2029]'));
        expect(JSON.parse(script.textContent)).toEqual(data);
    });

    it('takes an id so a page can carry several blocks', () => {
        const { container } = render(<JsonLd id="faq-schema" data={{ '@type': 'FAQPage' }} />);
        expect(container.querySelector('script')).toHaveAttribute('id', 'faq-schema');
    });

    it.each([
        ['null', null],
        ['an empty array', []],
        ['an array of nothing', [null, undefined, false]],
    ])('renders nothing for %s', (_label, data) => {
        const { container } = render(<JsonLd data={data} />);
        expect(container).toBeEmptyDOMElement();
    });
});
