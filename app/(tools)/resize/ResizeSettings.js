'use client';

/**
 * The controls that sit ABOVE the drop zone on /resize.
 *
 * That position is the point: a file that lands on a configured panel is
 * finished in one pass, instead of the upload → configure → reprocess loop the
 * old workspace forced (DESIGN.md > Layout).
 *
 * It also fights the other binding rule — the drop zone has to be painted
 * above the fold on a mid-tier phone — so the layout here is measured, not
 * guessed. Every control that can share a row does: the two mode switches sit
 * together, the ratio lock lives between the width and height fields rather
 * than on a line of its own, and the preset row scrolls sideways instead of
 * wrapping to four lines. Adding a stacked control here pushes the drop zone
 * off the first screen.
 *
 * Everything is presentational. State lives in ResizeTool so switching between
 * the single and bulk panels never throws a visitor's settings away.
 */
import { useState } from 'react';

import PresetChips from '@/components/tools/PresetChips';
import Field from '@/components/ui/Field';
import { SOCIAL_PRESETS, describePreset } from '@/lib/catalog/presets';
import { MAX_BULK_FILES } from '@/lib/limits';
import { formatLabel } from '@/lib/format/upload-helpers';

export const OUTPUT_FORMATS = [
    { value: 'original', label: 'Same as the original' },
    { value: 'jpeg', label: 'JPEG (.jpg)' },
    { value: 'png', label: 'PNG (.png)' },
    { value: 'webp', label: 'WebP (.webp)' },
];

const SCALE_SHORTCUTS = [25, 50, 75, 200];

const CONTROL =
    'w-full rounded-input border border-line bg-surface px-3 py-2 text-base text-ink transition-colors duration-120 ease-snap hover:border-ink-muted';

const NUMBER_CONTROL = `${CONTROL} font-data`;

/**
 * A two-state switch built from real buttons rather than sr-only radios: a
 * button picks up the app-wide :focus-visible ring for free, and a visually
 * hidden input cannot show one.
 */
