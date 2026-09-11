/**
 * useImageUpload — the AVIF intake gate.
 *
 * Once 'avif' joins an accept list, a file that SNIFFS as AVIF still is not
 * necessarily openable: capability.js's canDecodeAvif() decodes a tiny built-in
 * AVIF once with createImageBitmap and remembers the answer for the browser
 * this tab is running in. This hook is the one place that check belongs — at
 * the point of drop, not after a Convert/Resize button has already been
 * pressed — because a refusal at intake is a sentence next to the file the
 * visitor just chose, exactly like every other rejectReason here, rather than
 * a surprise after they have configured the whole panel.
 *
 * canDecodeAvif() does not exist in lib/image-client/capability.js yet — the
 * engine work landing it is separate — so this file mocks the module rather
 * than guarding the import with a typeof check. Once the real export lands,
 * these tests exercise it unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { canDecodeAvifMock } = vi.hoisted(() => ({ canDecodeAvifMock: vi.fn() }));

vi.mock('@/lib/image-client/capability', () => ({
    canDecodeAvif: canDecodeAvifMock,
}));

import { useImageUpload } from '@/lib/hooks/useImageUpload';
import { imageFile, stubImageProbe } from '../helpers.jsx';

const AVIF_ACCEPT = ['jpeg', 'png', 'webp', 'avif'];

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    canDecodeAvifMock.mockReset();
});

afterEach(() => {
    probe.restore();
});

async function select(result, files) {
    let accepted;
    await act(async () => {
        accepted = await result.current.selectFiles(files);
    });
    return accepted;
}

const DAMAGED = 'This AVIF file is damaged or incomplete and could not be read.';
const ANIMATED = 'Animated AVIF is not supported yet.';

/** A committed AVIF fixture as the File a drop zone would hand over. */
function fixtureFile(name) {
    // process.cwd() is the repo root under vitest; import.meta.url is an http
    // URL in the jsdom project and cannot locate a file.
    const bytes = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'avif', name));
    return new File([bytes], name, { type: 'image/avif' });
}

describe('useImageUpload — AVIF intake', () => {
    /**
     * THE CONTAINER IS READ BEFORE ANY PREVIEW. A browser handed an animated
     * AVIF shows its first frame and says nothing; a browser handed a broken
     * one fails a decode with a generic sentence. Both are refused here, by
     * name, from the file's own header, before an object URL or an <img> probe
     * exists for them.
     */
    /**
     * WHERE THE BROWSER HAS createImageBitmap, AN AVIF IS MEASURED WITH IT —
     * the decoder the engine will use — and never through an <img> probe on
     * an object URL. Two reasons: a broken file then fails here, in this
     * hook's own words, before any object URL exists; and an <img> whose load
     * fails is exactly what a Playwright trace tries to fetch back through a
     * blob: URL, which the site's connect-src forbids, so the failed probe
     * showed up as a console error in every flow that dropped a damaged AVIF.
     */
    it('measures an AVIF with createImageBitmap when the browser has it, without an <img> probe', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const seen = [];
        globalThis.createImageBitmap = async (blob) => {
            seen.push(blob.type);
            return { width: 96, height: 64, close() {} };
        };
        probe.configure({ fail: true }); // an <img> probe would fail — it must not be consulted
        try {
            const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));
            await select(result, [fixtureFile('irot-90.avif')]);

            expect(result.current.error).toBeNull();
            expect(result.current.file).toMatchObject({ format: 'avif', width: 96, height: 64 });
            expect(seen).toEqual(['image/avif']);
        } finally {
            delete globalThis.createImageBitmap;
        }
    });

    it('refuses an AVIF the browser\'s decoder rejects with the AVIF sentence, before any preview exists', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const created = [];
        const originalCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { created.push(blob); return 'blob:probe'; };
        globalThis.createImageBitmap = async () => { throw new Error('decode failed'); };
        try {
            const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));
            await select(result, [fixtureFile('truncated.avif')]);

            expect(result.current.file).toBeNull();
            expect(result.current.error).toBe(DAMAGED);
            expect(created).toEqual([]);
        } finally {
            delete globalThis.createImageBitmap;
            URL.createObjectURL = originalCreate;
        }
    });

    it('refuses an AVIF that declares itself an animation, at intake, by name', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        await select(result, [fixtureFile('avis-brand.avif')]);

        expect(result.current.file).toBeNull();
        expect(result.current.error).toBe(ANIMATED);
    });

    it('refuses an AVIF whose container cannot be read with the AVIF sentence, not the generic one', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        await select(result, [fixtureFile('garbage-after-ftyp.avif')]);

        expect(result.current.file).toBeNull();
        expect(result.current.error).toBe(DAMAGED);
    });

    it('names AVIF when a well-formed header hides a picture the browser cannot decode', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        probe.configure({ fail: true });
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        await select(result, [fixtureFile('irot-90.avif')]);

        expect(result.current.file).toBeNull();
        expect(result.current.error).toBe(DAMAGED);
    });

    it('accepts an AVIF file when this browser can decode one', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        const accepted = await select(result, [imageFile('photo.avif', 'avif')]);

        expect(accepted).toHaveLength(1);
        expect(result.current.error).toBeNull();
        expect(result.current.file).toMatchObject({ name: 'photo.avif', format: 'avif' });
        expect(canDecodeAvifMock).toHaveBeenCalledTimes(1);
    });

    it('refuses an AVIF file with a named-browser sentence when this browser cannot decode one', async () => {
        canDecodeAvifMock.mockResolvedValue(false);
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        const accepted = await select(result, [imageFile('photo.avif', 'avif')]);

        expect(accepted).toEqual([]);
        expect(result.current.hasFiles).toBe(false);
        expect(result.current.error).toBe(
            'This browser cannot open AVIF images. Chrome 85, Firefox 93, and Safari 16 on iOS 16 or '
            + 'macOS Ventura and later can.',
        );
    });

    it('never asks canDecodeAvif about a non-AVIF file', async () => {
        canDecodeAvifMock.mockResolvedValue(true);
        const { result } = renderHook(() => useImageUpload({ accept: AVIF_ACCEPT }));

        await select(result, [imageFile('photo.jpg', 'jpeg')]);

        expect(canDecodeAvifMock).not.toHaveBeenCalled();
    });

    it('rejects an AVIF file the ordinary way when the tool has not opted AVIF into its accept list', async () => {
        // Today's / a non-convert/resize tool's shape: accept has no 'avif', so
        // the generic wrong-type gate has to catch it before canDecodeAvif is
        // ever asked — an AVIF is not a JPEG, PNG or WebP for that tool either
        // way, and the sentence should say so rather than mention a browser.
        canDecodeAvifMock.mockResolvedValue(true);
        const { result } = renderHook(() => useImageUpload({ accept: ['jpeg', 'png', 'webp'] }));

        await select(result, [imageFile('photo.avif', 'avif')]);

        expect(result.current.error).toBe('That file is not a JPEG, PNG or WebP image. Pick one of those formats.');
        expect(canDecodeAvifMock).not.toHaveBeenCalled();
    });
});
