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
    assessBatchJob,
    assessFile,
    assessJob,
    assessPixels,
    batchArchiveBudgetBytes,
    deviceBudgetBytes,
    estimateBatchPeakBytes,
    estimatePeakBytes,
    nativeDownscaleSupported,
    outputExpansionFor,
    readDeviceProfile,
    refusalMessage,
    wasmSupported,
    BYTES_PER_PIXEL,
    COMFORTABLE_ENCODE_PIXELS,
    DEFAULT_OUTPUT_EXPANSION,
    HARD_MAX_SOURCE_PIXELS,
    MAX_TAB_BUDGET_BYTES,
    MIN_TAB_BUDGET_BYTES,
    OUTPUT_EXPANSION_BY_FORMAT,
    SAME_FORMAT_EXPANSION,
    WASM_BASELINE_BYTES,
    ZIP_ARCHIVE_COPIES,
} from '@/lib/image-client/capability';
import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE, MAX_PIXELS } from '@/lib/limits';
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

/**
 * Two tools rewrite a file's bytes without ever decoding it — the DPI changer
 * and the metadata remover. Charging them a decode surface would refuse a
 * 60-megapixel JPEG whose DPI field is eight bytes, so they are costed in
 * bytes: the input, the output and a working copy. The pixel caps are output
 * caps and do not apply to a job that produces the same pixels it was given.
 */
