/**
 * Byte Formatting
 *
 * One formatter for every byte count shown in the product, so the tools and
 * the dashboard never disagree about units.
 */

const UNITS = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Formats a byte count for display. Anything that is not a finite, positive
 * number renders as '0 Bytes' rather than 'NaN undefined'.
 */
export function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
        return '0 Bytes';
    }

    let value = bytes;
    let unit = 0;

    // Divide rather than use logarithms: log-based indexing drifts at exact
    // powers of 1024 and can overflow the unit table.
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }

    return `${parseFloat(value.toFixed(2))} ${UNITS[unit]}`;
}
