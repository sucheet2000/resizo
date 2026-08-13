/**
 * The exact-size search itself: lib/image-client/target-bytes.js.
 *
 * `parseTargetBytes` was already reached from tests/lib/constants.test.js, but
 * the three things around it were not tested by anything: the kilobyte
 * formatter, the sentence a user sees when no encoder can reach their target,
 * and the binary search both /compress and /jpg-to-pdf are built on.
 *
 * That the search was untested directly is not the same as untested at all —
 * compress-target.test.js drives it through real MozJPEG encodes. But an
 * end-to-end suite can only see the FILE the search returned, and the search's
 * contract is finer than that: which value it probes next, how many probes it
 * spends, what it hands back when nothing fits, and when it stops early. This
 * file drives it with a synthetic probe so each of those is a separate claim.
 *
 * Measured gap that motivated the file: rounding the floor DOWN in
 * impossibleTargetMessage — quoting a number the user cannot actually retry
 * with — survived the whole 2238-test suite unnoticed.
 */
import { describe, expect, it, vi } from 'vitest';

import { MIN_TARGET_BYTES, TARGET_SEARCH_ITERATIONS } from '@/lib/constants';
import {
    bytesToKb,
    impossibleTargetMessage,
    parseTargetBytes,
    searchQuality,
    searchScale,
    MAX_SCALE_PERCENT,
    MIN_SCALE_PERCENT,
} from '@/lib/image-client/target-bytes';

/* ------------------------------------------------------------------ *
 * Kilobytes, for a person to read
 * ------------------------------------------------------------------ */

describe('turning bytes into the number a person is shown', () => {
    it.each([
        [1024, 1],
        [10 * 1024, 10],
        [102_400, 100],
        [1_048_576, 1024],
    ])('%i bytes reads as %i KB', (bytes, kb) => {
        expect(bytesToKb(bytes)).toBe(kb);
    });

    /** Anything real is at least a kilobyte on screen; "0 KB" is never useful. */
    it('never rounds a real file down to nothing', () => {
        expect(bytesToKb(1)).toBe(1);
        expect(bytesToKb(511)).toBe(1);
    });

    it.each([
        ['zero', 0],
        ['a negative', -2048],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['a string', '10240'],
        ['nothing', undefined],
    ])('answers 0 for %s rather than printing nonsense', (_label, input) => {
        expect(bytesToKb(input)).toBe(0);
    });

    it('rounds to nearest by default and up when asked', () => {
        expect(bytesToKb(1536)).toBe(2);
        expect(bytesToKb(1537, Math.ceil)).toBe(2);
        expect(bytesToKb(1025, Math.ceil)).toBe(2);
        expect(bytesToKb(1025)).toBe(1);
    });
});

/* ------------------------------------------------------------------ *
 * The sentence for a target nothing can reach
 * ------------------------------------------------------------------ */

describe('the message for a target no encoder can hit', () => {
    it('quotes what was asked for and what is actually achievable', () => {
        expect(impossibleTargetMessage(50 * 1024, 84 * 1024)).toBe(
            'Cannot reach 50 KB for this image. Smallest achievable is 84 KB. Raise the target.',
        );
    });

    /**
     * THE FLOOR IS ROUNDED UP, AND THAT IS THE WHOLE POINT OF THE SECOND
     * ARGUMENT TO bytesToKb.
     *
     * The smallest this image can be made is 84,000 bytes. Rounded to nearest
     * that reads as 82 KB — and a user who obediently retries at 82 KB gets the
     * identical refusal, because 82 KB is 83,968 bytes and the real floor is
     * above it. Rounded up it reads 83 KB, which is 84,992 bytes and is a target
     * the encoder can actually meet. Only one of those two sentences is advice.
     *
     * This exact defect — nearest instead of up — survived the whole existing
     * suite when it was introduced deliberately.
     */
    it('rounds the achievable floor UP, so the number quoted back can be retried', () => {
        const smallest = 84_000;

        expect(bytesToKb(smallest)).toBe(82);
        expect(bytesToKb(smallest, Math.ceil)).toBe(83);
        expect(83 * 1024).toBeGreaterThan(smallest);
        expect(82 * 1024).toBeLessThan(smallest);

        expect(impossibleTargetMessage(50 * 1024, smallest)).toBe(
            'Cannot reach 50 KB for this image. Smallest achievable is 83 KB. Raise the target.',
        );
    });

    it('does not round the requested target up, because that number was theirs', () => {
        expect(impossibleTargetMessage(84_000, 90_000)).toContain('Cannot reach 82 KB');
    });
});

