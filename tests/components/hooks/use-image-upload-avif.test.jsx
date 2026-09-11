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

describe('useImageUpload — AVIF intake', () => {
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
