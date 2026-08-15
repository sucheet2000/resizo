/**
 * Folder picking.
 *
 * A folder is not a selection — it is whatever is on the disk — so the three
 * things asserted here are the three that decide whether this is safe:
 *
 *   THE FILTER IS THE BYTES.  A .jpg that is really a PDF must be left out, and
 *                             a .txt that really is a JPEG must be taken.
 *   THE COUNT IS HONEST.      A mixed folder reports how many usable images it
 *                             actually holds, not how many were added.
 *   NOTHING IS TRIMMED QUIETLY. The message a person reads names the real
 *                             number, the number added, and the two limits.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_FILE_SIZE } from '@/lib/limits';
import {
    FOLDER_SCAN_LIMIT,
    folderPickMessage,
    folderPickSupported,
    isHiddenPath,
    relativePathOf,
    scanFolderPick,
} from '@/lib/upload/folder-select';

const SIGNATURES = {
    jpeg: [0xFF, 0xD8, 0xFF, 0xE0],
    png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2D],
    text: [0x68, 0x65, 0x6C, 0x6C, 0x6F],
};

/**
 * A File that really carries the signature it claims, placed at a path the way
 * a directory pick reports one. `size` is overridden rather than allocated so a
 * 40 MB photo costs nothing to describe.
 */
function folderFile(path, format = 'jpeg', { size } = {}) {
    const bytes = new Uint8Array(16);
    bytes.set(SIGNATURES[format] ?? SIGNATURES.text, 0);

    const file = new File([bytes], path.split('/').pop(), { type: 'application/octet-stream' });
    Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
    if (Number.isFinite(size)) {
        Object.defineProperty(file, 'size', { value: size, configurable: true });
    }
    return file;
}

const ACCEPT = ['jpeg', 'png', 'webp'];

function scan(files, options = {}) {
    return scanFolderPick({ files, accept: ACCEPT, ...options });
}

describe('folderPickSupported', () => {
    it('is true when the input element carries webkitdirectory', () => {
        class WithDirectory {}
        WithDirectory.prototype.webkitdirectory = false;
        expect(folderPickSupported({ HTMLInputElement: WithDirectory })).toBe(true);
    });

    it('is false when it does not', () => {
        class WithoutDirectory {}
        expect(folderPickSupported({ HTMLInputElement: WithoutDirectory })).toBe(false);
    });

    it.each([
        ['there is no scope at all', undefined],
        ['the scope has no input element', {}],
        ['the input element is not a constructor', { HTMLInputElement: {} }],
    ])('is false when %s', (_label, scope) => {
        expect(folderPickSupported(scope ?? {})).toBe(false);
    });
});

describe('relativePathOf and isHiddenPath', () => {
    it('reads the path a directory pick reports', () => {
        expect(relativePathOf(folderFile('Holiday/a.jpg'))).toBe('Holiday/a.jpg');
    });

    it('is empty for a file that arrived any other way', () => {
        expect(relativePathOf(new File([], 'a.jpg'))).toBe('');
        expect(relativePathOf(null)).toBe('');
    });

    it.each([
        ['.DS_Store', true],
        ['Holiday/.DS_Store', true],
        ['.thumbnails/a.jpg', true],
        ['Holiday/a.jpg', false],
    ])('treats %s as hidden: %s', (path, hidden) => {
        expect(isHiddenPath(path)).toBe(hidden);
    });
});

describe('scanFolderPick — the filter is the bytes, never the extension', () => {
    it('leaves out a file named .jpg whose bytes are a PDF', async () => {
        const summary = await scan([
            folderFile('Docs/invoice.jpg', 'pdf'),
            folderFile('Docs/real.jpg', 'jpeg'),
        ]);

        expect(summary.usable).toBe(1);
        expect(summary.notImages).toBe(1);
        expect(summary.files.map((file) => file.name)).toEqual(['real.jpg']);
    });

    it('takes a file whose bytes are a JPEG whatever it is called', async () => {
        const summary = await scan([folderFile('Docs/notes.txt', 'jpeg')]);

        expect(summary.usable).toBe(1);
        expect(summary.files).toHaveLength(1);
    });

    it('leaves out a real image in a format this tool does not take', async () => {
        const summary = await scan([folderFile('Old/animation.gif', 'gif')]);

        expect(summary.usable).toBe(0);
        expect(summary.notImages).toBe(1);
    });

    it('a folder full of documents produces a count, not a crash', async () => {
        const summary = await scan([
            folderFile('Work/report.pdf', 'pdf'),
            folderFile('Work/notes.txt', 'text'),
            folderFile('Work/sheet.csv', 'text'),
        ]);

        expect(summary.usable).toBe(0);
        expect(summary.notImages).toBe(3);
        expect(summary.files).toEqual([]);
    });

    it('survives a file whose bytes cannot be read', async () => {
        const broken = folderFile('Holiday/a.jpg');
        broken.slice = () => { throw new Error('unreadable'); };

        const summary = await scan([broken, folderFile('Holiday/b.jpg')]);

        expect(summary.usable).toBe(1);
        expect(summary.notImages).toBe(1);
    });
});

