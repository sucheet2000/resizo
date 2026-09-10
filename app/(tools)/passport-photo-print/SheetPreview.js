'use client';

/**
 * SheetPreview
 *
 * The SVG the tool panel shows before Create sheet runs, and again on the
 * result — one white paper rectangle, one photo cell per copy, the cut guides
 * and the 50 mm reference line. It is drawn from a `layoutSheet()` result and
 * NOTHING ELSE: every rectangle it places is either a cell the layout already
 * computed, or that cell mapped against a crop/contain rect the caller already
 * computed (FrameCrop's own `value`, for Crop to fill). No second crop or fit
 * algorithm lives here — the cut guides and the measuring line with its ticks
 * are the same `guideRects` and `referenceRects` the raster compositor and
 * the PDF writer paint, so a mark drawn in one of them is drawn in all three.
 *
 * `href`, not `xlinkHref`: every browser this site supports (Chromium,
 * Firefox, WebKit, and their mobile builds) reads a plain `href` on `<image>`.
 *
 * PAPER WHITE IS DATA, NOT A DESIGN TOKEN. The engine composites every sheet
 * onto opaque white regardless of theme (lib/format/print-sheet.js), so this
 * preview shows that colour literally — the same reasoning that lets
 * `lib/image-client/flatten.js`'s BACKGROUND_PRESETS hex values render as
 * literal swatches elsewhere. The placeholder cell (before a file exists) and
 * the guide/reference lines are UI, not data, so those use `--surface-sunken`,
 * `--line` and `--ink-muted` — existing tokens, not a new colour.
 */
import { describeLayout, guideRects, referenceRects } from '@/lib/format/print-sheet';

/** object-fit: contain — the whole source centred inside the cell. */
function containPlacement(cell, sourceWidth, sourceHeight) {
    const scale = Math.min(cell.width / sourceWidth, cell.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
        x: cell.x + (cell.width - width) / 2,
        y: cell.y + (cell.height - height) / 2,
        width,
        height,
    };
}

/**
 * The full source image, scaled and positioned so that `cropRect` (a source-
 * pixel rectangle — FrameCrop's own `value`) lands exactly on `cell`. This is
 * the same "position the whole image, clip to the window" trick FrameCrop
 * itself uses in HTML/CSS percentages; here it is plain SVG arithmetic against
 * the same two rectangles, not a third geometry.
 */
function coverPlacement(cell, cropRect, sourceWidth, sourceHeight) {
    const scaleX = cell.width / cropRect.width;
    const scaleY = cell.height / cropRect.height;
    return {
        x: cell.x - cropRect.x * scaleX,
        y: cell.y - cropRect.y * scaleY,
        width: sourceWidth * scaleX,
        height: sourceHeight * scaleY,
    };
}

export default function SheetPreview({
    layout,
    previewUrl = null,
    sourceWidth = 0,
    sourceHeight = 0,
    cropRect = null,
    background = 'white',
    className = '',
}) {
    if (!layout || layout.ok === false || !layout.paper) return null;

    const { paper, reference } = layout;
    const cells = Array.isArray(layout.cells) ? layout.cells : [];
    // The guide marks and the measuring line are the rectangles the raster and
    // the PDF paint, so the preview is a third reader of one geometry, not a
    // third geometry.
    const guides = guideRects(layout);
    const referenceMarks = referenceRects(layout);

    const hasSource = Boolean(previewUrl) && sourceWidth > 0 && sourceHeight > 0;
    const isCover = Boolean(cropRect) && cropRect.width > 0 && cropRect.height > 0;


    return (
        <figure className={className}>
            <svg
                viewBox={`0 0 ${paper.widthPx} ${paper.heightPx}`}
                role="img"
                aria-label={describeLayout(layout)}
                className="h-auto max-h-[60vh] w-full rounded-input border border-line"
            >
                <rect x="0" y="0" width={paper.widthPx} height={paper.heightPx} fill="white" />

                {cells.map((cell) => {
                    const clipId = `sheet-cell-clip-${cell.index}`;

                    if (!hasSource) {
                        return (
                            <rect
                                key={cell.index}
                                x={cell.x}
                                y={cell.y}
                                width={cell.width}
                                height={cell.height}
                                fill="var(--surface-sunken)"
                                stroke="var(--ink-muted)"
                            />
                        );
                    }

                    const placement = isCover
                        ? coverPlacement(cell, cropRect, sourceWidth, sourceHeight)
                        : containPlacement(cell, sourceWidth, sourceHeight);

                    return (
                        <g key={cell.index}>
                            <clipPath id={clipId}>
                                <rect x={cell.x} y={cell.y} width={cell.width} height={cell.height} />
                            </clipPath>
                            {!isCover ? (
                                <rect x={cell.x} y={cell.y} width={cell.width} height={cell.height} fill={background} />
                            ) : null}
                            <image
                                href={previewUrl}
                                x={placement.x}
                                y={placement.y}
                                width={placement.width}
                                height={placement.height}
                                preserveAspectRatio="none"
                                clipPath={`url(#${clipId})`}
                            />
                        </g>
                    );
                })}

                {guides.map((rect, index) => (
                    <rect
                        key={`guide-${index}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        fill="var(--ink-muted)"
                    />
                ))}

                {referenceMarks.map((rect, index) => (
                    <rect
                        key={`reference-${index}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        fill="var(--ink)"
                    />
                ))}
            </svg>
            <figcaption className="mt-2 text-micro text-ink-muted">
                Preview — the file you download is generated from the same layout.
            </figcaption>
        </figure>
    );
}
