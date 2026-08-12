/**
 * useImageUpload
 *
 * The four things six tool clients used to reimplement and drift on: the
 * signature check, the object-URL lifecycle, the drag state and the dimension
 * probe. A leaked blob URL pins a decoded bitmap in memory, so every create is
 * paired with a revoke here.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/constants';
import { useImageUpload } from '@/lib/hooks/useImageUpload';
import { disguisedFile, imageFile, stubImageProbe } from '../helpers.jsx';

let probe;
let createObjectURL;
let revokeObjectURL;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
    createObjectURL = vi.spyOn(URL, 'createObjectURL');
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
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

describe('useImageUpload acceptance', () => {
    it('accepts a real JPEG and reports its facts', async () => {
        const { result } = renderHook(() => useImageUpload());
        const file = imageFile('holiday.jpg', 'jpeg', { size: 2_411_724 });

        const accepted = await select(result, [file]);

        expect(accepted).toHaveLength(1);
        expect(result.current.error).toBeNull();
        expect(result.current.hasFiles).toBe(true);
        expect(result.current.state).toBe('accepted');
        expect(result.current.file).toMatchObject({
            name: 'holiday.jpg',
            size: 2_411_724,
            format: 'jpeg',
            width: 1200,
            height: 800,
            selected: true,
        });
        expect(result.current.file.previewUrl).toMatch(/^blob:/);
    });

    it('measures dimensions through window.Image, not a bare Image', async () => {
        const { result } = renderHook(() => useImageUpload());
        probe.configure({ width: 4032, height: 3024 });

        await select(result, [imageFile('holiday.jpg')]);

        expect(probe.probes).toHaveLength(1);
        expect(result.current.file.width).toBe(4032);
        expect(result.current.file.height).toBe(3024);
    });

    it('publishes the accept attribute and the constraints line for the zone', () => {
        const { result } = renderHook(() => useImageUpload());

        expect(result.current.accept).toBe('image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp');
        expect(result.current.constraints).toBe('JPEG, PNG, WebP · up to 20 MB');
    });

    it('names the file cap in the constraints line in batch mode', () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true, maxFiles: 20 }));
        expect(result.current.constraints).toBe('JPEG, PNG, WebP · up to 20 MB · 20 files max');
    });

    it('falls back to the raster formats when handed an empty accept list', () => {
        const { result } = renderHook(() => useImageUpload({ accept: [] }));
        expect(result.current.constraints).toContain('JPEG, PNG, WebP');
    });
});

describe('useImageUpload rejection', () => {
    it('rejects a file whose bytes are not an image, whatever its name claims', async () => {
        const { result } = renderHook(() => useImageUpload());

        const accepted = await select(result, [disguisedFile('holiday.jpg')]);

        expect(accepted).toEqual([]);
        expect(result.current.error).toBe('That file is not a JPEG, PNG, WebP image. Pick one of those formats.');
        expect(result.current.state).toBe('reject');
        expect(result.current.hasFiles).toBe(false);
    });

    it('rejects a real image in a format this tool does not take', async () => {
        const { result } = renderHook(() => useImageUpload({ accept: ['jpeg', 'png'] }));

        await select(result, [imageFile('animation.gif', 'gif')]);

        expect(result.current.error).toBe('That file is not a JPEG, PNG image. Pick one of those formats.');
    });

    it('rejects an empty file and says what to do', async () => {
        const { result } = renderHook(() => useImageUpload());

        await select(result, [imageFile('empty.jpg', 'jpeg', { size: 0 })]);

        expect(result.current.error).toBe('That file is empty. Pick a file with content in it.');
    });

    it('names both numbers when the file is over the cap', async () => {
        const { result } = renderHook(() => useImageUpload());

        await select(result, [imageFile('huge.jpg', 'jpeg', { size: MAX_FILE_SIZE + 1 })]);

        expect(result.current.error).toContain('The limit is 20 MB');
        expect(result.current.error).toContain('compress it first');
    });

    it('rejects an image past the pixel cap and revokes the URL it made', async () => {
        const { result } = renderHook(() => useImageUpload());
        probe.configure({ width: MAX_DIMENSION + 1, height: 100 });

        await select(result, [imageFile('enormous.jpg')]);

        expect(result.current.error).toContain(`wider or taller than ${MAX_DIMENSION} px`);
        expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0].value);
    });

    it('rejects an image the browser cannot decode and revokes the URL it made', async () => {
        const { result } = renderHook(() => useImageUpload());
        probe.configure({ fail: true });

        await select(result, [imageFile('damaged.jpg')]);

        expect(result.current.error).toBe('That file could not be read as an image. It may be damaged.');
        expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0].value);
    });

    it('does nothing at all for an empty selection', async () => {
        const { result } = renderHook(() => useImageUpload());

        const accepted = await select(result, []);

        expect(accepted).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('clears the error on demand', async () => {
        const { result } = renderHook(() => useImageUpload());
        await select(result, [disguisedFile()]);

        act(() => result.current.clearError());

        expect(result.current.error).toBeNull();
        expect(result.current.state).toBe('rest');
    });
});

describe('useImageUpload object-URL lifecycle', () => {
    it('revokes the previous URL when a single-file pick is replaced', async () => {
        const { result } = renderHook(() => useImageUpload());

        await select(result, [imageFile('one.jpg')]);
        const first = result.current.file.previewUrl;

        await select(result, [imageFile('two.jpg')]);

        expect(revokeObjectURL).toHaveBeenCalledWith(first);
        expect(result.current.files).toHaveLength(1);
        expect(result.current.file.name).toBe('two.jpg');
    });

    it('revokes on clear', async () => {
        const { result } = renderHook(() => useImageUpload());
        await select(result, [imageFile('one.jpg')]);
        const url = result.current.file.previewUrl;

        act(() => result.current.clear());

        expect(revokeObjectURL).toHaveBeenCalledWith(url);
        expect(result.current.files).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it('revokes on remove', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true }));
        await select(result, [imageFile('one.jpg'), imageFile('two.jpg')]);
        const [first] = result.current.files;

        act(() => result.current.removeFile(first.id));

        expect(revokeObjectURL).toHaveBeenCalledWith(first.previewUrl);
        expect(result.current.files).toHaveLength(1);
    });

    it('revokes every held URL on unmount', async () => {
        const { result, unmount } = renderHook(() => useImageUpload({ multiple: true }));
        await select(result, [imageFile('one.jpg'), imageFile('two.jpg')]);
        const urls = result.current.files.map((entry) => entry.previewUrl);

        revokeObjectURL.mockClear();
        unmount();

        expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(urls.sort());
    });

    it('creates no URL and runs no probe when previews are off', async () => {
        const { result } = renderHook(() => useImageUpload({ accept: ['jpeg'], previews: false }));

        await select(result, [imageFile('IMG_0421.jpg')]);

        expect(createObjectURL).not.toHaveBeenCalled();
        expect(probe.probes).toHaveLength(0);
        expect(result.current.file).toMatchObject({ previewUrl: null, width: null, height: null });
    });

    it('skips the probe when the caller turns the pixel cap off', async () => {
        const { result } = renderHook(() => useImageUpload({ maxDimension: 0 }));

        await select(result, [imageFile('one.jpg')]);

        expect(probe.probes).toHaveLength(0);
        expect(result.current.file.width).toBeNull();
    });
});

describe('useImageUpload batch mode', () => {
    it('collects files across several selections', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true }));

        await select(result, [imageFile('one.jpg'), imageFile('two.png', 'png')]);
        await select(result, [imageFile('three.webp', 'webp')]);

        expect(result.current.files.map((entry) => entry.name)).toEqual(['one.jpg', 'two.png', 'three.webp']);
        expect(result.current.file).toBeNull();
        expect(new Set(result.current.files.map((entry) => entry.id)).size).toBe(3);
    });

    it('keeps only the first file when the tool is single-file', async () => {
        const { result } = renderHook(() => useImageUpload());

        await select(result, [imageFile('one.jpg'), imageFile('two.jpg')]);

        expect(result.current.files).toHaveLength(1);
        expect(result.current.file.name).toBe('one.jpg');
    });

    it('refuses a batch over the file-count cap without touching what is held', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true, maxFiles: 2 }));
        await select(result, [imageFile('one.jpg')]);

        const accepted = await select(result, [imageFile('two.jpg'), imageFile('three.jpg')]);

        expect(accepted).toEqual([]);
        expect(result.current.error).toBe('You can process 2 files at a time. Remove a few and try again.');
        expect(result.current.files).toHaveLength(1);
    });

    it('refuses a batch over the byte cap', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true, maxTotalBytes: 1500 }));

        await select(result, [
            imageFile('one.jpg', 'jpeg', { size: 1000 }),
            imageFile('two.jpg', 'jpeg', { size: 1000 }),
        ]);

        expect(result.current.error).toContain('add up to more than');
        expect(result.current.files).toEqual([]);
    });

    it('keeps the good files and reports the first bad one', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true }));

        await select(result, [imageFile('good.jpg'), disguisedFile('bad.jpg')]);

        expect(result.current.files.map((entry) => entry.name)).toEqual(['good.jpg']);
        expect(result.current.error).toContain('is not a JPEG, PNG, WebP image');
    });

    it('patches one entry without disturbing the rest', async () => {
        const { result } = renderHook(() => useImageUpload({ multiple: true }));
        await select(result, [imageFile('one.jpg'), imageFile('two.jpg')]);
        const [first, second] = result.current.files;

        act(() => result.current.updateFile(first.id, { selected: false }));

        expect(result.current.files[0].selected).toBe(false);
        expect(result.current.files[1]).toBe(second);
    });
});

describe('useImageUpload drag state', () => {
    it('reports dragover while a file is over the zone', () => {
        const { result } = renderHook(() => useImageUpload());

        act(() => result.current.setDragging(true));
        expect(result.current.state).toBe('dragover');

        act(() => result.current.setDragging(false));
        expect(result.current.state).toBe('rest');
    });

    it('lets a reject outrank a hover', async () => {
        const { result } = renderHook(() => useImageUpload());
        await select(result, [disguisedFile()]);

        act(() => result.current.setDragging(true));

        expect(result.current.state).toBe('reject');
    });

    it('drops the drag state the moment files arrive', async () => {
        const { result } = renderHook(() => useImageUpload());
        act(() => result.current.setDragging(true));

        await select(result, [imageFile('one.jpg')]);

        expect(result.current.isDragging).toBe(false);
        expect(result.current.isReading).toBe(false);
    });

    it('clears the drag state on clear', () => {
        const { result } = renderHook(() => useImageUpload());
        act(() => result.current.setDragging(true));

        act(() => result.current.clear());

        expect(result.current.isDragging).toBe(false);
    });
});