describe('scanFolderPick — a mixed folder is counted honestly', () => {
    it('reports usable images, other files and oversized images separately', async () => {
        const summary = await scan([
            folderFile('Trip/a.jpg', 'jpeg'),
            folderFile('Trip/b.png', 'png'),
            folderFile('Trip/notes.txt', 'text'),
            folderFile('Trip/scan.pdf', 'pdf'),
            folderFile('Trip/huge.jpg', 'jpeg', { size: MAX_FILE_SIZE + 1 }),
        ]);

        expect(summary).toMatchObject({
            usable: 2,
            added: 2,
            leftOver: 0,
            notImages: 2,
            tooBig: 1,
            total: 5,
        });
    });

    it('skips the folder itself and anything empty without counting it', async () => {
        const summary = await scan([
            folderFile('Trip/a.jpg', 'jpeg'),
            folderFile('Trip/Subfolder', 'text', { size: 0 }),
        ]);

        expect(summary).toMatchObject({ usable: 1, notImages: 0, tooBig: 0 });
    });

    it('ignores dot files rather than calling them "other files"', async () => {
        const summary = await scan([
            folderFile('Trip/.DS_Store', 'text'),
            folderFile('Trip/.thumbnails/tiny.jpg', 'jpeg'),
            folderFile('Trip/a.jpg', 'jpeg'),
        ]);

        expect(summary).toMatchObject({ usable: 1, notImages: 0 });
    });

    it('sorts by path, so "the first N" is something a person can predict', async () => {
        const summary = await scan([
            folderFile('Trip/b/10.jpg'),
            folderFile('Trip/a/2.jpg'),
            folderFile('Trip/a/10.jpg'),
        ]);

        expect(summary.files.map(relativePathOf)).toEqual([
            'Trip/a/2.jpg',
            'Trip/a/10.jpg',
            'Trip/b/10.jpg',
        ]);
    });

    it('stops scanning past the limit and says the count was cut short', async () => {
        const files = Array.from({ length: FOLDER_SCAN_LIMIT + 5 }, (_, index) =>
            folderFile(`Trip/${String(index).padStart(5, '0')}.jpg`));

        const summary = await scan(files, { capacityFiles: 3 });

        expect(summary.scanned).toBe(FOLDER_SCAN_LIMIT);
        expect(summary.scanTruncated).toBe(true);
        expect(summary.usable).toBe(FOLDER_SCAN_LIMIT);
    });

    /**
     * THE SLICE HAPPENED BEFORE THE SORT.
     *
     * `visible.slice(0, scanLimit).sort(byPath)` truncates in the order the
     * directory input handed the files back, then sorts only the survivors. A
     * real directory walk enumerates subfolders in creation order, not name
     * order, so "the first 1000 by name" was actually "an arbitrary 1000, then
     * sorted".
     *
     * The notice says it out loud — "so the first 1000 by name were checked"
     * and "The first N by name were added" — so this was a false sentence, not
     * just a surprising order.
     *
     * The existing over-limit test feeds files that are ALREADY in name order,
     * which is exactly why it could not see this.
     */
    it('sorts before it truncates, whatever order the browser enumerated in', async () => {
        const paths = Array.from({ length: FOLDER_SCAN_LIMIT + 200 }, (_, index) =>
            `Trip/${String(index).padStart(5, '0')}.jpg`);

        // Reversed: the alphabetically-first files arrive last.
        const files = paths.slice().reverse().map((path) => folderFile(path, 'jpeg', { size: 1000 }));

        const summary = await scan(files, { capacityFiles: 3 });

        expect(
            summary.files.map(relativePathOf),
            'the notice promises the first by name; these are the last enumerated',
        ).toEqual(['Trip/00000.jpg', 'Trip/00001.jpg', 'Trip/00002.jpg']);
    });

    it('takes an empty pick without complaint', async () => {
        const summary = await scan([]);
        expect(summary).toMatchObject({ total: 0, usable: 0, files: [] });
    });
});

