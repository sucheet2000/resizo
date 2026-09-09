/**
 * CropOverlay
 *
 * The one earned grid in the design system. It is not texture: it dims what
 * will be discarded, outlines what will be kept, and draws thirds inside the
 * kept region so the frame can be judged before the request is sent.
 *
 * Shared rather than copied. It started inside /crop and is now drawn over two
 * previews — /crop's rectangle and /signature-resizer's, which is the same
 * rectangle in the same source pixels. A second copy would be two places for
 * the even-odd punch-out to drift apart, and the punch-out is the whole reason
 * the dimming reads as "discarded" rather than as a tint over the photo.
 *
 * Purely presentational: no hooks, no handlers, no state. It renders inside a
 * client tool and needs no directive of its own, exactly like ToolShell.
 */
export default function CropOverlay({ width, height, rect }) {
    const { x, y, width: w, height: h } = rect;
    if (w <= 0 || h <= 0) return null;

    const guide = {
        stroke: 'var(--accent)',
        strokeOpacity: 0.45,
        strokeDasharray: '5 5',
        vectorEffect: 'non-scaling-stroke',
    };

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
        >
            {/* even-odd: the second subpath punches the kept region out of the dim. */}
            <path
                fillRule="evenodd"
                d={`M0 0H${width}V${height}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z`}
                fill="var(--overlay)"
            />
            {[1, 2].map((step) => (
                <line
                    key={`column-${step}`}
                    x1={x + (w * step) / 3}
                    y1={y}
                    x2={x + (w * step) / 3}
                    y2={y + h}
                    {...guide}
                />
            ))}
            {[1, 2].map((step) => (
                <line
                    key={`row-${step}`}
                    x1={x}
                    y1={y + (h * step) / 3}
                    x2={x + w}
                    y2={y + (h * step) / 3}
                    {...guide}
                />
            ))}
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
}
