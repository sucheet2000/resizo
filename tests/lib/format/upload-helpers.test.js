import { describe, expect, it } from 'vitest';

import { MAX_BULK_FILES, MAX_BULK_TOTAL_BYTES, MAX_DIMENSION, MAX_FILE_SIZE } from '@/lib/limits';
import {
    acceptAttribute,
    checkBatchLimits,
    checkDimensions,
    checkFileSize,
    constraintsLine,
    dropzoneState,
    formatLabel,
    formatList,
    rejectReason,
} from '@/lib/format/upload-helpers';

describe('formatLabel', () => {
    it.each([
        ['jpeg', 'JPEG'],
        ['jpg', 'JPEG'],
        ['png', 'PNG'],
        ['webp', 'WebP'],
        ['gif', 'GIF'],
        ['heic', 'HEIC'],
        ['avif', 'AVIF'],
        ['JPEG', 'JPEG'],
    ])('labels %s as %s', (input, expected) => {
        expect(formatLabel(input)).toBe(expected);
    });

    it('upper-cases an unknown token rather than dropping it', () => {
        expect(formatLabel('tiff')).toBe('TIFF');
    });
});

describe('formatList', () => {
    it('joins labels in order', () => {
        expect(formatList(['jpeg', 'png', 'webp'])).toBe('JPEG, PNG, WebP');
    });

    it('collapses aliases that share a label', () => {
        expect(formatList(['jpeg', 'jpg', 'png'])).toBe('JPEG, PNG');
    });

    it.each([[[]], [null], [undefined]])('is empty for %o', (input) => {
        expect(formatList(input)).toBe('');
    });
});

describe('acceptAttribute', () => {
    it('emits MIME types and extensions together', () => {
        const value = acceptAttribute(['jpeg', 'png']);
        expect(value.split(',')).toEqual(['image/jpeg', '.jpg', '.jpeg', 'image/png', '.png']);
    });

    it('includes the HEIC extensions, which is the only signal iOS gives', () => {
        const value = acceptAttribute(['heic']);
        expect(value).toContain('.heic');
        expect(value).toContain('.heif');
    });

    it('never repeats a token when formats overlap', () => {
        const tokens = acceptAttribute(['jpeg', 'jpg']).split(',');
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('is empty for an unknown format', () => {
        expect(acceptAttribute(['bmp'])).toBe('');
    });
});

describe('constraintsLine', () => {
    it('reads as one line inside the drop zone', () => {
        expect(constraintsLine({ formats: ['jpeg', 'png', 'webp'], maxBytes: 20 * 1024 * 1024 }))
            .toBe('JPEG, PNG, WebP · up to 20 MB');
    });

    it('adds the file count only in batch mode', () => {
        expect(constraintsLine({ formats: ['jpeg'], maxBytes: 1024, maxFiles: 20 }))
            .toBe('JPEG · up to 1 KB · 20 files max');
        expect(constraintsLine({ formats: ['jpeg'], maxBytes: 1024, maxFiles: 1 }))
            .toBe('JPEG · up to 1 KB');
    });

    it('omits a byte cap that is not a real number', () => {
        expect(constraintsLine({ formats: ['png'], maxBytes: null })).toBe('PNG');
    });

    it('defaults to the shared file-size limit', () => {
        expect(constraintsLine({ formats: ['png'] })).toContain('20 MB');
        expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
    });
});

describe('checkFileSize', () => {
    it('passes a normal file', () => {
        expect(checkFileSize({ size: 1024 })).toBeNull();
    });

    it.each([
        [{ size: 0 }],
        [{ size: -1 }],
        [{}],
        [null],
    ])('rejects %o as empty', (file) => {
        expect(checkFileSize(file)).toBe(rejectReason.empty());
    });

    it('names the actual size and the limit so the fix is obvious', () => {
        const message = checkFileSize({ size: 30 * 1024 * 1024 });
        expect(message).toContain('30 MB');
        expect(message).toContain('20 MB');
    });

    it('treats the limit itself as allowed', () => {
        expect(checkFileSize({ size: MAX_FILE_SIZE })).toBeNull();
        expect(checkFileSize({ size: MAX_FILE_SIZE + 1 })).not.toBeNull();
    });
});

describe('checkBatchLimits', () => {
    it('passes an empty batch', () => {
        expect(checkBatchLimits()).toBeNull();
    });

    it('counts files already in the panel, not just the incoming ones', () => {
        expect(checkBatchLimits({ incomingCount: 1, existingCount: MAX_BULK_FILES - 1 })).toBeNull();
        expect(checkBatchLimits({ incomingCount: 2, existingCount: MAX_BULK_FILES - 1 }))
            .toBe(rejectReason.tooManyFiles());
    });

    it('rejects a batch that busts the total byte budget', () => {
        expect(checkBatchLimits({
            incomingBytes: MAX_BULK_TOTAL_BYTES,
            existingBytes: 1,
        })).toBe(rejectReason.batchTooLarge());
    });

    it('reports the count problem first, because removing files fixes both', () => {
        const message = checkBatchLimits({
            incomingCount: 100,
            incomingBytes: MAX_BULK_TOTAL_BYTES * 2,
        });
        expect(message).toBe(rejectReason.tooManyFiles());
    });
});

describe('checkDimensions', () => {
    it('passes an image inside the cap', () => {
        expect(checkDimensions(1920, 1080)).toBeNull();
    });

    it('allows the cap exactly', () => {
        expect(checkDimensions(MAX_DIMENSION, MAX_DIMENSION)).toBeNull();
    });

    it.each([
        [MAX_DIMENSION + 1, 100],
        [100, MAX_DIMENSION + 1],
    ])('rejects %ix%i', (width, height) => {
        expect(checkDimensions(width, height)).toBe(rejectReason.tooManyPixels());
    });

    it.each([
        [0, 100],
        [100, 0],
        [NaN, 100],
        [undefined, undefined],
    ])('treats %o x %o as unreadable', (width, height) => {
        expect(checkDimensions(width, height)).toBe(rejectReason.unreadable());
    });
});

describe('dropzoneState', () => {
    it('defaults to rest', () => {
        expect(dropzoneState()).toBe('rest');
    });

    it('shows the accepted state once a file is held', () => {
        expect(dropzoneState({ hasFile: true })).toBe('accepted');
    });

    it('shows dragover while a file is over the zone', () => {
        expect(dropzoneState({ isDragging: true })).toBe('dragover');
    });

    it('keeps a reject visible even while dragging, so the reason is not hidden', () => {
        expect(dropzoneState({ isDragging: true, hasFile: true, error: 'nope' })).toBe('reject');
    });
});

describe('rejectReason', () => {
    it('never blames the visitor and always states the fix', () => {
        const messages = [
            rejectReason.empty(),
            rejectReason.tooLarge(1024),
            rejectReason.wrongType(['jpeg', 'png']),
            rejectReason.unreadable(),
            rejectReason.tooManyPixels(),
            rejectReason.tooManyFiles(),
            rejectReason.batchTooLarge(),
        ];

        for (const message of messages) {
            expect(message).toMatch(/[.!]$/);
            expect(message.toLowerCase()).not.toContain('you failed');
            expect(message.toLowerCase()).not.toContain('invalid');
        }
    });

    it('names the accepted formats when the type is wrong', () => {
        expect(rejectReason.wrongType(['jpeg', 'png', 'webp'])).toContain('JPEG, PNG, WebP');
    });
});
