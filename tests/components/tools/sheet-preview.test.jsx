/**
 * SheetPreview
 *
 * The SVG the tool panel and the page both show: one paper rectangle, one
 * `<image>` (or placeholder) per cell, the guide marks and the reference line,
 * all drawn from a `layoutSheet()` result and nothing else — no second crop or
 * fit math lives here, only the arithmetic that turns an already-known cell
 * rect plus an already-known crop/contain rect into an SVG placement.
 *
 * `lib/format/print-sheet` is real here (it has landed and is fully covered by
 * its own suite), so `describeLayout`, `guideRects` and `referenceRects` are
 * exercised for real rather than stubbed — the aria-label and the guide/
 * reference rects are asserted against their actual output, the same
 * rectangles the raster compositor and the PDF writer paint.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SheetPreview from '@/app/(tools)/passport-photo-print/SheetPreview';
import { describeLayout, guideRects, referenceRects } from '@/lib/format/print-sheet';

/** A minimal, well-shaped layout: two cells stacked in one column. */
function fakeLayout(overrides = {}) {
    return {
        ok: true,
        orientation: 'portrait',
        paper: { widthPx: 1200, heightPx: 1800, widthPt: 288, heightPt: 432 },
        photo: { widthPx: 600, heightPx: 600 },
        marginPx: 59,
        gapPx: 35,
        columns: 1,
        rows: 2,
        capacity: 2,
        copies: 2,
        requested: 'auto',
        clamped: false,
        notice: null,
        cells: [
            { index: 0, column: 0, row: 0, x: 300, y: 59, width: 600, height: 600 },
            { index: 1, column: 0, row: 1, x: 300, y: 694, width: 600, height: 600 },
        ],
        guides: {
            style: 'corners',
            thicknessPx: 1,
            marks: [
                { x1: 265, y1: 41, x2: 300, y2: 41 },
                { x1: 900, y1: 41, x2: 900, y2: 59 },
            ],
        },
        reference: { x1: 305, y1: 1770, x2: 896, y2: 1770, lengthMm: 50, lengthPx: 591, tickPx: 35 },
        summary: { paper: '4 × 6 in', pixels: '1200 × 1800 px', dpi: 300, photo: '2 × 2 in', copies: 2, orientation: 'Portrait' },
        ...overrides,
    };
}