function Switch({ id, labelId, label, options, value, onChange, className = '' }) {
    return (
        <div id={id} className={className}>
            <p id={labelId} className="text-ui text-ink">
                {label}
            </p>
            <div
                role="group"
                aria-labelledby={labelId}
                className="mt-1.5 inline-flex rounded-button border border-line p-0.5"
            >
                {options.map((option) => {
                    const active = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange(option.value)}
                            className={[
                                'rounded-button px-3 py-1.5 text-ui transition-colors duration-120 ease-snap',
                                active
                                    ? 'bg-accent text-accent-ink'
                                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                            ].join(' ')}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Carries id="bulk", which is the anchor /resize#bulk points at. */
function ModeSwitch({ mode, onModeChange }) {
    return (
        <Switch
            id="bulk"
            labelId="resize-mode-label"
            label="How many images?"
            value={mode}
            onChange={onModeChange}
            options={[
                { value: 'single', label: 'One' },
                { value: 'bulk', label: `Up to ${MAX_BULK_FILES}` },
            ]}
        />
    );
}

/** SOCIAL_PRESETS reshaped into the { id, label, detail } shape PresetChips reads. */
const PLATFORM_ITEMS = SOCIAL_PRESETS.map((preset) => ({
    ...preset,
    detail: `${preset.width}×${preset.height}`,
    title: describePreset(preset),
}));

/**
 * Intent chips, not a dropdown of numbers: a visitor arrives thinking
 * "Instagram story", not "1080 by 1920".
 *
 * The heading says "Common platform sizes" rather than "Platform sizes"
 * because seven of the twelve are the size the platform's own help page
 * states and five are conventions nobody official publishes — Instagram
 * documents no story or profile-picture size, X documents a ratio range and
 * no pixels, and WhatsApp and Discord document only a floor. Calling all
 * twelve "platform sizes" told a visitor they were rules. Which is which is
 * recorded per entry in lib/catalog/presets.js and spelled out in full on
 * /resize; this panel also renders on the resize intent pages, so the line
 * under the row has to be true without that section beneath it.
 *
 * On a phone the twelve chips are folded behind a real disclosure button so the
 * drop zone still lands above the fold on the smallest screens; from md up the
 * panel is always shown (`md:block`) and the toggle is hidden, so the chips
 * cost nothing on a laptop and stay one tap away on a phone. The open state
 * only governs mobile, so the same markup renders on the server and the client
 * with no hydration flash.
 *
 * The disclosure lives here, on /resize's own wrapper, and nowhere else: /crop
 * needs the same chip row (components/tools/PresetChips.js) but never this
 * toggle, because its controls only render once a file is chosen and there is
 * no fold left to protect by then.
 */
export function PlatformSizes({ value, onSelect, className = '' }) {
    const [open, setOpen] = useState(false);

    return (
        <div className={className}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls="resize-presets-panel"
                onClick={() => setOpen((prev) => !prev)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-input text-ui text-ink md:hidden"
            >
                <span>Common platform sizes</span>
                <span aria-hidden="true" className="font-data text-micro text-ink-muted">
                    {open ? 'Hide −' : 'Show +'}
                </span>
            </button>

            <p className="hidden text-ui text-ink md:block">Common platform sizes</p>

            <div
                id="resize-presets-panel"
                className={[open ? 'mt-1.5' : 'hidden', 'md:mt-1.5 md:block'].join(' ')}
            >
                <PresetChips
                    label="Common platform sizes"
                    labelHidden
                    items={PLATFORM_ITEMS}
                    value={value}
                    onSelect={onSelect}
                />

                <p className="mt-1.5 text-micro text-ink-muted">
                    A platform size fixes both sides, so the overflow is trimmed. Some of these are the
                    size the platform&rsquo;s own help page states; the rest are common export sizes,
                    not requirements.
                </p>
            </div>
        </div>
    );
}

/**
 * @param {object} props
 * @param {'pixels'|'percent'} props.sizeMode
 * @param {string} props.width|height|scale  raw input strings, validated on submit
 */
export function SingleSettings({
    mode,
    onModeChange,
    sizeMode,
    onSizeModeChange,
    presetId,
    onPresetSelect,
    width,
    height,
    onWidthChange,
    onHeightChange,
    lockRatio,
    onLockRatioChange,
    scale,
    onScaleChange,
    format,
    onFormatChange,
    sourceFormat,
    outputPreview,
}) {
    // There is no hint under this control any more. It used to warn that a GIF
    // source would come back as a JPEG, and GIF is no longer an accepted input,
    // so every format this select can see is a format it can also write.
    return (
        <div className="flex flex-col gap-2.5 sm:gap-4">
            <div className="flex flex-wrap items-start gap-x-5 gap-y-2.5">
                <ModeSwitch mode={mode} onModeChange={onModeChange} />

                <Switch
                    labelId="resize-by-label"
                    label="Resize by"
                    value={sizeMode}
                    onChange={onSizeModeChange}
                    options={[
                        { value: 'pixels', label: 'Pixels' },
                        { value: 'percent', label: 'Percent' },
                    ]}
                />

                <Field
                    id="resize-format"
                    label="Output format"
                    className="min-w-48 flex-1 sm:max-w-72"
                >
                    <select
                        id="resize-format"
                        value={format}
                        onChange={(event) => onFormatChange(event.target.value)}
                        className={CONTROL}
                    >
                        {OUTPUT_FORMATS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.value === 'original' && sourceFormat
                                    ? `Same as the original (${formatLabel(sourceFormat)})`
                                    : option.label}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>

            <PlatformSizes value={presetId} onSelect={onPresetSelect} />

            {sizeMode === 'pixels' ? (
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 sm:max-w-lg">
                    <Field id="resize-width" label="Width (px)">
                        <input
                            id="resize-width"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="1920"
                            value={width}
                            onChange={(event) => onWidthChange(event.target.value)}
                            className={NUMBER_CONTROL}
                        />
                    </Field>

                    <label
                        htmlFor="resize-lock"
                        title="Keep the aspect ratio"
                        className="flex items-center gap-1.5 pb-2.5 text-ui text-ink"
                    >
                        <input
                            id="resize-lock"
                            type="checkbox"
                            checked={lockRatio}
                            onChange={(event) => onLockRatioChange(event.target.checked)}
                            className="size-4 accent-[var(--accent)]"
                        />
                        <span className="whitespace-nowrap">Lock<span className="sr-only"> the aspect ratio</span></span>
                    </label>

                    <Field id="resize-height" label="Height (px)">
                        <input
                            id="resize-height"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            placeholder="1080"
                            value={height}
                            onChange={(event) => onHeightChange(event.target.value)}
                            className={NUMBER_CONTROL}
                        />
                    </Field>
                </div>
            ) : (
                <div className="flex flex-wrap items-end gap-3">
                    <Field id="resize-scale" label="Scale (%)" className="w-28">
                        <input
                            id="resize-scale"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="400"
                            step="1"
                            value={scale}
                            onChange={(event) => onScaleChange(event.target.value)}
                            className={NUMBER_CONTROL}
                        />
                    </Field>

                    <div role="group" aria-label="Common scales" className="flex gap-2 pb-1">
                        {SCALE_SHORTCUTS.map((percent) => (
                            <button
                                key={percent}
                                type="button"
                                aria-pressed={String(percent) === String(scale)}
                                onClick={() => onScaleChange(String(percent))}
                                className={[
                                    'rounded-pill border px-3 py-1.5 font-data text-micro transition-colors duration-120 ease-snap',
                                    String(percent) === String(scale)
                                        ? 'border-accent bg-accent text-accent-ink'
                                        : 'border-line text-ink hover:bg-surface-sunken',
                                ].join(' ')}
                            >
                                {percent}%
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {outputPreview ? (
                <p className="font-data text-micro text-ink-muted" aria-live="polite">
                    Output {outputPreview}
                </p>
            ) : null}
        </div>
    );
}

/**
 * Batch controls. These are the default target for every file in the list;
 * "Pin these values" fastens the current ones onto the ticked files so a mixed
 * batch is possible without a per-file form.
 */
export function BulkSettings({
    mode,
    onModeChange,
    width,
    height,
    onWidthChange,
    onHeightChange,
    format,
    onFormatChange,
    selectedCount,
    totalCount,
    allSelected,
    onToggleAll,
    onApplyToSelected,
}) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
                <ModeSwitch mode={mode} onModeChange={onModeChange} />

                <Field id="bulk-format" label="Output format" className="min-w-48 flex-1 sm:max-w-72">
                    <select
                        id="bulk-format"
                        value={format}
                        onChange={(event) => onFormatChange(event.target.value)}
                        className={CONTROL}
                    >
                        {OUTPUT_FORMATS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                <Field id="bulk-width" label="Width (px)">
                    <input
                        id="bulk-width"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="Auto"
                        value={width}
                        onChange={(event) => onWidthChange(event.target.value)}
                        className={NUMBER_CONTROL}
                    />
                </Field>

                <Field id="bulk-height" label="Height (px)">
                    <input
                        id="bulk-height"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        step="1"
                        placeholder="Auto"
                        value={height}
                        onChange={(event) => onHeightChange(event.target.value)}
                        className={NUMBER_CONTROL}
                    />
                </Field>
            </div>

            <p className="text-micro text-ink-muted">
                Leave a side empty and it is worked out from the other one. These values apply to every file
                below unless you pin different ones to a few of them.
            </p>

            {totalCount > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={onToggleAll}
                        className="rounded-button border border-line px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken"
                    >
                        {allSelected ? 'Clear selection' : 'Select all'}
                    </button>

                    <button
                        type="button"
                        onClick={onApplyToSelected}
                        disabled={selectedCount === 0}
                        className="rounded-button border border-line px-3 py-1.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:opacity-60"
                    >
                        Pin these values to {selectedCount} selected
                    </button>

                    <p className="font-data text-micro text-ink-muted">
                        {selectedCount}/{totalCount} selected
                    </p>
                </div>
            ) : null}
        </div>
    );
}
