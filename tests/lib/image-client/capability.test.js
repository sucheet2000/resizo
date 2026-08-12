/**
 * The pre-flight gate.
 *
 * This is the one module in the engine that has to be right before anything
 * else runs, because the failure it prevents is not an exception — on iOS an
 * over-committed tab is killed silently and the user's photo is simply gone.
 * There is no catch block for that, so the arithmetic here is the only defence
 * and every threshold is tested AT the boundary and one step past it.
 *
 * Everything in this file is pure. No codec is loaded and no pixel is
 * allocated, which is exactly the property being tested: the gate must be able
 * to say no before any memory is spent.
 */
import { describe, expect, it } from 'vitest';
import {
    assessFile,
    assessJob,
    assessPixels,
    deviceBudgetBytes,
    estimatePeakBytes,
    nativeDownscaleSupported,
    readDeviceProfile,
    refusalMessage,
    wasmSupported,
    BYTES_PER_PIXEL,
    COMFORTABLE_ENCODE_PIXELS,
    HARD_MAX_SOURCE_PIXELS,
    MAX_TAB_BUDGET_BYTES,
    MIN_TAB_BUDGET_BYTES,
    WASM_BASELINE_BYTES,
} from '@/lib/image-client/capability';
import { MAX_DIMENSION, MAX_FILE_SIZE, MAX_PIXELS } from '@/lib/constants';
import { makeFile } from './helpers/fixtures';

const GIB = 1024 * 1024 * 1024;

function device({ memoryGb = 4, ios = false, wasm = true, nativeDownscale = false } = {}) {
    return { memoryGb, memoryReported: true, cores: 8, ios, nativeDownscale, wasm };
}

describe('what the device says about itself', () => {
    it('uses navigator.deviceMemory when the browser reports it', () => {
        expect(readDeviceProfile({ deviceMemory: 8 })).toMatchObject({ memoryGb: 8, memoryReported: true });
    });

    it('falls back to the 2021-phone assumption when nothing is reported', () => {
        expect(readDeviceProfile({})).toMatchObject({ memoryGb: 4, memoryReported: false, cores: null });
    });

    it.each([
        [16, 6],
        [8, 6],
        [7, 4],
        [6, 4],
        [5, 3],
        [4, 3],
        [1, 3],
    ])('guesses %i cores as %i GB when deviceMemory is missing', (cores, memoryGb) => {
        expect(readDeviceProfile({ hardwareConcurrency: cores })).toMatchObject({ memoryGb, memoryReported: false, cores });
    });

    it.each([
        ['zero', 0],
        ['negative', -4],
        ['not a number', 'lots'],
        ['NaN', Number.NaN],
    ])('ignores a %s deviceMemory and uses the core count instead', (_label, deviceMemory) => {
        expect(readDeviceProfile({ deviceMemory, hardwareConcurrency: 8 }))
            .toMatchObject({ memoryGb: 6, memoryReported: false });
    });

    it.each([
        ['an iPhone by platform', { platform: 'iPhone' }, true],
        ['an iPad by user agent', { platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' }, true],
        ['an iPadOS device pretending to be a Mac', { platform: 'MacIntel', maxTouchPoints: 5 }, true],
        ['a real Mac', { platform: 'MacIntel', maxTouchPoints: 0 }, false],
        ['a Windows machine', { platform: 'Win32' }, false],
    ])('spots %s', (_label, navigatorLike, ios) => {
        expect(readDeviceProfile(navigatorLike).ios).toBe(ios);
    });

    it('reads the real environment when handed no navigator', () => {
        const profile = readDeviceProfile();

        expect(profile.memoryGb).toBeGreaterThan(0);
        expect(profile.wasm).toBe(wasmSupported());
        expect(profile.nativeDownscale).toBe(nativeDownscaleSupported());
    });
});

describe('capability probes', () => {
    it('finds WebAssembly in this environment', () => {
        expect(wasmSupported()).toBe(true);
    });

    /**
     * Node has neither createImageBitmap nor OffscreenCanvas, so every test in
     * this suite exercises the WASM path — which is the fallback the browser
     * uses whenever its own decoder refuses a file, and the only path HEIC ever
     * takes. The native 110 ms route is a browser-only optimisation and is
     * covered by the Playwright suite, not here.
     */
    it('correctly reports that this environment has no native downscale', () => {
        expect(nativeDownscaleSupported()).toBe(false);
    });

    it('reports a native downscale once both browser APIs exist', () => {
        globalThis.createImageBitmap = () => {};
        globalThis.OffscreenCanvas = class {};

        try {
            expect(nativeDownscaleSupported()).toBe(true);
        } finally {
            delete globalThis.createImageBitmap;
            delete globalThis.OffscreenCanvas;
        }
    });

    it('needs BOTH APIs, not either one', () => {
        globalThis.createImageBitmap = () => {};

        try {
            expect(nativeDownscaleSupported()).toBe(false);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });
});

describe('the memory budget for one tab', () => {
    it('gives a 4 GB phone a quarter of its memory, which lands exactly on the ceiling', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 4 }))).toBe(MAX_TAB_BUDGET_BYTES);
        expect(MAX_TAB_BUDGET_BYTES).toBe(4 * GIB * 0.25);
    });

    it('gives a 2 GB device half a gigabyte', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 2 }))).toBe(512 * 1024 * 1024);
    });

    it('caps a 32 GB desktop at the ceiling rather than planning an 8 GB job', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 32 }))).toBe(MAX_TAB_BUDGET_BYTES);
    });

    it('lands exactly on the floor at 0.75 GB', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 0.75 }))).toBe(MIN_TAB_BUDGET_BYTES);
    });

    it('never goes below the floor, however little the device claims', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 0.5 }))).toBe(MIN_TAB_BUDGET_BYTES);
        expect(deviceBudgetBytes(device({ memoryGb: 0.01 }))).toBe(MIN_TAB_BUDGET_BYTES);
    });

    it('takes the extra iOS haircut, because iOS gives no warning before it kills the tab', () => {
        expect(deviceBudgetBytes(device({ memoryGb: 4, ios: true })))
            .toBe(Math.floor(MAX_TAB_BUDGET_BYTES * 0.6));
        expect(deviceBudgetBytes(device({ memoryGb: 4, ios: true })))
            .toBeLessThan(deviceBudgetBytes(device({ memoryGb: 4, ios: false })));
    });
});

