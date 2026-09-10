'use client';

/**
 * FrameCrop
 *
 * A fixed window of the target aspect; the photo moves and scales underneath
 * it via CSS percentages, like a typical avatar cropper — unlike CropOverlay
 * (used by /crop and /signature-resizer), which dims the outside of a
 * movable rectangle drawn over a static photo. Here the frame IS the kept
 * region, so nothing outside it is ever visible to dim; this SVG draws only
 * the accent outline and rule-of-thirds lines CropOverlay also draws.
 *
 * `value` is a controlled prop, exactly like a controlled input: a source-
 * pixel rectangle the frame currently shows. When it is empty this computes
 * the largest centred rectangle of `aspect` that fits the source ("cover")
 * and reports it through `onChange` once, expecting the caller to feed it
 * back as `value`. `zoom` is never stored — it is always derived from how
 * the current rectangle compares to the cover rectangle, so the slider and
 * the emitted rect cannot disagree with each other.
 *
 * Every path that changes the rectangle funnels through `emit`, the only
 * place `normalizeRect` runs — which is what makes "onChange always receives
 * an integer, in-bounds rect of the target aspect" true by construction.
 */
import { useEffect, useMemo, useRef } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_BUTTON_STEP = 0.25;
const KEY_STEP = 0.02;
const KEY_STEP_SHIFT = 0.1;

const BUTTON_CLASS =
    'inline-flex min-h-11 items-center justify-center rounded-button border border-line px-4 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-50';
