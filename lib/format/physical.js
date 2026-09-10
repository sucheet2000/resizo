/**
 * Physical Size Conversion
 *
 * A government passport photo requirement is usually stated in millimetres or
 * inches, not pixels — this is the one place that turns one into the other,
 * so /passport-photo's presets and its custom-size fields both go through the
 * same rounding instead of two copies drifting apart.
 *
 * Pure and DOM-free like the rest of lib/format/: the worker imports this
 * module too, so it must never import React or the catalogue.
 *
 * Unlike formatFileSize, which quietly returns a fallback string for bad
 * input, these throw. A byte count is display-only; a mis-parsed physical
 * size becomes the pixel dimensions of a photo someone submits to a
 * government office, so a silent 0 or NaN here is the wrong failure mode —
 * callers are expected to validate user input before reaching this module.
 */

export const MM_PER_INCH = 25.4;

function assertPositiveFinite(value, description) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${description} must be a positive number. Received ${value}.`);
    }
}

/** unit: 'mm' | 'cm' | 'in'. Throws on a non-finite/zero/negative value or an unrecognised unit. */
export function toMillimetres(value, unit) {
    assertPositiveFinite(value, 'Physical size');

    switch (unit) {
        case 'mm':
            return value;
        case 'cm':
            return value * 10;
        case 'in':
            return value * MM_PER_INCH;
        default:
            throw new Error(`Unrecognised unit "${unit}". Use "mm", "cm", or "in".`);
    }
}

/**
 * Whole pixels for a physical size at a given DPI. Note that 2 in and 51 mm
 * are NOT the same length (2 in is exactly 50.8 mm) — a government page that
 * restates "2 x 2 inches" as "51 x 51 mm" has already rounded, so the two
 * forms land on different pixel counts at the same DPI (600 px vs 602 px at
 * 300 DPI) even though both describe "the same" printed photo.
 */
export function pixelsFor(value, unit, dpi) {
    const mm = toMillimetres(value, unit);
    assertPositiveFinite(dpi, 'DPI');

    return Math.round((mm / MM_PER_INCH) * dpi);
}

/** e.g. describePhysical(35, 45) -> '35 × 45 mm (1.38 × 1.77 in)'. */
export function describePhysical(widthMm, heightMm) {
    const widthIn = (widthMm / MM_PER_INCH).toFixed(2);
    const heightIn = (heightMm / MM_PER_INCH).toFixed(2);
    return `${widthMm} × ${heightMm} mm (${widthIn} × ${heightIn} in)`;
}