/* ------------------------------------------------------------------ *
 * The search
 * ------------------------------------------------------------------ */

/**
 * A stand-in encoder whose output size rises with the value it is handed —
 * which is the monotonicity assumption the whole search rests on.
 */
function linearProbe(bytesAt) {
    const seen = [];
    const probe = vi.fn(async (value) => {
        seen.push(value);
        return { bytes: bytesAt(value), payload: { value, bytes: bytesAt(value) } };
    });
    return { probe, seen };
}

const NEVER = { deadline: Number.POSITIVE_INFINITY, now: () => 0 };

describe('searching the quality axis', () => {
    it('searches the whole 1-100 range and lands on the largest quality that fits', async () => {
        const { probe, seen } = linearProbe((quality) => quality * 100);

        const result = await searchQuality({ probe, targetBytes: 4550, ...NEVER });

        expect(result.fitValue).toBe(45);
        expect(result.fitBytes).toBe(4500);
        expect(result.fit).toEqual({ value: 45, bytes: 4500 });
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...seen)).toBeLessThanOrEqual(100);
    });

    /**
     * It has to be a BISECTION. A linear walk from one end reaches the same
     * answer on a toy probe and costs eight real MozJPEG encodes on a phone to
     * move eight quality points — which is the difference between a tool that
     * works and one that times out.
     */
    it('bisects rather than walking, so 100 qualities cost seven probes and not ninety-nine', async () => {
        const { probe, seen } = linearProbe((quality) => quality * 100);

        await searchQuality({ probe, targetBytes: 4550, ...NEVER });

        expect(seen[0]).toBe(50);
        expect(seen[1]).toBe(25);
        expect(probe.mock.calls.length).toBeLessThanOrEqual(7);
    });

    it('spends no more than the published probe budget', async () => {
        const { probe } = linearProbe((quality) => quality);

        const result = await searchQuality({ probe, targetBytes: 1_000_000, ...NEVER });

        expect(result.iterations).toBeLessThanOrEqual(TARGET_SEARCH_ITERATIONS);
    });

    it('honours a smaller budget when one is given', async () => {
        const { probe } = linearProbe((quality) => quality * 100);

        const result = await searchQuality({ probe, targetBytes: 4550, maxIterations: 2, ...NEVER });

        expect(result.iterations).toBe(2);
        expect(probe).toHaveBeenCalledTimes(2);
    });

    /**
     * Nothing fits. `fit` is null — there is no file to hand back — but `floor`
     * carries the smallest output the search ever managed, which is what turns
     * a bare failure into "smallest achievable is N KB".
     */
    it('reports the smallest output it managed when nothing fits at all', async () => {
        const { probe } = linearProbe((quality) => 90_000 + quality);

        const result = await searchQuality({ probe, targetBytes: 10_000, ...NEVER });

        expect(result.fit).toBeNull();
        expect(result.fitBytes).toBeNull();
        expect(result.fitValue).toBeNull();
        expect(result.floorBytes).toBe(90_001);
        expect(result.floor).toEqual({ value: 1, bytes: 90_001 });
    });

    it('takes the top of the range when even the largest output fits', async () => {
        const { probe } = linearProbe((quality) => quality);

        const result = await searchQuality({ probe, targetBytes: 1_000_000, ...NEVER });

        expect(result.fitValue).toBe(100);
    });

    it('reports every probe as progress, in order, against the same total', async () => {
        const { probe } = linearProbe((quality) => quality * 100);
        const onIteration = vi.fn();

        await searchQuality({ probe, targetBytes: 4550, maxIterations: 3, onIteration, ...NEVER });

        expect(onIteration.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    /**
     * A pathological input must not spin a tab forever. The clock is injected,
     * so this is a real assertion about the deadline and not a sleep.
     */
    it('stops at the deadline and hands back the best fit it had found', async () => {
        const { probe } = linearProbe((quality) => quality * 100);
        let clock = 0;
        const now = () => { clock += 500; return clock; };

        const result = await searchQuality({ probe, targetBytes: 4550, deadline: 1200, now });

        expect(result.iterations).toBe(2);
        expect(result.fitValue).toBe(25);
    });

    it('stops when the probe gives up and returns nothing', async () => {
        const probe = vi.fn(async () => null);

        const result = await searchQuality({ probe, targetBytes: 5000, ...NEVER });

        expect(probe).toHaveBeenCalledTimes(1);
        expect(result.fit).toBeNull();
        expect(result.floor).toBeNull();
    });
});

describe('searching the scale axis', () => {
    /** PNG's only lever here, since @jsquash/png has no quantiser to turn. */
    it('stays inside the published 10-99 percent bounds', async () => {
        const { probe, seen } = linearProbe((percent) => percent * 1000);

        await searchScale({ probe, targetBytes: 1, ...NEVER });

        expect(Math.min(...seen)).toBeGreaterThanOrEqual(MIN_SCALE_PERCENT);
        expect(Math.max(...seen)).toBeLessThanOrEqual(MAX_SCALE_PERCENT);
    });

    it('never returns a scale below the floor, however small the target', async () => {
        const { probe } = linearProbe((percent) => percent * 1000);

        const result = await searchScale({ probe, targetBytes: 100, ...NEVER });

        expect(result.fit).toBeNull();
        expect(result.floor.value).toBe(MIN_SCALE_PERCENT);
    });

    it('never returns a scale above the ceiling, because 100 percent is no shrink at all', async () => {
        const { probe } = linearProbe((percent) => percent);

        const result = await searchScale({ probe, targetBytes: 1_000_000, ...NEVER });

        expect(result.fitValue).toBe(MAX_SCALE_PERCENT);
    });

    it('lands on the largest scale that fits', async () => {
        const { probe } = linearProbe((percent) => percent * 1000);

        const result = await searchScale({ probe, targetBytes: 60_500, ...NEVER });

        expect(result.fitValue).toBe(60);
    });
});

/* ------------------------------------------------------------------ *
 * A parse case the boundary suite does not cover
 * ------------------------------------------------------------------ */

describe('telling "no target asked for" apart from "asked for and wrong"', () => {
    it.each([[null], [undefined]])('marks %s as absent, not as an error to show', (raw) => {
        expect(parseTargetBytes(raw)).toMatchObject({ ok: false, absent: true });
    });

    it.each([
        ['an empty string', ''],
        ['whitespace', '   '],
        ['scientific notation', '1e5'],
        ['a decimal', '10240.0'],
        ['a boolean', true],
        ['an object', {}],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ])('marks %s as present-but-invalid, which is a message a user must see', (_label, raw) => {
        expect(parseTargetBytes(raw)).toMatchObject({ ok: false, absent: false });
    });

    it('takes a plain number as well as a string, since the engine passes both', () => {
        expect(parseTargetBytes(MIN_TARGET_BYTES)).toEqual({ ok: true, value: MIN_TARGET_BYTES });
        expect(parseTargetBytes(` ${MIN_TARGET_BYTES} `)).toEqual({ ok: true, value: MIN_TARGET_BYTES });
    });
});