const GUIDE_LINE = { stroke: 'var(--accent)', strokeOpacity: 0.45, strokeDasharray: '5 5', vectorEffect: 'non-scaling-stroke' };
const REQUIREMENT_BAND = { fill: 'none', stroke: 'var(--accent)', strokeDasharray: '2 3', strokeWidth: '1', vectorEffect: 'non-scaling-stroke' };

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/** The largest rectangle of `aspect` centred inside a sourceWidth x sourceHeight source. */
function coverRect(sourceWidth, sourceHeight, aspect) {
    const sourceAspect = sourceWidth / sourceHeight;
    let width;
    let height;

    if (sourceAspect > aspect) {
        height = sourceHeight;
        width = height * aspect;
    } else {
        width = sourceWidth;
        height = width / aspect;
    }

    return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

/**
 * Rounds to an integer, in-bounds rectangle of exactly `aspect`. Width is
 * rounded first and height derived from it — rather than rounding both
 * independently — so the result never drifts from the requested aspect by
 * more than that one rounding step (the "±1 px" the contract allows).
 */
function normalizeRect(rect, sourceWidth, sourceHeight, aspect) {
    const width = clamp(Math.round(rect.width), 1, sourceWidth);
    const height = clamp(Math.round(width / aspect), 1, sourceHeight);
    const x = clamp(Math.round(rect.x), 0, sourceWidth - width);
    const y = clamp(Math.round(rect.y), 0, sourceHeight - height);
    return { x, y, width, height };
}

/** A rectangle at `zoom` relative to the cover rectangle, centred on `centreOf`. */
function rectAtZoom(centreOf, zoom, cover, aspect) {
    const width = cover.width / zoom;
    const cx = centreOf.x + centreOf.width / 2;
    const cy = centreOf.y + centreOf.height / 2;
    return { x: cx - width / 2, y: cy - width / aspect / 2, width, height: width / aspect };
}

export default function FrameCrop({ src, sourceWidth, sourceHeight, aspect, value, onChange, guides = [], label, id }) {
    const frameRef = useRef(null);
    const dragRef = useRef(null);
    const firedInitialRef = useRef(false);

    const initialRect = useMemo(
        () => normalizeRect(coverRect(sourceWidth, sourceHeight, aspect), sourceWidth, sourceHeight, aspect),
        [sourceWidth, sourceHeight, aspect],
    );

    const isEmpty = value == null;
    const rect = isEmpty ? initialRect : value;
    const zoom = clamp(initialRect.width / rect.width, MIN_ZOOM, MAX_ZOOM);

    // A ref, not a plain "value is empty" check, is what makes this fire
    // exactly once regardless of how many times the effect re-runs before
    // the caller feeds the rectangle back as `value`.
    useEffect(() => {
        if (isEmpty && !firedInitialRef.current) {
            firedInitialRef.current = true;
            onChange(initialRect);
        }
    }, [isEmpty, initialRect, onChange]);

    function emit(nextRect) {
        onChange(normalizeRect(nextRect, sourceWidth, sourceHeight, aspect));
    }

    function setZoom(nextZoom) {
        emit(rectAtZoom(rect, clamp(nextZoom, MIN_ZOOM, MAX_ZOOM), initialRect, aspect));
    }

    // The arrows move the PHOTO, the same way a drag does: ArrowRight slides
    // the picture right, which moves the kept window left. Space is swallowed
    // so a focused frame never scrolls the page.
    function handleKeyDown(event) {
        if (event.key === ' ') {
            event.preventDefault();
            return;
        }

        const step = event.shiftKey ? KEY_STEP_SHIFT : KEY_STEP;
        let dx = 0;
        let dy = 0;
        if (event.key === 'ArrowLeft') dx = rect.width * step;
        else if (event.key === 'ArrowRight') dx = -rect.width * step;
        else if (event.key === 'ArrowUp') dy = rect.height * step;
        else if (event.key === 'ArrowDown') dy = -rect.height * step;
        else return;

        event.preventDefault();
        emit({ ...rect, x: rect.x + dx, y: rect.y + dy });
    }

    function handlePointerDown(event) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startRect: rect };
    }

    // Dragging moves the photo, not the window: dragging right reveals more
    // of the photo's left edge, so the window's x decreases.
    function handlePointerMove(event) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        const frameSize = frameRef.current?.getBoundingClientRect();
        const scale = frameSize?.width > 0 ? frameSize.width / drag.startRect.width : 1;
        const dxSource = (event.clientX - drag.startX) / scale;
        const dySource = (event.clientY - drag.startY) / scale;
        emit({ ...drag.startRect, x: drag.startRect.x - dxSource, y: drag.startRect.y - dySource });
    }

    function handlePointerUp(event) {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    const zoomFieldId = `${id}-zoom`;
    const hintId = `${id}-hint`;

    return (
        <div className="flex flex-col gap-3">
            <div
                ref={frameRef}
                id={id}
                role="group"
                aria-label={label}
                aria-roledescription="crop frame"
                aria-describedby={hintId}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="relative mx-auto w-full touch-none overflow-hidden rounded-panel border border-line bg-surface-sunken checkerboard"
                style={{ aspectRatio: aspect, maxWidth: 420 }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from the visitor's own file; next/image cannot optimise it. */}
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="absolute max-w-none select-none"
                    style={{
                        width: `${(sourceWidth / rect.width) * 100}%`,
                        height: `${(sourceHeight / rect.height) * 100}%`,
                        left: `${-(rect.x / rect.width) * 100}%`,
                        top: `${-(rect.y / rect.height) * 100}%`,
                    }}
                />

                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
                    {[1, 2].flatMap((step) => [
                        <line key={`v${step}`} x1={(step * 100) / 3} y1="0" x2={(step * 100) / 3} y2="100" {...GUIDE_LINE} />,
                        <line key={`h${step}`} x1="0" y1={(step * 100) / 3} x2="100" y2={(step * 100) / 3} {...GUIDE_LINE} />,
                    ])}
                    <rect x="0" y="0" width="100" height="100" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    {guides.map((guide, index) => (
                        <rect key={index} x="0" y={guide.from * 100} width="100" height={(guide.to - guide.from) * 100} {...REQUIREMENT_BAND} />
                    ))}
                </svg>
            </div>

            <p id={hintId} className="text-micro text-ink-muted">
                Drag the photo to move it, or use the arrow keys; hold Shift to move further. The slider zooms.
            </p>

            {/* One text node and aria-atomic, so a screen reader hears the
                whole sentence rather than the one number that changed. */}
            <p aria-live="polite" aria-atomic="true" className="font-data text-micro text-ink-muted">
                {`Keeping ${rect.width}×${rect.height} pixels from ${rect.x}, ${rect.y}`}
            </p>

            <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={zoomFieldId} className="text-ui text-ink">
                    Zoom
                </label>
                <input
                    id={zoomFieldId}
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.05}
                    value={zoom}
                    aria-valuetext={`${zoom.toFixed(2)} times`}
                    onChange={(event) => setZoom(Number(event.target.value))}
                    className="min-h-11 w-full max-w-xs accent-[var(--accent)]"
                />
                <div className="flex gap-2">
                    <button type="button" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(zoom - ZOOM_BUTTON_STEP)} className={BUTTON_CLASS}>
                        Zoom out
                    </button>
                    <button type="button" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(zoom + ZOOM_BUTTON_STEP)} className={BUTTON_CLASS}>
                        Zoom in
                    </button>
                    <button type="button" onClick={() => emit(initialRect)} className={BUTTON_CLASS}>
                        Reset
                    </button>
                </div>
            </div>

            {guides.length > 0 ? (
                <ul className="flex flex-col gap-1">
                    {guides.map((guide, index) => (
                        <li key={index} className="text-micro text-ink-muted">
                            {guide.kind === 'official' ? 'Official requirement: ' : 'Guidance: '}
                            {guide.label}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
