/**
 * usePreviewUrl
 *
 * The object URL for a result blob. Its only job is that ten results in a row
 * do not pin ten decoded bitmaps in memory, so every assertion here is about
 * the revoke.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePreviewUrl } from '@/lib/hooks/usePreviewUrl';
import { blobOfSize } from '../helpers.jsx';

let revokeObjectURL;

beforeEach(() => {
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
});

describe('usePreviewUrl', () => {
    it('starts empty', () => {
        const { result } = renderHook(() => usePreviewUrl());
        expect(result.current.url).toBeNull();
    });

    it('publishes a URL for a blob', () => {
        const { result } = renderHook(() => usePreviewUrl());

        act(() => result.current.show(blobOfSize(10)));

        expect(result.current.url).toMatch(/^blob:/);
    });

    it('revokes the previous URL when a new result replaces it', () => {
        const { result } = renderHook(() => usePreviewUrl());

        act(() => result.current.show(blobOfSize(10)));
        const first = result.current.url;

        act(() => result.current.show(blobOfSize(20)));

        expect(revokeObjectURL).toHaveBeenCalledWith(first);
        expect(result.current.url).not.toBe(first);
    });

    it('revokes on clear', () => {
        const { result } = renderHook(() => usePreviewUrl());
        act(() => result.current.show(blobOfSize(10)));
        const url = result.current.url;

        act(() => result.current.clear());

        expect(revokeObjectURL).toHaveBeenCalledWith(url);
        expect(result.current.url).toBeNull();
    });

    it('revokes nothing when there was nothing to revoke', () => {
        const { result } = renderHook(() => usePreviewUrl());

        act(() => result.current.clear());

        expect(revokeObjectURL).not.toHaveBeenCalled();
    });

    it('revokes on unmount', () => {
        const { result, unmount } = renderHook(() => usePreviewUrl());
        act(() => result.current.show(blobOfSize(10)));
        const url = result.current.url;

        unmount();

        expect(revokeObjectURL).toHaveBeenCalledWith(url);
    });
});
