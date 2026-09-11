/**
 * /image-metadata-viewer — the static page.
 *
 * Mirrors tests/components/tools/image-size-fitter-page.test.jsx's approach:
 * mock the engine module the tool client needs (a unit test should not
 * exercise byte-level EXIF/GPS/XMP parsing here — the engine's own suites own
 * that), then render the whole page tree and check what a crawler and a
 * visitor would see: the metadata, the one h1, the direct answer, the visible
 * HowTo/FAQ lists and the JSON-LD.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/image-client/metadata-report', () => ({
    inspectImageMetadata: () => ({ ok: false, code: 'invalid', format: null, message: 'stub' }),
}));

const { default: ImageMetadataViewerPage, metadata } = await import('@/app/(tools)/image-metadata-viewer/page');

describe('/image-metadata-viewer metadata', () => {
    it('has the exact H1 the plan asks for, and a canonical for this path', () => {
        expect(metadata.alternates.canonical).toBe('https://www.resizo.net/image-metadata-viewer');

        render(<ImageMetadataViewerPage />);
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('View Image Metadata');
    });

    it('states its no-upload claim before the snippet is cut', () => {
        const NO_UPLOAD_CLAIM = /(?:no|not|never|without|nothing)[^.,;—]{0,40}(?:upload|uploading|leaving|leaves|server|install)|(?:on )?your own (?:device|computer)|in (?:your|this) browser/i;
        const match = metadata.description.match(NO_UPLOAD_CLAIM);
        expect(match, 'no no-upload claim found in the description').toBeTruthy();
        expect(match.index + match[0].length).toBeLessThanOrEqual(155);
    });

    it('has a unique title distinct from the remover and the DPI tool', () => {
        expect(metadata.title).not.toMatch(/Remove Image Metadata/);
        expect(metadata.title.toLowerCase()).toContain('metadata');
    });
});

describe('/image-metadata-viewer direct answer', () => {
    it('renders the answer paragraph: what metadata is, then what Resizo does with it, in your browser', () => {
        render(<ImageMetadataViewerPage />);

        const answer = screen.getByText(/Image metadata is the information a camera, a phone or an editor writes/);
        expect(answer).toHaveTextContent(/Choose a photo and Resizo reads all of it from the file’s own bytes in your browser/);
        expect(answer).toHaveTextContent(/never decoded, changed or written anywhere\.$/);
        expect(answer.textContent).not.toMatch(/upload/i);
    });
});

describe('/image-metadata-viewer content sections', () => {
    it('covers every topic the plan names', () => {
        render(<ImageMetadataViewerPage />);

        for (const heading of [
            'What EXIF metadata is',
            'Can an image contain location data?',
            'Does removing metadata change the pixels?',
            'What DPI metadata is',
            'What an ICC profile is',
            'Does choosing a photo here expose its metadata?',
        ]) {
            expect(screen.getByRole('heading', { name: heading }), heading).toBeInTheDocument();
        }
    });

    it('states the no-upload mechanism in the exact words the plan pins', () => {
        render(<ImageMetadataViewerPage />);

        expect(screen.getByText(
            /The viewer never uploads the file: it reads the bytes in your browser and the request log of every test proves only same-origin GET requests\./,
        )).toBeInTheDocument();
    });

    it('pairs to the remover tool somewhere in the page prose', () => {
        render(<ImageMetadataViewerPage />);

        const link = screen.getAllByRole('link').find((node) => node.getAttribute('href') === '/remove-image-metadata');
        expect(link, 'no link to /remove-image-metadata found in the page content').toBeTruthy();
    });

    it('renders the visible HowTo steps and FAQ that back the JSON-LD', () => {
        render(<ImageMetadataViewerPage />);

        expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'How to view the metadata stored in an image' })).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
    });
});

describe('/image-metadata-viewer JSON-LD', () => {
    function schemaGraph(container) {
        const script = container.querySelector('script[type="application/ld+json"]');
        expect(script, 'no JSON-LD script tag found').toBeTruthy();
        return JSON.parse(script.textContent);
    }

    it('emits softwareApplication, breadcrumbList, howTo and faqPage, and no rating', () => {
        const { container } = render(<ImageMetadataViewerPage />);
        const graph = schemaGraph(container);
        const types = graph.map((node) => node['@type']);

        expect(types).toEqual(expect.arrayContaining(['SoftwareApplication', 'BreadcrumbList', 'HowTo', 'FAQPage']));

        const app = graph.find((node) => node['@type'] === 'SoftwareApplication');
        expect(app.aggregateRating).toBeUndefined();
        expect(app.review).toBeUndefined();
    });

    it('mirrors the visible HowTo steps exactly, with no step the page does not show', () => {
        const { container } = render(<ImageMetadataViewerPage />);
        const graph = schemaGraph(container);
        const howTo = graph.find((node) => node['@type'] === 'HowTo');

        for (const step of howTo.step) {
            expect(screen.getByText(step.name, { exact: false })).toBeInTheDocument();
        }
    });

    it('mirrors the visible FAQ exactly, five questions', () => {
        const { container } = render(<ImageMetadataViewerPage />);
        const graph = schemaGraph(container);
        const faq = graph.find((node) => node['@type'] === 'FAQPage');

        expect(faq.mainEntity).toHaveLength(5);
        for (const entry of faq.mainEntity) {
            expect(screen.getByText(entry.name)).toBeInTheDocument();
        }
    });
});
