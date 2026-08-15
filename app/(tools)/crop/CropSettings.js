'use client';

/**
 * CropSettings
 *
 * The aspect-ratio chip row for /crop. Presentational only — state (`ratioId`
 * and the rectangle it produces) lives in CropTool, mirroring how
 * ResizeSettings.js's controls are driven entirely by ResizeTool.
 *
 * Co-located here rather than in components/tools/ because this is one tool's
 * settings UI, the same reasoning ResizeSettings.js is co-located with
 * ResizeTool.js rather than shared.
 *
 * No mobile disclosure: CropTool only renders this once a file is chosen (a
 * ratio is meaningless without an image to measure it against), so unlike
 * /resize's PlatformSizes there is no fold above an empty drop zone to
 * protect.
 */
import PresetChips from '@/components/tools/PresetChips';
import { ASPECT_RATIOS } from '@/lib/catalog';

/** ASPECT_RATIOS reshaped into the { id, label, detail } shape PresetChips reads. */
const RATIO_ITEMS = ASPECT_RATIOS.map((ratio) => ({ ...ratio, detail: ratio.ratio }));

export default function CropSettings({ ratioId, onRatioSelect, className = '' }) {
    return (
        <PresetChips
            label="Aspect ratio"
            items={RATIO_ITEMS}
            value={ratioId}
            onSelect={onRatioSelect}
            className={className}
        />
    );
}
