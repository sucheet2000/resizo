/**
 * CSV Building
 *
 * RFC 4180 quoting plus a spreadsheet formula-injection guard: exported
 * filenames are attacker-supplied, so a cell starting with '=', '+', '-', '@',
 * TAB or CR is prefixed with a single quote before it can be evaluated by
 * Excel or Sheets.
 */

const NEEDS_QUOTING = /[",\n\r]/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value) {
    if (value === null || value === undefined) return '';

    let cell = String(value);
    if (cell === '') return '';

    if (FORMULA_PREFIX.test(cell)) {
        cell = `'${cell}`;
    }

    if (NEEDS_QUOTING.test(cell)) {
        return `"${cell.replace(/"/g, '""')}"`;
    }

    return cell;
}

/**
 * Joins rows (arrays of cells) into a CRLF-terminated CSV body. Pass the
 * header row as the first entry.
 */
export function buildCsv(rows) {
    if (!Array.isArray(rows)) return '';

    return rows
        .filter((row) => Array.isArray(row))
        .map((row) => row.map(escapeCsvCell).join(','))
        .join('\r\n');
}
