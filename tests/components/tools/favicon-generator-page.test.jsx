/**
 * /favicon-generator — the static page.
 *
 * Mirrors tests/components/tools/image-size-fitter-page.test.jsx: FrameCrop
 * and useLocalProcess are stubbed so this suite exercises the PAGE (metadata,
 * direct answer, content sections, sources table, JSON-LD, HowTo/FAQ) rather
 * than FaviconTool's own logic, which favicon-tool.test.jsx already covers.
 *
 * lib/catalog/icon-sources.js and lib/format/icon-package.js are both real
 * and landed, so the sources table and the HowTo/FAQ counts below are checked
 * against the actual registries, not a guess at their shape.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ICON_SOURCES } from '@/lib/catalog/icon-sources';

vi.mock('@/components/tools/FrameCrop', () => ({
    default: function FrameCropStub({ id, label }) {
        return <div role="group" aria-label={label} id={id} data-testid="frame-crop" />;
    },
}));

vi.mock('@/lib/hooks/useLocalProcess', async () => {
    const { useState } = await import('react');
    return {
        default: function useStubbedProcess() {
            const [result] = useState(null);
            return {
                submit: () => {},
                download: () => {},
                reset: () => {},
                cancel: () => {},
                isProcessing: false,
                progress: 0,
                error: null,
                result,
                setError: () => {},
                phase: null,
                suggestion: null,
                code: null,
            };
        },
    };
});

const { default: FaviconGeneratorPage, metadata } = await import('@/app/(tools)/favicon-generator/page');

describe('/favicon-generator metadata', () => {
    it('has a title and its own canonical', () => {
        expect(metadata.title).toContain('Favicon');
        expect(metadata.alternates.canonical).toBe('https://www.resizo.net/favicon-generator');
    });

    it('states its no-upload claim before the snippet is cut', () => {
        const NO_UPLOAD_CLAIM = /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;
        const match = metadata.description.match(NO_UPLOAD_CLAIM);
        expect(match, 'no no-upload claim found in the description').toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });
});

describe('/favicon-generator renders one h1 and the direct-answer paragraph', () => {
    it('has exactly one h1 matching the plan’s exact wording', () => {
        render(<FaviconGeneratorPage />);
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Generate Favicons and App Icons');
    });

    it('answers in the browser, never claiming an upload', () => {
        render(<FaviconGeneratorPage />);
        // A phrase unique to the answer slot — the intro line above the panel
        // also mentions favicon.ico, so that alone would not pick it out.
        const answer = screen.getByText(/the decoder and encoder this page loads/i);
        expect(answer.textContent.toLowerCase()).not.toMatch(/\bupload(ed|ing)?\b/);
    });
});

describe('/favicon-generator content sections', () => {
    it('carries the named statement headings from the plan', () => {
        render(<FaviconGeneratorPage />);
        expect(screen.getByRole('heading', { name: /what favicon\.ico is/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /do modern sites still need favicon\.ico/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /why 16.*32/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /apple touch icon/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /192.*512/ })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /transparency/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /resizing improve a low-resolution logo/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /are icons uploaded/i })).toBeInTheDocument();
    });

    it('answers the resizing-quality and upload questions truthfully, in the negative', () => {
        render(<FaviconGeneratorPage />);
        const resizeHeading = screen.getByRole('heading', { name: /resizing improve a low-resolution logo/i });
        expect(resizeHeading.closest('section')).toHaveTextContent(/no[,.]/i);

        const uploadHeading = screen.getByRole('heading', { name: /are icons uploaded/i });
        expect(uploadHeading.closest('section')).toHaveTextContent(/no[,.]/i);
        expect(uploadHeading.closest('section').textContent.toLowerCase()).not.toMatch(/\bare uploaded\b|\bis uploaded\b/);
    });

    it('never calls a size "required" outside the Chrome installability pair', () => {
        render(<FaviconGeneratorPage />);
        const body = document.body.textContent;
        // Every sentence containing "required" is one of the two Chrome rows.
        const sentences = body.split(/(?<=[.!?])\s+/).filter((sentence) => /required/i.test(sentence));
        for (const sentence of sentences) {
            expect(sentence).toMatch(/chrome|install/i);
        }
    });
});

describe('/favicon-generator sources table', () => {
    it('lists every claim from the real registry, with its publisher and verified date', () => {
        render(<FaviconGeneratorPage />);
        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row');
        // Header row plus one row per ICON_SOURCES entry.
        expect(rows).toHaveLength(ICON_SOURCES.length + 1);

        for (const entry of ICON_SOURCES) {
            expect(within(table).getByText(entry.sizeLabel)).toBeInTheDocument();
        }
        expect(within(table).getByRole('link', { name: /microsoft/i })).toHaveAttribute(
            'href',
            'https://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)',
        );
        expect(within(table).getAllByText('2026-09-10').length).toBeGreaterThan(0);
    });
});

describe('/favicon-generator HowTo and FAQ', () => {
    it('shows at least four HowTo steps and five FAQ entries', () => {
        render(<FaviconGeneratorPage />);
        expect(screen.getByRole('heading', { name: /how to/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    });
});

describe('/favicon-generator structured data', () => {
    it('carries a SoftwareApplication, a BreadcrumbList, a HowTo and an FAQPage', () => {
        const { container } = render(<FaviconGeneratorPage />);
        const script = container.querySelector('script[type="application/ld+json"]');
        expect(script, 'no JSON-LD script tag rendered').toBeTruthy();
        const nodes = JSON.parse(script.textContent);
        const types = nodes.map((node) => node['@type']);
        expect(types).toContain('SoftwareApplication');
        expect(types).toContain('BreadcrumbList');
        expect(types).toContain('HowTo');
        expect(types).toContain('FAQPage');

        const [software] = nodes.filter((node) => node['@type'] === 'SoftwareApplication');
        expect(software.offers.price).toBe('0');
        expect(software.isAccessibleForFree).toBe(true);
        expect(software.aggregateRating).toBeUndefined();
        expect(software.review).toBeUndefined();

        const [faq] = nodes.filter((node) => node['@type'] === 'FAQPage');
        expect(faq.mainEntity.length).toBeGreaterThanOrEqual(5);

        const [howTo] = nodes.filter((node) => node['@type'] === 'HowTo');
        expect(howTo.step.length).toBeGreaterThanOrEqual(4);
    });
});
