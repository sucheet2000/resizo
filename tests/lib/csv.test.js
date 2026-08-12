import { describe, expect, it } from 'vitest';
import { buildCsv, escapeCsvCell } from '@/lib/csv';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

describe('escapeCsvCell', () => {
    it('leaves a plain value alone', () => {
        expect(escapeCsvCell('photo')).toBe('photo');
        expect(escapeCsvCell('photo 2024.jpg')).toBe('photo 2024.jpg');
    });

    describe('RFC 4180 quoting', () => {
        it('quotes a value containing a comma', () => {
            expect(escapeCsvCell('a,b')).toBe('"a,b"');
        });

        it('doubles embedded quotes', () => {
            expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
        });

        it('quotes a value containing a line feed', () => {
            expect(escapeCsvCell(`line1${LF}line2`)).toBe(`"line1${LF}line2"`);
        });

        it('quotes a value containing a lone carriage return', () => {
            expect(escapeCsvCell(`line1${CR}line2`)).toBe(`"line1${CR}line2"`);
        });

        it('quotes a CRLF pair', () => {
            expect(escapeCsvCell(`line1${CR}${LF}line2`)).toBe(`"line1${CR}${LF}line2"`);
        });
    });

    describe('empty and non-string values', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['an empty string', ''],
        ])('renders %s as an empty cell', (_label, value) => {
            expect(escapeCsvCell(value)).toBe('');
        });

        it('renders 0 as "0" rather than an empty cell', () => {
            expect(escapeCsvCell(0)).toBe('0');
        });

        it('renders false as "false" rather than an empty cell', () => {
            expect(escapeCsvCell(false)).toBe('false');
        });

        it.each([
            [42, '42'],
            [true, 'true'],
            [3.5, '3.5'],
        ])('stringifies %s', (value, expected) => {
            expect(escapeCsvCell(value)).toBe(expected);
        });

        it('does not throw on an object', () => {
            expect(() => escapeCsvCell({})).not.toThrow();
        });
    });

    describe('spreadsheet formula injection', () => {
        it.each([
            ['=1+1', "'=1+1"],
            ['+1', "'+1"],
            ['-1', "'-1"],
            ['@SUM(1)', "'@SUM(1)"],
        ])('neutralizes %s', (value, expected) => {
            expect(escapeCsvCell(value)).toBe(expected);
        });

        it('neutralizes a leading tab', () => {
            expect(escapeCsvCell(`${TAB}=1`)).toBe(`'${TAB}=1`);
        });

        it('neutralizes a leading carriage return and quotes the result', () => {
            expect(escapeCsvCell(`${CR}=1`)).toBe(`"'${CR}=1"`);
        });

        it('neutralizes a HYPERLINK payload and keeps it quoted', () => {
            expect(escapeCsvCell('=HYPERLINK("http://evil","click")'))
                .toBe('"\'=HYPERLINK(""http://evil"",""click"")"');
        });

        it('neutralizes a negative number cell', () => {
            expect(escapeCsvCell(-5)).toBe("'-5");
        });

        it('leaves a value with an inner equals sign alone', () => {
            expect(escapeCsvCell('a=1')).toBe('a=1');
        });

        it('never starts a cell with a bare formula character', () => {
            const payloads = ['=cmd', '+cmd', '-cmd', '@cmd', `${TAB}cmd`, `${CR}cmd`, '=1+1', '@SUM(A1)'];
            for (const payload of payloads) {
                const cell = escapeCsvCell(payload);
                const first = cell.startsWith('"') ? cell[1] : cell[0];
                expect(first).toBe("'");
            }
        });
    });
});

describe('buildCsv', () => {
    it('joins cells with commas and rows with CRLF', () => {
        expect(buildCsv([['a', 'b'], ['1', '2']])).toBe(`a,b${CR}${LF}1,2`);
    });

    it('emits a header-only file without a trailing newline', () => {
        expect(buildCsv([['filename', 'size']])).toBe('filename,size');
    });

    it.each([
        ['an empty list', []],
        ['null', null],
        ['undefined', undefined],
        ['a string', 'a,b'],
        ['an object', {}],
    ])('returns an empty string for %s', (_label, rows) => {
        expect(buildCsv(rows)).toBe('');
    });

    it('skips entries that are not rows', () => {
        expect(buildCsv([['a'], null, ['b'], 'c'])).toBe(`a${CR}${LF}b`);
    });

    it('escapes every cell it writes', () => {
        expect(buildCsv([['name'], ['a,b'], ['=1+1']])).toBe(`name${CR}${LF}"a,b"${CR}${LF}'=1+1`);
    });

    it('keeps a filename containing a lone carriage return inside one row', () => {
        const csv = buildCsv([['filename'], [`photo${CR}evil.jpg`]]);
        expect(csv.split(`${CR}${LF}`)).toHaveLength(2);
    });

    it('handles 10k rows with the right row count', () => {
        const rows = [['filename', 'bytes']];
        for (let index = 0; index < 10000; index += 1) {
            rows.push([`photo-${index}.jpg`, index]);
        }
        const csv = buildCsv(rows);
        expect(csv.split(`${CR}${LF}`)).toHaveLength(10001);
        expect(csv.endsWith('photo-9999.jpg,9999')).toBe(true);
    });
});
