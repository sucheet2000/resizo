'use client';

/**
 * RecoveryOptions
 *
 * /passport-photo built this Alert-plus-buttons block inline, one boolean per
 * button, computed from the failure code and the current format by hand.
 * /image-size-fitter needs the identical buttons for the identical two
 * failures, so the vocabulary moved into `lib/format/fit-requirements.js`'s
 * `recoveryFor(code, { format, isCustom })`, which returns exactly the
 * buttons this failure and this format actually have — 'lower-quality' |
 * 'webp' | 'limit' for a ceiling nothing could fit under, 'png' | 'size' |
 * 'minimum' for a floor nothing could climb to, in that order.
 *
 * This component renders whichever of those it is handed and nothing else.
 * It does not know what a failure code is; the caller decides `options`
 * (empty when the failure has no recovery — a memory refusal, say — in which
 * case the caller shows a plain message elsewhere instead of this component).
 */
import Alert from '@/components/ui/Alert';

// min-h-11 (44px) on every touch control here, matching the tap-target floor
// components/tools/FrameCrop.js's own buttons already set.
const RECOVERY_BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-button border border-line bg-surface-raised px-3 text-ui font-medium text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken';

const BUTTONS = [
    { key: 'lower-quality', label: 'Allow lower quality', handlerProp: 'onAllowLowerQuality' },
    { key: 'webp', label: 'Switch to WebP', handlerProp: 'onSwitchToWebp' },
    { key: 'limit', label: 'Change the limit', handlerProp: 'onChangeLimit' },
    { key: 'png', label: 'Switch to PNG', handlerProp: 'onSwitchToPng' },
    { key: 'size', label: 'Change the size', handlerProp: 'onChangeSize' },
    { key: 'minimum', label: 'Change the minimum', handlerProp: 'onChangeMinimum' },
];

export default function RecoveryOptions({
    id,
    error,
    suggestion,
    options = [],
    onAllowLowerQuality,
    onSwitchToWebp,
    onChangeLimit,
    onSwitchToPng,
    onChangeSize,
    onChangeMinimum,
    className = '',
}) {
    if (!error) return null;

    const handlers = {
        onAllowLowerQuality,
        onSwitchToWebp,
        onChangeLimit,
        onSwitchToPng,
        onChangeSize,
        onChangeMinimum,
    };

    return (
        <Alert id={id} tabIndex={-1} className={className}>
            <span className="block">{error}</span>
            {suggestion ? <span className="mt-1 block text-ink-muted">{suggestion}</span> : null}
            <span className="mt-3 flex flex-wrap gap-3">
                {BUTTONS.filter((button) => options.includes(button.key)).map((button) => (
                    <button
                        key={button.key}
                        type="button"
                        onClick={handlers[button.handlerProp]}
                        className={RECOVERY_BUTTON}
                    >
                        {button.label}
                    </button>
                ))}
            </span>
        </Alert>
    );
}