describe('costing a job before it runs', () => {
    it('a 1000x1000 decode is two surfaces plus the codec baseline', () => {
        const surface = 1000 * 1000 * BYTES_PER_PIXEL;

        expect(estimatePeakBytes({ sourceWidth: 1000, sourceHeight: 1000, operation: 'decode' }))
            .toBe(surface * 2 + WASM_BASELINE_BYTES);
        expect(estimatePeakBytes({ sourceWidth: 1000, sourceHeight: 1000, operation: 'decode' }))
            .toBe(33_165_824);
    });

    it('counts the encoded file as resident during the decode', () => {
        const withFile = estimatePeakBytes({ sourceWidth: 1000, sourceHeight: 1000, operation: 'decode', fileBytes: 5_000_000 });

        expect(withFile - estimatePeakBytes({ sourceWidth: 1000, sourceHeight: 1000, operation: 'decode' }))
            .toBe(5_000_000);
    });

    /**
     * The worked example from the engine's design notes: a 12 MP phone photo
     * downscaled to 1920x1440 and re-encoded. The WASM resize stage dominates
     * (source twice plus destination twice); on the native path the decode
     * stage dominates instead, which is why the native route is cheaper on
     * memory as well as 15x faster.
     */
    it('prices the 12 MP resize job the design was built around', () => {
        const job = {
            sourceWidth: 4000,
            sourceHeight: 3000,
            targetWidth: 1920,
            targetHeight: 1440,
            fileBytes: 4 * 1024 * 1024,
            operation: 'resize',
        };

        expect(estimatePeakBytes({ ...job, nativeDownscale: false })).toBe(143_284_224);
        expect(estimatePeakBytes({ ...job, nativeDownscale: true })).toBe(125_360_128);
    });

    it('always prefers the native path on memory as well as on time', () => {
        const job = { sourceWidth: 4000, sourceHeight: 3000, targetWidth: 800, targetHeight: 600, operation: 'resize' };

        expect(estimatePeakBytes({ ...job, nativeDownscale: true }))
            .toBeLessThanOrEqual(estimatePeakBytes({ ...job, nativeDownscale: false }));
    });

    it('treats a missing target as a full-size job', () => {
        const explicit = estimatePeakBytes({ sourceWidth: 800, sourceHeight: 600, targetWidth: 800, targetHeight: 600 });

        expect(estimatePeakBytes({ sourceWidth: 800, sourceHeight: 600 })).toBe(explicit);
    });

    /**
     * A two-sided /resize scales the image until it COVERS the box and crops
     * the overflow off afterwards, so the surface that actually gets allocated
     * is bigger than the file the user ends up with. A gate that priced only
     * the output would wave through a job that cannot fit, and on iOS the tab
     * is killed for it without an exception to catch.
     */
    it('costs the covering surface, not the cropped-down output', () => {
        // A wide banner crop out of a small source: 1000x500 asked for
        // 4000x1000 covers at 4000x2000, which is twice the surface of the
        // output and the largest thing this job ever holds.
        const job = {
            sourceWidth: 1000,
            sourceHeight: 500,
            targetWidth: 4000,
            targetHeight: 1000,
            operation: 'resize',
            nativeDownscale: true,
        };

        const cropped = estimatePeakBytes(job);
        const covered = estimatePeakBytes({
            ...job,
            intermediateWidth: 4000,
            intermediateHeight: 2000,
        });

        expect(covered).toBeGreaterThan(cropped);
    });

    it('leaves every job that crops nothing costed exactly as before', () => {
        const job = { sourceWidth: 4000, sourceHeight: 3000, targetWidth: 800, targetHeight: 600, operation: 'resize' };

        expect(estimatePeakBytes({ ...job, intermediateWidth: 800, intermediateHeight: 600 }))
            .toBe(estimatePeakBytes(job));
    });

    it('costs a decode-only job below one that also encodes', () => {
        const shape = { sourceWidth: 2000, sourceHeight: 2000 };

        expect(estimatePeakBytes({ ...shape, operation: 'decode' }))
            .toBeLessThan(estimatePeakBytes({ ...shape, operation: 'convert' }));
    });

    it('costs a crop as a plain re-encode, because slicing a buffer only shrinks it', () => {
        const shape = { sourceWidth: 2000, sourceHeight: 2000 };

        expect(estimatePeakBytes({ ...shape, operation: 'crop' }))
            .toBe(estimatePeakBytes({ ...shape, operation: 'convert' }));
    });

    it('falls back to the convert profile for an operation it has never heard of', () => {
        const shape = { sourceWidth: 1200, sourceHeight: 900 };

        expect(estimatePeakBytes({ ...shape, operation: 'teleport' }))
            .toBe(estimatePeakBytes({ ...shape, operation: 'convert' }));
    });

    it('scales linearly with the pixel count', () => {
        const small = estimatePeakBytes({ sourceWidth: 1000, sourceHeight: 1000, operation: 'decode' }) - WASM_BASELINE_BYTES;
        const large = estimatePeakBytes({ sourceWidth: 2000, sourceHeight: 2000, operation: 'decode' }) - WASM_BASELINE_BYTES;

        expect(large).toBe(small * 4);
    });
});

