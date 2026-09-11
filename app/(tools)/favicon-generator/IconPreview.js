'use client';

/**
 * IconPreview
 *
 * The one pre-generation preview FaviconTool shows: a square canvas painted
 * with exactly the crop rect (Crop to square) or the pad rect (Fit inside
 * square) the engine's own `icons` op will use, plus the chosen background.
 * NO SECOND GEOMETRY — `iconPreviewDraw` below takes FrameCrop's own `value`
 * for cover and `fitGeometry` (lib/image-client/requirements.js, the exact
 * function the engine's pipeline calls) for contain, and turns either into a
 * plain source-rect/dest-rect pair a 2D canvas context understands. There is
 * no CSS object-fit anywhere near it: that would be a geometry of its own,
 * arrived at independently of the one the file is actually built from.
 *
 * `iconPreviewDraw` is exported and is the thing to test — it is pure
 * arithmetic with no DOM in it. The paint effect around it is the thin,
 * untestable part: jsdom implements `<canvas>` but not a real 2D context (no
 * `canvas` package is installed, and none is being added — see CLAUDE.md), so
 * `getContext('2d')` is null in every component test and the effect below is
 * written to do nothing useful when that happens rather than to throw.
 *
 * The guide checkbox lives in FaviconTool (it is a setting, not a drawing);
 * this component only draws the overlay when told to.
 */
import { useEffect, useRef } from 'react';

import { fitGeometry } from '@/lib/image-client/requirements';

export const PREVIEW_SIZE = 256;

/**
 * @param {{ sourceWidth: number, sourceHeight: number, geometry: 'cover'|'contain',
 *           frameRect: {x,y,width,height}|null, size?: number }} input
 * @returns {{ source: {x,y,width,height}, dest: {x,y,width,height} }|null}
 */
export function iconPreviewDraw({ sourceWidth, sourceHeight, geometry, frameRect, size = PREVIEW_SIZE }) {
    const usable = (value) => Number.isFinite(value) && value > 0;
    if (!usable(sourceWidth) || !usable(sourceHeight) || !usable(size)) return null;

    if (geometry === 'contain') {
        const fit = fitGeometry({ sourceWidth, sourceHeight, width: size, height: size, geometry: 'contain' });
        if (!fit.ok) return null;

        return {
            source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
            dest: { x: fit.pad.x, y: fit.pad.y, width: fit.resampleTo.width, height: fit.resampleTo.height },
        };
    }

    if (!frameRect || !usable(frameRect.width) || !usable(frameRect.height)) return null;

    return {
        source: { x: frameRect.x, y: frameRect.y, width: frameRect.width, height: frameRect.height },
        dest: { x: 0, y: 0, width: size, height: size },
    };
}

export default function IconPreview({
    id = 'icon-preview',
    entry,
    geometry,
    frameRect,
    background,
    showGuides = false,
    size = PREVIEW_SIZE,
    className = '',
}) {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !entry) return undefined;

        let ctx = null;
        try {
            ctx = canvas.getContext('2d');
        } catch {
            ctx = null;
        }
        if (!ctx) return undefined;

        ctx.clearRect(0, 0, size, size);

        const draw = iconPreviewDraw({
            sourceWidth: entry.width,
            sourceHeight: entry.height,
            geometry,
            frameRect,
            size,
        });
        if (!draw) return undefined;

        if (background !== 'transparent') {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, size, size);
        }

        let cancelled = false;
        // window.Image, never bare Image — a component that also imports
        // next/image would otherwise resolve Image to the React component.
        const image = new window.Image();
        image.onload = () => {
            if (cancelled) return;
            ctx.drawImage(
                image,
                draw.source.x, draw.source.y, draw.source.width, draw.source.height,
                draw.dest.x, draw.dest.y, draw.dest.width, draw.dest.height,
            );
        };
        image.src = entry.previewUrl;

        return () => {
            cancelled = true;
        };
    }, [entry, geometry, frameRect, background, size]);

    return (
        <figure className={className}>
            <div
                className="checkerboard relative mx-auto w-56 max-w-full overflow-hidden rounded-panel border border-line"
                style={{ aspectRatio: '1 / 1' }}
            >
                <canvas
                    ref={canvasRef}
                    id={id}
                    width={size}
                    height={size}
                    aria-hidden="true"
                    className="block size-full"
                />

                {showGuides ? (
                    <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 size-full"
                    >
                        <circle cx="50" cy="50" r="49" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        <rect x="1" y="1" width="98" height="98" rx="22" fill="none" stroke="var(--accent)" strokeDasharray="4 3" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    </svg>
                ) : null}
            </div>
            <figcaption className="mt-2 text-micro text-ink-muted">
                Preview — how the composition looks; browsers and devices draw their own frames.
            </figcaption>
        </figure>
    );
}