describe('scanFolderPick — the cap trims, it never truncates silently', () => {
    it('takes the first N by name and reports what was left over', async () => {
        const files = Array.from({ length: 50 }, (_, index) =>
            folderFile(`Trip/${String(index).padStart(3, '0')}.jpg`, 'jpeg', { size: 1000 }));

        const summary = await scan(files, { capacityFiles: MAX_BULK_FILES, capacityBytes: MAX_BULK_TOTAL_BYTES });

        expect(summary.usable).toBe(50);
        expect(summary.added).toBe(MAX_BULK_FILES);
        expect(summary.leftOver).toBe(30);
        expect(summary.files[0].name).toBe('000.jpg');
        expect(summary.files.at(-1).name).toBe('019.jpg');
    });

    it('stops on the byte budget before the file count when the photos are big', async () => {
        const files = Array.from({ length: 20 }, (_, index) =>
            folderFile(`Trip/${String(index).padStart(3, '0')}.jpg`, 'jpeg', { size: 10 * 1024 * 1024 }));

        const summary = await scan(files, { capacityFiles: MAX_BULK_FILES, capacityBytes: MAX_BULK_TOTAL_BYTES });

        expect(summary.added).toBe(8);
        expect(summary.bytes).toBe(80 * 1024 * 1024);
        expect(summary.leftOver).toBe(12);
    });

    it('adds nothing when the batch is already full, and still counts the folder', async () => {
        const summary = await scan(
            [folderFile('Trip/a.jpg'), folderFile('Trip/b.jpg')],
            { capacityFiles: 0, capacityBytes: MAX_BULK_TOTAL_BYTES },
        );

        expect(summary.usable).toBe(2);
        expect(summary.added).toBe(0);
        expect(summary.leftOver).toBe(2);
    });

    it('uses the caller’s sniff rather than assuming one', async () => {
        const sniff = vi.fn(() => 'png');
        const summary = await scan([folderFile('Trip/a.jpg', 'pdf')], { sniff });

        expect(sniff).toHaveBeenCalledTimes(1);
        expect(summary.usable).toBe(1);
    });
});

describe('folderPickMessage', () => {
    const options = {
        accept: ACCEPT,
        maxBytes: MAX_FILE_SIZE,
        maxFiles: MAX_BULK_FILES,
        maxTotalBytes: MAX_BULK_TOTAL_BYTES,
    };

    async function messageFor(files, scanOptions = {}) {
        return folderPickMessage(await scan(files, scanOptions), options);
    }

    it('says how many were added when the whole folder fits', async () => {
        const message = await messageFor([folderFile('Trip/a.jpg'), folderFile('Trip/b.png', 'png')]);
        expect(message).toBe('Added 2 images from that folder.');
    });

    it('uses the singular for one image', async () => {
        expect(await messageFor([folderFile('Trip/a.jpg')])).toBe('Added 1 image from that folder.');
    });

    it('names the real total, the number added and both limits when it trims', async () => {
        const files = Array.from({ length: 312 }, (_, index) =>
            folderFile(`Trip/${String(index).padStart(4, '0')}.jpg`, 'jpeg', { size: 1000 }));

        const message = await messageFor(files, { capacityFiles: MAX_BULK_FILES, capacityBytes: MAX_BULK_TOTAL_BYTES });

        expect(message).toContain('That folder has 312 images.');
        expect(message).toContain('The first 20 by name were added');
        expect(message).toContain('one batch takes up to 20 images and 80 MB in total');
        expect(message).toContain('the other 292 were left out');
        expect(message).toContain('Drag the rest in when these are done, or pick a subfolder.');
    });

    it('says plainly when there was nothing it could read', async () => {
        const message = await messageFor([folderFile('Work/report.pdf', 'pdf')]);

        expect(message).toContain('No JPEG, PNG or WebP images were found in that folder.');
        expect(message).toContain('1 other file in there is not an image this tool reads.');
    });

    it('counts the oversized images as images, and says the limit', async () => {
        const message = await messageFor([
            folderFile('Trip/a.jpg'),
            folderFile('Trip/huge.jpg', 'jpeg', { size: MAX_FILE_SIZE + 1 }),
            folderFile('Trip/bigger.jpg', 'jpeg', { size: MAX_FILE_SIZE + 2 }),
        ]);

        expect(message).toContain('Added 1 image from that folder.');
        expect(message).toContain('2 images were over 20 MB and were left out.');
    });

    it('does not pretend a full batch has room', async () => {
        const message = await messageFor(
            [folderFile('Trip/a.jpg'), folderFile('Trip/b.jpg')],
            { capacityFiles: 0 },
        );

        expect(message).toContain('That folder has 2 images, and this batch is already full at 20 images and 80 MB.');
        expect(message).toContain('Resize these first, or remove a few to make room.');
    });

    it('says when the folder was too big to check all of', async () => {
        const files = Array.from({ length: FOLDER_SCAN_LIMIT + 1 }, (_, index) =>
            folderFile(`Trip/${String(index).padStart(5, '0')}.jpg`, 'jpeg', { size: 1000 }));

        const message = await messageFor(files, { capacityFiles: MAX_BULK_FILES, capacityBytes: MAX_BULK_TOTAL_BYTES });

        expect(message).toContain(`That folder holds more than ${FOLDER_SCAN_LIMIT} files, so the first ${FOLDER_SCAN_LIMIT} by name were checked.`);
    });

    it('says so when the folder was empty', async () => {
        expect(await messageFor([])).toBe('That folder has nothing in it.');
        expect(folderPickMessage(null)).toBe('That folder has nothing in it.');
    });

    it('never claims a file went anywhere', async () => {
        const messages = [
            await messageFor([folderFile('Trip/a.jpg')]),
            await messageFor([folderFile('Work/report.pdf', 'pdf')]),
            await messageFor([folderFile('Trip/a.jpg'), folderFile('Trip/b.jpg')], { capacityFiles: 1 }),
        ];

        for (const message of messages) {
            expect(message.toLowerCase()).not.toMatch(/upload|sent|stored|server|offline/);
        }
    });
});