describe('the pixel gate', () => {
    it('passes an ordinary phone photo on an ordinary phone', () => {
        const verdict = assessPixels({
            sourceWidth: 4000,
            sourceHeight: 3000,
            targetWidth: 1920,
            targetHeight: 1440,
            operation: 'resize',
            device: device(),
        });

        expect(verdict).toMatchObject({ ok: true, code: 'ok', megapixels: 12 });
        expect(verdict.estimatedPeakBytes).toBeLessThan(verdict.budgetBytes);
    });

    it('passes a 1x1 image', () => {
        expect(assessPixels({ sourceWidth: 1, sourceHeight: 1, device: device() }))
            .toMatchObject({ ok: true, code: 'ok', megapixels: 0, suggestion: null });
    });

    it.each([
        ['zero width', 0, 100],
        ['a negative height', 100, -20],
        ['NaN', Number.NaN, 100],
        ['Infinity', Number.POSITIVE_INFINITY, 100],
        ['nothing at all', null, null],
    ])('refuses %s as unknown dimensions', (_label, sourceWidth, sourceHeight) => {
        expect(assessPixels({ sourceWidth, sourceHeight, device: device() }))
            .toMatchObject({ ok: false, code: 'unknown-dimensions' });
    });

    it('refuses everything when WebAssembly is switched off', () => {
        const verdict = assessPixels({ sourceWidth: 100, sourceHeight: 100, device: device({ wasm: false }) });

        expect(verdict).toMatchObject({ ok: false, code: 'no-wasm' });
        expect(verdict.reason).toMatch(/WebAssembly/);
    });

    it('accepts a source of exactly the hard maximum', () => {
        expect(assessPixels({
            sourceWidth: 10_000,
            sourceHeight: 8_000,
            targetWidth: 100,
            targetHeight: 100,
            device: device(),
        })).toMatchObject({ ok: true, code: 'ok' });

        expect(10_000 * 8_000).toBe(HARD_MAX_SOURCE_PIXELS);
    });

    it('refuses a source one pixel past the hard maximum', () => {
        const verdict = assessPixels({
            sourceWidth: 10_001,
            sourceHeight: 8_000,
            targetWidth: 100,
            targetHeight: 100,
            device: device(),
        });

        expect(verdict).toMatchObject({ ok: false, code: 'source-too-large' });
        expect(verdict.reason).toMatch(/80 megapixel limit/);
    });

    it('accepts an output of exactly the maximum dimension', () => {
        expect(assessPixels({
            sourceWidth: MAX_DIMENSION,
            sourceHeight: 10,
            device: device(),
        })).toMatchObject({ ok: true });
    });

    it('refuses an output one pixel wider than the maximum dimension', () => {
        expect(assessPixels({
            sourceWidth: 100,
            sourceHeight: 100,
            targetWidth: MAX_DIMENSION + 1,
            targetHeight: 10,
            device: device(),
        })).toMatchObject({ ok: false, code: 'output-too-large' });
    });

    it('accepts an output of exactly the pixel budget', () => {
        expect(8000 * 5000).toBe(MAX_PIXELS);

        expect(assessPixels({
            sourceWidth: 8000,
            sourceHeight: 5000,
            device: device({ memoryGb: 32 }),
        })).toMatchObject({ ok: true });
    });

    it('refuses an output one row past the pixel budget', () => {
        const verdict = assessPixels({
            sourceWidth: 8000,
            sourceHeight: 5001,
            device: device({ memoryGb: 32 }),
        });

        expect(verdict).toMatchObject({ ok: false, code: 'output-too-large' });
        expect(verdict.reason).toMatch(/40 megapixel limit/);
    });

    it('refuses a job that does not fit the device, in plain English', () => {
        const verdict = assessPixels({
            sourceWidth: 6000,
            sourceHeight: 4000,
            device: device({ memoryGb: 0.5 }),
        });

        expect(verdict).toMatchObject({ ok: false, code: 'not-enough-memory', megapixels: 24 });
        expect(verdict.reason).toMatch(/24 megapixel image needs about \d+ MB of memory/);
        expect(verdict.estimatedPeakBytes).toBeGreaterThan(verdict.budgetBytes);
    });

    it('accepts on a roomy device the same job it refuses on a small one', () => {
        const job = { sourceWidth: 6000, sourceHeight: 4000 };

        expect(assessPixels({ ...job, device: device({ memoryGb: 0.5 }) }).ok).toBe(false);
        expect(assessPixels({ ...job, device: device({ memoryGb: 8 }) }).ok).toBe(true);
    });

    it('stays quiet for an output at exactly the comfortable encode size', () => {
        expect(2000 * 2000).toBe(COMFORTABLE_ENCODE_PIXELS);

        expect(assessPixels({ sourceWidth: 2000, sourceHeight: 2000, device: device() }).suggestion)
            .toBeNull();
    });

    it('warns about the wait one row past it', () => {
        expect(assessPixels({ sourceWidth: 2000, sourceHeight: 2001, device: device() }).suggestion)
            .toMatch(/may take a few seconds/);
    });

    it('reports the numbers it decided on, whatever the verdict', () => {
        const verdict = assessPixels({ sourceWidth: 1200, sourceHeight: 900, device: device() });

        expect(verdict.budgetBytes).toBe(deviceBudgetBytes(device()));
        expect(verdict.megapixels).toBe(1.1);
        expect(verdict.device).toMatchObject({ memoryGb: 4 });
    });
});

