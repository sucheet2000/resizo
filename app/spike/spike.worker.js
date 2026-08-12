/**
 * PHASE 0 SPIKE — THROWAWAY. Not for merge.
 *
 * Runs the on-device benchmark battery off the main thread so a slow or
 * memory-hungry step cannot freeze the UI before it has rendered a result.
 *
 * Protocol
 *   main -> worker  { type: 'run', file }
 *   main -> worker  { type: 'ack', seq }
 *   worker -> main  { type: 'begin', seq, step }   (waits for the matching ack)
 *   worker -> main  { type: 'row', row }
 *   worker -> main  { type: 'done' }
 *   worker -> main  { type: 'fatal', message }
 *
 * The begin/ack handshake exists for crash forensics: the main thread writes a
 * localStorage breadcrumb naming the step and only then lets the worker start
 * it, so an iOS out-of-memory kill (which throws nothing, catches nothing, and
 * takes the whole tab) still leaves a record of which step was in flight.
 */

import { sniffImageType } from '@/lib/image/magic-bytes';

const WASM_BASE = '/wasm';
const TARGET_WIDTH = 1920;

let seqCounter = 0;
const pendingAcks = new Map();

function post(message, transfer) {
    if (transfer && transfer.length) self.postMessage(message, transfer);
    else self.postMessage(message);
}

function beginStep(step) {
    seqCounter += 1;
    const seq = seqCounter;
    const waited = new Promise((resolve) => {
        pendingAcks.set(seq, resolve);
        // If the main thread never answers, do not hang the whole battery.
        setTimeout(() => {
            if (pendingAcks.has(seq)) {
                pendingAcks.delete(seq);
                resolve();
            }
        }, 2000);
    });
    post({ type: 'begin', seq, step });
    return waited;
}

