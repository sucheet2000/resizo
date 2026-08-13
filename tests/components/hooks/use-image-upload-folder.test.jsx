/**
 * useImageUpload.selectFolder
 *
 * The folder path of the batch intake. What has to hold:
 *
 *  - the tree is filtered by MAGIC BYTES, so a .jpg that is really a PDF never
 *    becomes an entry and a folder of documents produces a sentence, not a
 *    stack of failures;
 *  - a folder bigger than the batch is TRIMMED AND SAID SO — never rejected the
 *    way a hand-picked over-cap drop is, and never quietly cut down;
 *  - the trimming message lands on `notice`, not on `error`, because nothing
 *    went wrong;
 *  - each entry carries where it sat, so the ZIP can put it back there.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_FILE_SIZE, RESIZE_INPUT_FORMATS } from '@/lib/limits';
import { useImageUpload } from '@/lib/hooks/useImageUpload';
import { imageFile, stubImageProbe } from '../helpers.jsx';

let probe;

beforeEach(() => {
    probe = stubImageProbe({ width: 1200, height: 800 });
});

afterEach(() => {
    probe.restore();
});

/** An imageFile placed on a path, the way a directory pick reports one. */
function atPath(path, format = 'jpeg', options = {}) {
    const file = imageFile(path.split('/').pop(), format, options);
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
    return file;
}

function bulkHook(options = {}) {
    return renderHook(() => useImageUpload({
        accept: RESIZE_INPUT_FORMATS,
        multiple: true,
        maxFiles: MAX_BULK_FILES,
        ...options,
    }));
}

async function pickFolder(result, files) {
    let accepted;
    await act(async () => {
        accepted = await result.current.selectFolder(files);
    });
    return accepted;
}

async function pickFiles(result, files) {
    let accepted;
    await act(async () => {
        accepted = await result.current.selectFiles(files);
    });
    return accepted;
}

describe('selectFolder — the bytes decide, not the extension', () => {
    it('takes the real images out of a mixed folder and leaves the rest', async () => {
        const { result } = bulkHook();

        const accepted = await pickFolder(result, [
            atPath('Trip/photo.jpg', 'jpeg'),
            // Named .jpg, and a PDF underneath.
            atPath('Trip/invoice.jpg', 'other'),
            atPath('Trip/logo.png', 'png'),
            atPath('Trip/notes.txt', 'other'),
        ]);

        expect(accepted).toHaveLength(2);
        expect(result.current.files.map((entry) => entry.name)).toEqual(['logo.png', 'photo.jpg']);
        expect(result.current.notice).toContain('Added 2 images from that folder.');
        expect(result.current.notice).toContain('2 other files in there are not images this tool reads.');
    });

    it('says how many usable images a folder of documents held — which is none', async () => {
        const { result } = bulkHook();

        const accepted = await pickFolder(result, [
            atPath('Work/report.pdf', 'other'),
            atPath('Work/sheet.csv', 'other'),
        ]);

        expect(accepted).toEqual([]);
        expect(result.current.files).toEqual([]);
        expect(result.current.notice).toContain('No JPEG, PNG or WebP images were found in that folder.');
        // Not an error: nothing went wrong, the folder simply had no photos.
        expect(result.current.error).toBeNull();
        expect(result.current.state).toBe('rest');
    });

    it('leaves out a real image in a format this tool does not take', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [atPath('Old/animation.gif', 'gif'), atPath('Old/a.jpg', 'jpeg')]);

        expect(result.current.files.map((entry) => entry.name)).toEqual(['a.jpg']);
    });

    it('ignores the system files nobody chose', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [
            atPath('Trip/.DS_Store', 'other'),
            atPath('Trip/a.jpg', 'jpeg'),
        ]);

        expect(result.current.notice).toBe('Added 1 image from that folder.');
    });
});