describe('the full pre-flight gate for one file', () => {
    const bytes = Buffer.alloc(2048, 7);

    it('passes a valid file but says the dimensions are still unknown', () => {
        const verdict = assessFile(makeFile(bytes), { device: device() });

        expect(verdict).toMatchObject({
            ok: true,
            code: 'dimensions-unknown',
            dimensionsKnown: false,
            megapixels: null,
            estimatedPeakBytes: null,
        });
        expect(verdict.budgetBytes).toBe(deviceBudgetBytes(device()));
    });

    it('costs the job once the dimensions arrive', () => {
        const verdict = assessFile(makeFile(bytes), {
            sourceWidth: 4000,
            sourceHeight: 3000,
            targetWidth: 1000,
            targetHeight: 750,
            operation: 'resize',
            device: device(),
        });

        expect(verdict).toMatchObject({ ok: true, code: 'ok', dimensionsKnown: true, megapixels: 12 });
        expect(verdict.estimatedPeakBytes).toBeGreaterThan(0);
    });

    it('feeds the file size into the estimate', () => {
        const shape = { sourceWidth: 2000, sourceHeight: 2000, operation: 'decode', device: device() };

        const small = assessFile(makeFile(bytes, { size: 1024 }), shape);
        const large = assessFile(makeFile(bytes, { size: 8 * 1024 * 1024 }), shape);

        expect(large.estimatedPeakBytes - small.estimatedPeakBytes).toBe(8 * 1024 * 1024 - 1024);
    });

    it.each([
        ['nothing', null, 'No file provided in the request.'],
        ['a plain form field', 'width=100', 'No valid file was uploaded.'],
    ])('refuses %s', (_label, file, reason) => {
        expect(assessFile(file, { device: device() })).toMatchObject({ ok: false, code: 'invalid-file', reason });
    });

    it('refuses a PDF', () => {
        const file = makeFile(bytes, { name: 'contract.pdf', type: 'application/pdf' });

        expect(assessFile(file, { device: device() }))
            .toMatchObject({ ok: false, code: 'invalid-file', reason: 'Invalid file type. Only images are allowed.' });
    });

    it('refuses an empty file', () => {
        expect(assessFile(makeFile(bytes, { size: 0 }), { device: device() }))
            .toMatchObject({ ok: false, code: 'invalid-file', reason: 'The uploaded file is empty.' });
    });

    it('accepts a file of exactly the size limit and refuses one byte more', () => {
        expect(assessFile(makeFile(bytes, { size: MAX_FILE_SIZE }), { device: device() }).ok).toBe(true);

        const over = assessFile(makeFile(bytes, { size: MAX_FILE_SIZE + 1 }), { device: device() });

        expect(over).toMatchObject({ ok: false, code: 'invalid-file' });
        expect(over.reason).toMatch(/maximum allowed size of 20MB/);
    });

    it('accepts a HEIC that arrives with no MIME type at all, on the extension alone', () => {
        expect(assessFile(makeFile(bytes, { name: 'IMG_0042.HEIC', type: '' }), { device: device() }).ok).toBe(true);
    });

    it('runs the file gates before the pixel gates', () => {
        const verdict = assessFile('width=100', {
            sourceWidth: 999_999,
            sourceHeight: 999_999,
            device: device(),
        });

        expect(verdict.code).toBe('invalid-file');
    });

    it('works with no device argument, on whatever this environment is', () => {
        expect(assessFile(makeFile(bytes)).ok).toBe(true);
    });
});