describe('a missing or invalid layout', () => {
    it('renders nothing when there is no layout yet', () => {
        const { container } = render(<SheetPreview layout={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for a refused layout', () => {
        const { container } = render(<SheetPreview layout={{ ok: false, error: 'nope' }} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('the SVG frame', () => {
    it('sets the viewBox to the paper pixel size', () => {
        render(<SheetPreview layout={fakeLayout()} />);
        const svg = screen.getByRole('img');
        expect(svg.tagName.toLowerCase()).toBe('svg');
        expect(svg).toHaveAttribute('viewBox', '0 0 1200 1800');
    });

    it('names the layout in the accessible name, using the real describeLayout', () => {
        const layout = fakeLayout();
        render(<SheetPreview layout={layout} />);
        expect(screen.getByRole('img', { name: describeLayout(layout) })).toBeInTheDocument();
    });

    it('shows the visible caption saying the download matches this preview', () => {
        render(<SheetPreview layout={fakeLayout()} />);
        expect(screen.getByText('Preview — the file you download is generated from the same layout.')).toBeInTheDocument();
    });

    it('scales to the full width of its column with no fixed pixel width', () => {
        render(<SheetPreview layout={fakeLayout()} />);
        const svg = screen.getByRole('img');
        expect(svg).not.toHaveAttribute('width');
        expect(svg.getAttribute('class') || '').toMatch(/\bw-full\b/);
    });
});

describe('before a file exists', () => {
    it('draws one placeholder rect per cell and no <image> elements', () => {
        // Guides and the reference are off here so this count is only ever the
        // cell placeholders and the paper — their own rects are covered above.
        const layout = fakeLayout({ guides: { style: 'none', thicknessPx: 1, marks: [] }, reference: null });
        const { container } = render(<SheetPreview layout={layout} />);
        expect(container.querySelectorAll('image')).toHaveLength(0);
        // Two cells, two placeholders, plus the one full-paper background rect.
        expect(container.querySelectorAll('rect')).toHaveLength(3);
    });
});

describe('once a source photo is loaded, cropping to fill', () => {
    const cropRect = { x: 100, y: 0, width: 800, height: 800 };

    it('draws one <image> per cell, each pointing at the same preview URL', () => {
        const layout = fakeLayout();
        const { container } = render(
            <SheetPreview
                layout={layout}
                previewUrl="blob:source"
                sourceWidth={1000}
                sourceHeight={800}
                cropRect={cropRect}
            />,
        );
        const images = container.querySelectorAll('image');
        expect(images).toHaveLength(layout.cells.length);
        for (const image of images) {
            expect(image.getAttribute('href')).toBe('blob:source');
        }
    });

    it('positions each image so the crop rect maps exactly onto that cell, with no second crop computed', () => {
        const layout = fakeLayout({
            cells: [{ index: 0, column: 0, row: 0, x: 300, y: 59, width: 600, height: 600 }],
        });
        const { container } = render(
            <SheetPreview
                layout={layout}
                previewUrl="blob:source"
                sourceWidth={1000}
                sourceHeight={800}
                cropRect={cropRect}
            />,
        );
        const image = container.querySelector('image');
        // scale = cell.width / cropRect.width = 600 / 800 = 0.75
        const scale = 600 / 800;
        expect(Number(image.getAttribute('width'))).toBeCloseTo(1000 * scale, 5);
        expect(Number(image.getAttribute('height'))).toBeCloseTo(800 * scale, 5);
        expect(Number(image.getAttribute('x'))).toBeCloseTo(300 - cropRect.x * scale, 5);
        expect(Number(image.getAttribute('y'))).toBeCloseTo(59 - cropRect.y * scale, 5);
    });

    it('clips every image to its own cell so neighbouring photos never bleed together', () => {
        const layout = fakeLayout();
        const { container } = render(
            <SheetPreview layout={layout} previewUrl="blob:source" sourceWidth={1000} sourceHeight={800} cropRect={cropRect} />,
        );
        const images = container.querySelectorAll('image');
        const clipPaths = container.querySelectorAll('clipPath');
        expect(clipPaths).toHaveLength(images.length);
        for (const image of images) {
            expect(image.getAttribute('clip-path')).toMatch(/^url\(#/);
        }
    });
});

describe('fitting inside instead of cropping', () => {
    it('centres the whole photo in each cell and fills the rest with the background colour', () => {
        const layout = fakeLayout({
            cells: [{ index: 0, column: 0, row: 0, x: 0, y: 0, width: 600, height: 600 }],
        });
        const { container } = render(
            <SheetPreview
                layout={layout}
                previewUrl="blob:source"
                sourceWidth={1000}
                sourceHeight={500}
                cropRect={null}
                background="#000000"
            />,
        );
        const image = container.querySelector('image');
        // object-fit: contain — scale = min(600/1000, 600/500) = 0.6
        expect(Number(image.getAttribute('width'))).toBeCloseTo(600, 5);
        expect(Number(image.getAttribute('height'))).toBeCloseTo(300, 5);
        expect(Number(image.getAttribute('x'))).toBeCloseTo(0, 5);
        expect(Number(image.getAttribute('y'))).toBeCloseTo(150, 5);

        const fill = container.querySelector('rect[fill="#000000"]');
        expect(fill).toBeTruthy();
    });
});

describe('guides and the reference line are the exact rects the raster and PDF paint', () => {
    it('renders exactly guideRects(layout).length + referenceRects(layout).length filled rects, at their coordinates, for full lines with the reference on', () => {
        const layout = fakeLayout({
            guides: {
                style: 'lines',
                thicknessPx: 1,
                marks: [
                    { x1: 265, y1: 41, x2: 300, y2: 41 },
                    { x1: 900, y1: 41, x2: 900, y2: 59 },
                ],
            },
        });
        const { container } = render(<SheetPreview layout={layout} />);

        const expectedGuides = guideRects(layout);
        const expectedReference = referenceRects(layout);

        const guideEls = Array.from(container.querySelectorAll('rect[fill="var(--ink-muted)"]'));
        const referenceEls = Array.from(container.querySelectorAll('rect[fill="var(--ink)"]'));

        expect(guideEls).toHaveLength(expectedGuides.length);
        expect(referenceEls).toHaveLength(expectedReference.length);
        expect(guideEls.length + referenceEls.length).toBe(expectedGuides.length + expectedReference.length);

        guideEls.forEach((rect, index) => {
            expect(Number(rect.getAttribute('x'))).toBe(expectedGuides[index].x);
            expect(Number(rect.getAttribute('y'))).toBe(expectedGuides[index].y);
            expect(Number(rect.getAttribute('width'))).toBe(expectedGuides[index].width);
            expect(Number(rect.getAttribute('height'))).toBe(expectedGuides[index].height);
        });

        referenceEls.forEach((rect, index) => {
            expect(Number(rect.getAttribute('x'))).toBe(expectedReference[index].x);
            expect(Number(rect.getAttribute('y'))).toBe(expectedReference[index].y);
            expect(Number(rect.getAttribute('width'))).toBe(expectedReference[index].width);
            expect(Number(rect.getAttribute('height'))).toBe(expectedReference[index].height);
        });
    });

    it('draws no guide or reference rects when guides are off and the reference is off', () => {
        const layout = fakeLayout({ guides: { style: 'none', thicknessPx: 1, marks: [] }, reference: null });
        const { container } = render(<SheetPreview layout={layout} />);

        expect(container.querySelectorAll('rect[fill="var(--ink-muted)"]')).toHaveLength(0);
        expect(container.querySelectorAll('rect[fill="var(--ink)"]')).toHaveLength(0);
    });
});

