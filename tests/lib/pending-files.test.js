import { afterEach, describe, expect, it } from 'vitest';

import { clearPendingFiles, setPendingFiles, takePendingFiles } from '@/lib/pending-files';

const fileLike = (name) => ({ name, size: 10 });

afterEach(() => {
    clearPendingFiles();
});

describe('pending files hand-off', () => {
    it('starts empty', () => {
        expect(takePendingFiles()).toEqual([]);
    });

    it('hands over what was set', () => {
        const one = fileLike('a.jpg');
        setPendingFiles([one]);

        expect(takePendingFiles()).toEqual([one]);
    });

    it('empties on read, so a stale file cannot reappear on a later visit', () => {
        setPendingFiles([fileLike('a.jpg')]);

        expect(takePendingFiles()).toHaveLength(1);
        expect(takePendingFiles()).toEqual([]);
    });

    it('accepts an array-like FileList', () => {
        const list = { 0: fileLike('a.jpg'), 1: fileLike('b.png'), length: 2 };
        setPendingFiles(list);

        expect(takePendingFiles().map((file) => file.name)).toEqual(['a.jpg', 'b.png']);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty array', []],
    ])('treats %s as nothing to hand over', (_label, input) => {
        setPendingFiles(input);

        expect(takePendingFiles()).toEqual([]);
    });

    it('drops holes rather than handing over undefined entries', () => {
        setPendingFiles([fileLike('a.jpg'), null, undefined]);

        expect(takePendingFiles()).toHaveLength(1);
    });

    it('replaces an unread hand-off rather than appending to it', () => {
        setPendingFiles([fileLike('first.jpg')]);
        setPendingFiles([fileLike('second.jpg')]);

        expect(takePendingFiles().map((file) => file.name)).toEqual(['second.jpg']);
    });

    it('can be cleared without being read', () => {
        setPendingFiles([fileLike('a.jpg')]);
        clearPendingFiles();

        expect(takePendingFiles()).toEqual([]);
    });
});