function heapUsed() {
    const memory = typeof performance !== 'undefined' ? performance.memory : null;
    return memory && typeof memory.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

/**
 * Says out loud which memory API this worker actually has. Chrome exposes
 * performance.memory on the main thread but not necessarily inside a worker,
 * and Safari exposes neither — without this probe a blank memory column is
 * indistinguishable from "the step used no memory".
 */
function memoryProbe() {
    const inWorker = heapUsed() !== null;
    const precise =
        typeof performance !== 'undefined' &&
        typeof performance.measureUserAgentSpecificMemory === 'function';
    return [
        `worker performance.memory: ${inWorker ? 'AVAILABLE' : 'NOT AVAILABLE (worker heap figures will be blank)'}`,
        `measureUserAgentSpecificMemory: ${precise ? 'available' : 'unavailable'}`,
        `crossOriginIsolated in worker: ${globalThis.crossOriginIsolated}`,
        `OffscreenCanvas in worker: ${typeof OffscreenCanvas !== 'undefined'}`,
    ].join(' | ');
}

function mb(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
}

function megapixels(width, height) {
    return ((width * height) / 1e6).toFixed(1);
}

function errorText(error) {
    if (!error) return 'unknown error';
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}

/**
 * Every step is wrapped: a thrown error is a RESULT (a row that says what
 * failed), never something that stops the battery. `fn` returns
 * `{ detail, value }`; `value` is what later steps consume.
 */
async function runStep(step, fn) {
    await beginStep(step);
    const heapBefore = heapUsed();
    const startedAt = performance.now();
    try {
        const outcome = (await fn()) || {};
        const ms = performance.now() - startedAt;
        post({
            type: 'row',
            row: {
                step,
                status: 'ok',
                ms,
                detail: outcome.detail || '',
                heapBefore,
                heapAfter: heapUsed(),
            },
        });
        return { ok: true, value: outcome.value };
    } catch (error) {
        const ms = performance.now() - startedAt;
        post({
            type: 'row',
            row: {
                step,
                status: 'FAIL',
                ms,
                detail: errorText(error),
                heapBefore,
                heapAfter: heapUsed(),
            },
        });
        return { ok: false, value: undefined };
    }
}

function skipStep(step, why) {
    post({
        type: 'row',
        row: { step, status: 'skip', ms: null, detail: why, heapBefore: null, heapAfter: null },
    });
}

function looksHeic(sniffed, name) {
    if (sniffed === 'heic') return true;
    return /\.hei[cf]$/i.test(name || '');
}

/**
 * The emscripten codecs resolve their .wasm relative to the bundled chunk URL,
 * which is wrong under Next. Both are pointed at public/wasm/ explicitly.
 */
async function initMozjpegEncoder() {
    const codec = await import('@jsquash/jpeg/encode');
    await codec.init({ locateFile: () => `${WASM_BASE}/mozjpeg_enc.wasm` });
    return codec.default;
}

async function initMozjpegDecoder() {
    const codec = await import('@jsquash/jpeg/decode');
    await codec.init({ locateFile: () => `${WASM_BASE}/mozjpeg_dec.wasm` });
    return codec.default;
}

async function initResizer() {
    const codec = await import('@jsquash/resize');
    await codec.initResize(`${WASM_BASE}/squoosh_resize_bg.wasm`);
    return codec.default;
}

async function runBattery(file) {
    await runStep('00 worker environment', async () => ({ detail: memoryProbe() }));

    const facts = await runStep('01 file facts', async () => {
        const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
        const sniffed = sniffImageType(head);
        return {
            detail: `${file.name} | ${mb(file.size)} MB | magic bytes: ${sniffed || 'UNRECOGNISED'} | browser type: ${file.type || 'none'}`,
            value: { sniffed },
        };
    });

    const sniffed = facts.value ? facts.value.sniffed : null;
    const heic = looksHeic(sniffed, file.name);

    const native = await runStep('02 createImageBitmap (native decode)', async () => {
        const bitmap = await createImageBitmap(file);
        return {
            detail: `${bitmap.width}x${bitmap.height} | ${megapixels(bitmap.width, bitmap.height)} MP | RGBA would be ${mb(bitmap.width * bitmap.height * 4)} MB`,
            value: bitmap,
        };
    });

    await runStep(`03 createImageBitmap resizeWidth:${TARGET_WIDTH}`, async () => {
        const bitmap = await createImageBitmap(file, {
            resizeWidth: TARGET_WIDTH,
            resizeQuality: 'high',
        });
        const honoured = bitmap.width === TARGET_WIDTH;
        const detail = `${bitmap.width}x${bitmap.height}${honoured ? '' : ' | resizeWidth IGNORED by this browser'}`;
        bitmap.close();
        return { detail };
    });

    let fullPixels = null;

    if (heic) {
        const heifModule = await runStep('04a libheif wasm import + init', async () => {
            const importedAt = performance.now();
            const codec = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
            const importMs = performance.now() - importedAt;
            const instantiatedAt = performance.now();
            const libheif = codec.default();
            const instantiateMs = performance.now() - instantiatedAt;
            return {
                detail: `download+parse ${importMs.toFixed(0)} ms, instantiate ${instantiateMs.toFixed(0)} ms (~1.4 MB inlined wasm)`,
                value: libheif,
            };
        });

        if (heifModule.ok) {
            const decoded = await runStep('04b libheif decode to RGBA', async () => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const decoder = new heifModule.value.HeifDecoder();
                const images = decoder.decode(bytes);
                if (!images || images.length === 0) throw new Error('libheif returned no images');
                const image = images[0];
                const width = image.get_width();
                const height = image.get_height();
                const pixels = new ImageData(width, height);
                await new Promise((resolve, reject) => {
                    image.display(pixels, (displayed) => {
                        if (displayed) resolve();
                        else reject(new Error('libheif display() returned nothing'));
                    });
                });
                return {
                    detail: `${width}x${height} | ${megapixels(width, height)} MP | ${images.length} image(s) in file | RGBA buffer ${mb(width * height * 4)} MB`,
                    value: pixels,
                };
            });
            if (decoded.ok) fullPixels = decoded.value;
        }
    } else {
        skipStep('04a libheif wasm import + init', 'not a HEIC/HEIF file');
        skipStep('04b libheif decode to RGBA', 'not a HEIC/HEIF file');
    }

    if (!fullPixels && native.ok) {
        const drawn = await runStep('05 bitmap to RGBA via OffscreenCanvas', async () => {
            const bitmap = native.value;
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) throw new Error('OffscreenCanvas 2d context unavailable');
            context.drawImage(bitmap, 0, 0);
            const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
            return {
                detail: `${pixels.width}x${pixels.height} | RGBA buffer ${mb(pixels.data.byteLength)} MB`,
                value: pixels,
            };
        });
        if (drawn.ok) fullPixels = drawn.value;
    } else if (!fullPixels) {
        skipStep('05 bitmap to RGBA via OffscreenCanvas', 'native decode did not produce a bitmap');
    }

    if (!fullPixels && sniffed === 'jpeg') {
        const jpegDecoded = await runStep('05b fallback: mozjpeg wasm decode', async () => {
            const decode = await initMozjpegDecoder();
            const pixels = await decode(await file.arrayBuffer());
            return {
                detail: `${pixels.width}x${pixels.height} | RGBA buffer ${mb(pixels.data.byteLength)} MB`,
                value: pixels,
            };
        });
        if (jpegDecoded.ok) fullPixels = jpegDecoded.value;
    }

    if (native.ok && native.value && typeof native.value.close === 'function') {
        native.value.close();
    }

    if (!fullPixels) {
        skipStep('06 @jsquash/resize wasm init', 'no full-resolution pixels to work from');
        skipStep(`07 resize to ${TARGET_WIDTH}px`, 'no full-resolution pixels to work from');
        skipStep('08 mozjpeg encode wasm init', 'no full-resolution pixels to work from');
        skipStep('09 mozjpeg encode FULL resolution q80', 'no full-resolution pixels to work from');
        skipStep(`10 mozjpeg encode ${TARGET_WIDTH}px q80`, 'no full-resolution pixels to work from');
        post({ type: 'done' });
        return;
    }

    const resizer = await runStep('06 @jsquash/resize wasm init', async () => {
        const resize = await initResizer();
        return { detail: 'squoosh_resize wasm ready (~34 KB)', value: resize };
    });

    let smallPixels = null;
    if (resizer.ok) {
        const width = Math.min(TARGET_WIDTH, fullPixels.width);
        const height = Math.max(1, Math.round((fullPixels.height * width) / fullPixels.width));
        const resized = await runStep(`07 resize to ${TARGET_WIDTH}px`, async () => {
            const pixels = await resizer.value(fullPixels, { width, height, method: 'lanczos3' });
            const note = fullPixels.width <= TARGET_WIDTH ? ' | source was already narrower, no downscale' : '';
            return {
                detail: `${fullPixels.width}x${fullPixels.height} -> ${pixels.width}x${pixels.height}${note}`,
                value: pixels,
            };
        });
        if (resized.ok) smallPixels = resized.value;
    } else {
        skipStep(`07 resize to ${TARGET_WIDTH}px`, 'resize wasm never initialised');
    }

    const encoder = await runStep('08 mozjpeg encode wasm init', async () => {
        const encode = await initMozjpegEncoder();
        return { detail: 'mozjpeg_enc wasm ready (~246 KB)', value: encode };
    });

    if (!encoder.ok) {
        skipStep('09 mozjpeg encode FULL resolution q80', 'encoder wasm never initialised');
        skipStep(`10 mozjpeg encode ${TARGET_WIDTH}px q80`, 'encoder wasm never initialised');
        post({ type: 'done' });
        return;
    }

    await runStep('09 mozjpeg encode FULL resolution q80', async () => {
        const output = await encoder.value(fullPixels, { quality: 80 });
        return {
            detail: `${fullPixels.width}x${fullPixels.height} in | ${mb(output.byteLength)} MB out (${output.byteLength} bytes)`,
        };
    });

    if (smallPixels) {
        await runStep(`10 mozjpeg encode ${TARGET_WIDTH}px q80`, async () => {
            const output = await encoder.value(smallPixels, { quality: 80 });
            return {
                detail: `${smallPixels.width}x${smallPixels.height} in | ${mb(output.byteLength)} MB out (${output.byteLength} bytes)`,
            };
        });
    } else {
        skipStep(`10 mozjpeg encode ${TARGET_WIDTH}px q80`, 'no resized pixels to encode');
    }

    post({ type: 'done' });
}

self.onmessage = async (event) => {
    const message = event.data || {};

    if (message.type === 'ack') {
        const resolve = pendingAcks.get(message.seq);
        if (resolve) {
            pendingAcks.delete(message.seq);
            resolve();
        }
        return;
    }

    if (message.type === 'run') {
        try {
            await runBattery(message.file);
        } catch (error) {
            post({ type: 'fatal', message: errorText(error) });
        }
    }
};