describe('byte-only operations', () => {
    it.each(['dpi', 'strip'])('costs %s as three copies of the file plus the baseline, whatever the dimensions', (operation) => {
        const small = estimatePeakBytes({ sourceWidth: 100, sourceHeight: 100, fileBytes: 1_000_000, operation });
        const huge = estimatePeakBytes({ sourceWidth: 12000, sourceHeight: 9000, fileBytes: 1_000_000, operation });

        expect(small).toBe(huge);
        expect(small).toBe(3 * 1_000_000 + WASM_BASELINE_BYTES);
    });

    it.each(['dpi', 'strip'])('lets %s through the pixel caps a decode would trip', (operation) => {
        const verdict = assessPixels({
            sourceWidth: 12000,
            sourceHeight: 12000,
            fileBytes: 4_000_000,
            operation,
            device: device({ memoryGb: 4 }),
        });
        expect(verdict.ok).toBe(true);
        expect(verdict.code).toBe('ok');
    });

    /**
     * The memory question is still asked — the estimate is reported on the
     * verdict — but three copies of the largest file the site accepts sit
     * under the smallest tab budget the gate ever computes, so a byte-only job
     * cannot be refused for memory by construction. Asserted, so a change to
     * either number that breaks that is noticed here rather than on a phone.
     */
    it('reports the byte cost on the verdict, and the cap keeps it inside every budget', () => {
        const verdict = assessPixels({
            sourceWidth: 100,
            sourceHeight: 100,
            fileBytes: MAX_FILE_SIZE,
            operation: 'strip',
            device: device({ memoryGb: 0.5, ios: true }),
        });
        expect(verdict.ok).toBe(true);
        expect(verdict.estimatedPeakBytes).toBe(3 * MAX_FILE_SIZE + WASM_BASELINE_BYTES);
        expect(3 * MAX_FILE_SIZE + WASM_BASELINE_BYTES).toBeLessThanOrEqual(MIN_TAB_BUDGET_BYTES);
    });

    it('costs the signature workflow as a resize, because it resamples', () => {
        const withResize = estimatePeakBytes({ sourceWidth: 4000, sourceHeight: 3000, targetWidth: 600, targetHeight: 200, operation: 'signature', nativeDownscale: false });
        const plainEncode = estimatePeakBytes({ sourceWidth: 4000, sourceHeight: 3000, targetWidth: 600, targetHeight: 200, operation: 'convert', nativeDownscale: false });
        expect(withResize).toBeGreaterThanOrEqual(plainEncode);
    });

    /**
     * The requirement fitter resamples exactly as the signature workflow does,
     * so it must be costed identically. An op MISSING from the profile table
     * silently falls back to 'convert', which charges no resize stage at all —
     * a gate that has not been told about the resample is costing the wrong job,
     * and on a phone the tab it under-charged is the one that gets killed.
     */
    it('costs the requirement fitter as a resize too, rather than falling back to a plain encode', () => {
        const shape = { sourceWidth: 4000, sourceHeight: 3000, targetWidth: 600, targetHeight: 750, nativeDownscale: false };

        expect(estimatePeakBytes({ ...shape, operation: 'fit' }))
            .toBe(estimatePeakBytes({ ...shape, operation: 'signature' }));
        expect(estimatePeakBytes({ ...shape, operation: 'fit' }))
            .toBeGreaterThan(estimatePeakBytes({ ...shape, operation: 'convert' }));
    });

    /**
     * The fitter's default geometry resamples to a COVERING size, bigger than
     * the output on one axis, and that is the surface it really allocates.
     */
    it('charges the fitter for the covering surface it resamples to, not just the output', () => {
        const shape = { sourceWidth: 4000, sourceHeight: 3000, targetWidth: 600, targetHeight: 600, operation: 'fit', nativeDownscale: false };

        expect(estimatePeakBytes({ ...shape, intermediateWidth: 800, intermediateHeight: 600 }))
            .toBeGreaterThan(estimatePeakBytes(shape));
    });

    /**
     * The favicon package resamples and encodes exactly as the fitter does —
     * six times, off one decode, and the largest of the six is what it must be
     * costed by. Missing from the table it would fall back to 'convert' and be
     * charged no resample at all.
     */
    it('costs the favicon package as a resize too', () => {
        const shape = { sourceWidth: 4000, sourceHeight: 3000, targetWidth: 512, targetHeight: 512, nativeDownscale: false };

        expect(estimatePeakBytes({ ...shape, operation: 'icons' }))
            .toBe(estimatePeakBytes({ ...shape, operation: 'fit' }));
        expect(estimatePeakBytes({ ...shape, operation: 'icons' }))
            .toBeGreaterThan(estimatePeakBytes({ ...shape, operation: 'convert' }));
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

/**
 * THE WORKER AND THE MAIN THREAD MUST NOT DISAGREE ABOUT THE DEVICE.
 *
 * isIosLike() separates iPadOS-pretending-to-be-a-Mac purely by
 * `maxTouchPoints > 1`. That property is spec'd only on `Navigator` — a
 * `WorkerNavigator` does not have it (confirmed in Chromium: the worker sees
 * platform 'MacIntel', a Macintosh UA, 8 cores, and `maxTouchPoints`
 * undefined). So on iPadOS the two threads derived DIFFERENT budgets from the
 * same machine: 614 MiB on the page, 1024 MiB inside the worker, with the 0.6
 * iOS haircut silently dropped exactly where the last gates before allocation
 * run.
 *
 * Two places that actually escaped, both worker-only estimates the main thread
 * never computes:
 *
 *   /resize with a two-sided target — the worker charges the COVER
 *   intermediate. A 70 MP source to 8000x800 costs 900 MiB there; the page had
 *   charged 607 MiB against 614 and let it through.
 *
 *   /jpg-to-pdf's whole-document gate — it has NO main-thread counterpart at
 *   all. 13 images at the 80 MiB batch cap cost 623 MiB.
 *
 * Both are approved at a 1024 MiB budget and refused at the correct 614 MiB.
 * On iOS the tab is then reaped with no exception and no error event.
 *
 * The engine now reads the profile once, on the page, and carries it to the
 * worker. These tests pin the underlying divergence so it cannot be
 * reintroduced by another environment sniff.
 */
describe('the device profile does not depend on which thread reads it', () => {
    const IPAD = {
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        hardwareConcurrency: 8,
    };

    it('sees an iPad as iOS from the page, where maxTouchPoints exists', () => {
        expect(readDeviceProfile({ ...IPAD, maxTouchPoints: 5 }).ios).toBe(true);
    });

    it('cannot see it from a WorkerNavigator, which has no maxTouchPoints', () => {
        // Not a bug to fix in isIosLike — the property genuinely is not there.
        // It is the reason the profile must travel rather than be re-derived.
        expect(readDeviceProfile(IPAD).ios).toBe(false);
    });

    it('gives two different budgets for the same machine', () => {
        const page = deviceBudgetBytes(readDeviceProfile({ ...IPAD, maxTouchPoints: 5 }));
        const worker = deviceBudgetBytes(readDeviceProfile(IPAD));

        expect(worker).toBeGreaterThan(page);
        // The 0.6 haircut, dropped.
        expect(page / worker).toBeCloseTo(0.6, 2);
    });
});

/**
 * THE BULK ARCHIVE.
 *
 * folder-select.js justified keeping MAX_BULK_FILES at 20 by costing the ZIP at
 * three copies of the payload, bounded by the 80 MB byte cap — "up to 240 MB".
 * That arithmetic assumed output bytes never exceed input bytes, which is true
 * of a resize and of nothing else. Measured with this repo's sharp reference
 * against public/samples/, a JPEG re-encoded as PNG comes back 3.25x to 8.69x
 * larger, so the same twenty files that cost 240 MB as a resize cost up to
 * 2.1 GB as a conversion — on a device that can spare 614 MB.
 *
 * These tests pin the two halves of the fix: that the estimate keys on the
 * TARGET FORMAT (below), and that no estimate is trusted to hold the archive on
 * its own (tests/lib/upload/bulk-batch.test.js).
 */
describe('what a batch is charged for its outputs', () => {
    it('keys the expansion on the target format, not on the operation', () => {
        expect(outputExpansionFor('png')).toBeGreaterThan(outputExpansionFor('jpeg'));
        expect(outputExpansionFor('png')).toBeGreaterThan(outputExpansionFor('webp'));
    });

    it('covers the worst expansion measured on public/samples/', () => {
        // sharp 0.35.3 against the three sample photographs:
        //   JPEG -> PNG      3.25x (portrait), 5.06x (landscape), 8.69x (square)
        //   JPEG -> JPEG q90 1.13x - 1.19x
        //   WebP -> WebP q90 1.14x - 1.26x
        // A factor under the measured worst is a factor that under-charges the
        // exact job it was written for.
        expect(OUTPUT_EXPANSION_BY_FORMAT.png).toBeGreaterThanOrEqual(8.69);
        expect(OUTPUT_EXPANSION_BY_FORMAT.jpeg).toBeGreaterThanOrEqual(1.19);
        expect(OUTPUT_EXPANSION_BY_FORMAT.webp).toBeGreaterThanOrEqual(1.26);
    });

    it('reads the bulk sentinel as a same-format re-encode', () => {
        // Mismatching this sentinel once silently converted every bulk PNG to
        // JPEG. Here it must mean "each file keeps its own format".
        expect(outputExpansionFor('original')).toBe(SAME_FORMAT_EXPANSION);
        expect(outputExpansionFor('same')).toBe(SAME_FORMAT_EXPANSION);
        expect(outputExpansionFor('')).toBe(SAME_FORMAT_EXPANSION);
        expect(outputExpansionFor(null)).toBe(SAME_FORMAT_EXPANSION);
    });

    it('charges an unrecognised target the most expensive format it knows', () => {
        // Same reasoning as assessJob leaving `operation` without a default: a
        // caller that has not said what it is writing must not be quoted the
        // cheapest answer.
        expect(outputExpansionFor('avif')).toBe(DEFAULT_OUTPUT_EXPANSION);
        expect(DEFAULT_OUTPUT_EXPANSION).toBe(OUTPUT_EXPANSION_BY_FORMAT.png);
    });

    it('treats jpg as jpeg', () => {
        expect(outputExpansionFor('jpg')).toBe(OUTPUT_EXPANSION_BY_FORMAT.jpeg);
        expect(outputExpansionFor('JPEG')).toBe(OUTPUT_EXPANSION_BY_FORMAT.jpeg);
    });

    it('counts three resident copies of the archive, its own constant', () => {
        expect(ZIP_ARCHIVE_COPIES).toBe(3);
    });
});

describe('costing a whole batch before it runs', () => {
    const unsized = (fileBytes) => ({ fileBytes });

    it('grows the archive with the SUM of the files', () => {
        const one = estimateBatchPeakBytes({ files: [unsized(1_000_000)], format: 'jpeg' });
        const two = estimateBatchPeakBytes({ files: [unsized(1_000_000), unsized(1_000_000)], format: 'jpeg' });

        // The second file adds only archive, not a second working set.
        expect(two - one).toBe(Math.round(1_000_000 * OUTPUT_EXPANSION_BY_FORMAT.jpeg * ZIP_ARCHIVE_COPIES));
    });

    it('charges the LARGEST single file for the working set, never the sum', () => {
        const sized = { fileBytes: 4_000_000, sourceWidth: 4032, sourceHeight: 3024 };
        const alone = estimateBatchPeakBytes({ files: [sized], format: 'jpeg' });
        const twice = estimateBatchPeakBytes({ files: [sized, sized], format: 'jpeg' });

        // Twenty decoded surfaces at once is exactly how a phone tab dies, and
        // processBatch awaits each file before starting the next precisely so
        // that never happens. Charging for it would refuse every batch.
        const archiveOfOneMore = Math.round(4_000_000 * OUTPUT_EXPANSION_BY_FORMAT.jpeg * ZIP_ARCHIVE_COPIES);
        expect(twice - alone).toBe(archiveOfOneMore);
    });

    it('is the format, and only the format, that changes the answer', () => {
        const files = [unsized(10_000_000)];
        const asWebp = estimateBatchPeakBytes({ files, format: 'webp' });
        const asJpeg = estimateBatchPeakBytes({ files, format: 'jpeg' });
        const asPng = estimateBatchPeakBytes({ files, format: 'png' });

        // PNG is the expensive one by a distance. WebP sits just ABOVE JPEG
        // rather than below it, which is the opposite of the intuition that
        // "WebP is the small format": the 0.25x-0.65x everyone quotes is
        // JPEG -> WebP, and a batch is charged for the worst SOURCE it might be
        // handed. WebP -> WebP q90 measured 1.14x-1.26x against JPEG -> JPEG
        // q90 at 1.13x-1.19x, so the order below is the measurement, not a
        // ranking of the formats.
        expect(asPng).toBeGreaterThan(asWebp);
        expect(asWebp).toBeGreaterThan(asJpeg);
    });
});

describe('the pre-flight gate for a whole batch', () => {
    const unsized = (fileBytes) => ({ fileBytes });

    /**
     * The floor device, exactly as folder-select.js describes it: a 2021 phone,
     * 4 GB, a 1024 MiB tab budget and 614 MiB after the iOS haircut.
     */
    const IOS_FLOOR = device({ memoryGb: 4, ios: true });

    /** Twenty 12 MP photos filling the published 80 MB cap. */
    const FULL_BATCH = Array.from({ length: MAX_BULK_FILES }, () => ({
        fileBytes: MAX_BULK_TOTAL_BYTES / MAX_BULK_FILES,
        sourceWidth: 4032,
        sourceHeight: 3024,
    }));

    it('still lets the flagship job through — a full 80 MB bulk resize on the floor device', () => {
        // This is the over-refusal guard, and it is the reason the JPEG factor
        // is 1.2 and not the 4.18x a WebP source can reach. folder-select.js
        // documents this exact job as fitting at ~365 MB; a gate that started
        // refusing it would be a regression dressed up as safety.
        const assessment = assessBatchJob({
            files: FULL_BATCH,
            format: 'jpeg',
            operation: 'resize',
            device: IOS_FLOOR,
        });

        expect(assessment.ok).toBe(true);
        expect(assessment.estimatedPeakBytes).toBeLessThan(assessment.budgetBytes);
    });

    it('refuses the same twenty files when the target format is PNG', () => {
        // The measured 3.25x-8.69x, carried through three ZIP copies. This is
        // the job that was silently killing the tab.
        const assessment = assessBatchJob({
            files: FULL_BATCH,
            format: 'png',
            operation: 'convert',
            device: IOS_FLOOR,
        });

        expect(assessment.ok).toBe(false);
        expect(assessment.code).toBe('not-enough-memory');
        // Same shape as assessPdfJob: a refusal reports no peak, because the
        // number the panel needs is already in the sentence.
        expect(assessment.estimatedPeakBytes).toBeNull();
        expect(estimateBatchPeakBytes({ files: FULL_BATCH, format: 'png', operation: 'convert' }))
            .toBeGreaterThan(assessment.budgetBytes);
    });

    it('is the format alone that separates those two answers', () => {
        const base = { files: FULL_BATCH, operation: 'convert', device: IOS_FLOOR };
        expect(assessBatchJob({ ...base, format: 'webp' }).ok).toBe(true);
        expect(assessBatchJob({ ...base, format: 'png' }).ok).toBe(false);
    });

    it('passes at the budget and refuses one byte past it', () => {
        // 192 MiB floor budget; one unsized file charged 1.2x through three ZIP
        // copies plus its own two-copy read, so 5.6x its bytes + the WASM
        // baseline. 30 MiB lands exactly on the budget.
        const small = device({ memoryGb: 0.5 });
        const exact = 30 * 1024 * 1024;

        const atBudget = assessBatchJob({ files: [unsized(exact)], format: 'jpeg', device: small });
        const overBudget = assessBatchJob({ files: [unsized(exact + 1)], format: 'jpeg', device: small });

        expect(atBudget.estimatedPeakBytes).toBe(atBudget.budgetBytes);
        expect(atBudget.ok).toBe(true);
        expect(overBudget.ok).toBe(false);
        expect(overBudget.code).toBe('not-enough-memory');
    });

    it('refuses more than the published file count', () => {
        const files = Array.from({ length: MAX_BULK_FILES + 1 }, () => unsized(1000));
        const assessment = assessBatchJob({ files, format: 'jpeg', device: IOS_FLOOR });

        expect(assessment.ok).toBe(false);
        expect(assessment.code).toBe('too-many-files');
        expect(assessment.reason).toContain(String(MAX_BULK_FILES));
        expect(assessment.fileCount).toBe(MAX_BULK_FILES + 1);
    });

    it('refuses more than the published byte cap', () => {
        const assessment = assessBatchJob({
            files: [unsized(MAX_BULK_TOTAL_BYTES + 1)],
            format: 'jpeg',
            device: IOS_FLOOR,
        });

        expect(assessment.ok).toBe(false);
        expect(assessment.code).toBe('total-too-large');
        expect(assessment.totalBytes).toBe(MAX_BULK_TOTAL_BYTES + 1);
        // One byte over must not round down into "80 MB is more than 80 MB",
        // which is a sentence nobody can act on.
        expect(assessment.reason).toBe('Those images add up to 81 MB, and 80 MB is the most one batch can hold.');
    });

    it('accepts exactly the published limits', () => {
        // The intake numbers are product promises quoted on three marketing
        // pages. The gate must not quietly move either of them.
        const files = Array.from({ length: MAX_BULK_FILES }, () => unsized(MAX_BULK_TOTAL_BYTES / MAX_BULK_FILES));
        expect(assessBatchJob({ files, format: 'jpeg', device: IOS_FLOOR }).code).not.toBe('too-many-files');
        expect(assessBatchJob({ files, format: 'jpeg', device: IOS_FLOOR }).code).not.toBe('total-too-large');
    });

    it('refuses when WebAssembly is off, before it costs anything', () => {
        const assessment = assessBatchJob({
            files: [unsized(1000)],
            format: 'jpeg',
            device: device({ wasm: false }),
        });

        expect(assessment.ok).toBe(false);
        expect(assessment.code).toBe('no-wasm');
        expect(assessment.estimatedPeakBytes).toBeNull();
    });

    it('refuses an empty batch', () => {
        expect(assessBatchJob({ files: [], format: 'jpeg', device: IOS_FLOOR })).toMatchObject({
            ok: false,
            code: 'no-file',
        });
        expect(assessBatchJob({ files: null, format: 'jpeg', device: IOS_FLOOR }).code).toBe('no-file');
    });

    it('carries a reason AND a suggestion out of every refusal', () => {
        // A refusal is the end of the story here — there is no server to fall
        // back to — so every path must hand the panel words a person can act on.
        const refusals = [
            assessBatchJob({ files: [unsized(1000)], device: device({ wasm: false }) }),
            assessBatchJob({ files: [], device: IOS_FLOOR }),
            assessBatchJob({ files: Array.from({ length: 21 }, () => unsized(10)), device: IOS_FLOOR }),
            assessBatchJob({ files: [unsized(MAX_BULK_TOTAL_BYTES + 1)], device: IOS_FLOOR }),
            assessBatchJob({ files: FULL_BATCH, format: 'png', device: IOS_FLOOR }),
        ];

        for (const refusal of refusals) {
            expect(refusal.ok).toBe(false);
            expect(typeof refusal.reason).toBe('string');
            expect(refusal.reason.length).toBeGreaterThan(0);
            expect(typeof refusal.suggestion).toBe('string');
            expect(refusal.suggestion.length).toBeGreaterThan(0);
            expect(refusalMessage(refusal)).toContain(refusal.suggestion);
        }
    });

    it('takes the device it is given rather than re-deriving one', () => {
        // The profile travels now — a worker cannot read maxTouchPoints and so
        // reads an iPad as a Mac, handing itself 1024 MiB where the real ceiling
        // is 614 MiB. Same batch, two devices, two answers.
        const files = Array.from({ length: 10 }, () => unsized(3 * 1024 * 1024));

        expect(assessBatchJob({ files, format: 'png', device: device({ memoryGb: 4 }) }).ok).toBe(true);
        expect(assessBatchJob({ files, format: 'png', device: IOS_FLOOR }).ok).toBe(false);
    });
});

describe('how much archive this device can hold', () => {
    it('subtracts the file being worked on, then splits what is left three ways', () => {
        const files = [{ fileBytes: 4_000_000, sourceWidth: 4032, sourceHeight: 3024 }];
        const profile = device({ memoryGb: 4, ios: true });

        const stage = estimatePeakBytes({
            sourceWidth: 4032,
            sourceHeight: 3024,
            fileBytes: 4_000_000,
            operation: 'resize',
            nativeDownscale: false,
        });

        expect(batchArchiveBudgetBytes({ files, operation: 'resize', device: profile }))
            .toBe(Math.floor((deviceBudgetBytes(profile) - stage) / ZIP_ARCHIVE_COPIES));
    });

    it('is smaller on iOS than on the same machine without the haircut', () => {
        const files = [{ fileBytes: 4_000_000, sourceWidth: 4032, sourceHeight: 3024 }];

        expect(batchArchiveBudgetBytes({ files, device: device({ memoryGb: 4, ios: true }) }))
            .toBeLessThan(batchArchiveBudgetBytes({ files, device: device({ memoryGb: 4 }) }));
    });

    it('never starves the archive over a file that will be refused anyway', () => {
        // THE CI REGRESSION, at the source. A file past HARD_MAX_SOURCE_PIXELS
        // is refused by the per-file gate before it allocates, so it produces no
        // output and must reserve nothing. It used to reserve the largest
        // working set in the batch and drive this to zero.
        const ordinary = { fileBytes: 1000, sourceWidth: 1600, sourceHeight: 1200 };
        const pastTheCap = { fileBytes: 1000, sourceWidth: 12_000, sourceHeight: 9_000 };
        const profile = device({ memoryGb: 3, ios: false });

        expect(batchArchiveBudgetBytes({ files: [ordinary, pastTheCap], device: profile }))
            .toBe(batchArchiveBudgetBytes({ files: [ordinary], device: profile }));
    });

    it('ignores a file too big for THIS device, which is the device that refuses it', () => {
        // The other half of the same rule: not over the pixel cap, but over what
        // this particular tab can hold, so assessPixels refuses it too.
        const ordinary = { fileBytes: 1000, sourceWidth: 1600, sourceHeight: 1200 };
        const tooBigHere = { fileBytes: 1000, sourceWidth: 7000, sourceHeight: 7000 };
        const small = device({ memoryGb: 0.5, ios: true });

        expect(batchArchiveBudgetBytes({ files: [ordinary, tooBigHere], device: small }))
            .toBe(batchArchiveBudgetBytes({ files: [ordinary], device: small }));
    });

    it('is never zero for anything intake can actually produce', () => {
        // A zero ceiling means "no image can ever be archived", which is never
        // true of a batch that still has a processable file in it. Swept across
        // the devices and the file shapes intake allows, including ones the
        // per-file gate refuses.
        const shapes = [
            { fileBytes: 1000, sourceWidth: 1600, sourceHeight: 1200 },
            { fileBytes: MAX_FILE_SIZE, sourceWidth: 4032, sourceHeight: 3024 },
            { fileBytes: 1000, sourceWidth: 12_000, sourceHeight: 9_000 },
            { fileBytes: 1000, sourceWidth: 8000, sourceHeight: 8000 },
            { fileBytes: 1000 },
        ];
        const profiles = [
            device({ memoryGb: 0.5, ios: true }),
            device({ memoryGb: 3, cores: 4 }),
            device({ memoryGb: 4, ios: true }),
            device({ memoryGb: 8 }),
        ];

        for (const profile of profiles) {
            for (const operation of ['resize', 'convert', 'compress', 'heic']) {
                expect(batchArchiveBudgetBytes({ files: shapes, operation, device: profile }))
                    .toBeGreaterThan(0);
            }
        }
    });

    it('holds the archive it says it holds', () => {
        // The two halves of the same arithmetic: a batch whose outputs exactly
        // fill the archive budget is a batch that fits.
        const files = [{ fileBytes: 4_000_000, sourceWidth: 4032, sourceHeight: 3024 }];
        const profile = device({ memoryGb: 4, ios: true });
        const ceiling = batchArchiveBudgetBytes({ files, operation: 'resize', device: profile });

        const stage = estimatePeakBytes({
            sourceWidth: 4032,
            sourceHeight: 3024,
            fileBytes: 4_000_000,
            operation: 'resize',
            nativeDownscale: false,
        });

        expect((ceiling * ZIP_ARCHIVE_COPIES) + stage).toBeLessThanOrEqual(deviceBudgetBytes(profile));
    });
});
