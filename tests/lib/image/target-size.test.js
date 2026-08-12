/**
 * The pure half of exact-size targeting: the strict parser that guards the
 * `targetBytes` field and the wording of the message a caller gets when no
 * encode can reach their number. The search itself needs an encoder, so it is
 * pinned in tests/api/compress-target.test.js against a deterministic sharp.
 */
import { describe, expect, it } from 'vitest';
import { MAX_TARGET_BYTES, MIN_TARGET_BYTES } from '@/lib/constants';
import { bytesToKb, impossibleTargetMessage, parseTargetBytes } from '@/lib/image/target-size';

const RANGE_ERROR = 'Target size must be a whole number of bytes between 10 KB and 20 MB.';

describe('parseTargetBytes', () => {
    it.each([
        ['the exact floor', String(MIN_TARGET_BYTES), MIN_TARGET_BYTES],
        ['the exact ceiling', String(MAX_TARGET_BYTES), MAX_TARGET_BYTES],
        ['100 KB', '102400', 102400],
        ['a padded string', '  51200  ', 51200],
        ['a real number', 51200, 51200],
    ])('accepts %s', (_label, raw, expected) => {
        expect(parseTargetBytes(raw)).toEqual({ ok: true, value: expected });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
    ])('reports %s as absent, not invalid', (_label, raw) => {
        const result = parseTargetBytes(raw);

        expect(result.ok).toBe(false);
        expect(result.absent).toBe(true);
    });

    // parseInt would read every one of these as a number: '50000abc' as 50000,
    // '1e6' as 1, '  ' as NaN. A strict pattern is the whole point.
    it.each([
        ['an empty string', ''],
        ['whitespace only', '   '],
        ['non-numeric', 'abc'],
        ['a trailing suffix', '50000abc'],
        ['exponent notation', '1e6'],
        ['a fractional string', '51200.5'],
        ['a negative string', '-51200'],
        ['a leading plus', '+51200'],
        ['a hex literal', '0x1000'],
        ['a thousands separator', '102,400'],
        ['a unit suffix', '100KB'],
        ['zero', '0'],
        ['one byte below the floor', String(MIN_TARGET_BYTES - 1)],
        ['one byte above the ceiling', String(MAX_TARGET_BYTES + 1)],
        ['a fractional number', 51200.5],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
        ['a negative number', -1],
        ['a boolean', true],
        ['an array', [51200]],
        ['a plain object', {}],
    ])('rejects %s as invalid, not absent', (_label, raw) => {
        const result = parseTargetBytes(raw);

        expect(result).toMatchObject({ ok: false, absent: false, error: RANGE_ERROR });
    });

    // FormData.get returns a File when a client posts the field as a file part,
    // and a File has no usable numeric value at all.
    it('rejects a File posted under the field name', () => {
        const file = new File([Buffer.from('102400')], 'target.txt', { type: 'text/plain' });

        expect(parseTargetBytes(file)).toMatchObject({ ok: false, absent: false, error: RANGE_ERROR });
    });

    it('states both bounds in the error, in the units the control uses', () => {
        expect(parseTargetBytes('1').error).toContain('10 KB');
        expect(parseTargetBytes('1').error).toContain('20 MB');
    });

    it('honours caller-supplied bounds', () => {
        expect(parseTargetBytes('2048', { min: 1024, max: 4096 })).toEqual({ ok: true, value: 2048 });
        expect(parseTargetBytes('8192', { min: 1024, max: 4096 }).ok).toBe(false);
    });
});

describe('bytesToKb', () => {
    it.each([
        [1024, 1],
        [102400, 100],
        [51200, 50],
        [20971520, 20480],
    ])('renders %i bytes as %i KB', (bytes, kb) => {
        expect(bytesToKb(bytes)).toBe(kb);
    });

    it('never rounds a real file down to zero', () => {
        expect(bytesToKb(1)).toBe(1);
        expect(bytesToKb(200)).toBe(1);
    });

    it.each([
        ['zero', 0],
        ['a negative', -100],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['a string', '1024'],
        ['undefined', undefined],
    ])('renders %s as 0', (_label, input) => {
        expect(bytesToKb(input)).toBe(0);
    });

    it('rounds up when asked, so a quoted floor is one the user can retry with', () => {
        expect(bytesToKb(43000, Math.ceil)).toBe(42);
        expect(bytesToKb(43000)).toBe(42);
        expect(bytesToKb(42500, Math.ceil)).toBe(42);
        expect(bytesToKb(42600, Math.ceil)).toBe(42);
        expect(bytesToKb(43009, Math.ceil)).toBe(43);
    });
});

describe('impossibleTargetMessage', () => {
    it('names the target that was asked for and the floor that was measured', () => {
        expect(impossibleTargetMessage(20480, 43008))
            .toBe('Cannot reach 20 KB for this image. Smallest achievable is 42 KB — raise the target.');
    });

    it('rounds the floor up so the quoted number is actually reachable', () => {
        expect(impossibleTargetMessage(10240, 43009)).toContain('Smallest achievable is 43 KB');
    });

    it('never blames the caller and never says the word failed', () => {
        const message = impossibleTargetMessage(10240, 51200);

        expect(message).not.toMatch(/failed|invalid|error|sorry/i);
        expect(message).toMatch(/raise the target/);
    });
});
