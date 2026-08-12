/**
 * useToolSubmit
 *
 * The request half. Three things have to hold:
 *
 *  - the download's object URL is revoked on a timer, not in the same tick as
 *    the click. Safari and Firefox both abort a download whose blob URL
 *    disappears immediately, which is why this is asserted with fake timers
 *    rather than trusted.
 *  - a JSON `{ error }` body is what the visitor reads.
 *  - a NON-JSON body — the plain-text 413 a platform proxy returns — must
 *    still produce a human sentence. The old clients ran `res.json()` on it
 *    unguarded and printed "Unexpected token '<'".
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageForStatus } from '@/lib/hooks/submit-helpers';
import { useToolSubmit } from '@/lib/hooks/useToolSubmit';
import { blobOfSize, installFakeXhr } from '../helpers.jsx';

let xhr;
let clicks;
let revokeObjectURL;

beforeEach(() => {
    xhr = installFakeXhr();
    clicks = [];
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
        clicks.push({ href: this.href, download: this.download, connected: this.isConnected });
    });
});

afterEach(() => {
    xhr.restore();
    vi.useRealTimers();
});

const OK_HEADERS = {
    'Content-Type': 'image/webp',
    'Content-Disposition': 'attachment; filename="holiday-1080x810.webp"',
    'X-Original-Size': '2411724',
    'X-Output-Size': '313524',
    'X-RateLimit-Remaining': '19',
};

function submitOnce(result, options = {}) {
    let promise;
    act(() => {
        promise = result.current.submit(new FormData(), options);
    });
    return promise;
}

async function complete(promise, response) {
    let payload;
    await act(async () => {
        await xhr.last().respond(response);
        payload = await promise;
    });
    return payload;
}

describe('useToolSubmit success path', () => {
    it('returns the blob with the numbers the panel prints', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const blob = blobOfSize(313_524);

        const promise = submitOnce(result, { originalBytes: 2_411_724 });
        const payload = await complete(promise, { status: 200, headers: OK_HEADERS, body: blob });

        expect(payload.blob).toBe(blob);
        expect(payload.filename).toBe('holiday-1080x810.webp');
        expect(payload).toMatchObject({
            originalBytes: 2_411_724,
            resultBytes: 313_524,
            savedPercent: 87,
            remaining: 19,
        });
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(100);
    });

    it('posts to the endpoint it was given', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/convert' }));

        const promise = submitOnce(result);
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        expect(xhr.last().method).toBe('POST');
        expect(xhr.last().url).toBe('/api/convert');
        expect(xhr.last().responseType).toBe('blob');
    });

    it('prefers a caller-supplied filename over the header', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/resize' }));

        const promise = submitOnce(result, { filename: 'my-name.webp' });
        const payload = await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        expect(payload.filename).toBe('my-name.webp');
    });

    it('reads a UTF-8 filename out of the disposition header', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/resize' }));

        const promise = submitOnce(result);
        const payload = await complete(promise, {
            status: 200,
            headers: { 'Content-Disposition': "attachment; filename*=UTF-8''caf%C3%A9.webp" },
            body: blobOfSize(10),
        });

        expect(payload.filename).toBe('café.webp');
    });

    it('falls back to a default name when the response carries none', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/resize' }));

        const promise = submitOnce(result);
        const payload = await complete(promise, { status: 200, headers: {}, body: blobOfSize(10) });

        expect(payload.filename).toBe('resizo-output');
    });

    it('hands the result to onSuccess and carries the caller meta through', async () => {
        const onSuccess = vi.fn();
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/crop', onSuccess }));

        const promise = submitOnce(result, { meta: { tool: 'crop' } });
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onSuccess.mock.calls[0][0].meta).toEqual({ tool: 'crop' });
    });

    it('maps measured upload progress onto the first three quarters of the bar', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        act(() => xhr.last().uploadProgress(40, 100));
        expect(result.current.progress).toBe(30);

        act(() => xhr.last().uploadDone());
        expect(result.current.progress).toBe(75);

        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });
        expect(result.current.progress).toBe(100);
    });

    it('ignores a progress event that cannot be measured', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        act(() => xhr.last().upload.onprogress({ lengthComputable: false, loaded: 5, total: 0 }));
        expect(result.current.progress).toBe(0);

        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });
    });
});

describe('useToolSubmit download', () => {
    it('fires the anchor download and revokes the URL only after a delay', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress', autoDownload: true }));

        const promise = submitOnce(result);
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        expect(clicks).toHaveLength(1);
        expect(clicks[0].download).toBe('holiday-1080x810.webp');
        expect(clicks[0].connected).toBe(true);
        expect(document.querySelector('a[download]')).toBeNull();

        // Safari and Firefox abort a download whose blob URL is revoked in the
        // same tick as the click, so nothing may be revoked yet.
        expect(revokeObjectURL).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(1000));
        expect(revokeObjectURL).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(1000));
        expect(revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL.mock.calls[0][0]).toBe(clicks[0].href);
    });

    it('does not download unless the tool asked for it', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        expect(clicks).toHaveLength(0);
    });

    it('re-fires the download for a result already in hand', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        let fired;
        act(() => {
            fired = result.current.download();
        });

        expect(fired).toBe(true);
        expect(clicks).toHaveLength(1);
    });

    it('downloads an explicit payload when one is passed', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        act(() => {
            result.current.download({ blob: blobOfSize(10), filename: 'other.zip' });
        });

        expect(clicks[0].download).toBe('other.zip');
    });

    it('refuses to download nothing', () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        let fired;
        act(() => {
            fired = result.current.download();
        });

        expect(fired).toBe(false);
        expect(clicks).toHaveLength(0);
    });
});

describe('useToolSubmit error paths', () => {
    it('surfaces the API sentence from a JSON error body', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        const payload = await complete(promise, {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: new Blob([JSON.stringify({ error: 'Quality must be between 1 and 100.' })], { type: 'application/json' }),
        });

        expect(payload).toBeNull();
        expect(result.current.error).toBe('Quality must be between 1 and 100.');
        expect(result.current.result).toBeNull();
        expect(result.current.progress).toBe(0);
    });

    it('turns a plain-text 413 into the human too-large sentence', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, {
            status: 413,
            headers: { 'Content-Type': 'text/plain' },
            body: new Blob(['Request Entity Too Large'], { type: 'text/plain' }),
        });

        expect(result.current.error).toBe(messageForStatus(413));
        expect(result.current.error).toContain('larger than the server will accept');
        expect(result.current.error).not.toContain('Request Entity Too Large');
    });

    it('never prints the literal word undefined at a visitor', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, {
            status: 500,
            headers: {},
            body: new Blob(['undefined'], { type: 'text/plain' }),
        });

        expect(result.current.error).toBe(messageForStatus(500));
        expect(result.current.error).not.toBe('undefined');
    });

    it('never prints markup at a visitor', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
            body: new Blob(['<html><body>502 Bad Gateway</body></html>'], { type: 'text/html' }),
        });

        expect(result.current.error).toBe(messageForStatus(502));
        expect(result.current.error).not.toContain('<');
    });

    it('explains a body that could not be read at all', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const unreadable = { text: () => Promise.reject(new Error('gone')) };

        const promise = submitOnce(result);
        await complete(promise, { status: 500, headers: {}, body: unreadable });

        expect(result.current.error).toBe(messageForStatus(500));
    });

    it('treats an empty 200 as a failure rather than a zero-byte download', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        const payload = await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(0) });

        expect(payload).toBeNull();
        expect(result.current.error).toBe(messageForStatus(500));
    });

    it('explains a request that never reached the server', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        await act(async () => {
            xhr.last().networkError();
            await promise;
        });

        expect(result.current.error).toBe(messageForStatus(0));
        expect(result.current.isProcessing).toBe(false);
    });

    it('explains a timeout', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        await act(async () => {
            xhr.last().timeout();
            await promise;
        });

        expect(result.current.error).toBe(messageForStatus(408));
    });

    it('refuses to run without an endpoint', () => {
        const { result } = renderHook(() => useToolSubmit());

        expect(() => result.current.submit(new FormData())).toThrow('useToolSubmit requires an endpoint.');
    });
});

describe('useToolSubmit lifecycle', () => {
    it('cancels an in-flight request without leaving an error behind', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        let payload;
        await act(async () => {
            result.current.cancel();
            payload = await promise;
        });

        expect(payload).toBeNull();
        expect(xhr.last().aborted).toBe(true);
        expect(result.current.error).toBeNull();
        expect(result.current.isProcessing).toBe(false);
        expect(result.current.progress).toBe(0);
    });

    it('aborts the previous request when a second submit starts', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const first = submitOnce(result);

        let second;
        await act(async () => {
            second = result.current.submit(new FormData());
            await first;
        });

        expect(xhr.requests[0].aborted).toBe(true);
        await complete(second, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });
        expect(result.current.error).toBeNull();
    });

    it('aborts on unmount and never sets state afterwards', async () => {
        const { result, unmount } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));
        const promise = submitOnce(result);

        unmount();
        const payload = await promise;

        expect(payload).toBeNull();
        expect(xhr.last().aborted).toBe(true);
    });

    it('resets back to an empty panel', async () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        const promise = submitOnce(result);
        await complete(promise, { status: 200, headers: OK_HEADERS, body: blobOfSize(10) });

        act(() => result.current.reset());

        expect(result.current.result).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.progress).toBe(0);
        expect(result.current.isProcessing).toBe(false);
    });

    it('lets a tool set its own error message', () => {
        const { result } = renderHook(() => useToolSubmit({ endpoint: '/api/compress' }));

        act(() => result.current.setError('Pick a file first.'));

        expect(result.current.error).toBe('Pick a file first.');
    });
});