describe('selectFolder — the cap trims and says so', () => {
    it('adds the first twenty of a large folder and names every number', async () => {
        const { result } = bulkHook();
        const files = Array.from({ length: 312 }, (_, index) =>
            atPath(`Trip/${String(index).padStart(4, '0')}.jpg`, 'jpeg', { size: 1000 }));

        const accepted = await pickFolder(result, files);

        expect(accepted).toHaveLength(MAX_BULK_FILES);
        expect(result.current.files).toHaveLength(MAX_BULK_FILES);
        expect(result.current.files[0].name).toBe('0000.jpg');
        expect(result.current.notice).toContain('That folder has 312 images.');
        expect(result.current.notice).toContain('The first 20 by name were added');
        expect(result.current.notice).toContain('one batch takes up to 20 images and 80 MB in total');
        expect(result.current.notice).toContain('the other 292 were left out');
    });

    it('puts the trimming on notice, never on error', async () => {
        const { result } = bulkHook();
        const files = Array.from({ length: 40 }, (_, index) =>
            atPath(`Trip/${String(index).padStart(3, '0')}.jpg`, 'jpeg', { size: 1000 }));

        await pickFolder(result, files);

        expect(result.current.error).toBeNull();
        expect(result.current.state).toBe('accepted');
    });

    it('does NOT refuse the whole pick the way an over-cap hand-picked drop is refused', async () => {
        // The existing drop behaviour, unchanged, for contrast: 25 files chosen
        // by hand are refused outright, because "remove a few" is advice a
        // person can act on. A folder of 312 is not.
        const { result } = bulkHook({ maxFiles: 2 });

        const dropped = await pickFiles(result, [
            atPath('a.jpg'), atPath('b.jpg'), atPath('c.jpg'),
        ]);

        expect(dropped).toEqual([]);
        expect(result.current.error).toBe('You can process 2 files at a time. Remove a few and try again.');
    });

    it('respects what the batch already holds', async () => {
        const { result } = bulkHook({ maxFiles: 3 });
        await pickFiles(result, [imageFile('held.jpg')]);

        await pickFolder(result, [
            atPath('Trip/a.jpg'), atPath('Trip/b.jpg'), atPath('Trip/c.jpg'), atPath('Trip/d.jpg'),
        ]);

        expect(result.current.files.map((entry) => entry.name)).toEqual(['held.jpg', 'a.jpg', 'b.jpg']);
        expect(result.current.notice).toContain('The first 2 by name were added');
    });

    it('adds nothing when the batch is already full, and still says what was in there', async () => {
        const { result } = bulkHook({ maxFiles: 1 });
        await pickFiles(result, [imageFile('held.jpg')]);

        const accepted = await pickFolder(result, [atPath('Trip/a.jpg'), atPath('Trip/b.jpg')]);

        expect(accepted).toEqual([]);
        expect(result.current.files).toHaveLength(1);
        expect(result.current.notice).toContain('That folder has 2 images, and this batch is already full');
    });

    it('stops on the byte budget when the photos are big', async () => {
        const { result } = bulkHook({ maxTotalBytes: MAX_BULK_TOTAL_BYTES });
        const files = Array.from({ length: 12 }, (_, index) =>
            atPath(`Trip/${index}.jpg`, 'jpeg', { size: 10 * 1024 * 1024 }));

        await pickFolder(result, files);

        expect(result.current.files).toHaveLength(8);
        expect(result.current.notice).toContain('The first 8 by name were added');
    });

    it('leaves out an image over the per-file cap and says which limit it hit', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [
            atPath('Trip/a.jpg', 'jpeg', { size: 1000 }),
            atPath('Trip/huge.jpg', 'jpeg', { size: MAX_FILE_SIZE + 1 }),
        ]);

        expect(result.current.files).toHaveLength(1);
        expect(result.current.notice).toContain('1 image was over 20 MB and was left out.');
    });
});

describe('selectFolder — where each file sat travels with it', () => {
    it('records the relative path and the cleaned folder', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [atPath('Holiday/2024/IMG_0001.jpg')]);

        expect(result.current.files[0]).toMatchObject({
            name: 'IMG_0001.jpg',
            relativePath: 'Holiday/2024/IMG_0001.jpg',
            folder: 'Holiday/2024',
        });
    });

    it('leaves both empty for a file that arrived any other way', async () => {
        const { result } = bulkHook();

        await pickFiles(result, [imageFile('dropped.jpg')]);

        expect(result.current.files[0]).toMatchObject({ relativePath: '', folder: '' });
    });

    it('keeps two same-named photos from two subfolders distinguishable', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [
            atPath('Trip/jan/IMG_0001.jpg'),
            atPath('Trip/feb/IMG_0001.jpg'),
        ]);

        expect(result.current.files.map((entry) => entry.folder)).toEqual(['Trip/feb', 'Trip/jan']);
        expect(new Set(result.current.files.map((entry) => entry.relativePath)).size).toBe(2);
    });
});

describe('selectFolder — the notice does not linger', () => {
    it('is cleared by a plain file pick', async () => {
        const { result } = bulkHook();
        await pickFolder(result, [atPath('Trip/a.jpg')]);
        expect(result.current.notice).toBeTruthy();

        await pickFiles(result, [imageFile('later.jpg')]);

        expect(result.current.notice).toBeNull();
    });

    it('is cleared by clear()', async () => {
        const { result } = bulkHook();
        await pickFolder(result, [atPath('Trip/a.jpg')]);

        act(() => result.current.clear());

        expect(result.current.notice).toBeNull();
    });

    it('does nothing at all for an empty pick', async () => {
        const { result } = bulkHook();

        const accepted = await pickFolder(result, []);

        expect(accepted).toEqual([]);
        expect(result.current.notice).toBeNull();
        expect(result.current.isReading).toBe(false);
    });

    it('reads one file at a time, never the whole folder in parallel', async () => {
        // The dimension probe is the expensive half of intake; a folder pick
        // that ran them together is exactly the memory spike this engine
        // refuses everywhere else.
        const { result } = bulkHook();
        const files = Array.from({ length: 5 }, (_, index) => atPath(`Trip/${index}.jpg`));

        await pickFolder(result, files);

        expect(probe.probes).toHaveLength(5);
        expect(result.current.files).toHaveLength(5);
    });

    it('leaves isReading false once the pick has settled', async () => {
        const { result } = bulkHook();

        await pickFolder(result, [atPath('Trip/a.jpg')]);

        expect(result.current.isReading).toBe(false);
    });

    it('survives a folder input handing back a FileList rather than an array', async () => {
        const { result } = bulkHook();
        const files = [atPath('Trip/a.jpg'), atPath('Trip/b.jpg')];
        const list = { length: 2, 0: files[0], 1: files[1], [Symbol.iterator]: files[Symbol.iterator].bind(files) };

        await pickFolder(result, list);

        expect(result.current.files).toHaveLength(2);
    });
});

describe('selectFolder — nothing is sent anywhere', () => {
    it('never touches the network while reading a folder', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
            throw new Error('no network');
        });
        const { result } = bulkHook();

        await pickFolder(result, [atPath('Trip/a.jpg'), atPath('Trip/b.png', 'png')]);

        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
