/**
 * OperationMark
 *
 * Tool identity is a typographic operation token — `W×H`, `−%`, `→WEBP`, `⤢`,
 * `HEIC→JPG` — set in mono. Never an icon tile above a heading.
 *
 * The glyph is decorative to a screen reader; `label` carries the meaning.
 */
export const TOOL_MARKS = {
    resize: { mark: 'W×H', label: 'Resize' },
    'bulk-resize': { mark: 'W×H ×N', label: 'Bulk resize' },
    compress: { mark: '−%', label: 'Compress' },
    convert: { mark: '→WEBP', label: 'Convert format' },
    crop: { mark: '⤢', label: 'Crop' },
    heic: { mark: 'HEIC→JPG', label: 'Convert HEIC to JPG' },
    'jpg-to-pdf': { mark: 'JPG→PDF', label: 'JPG to PDF' },
    'merge-pdf': { mark: 'PDF+PDF', label: 'Merge PDF' },
    'signature-resizer': { mark: 'SIG→W×H', label: 'Signature resizer' },
    'change-image-dpi': { mark: 'DPI', label: 'Change image DPI' },
    'remove-image-metadata': { mark: '−EXIF', label: 'Remove image metadata' },
};

export function markFor(slug) {
    return TOOL_MARKS[slug] ?? null;
}

export default function OperationMark({
    tool,
    mark,
    label,
    size = 'ui',
    className = '',
}) {
    const preset = tool ? TOOL_MARKS[tool] : null;
    const glyph = mark ?? preset?.mark;
    if (!glyph) return null;

    const text = label ?? preset?.label ?? null;

    const sizeClass = {
        micro: 'text-micro',
        ui: 'text-ui',
        lead: 'text-lead',
        title: 'text-title',
    }[size] ?? 'text-ui';

    return (
        <span
            className={[
                'inline-flex items-center font-data font-medium tracking-tight text-accent',
                sizeClass,
                className,
            ].filter(Boolean).join(' ')}
        >
            <span aria-hidden="true">{glyph}</span>
            {text ? <span className="sr-only">{text}</span> : null}
        </span>
    );
}