/**
 * assessJob is the whole decision now.
 *
 * It used to be a boolean called canProcessLocally, living in a React hook,
 * answering "should this run here or be posted to the server?". There is no
 * server, so the question changed and so did the answer's shape: a refusal is
 * the final outcome for the visitor's file, which means it has to carry words
 * and not just `false`. Everything below is about that.
 */
describe('the one gate every job passes through', () => {
    const bytes = Buffer.alloc(64, 1);

    function file(overrides = {}) {
        return makeFile(bytes, { size: 1024, ...overrides });
    }

    it('lets an ordinary photo on an ordinary device through', () => {
        const verdict = assessJob(file(), {
            operation: 'resize',
            sourceWidth: 4032,
            sourceHeight: 3024,
            targetWidth: 1920,
            targetHeight: 1440,
            device: device(),
        });

        expect(verdict.ok).toBe(true);
        expect(verdict.reason).toBeNull();
    });

    it('refuses before anything else when WebAssembly is off', () => {
        // assessPixels only reaches its own no-wasm branch once the dimensions
        // are known. A browser with WASM off has to be told even for a file
        // nothing has measured, which is why this check is separate and first.
        const verdict = assessJob(file(), {
            operation: 'resize',
            device: device({ wasm: false }),
        });

        expect(verdict).toMatchObject({ ok: false, code: 'no-wasm' });
        expect(verdict.reason).toMatch(/WebAssembly/);
        expect(verdict.suggestion).toBeTruthy();
    });

    it.each([
        ['no file', null],
        ['no operation', undefined],
    ])('refuses with words rather than throwing when there is %s', (_label, given) => {
        const verdict = _label === 'no file'
            ? assessJob(given, { operation: 'resize', device: device() })
            : assessJob(file(), { operation: given, device: device() });

        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBeTruthy();
        expect(verdict.suggestion).toBeTruthy();
    });

    it('defers on dimensions it was not given, instead of reading them as zero', () => {
        // The HEIC tool has no preview to measure. Zero would be read as
        // "damaged" and would turn away every iPhone photo on the site.
        expect(assessJob(file(), { operation: 'heic', device: device() }))
            .toMatchObject({ ok: true, code: 'dimensions-unknown' });

        expect(assessJob(file(), {
            operation: 'heic',
            sourceWidth: 0,
            sourceHeight: 0,
            device: device(),
        })).toMatchObject({ ok: true, code: 'dimensions-unknown' });
    });

    it('passes a real measurement through to the pixel gate', () => {
        const verdict = assessJob(file(), {
            operation: 'resize',
            sourceWidth: 12_000,
            sourceHeight: 9_000,
            device: device(),
        });

        expect(verdict).toMatchObject({ ok: false, code: 'source-too-large' });
        expect(verdict.reason).toMatch(/108 megapixels/);
    });

    it('every refusal it can produce carries both a reason and a suggestion', () => {
        const refusals = [
            assessJob(file(), { operation: 'resize', device: device({ wasm: false }) }),
            assessJob(null, { operation: 'resize', device: device() }),
            assessJob(makeFile(bytes, { size: 0 }), { operation: 'resize', device: device() }),
            assessJob(file(), { operation: 'resize', sourceWidth: 12_000, sourceHeight: 9_000, device: device() }),
            assessJob(file(), {
                operation: 'resize', sourceWidth: 100, sourceHeight: 100, targetWidth: 9000, targetHeight: 9000, device: device(),
            }),
        ];

        for (const refusal of refusals) {
            expect(refusal.ok, `${refusal.code} should be a refusal`).toBe(false);
            expect(typeof refusal.reason, refusal.code).toBe('string');
            expect(refusal.reason, refusal.code).toMatch(/[.!?]$/);
            expect(typeof refusal.suggestion, refusal.code).toBe('string');
            expect(refusal.suggestion, refusal.code).toMatch(/[.!?]$/);
        }
    });
});

describe('turning a refusal into something a person reads', () => {
    it('joins the reason and the suggestion into one sentence pair', () => {
        expect(refusalMessage({ reason: 'That is too big.', suggestion: 'Try a smaller one.' }))
            .toBe('That is too big. Try a smaller one.');
    });

    it('uses the reason alone when there is no advice to give', () => {
        expect(refusalMessage({ reason: 'That is too big.', suggestion: null }))
            .toBe('That is too big.');
    });

    it.each([
        ['nothing at all', undefined],
        ['an empty verdict', {}],
        ['a verdict with a blank reason', { reason: '' }],
    ])('never hands back an empty string for %s', (_label, verdict) => {
        const message = refusalMessage(verdict);
        expect(message).toBeTruthy();
        expect(message).toMatch(/[.!?]$/);
    });
});
