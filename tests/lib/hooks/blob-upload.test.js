import { describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/blob/client', () => ({ upload: vi.fn() }));

import { upload } from '@vercel/blob/client';

import {
    BlobUploadError,
    BLOB_UPLOAD_ENDPOINT,
    DIRECT_UPLOAD_MAX_BYTES,
    LARGE_FILE_UNAVAILABLE_MESSAGE,
    isUploadableFile,
    shouldUploadToBlob,
    toProcessBody,
    uploadToBlob,
} from '@/lib/hooks/blob-upload';

/** A File whose reported size is overridden without allocating the bytes. */
function fileOfSize(bytes, name = 'photo.jpg', type = 'image/jpeg') {
    const file = new File([new Uint8Array(1)], name, { type });
    Object.defineProperty(file, 'size', { value: bytes, configurable: true });
    return file;
}

const OVER = DIRECT_UPLOAD_MAX_BYTES + 1;
const UNDER = DIRECT_UPLOAD_MAX_BYTES;

describe('shouldUploadToBlob', () => {
    it('sends a file over the threshold to Blob', () => {
        expect(shouldUploadToBlob(fileOfSize(OVER))).toBe(true);
    });

    it('keeps a file at or under the threshold on the direct path', () => {
        expect(shouldUploadToBlob(fileOfSize(UNDER))).toBe(false);
        expect(shouldUploadToBlob(fileOfSize(1024))).toBe(false);
    });

    it.each([[null], [undefined], ['a-string'], [{}], [{ name: 'x' }]])(
        'is false for a non-file value %o',
        (value) => {
            expect(shouldUploadToBlob(value)).toBe(false);
        },
    );
});

describe('isUploadableFile', () => {
    it('accepts a real File', () => {
        expect(isUploadableFile(fileOfSize(10))).toBe(true);
    });

    it.each([[null], ['photo.jpg'], [{ name: 'x' }], [{ size: 1 }]])(
        'rejects %o',
        (value) => {
            expect(isUploadableFile(value)).toBe(false);
        },
    );
});

describe('uploadToBlob', () => {
    it('uploads to the token endpoint and resolves the public URL', async () => {
        upload.mockResolvedValue({ url: 'https://store.public.blob.vercel-storage.com/photo-abc.jpg' });
        const file = fileOfSize(OVER, 'photo.jpg', 'image/jpeg');

        const url = await uploadToBlob(file);

        expect(url).toBe('https://store.public.blob.vercel-storage.com/photo-abc.jpg');
        const [pathname, body, options] = upload.mock.calls[0];
        expect(pathname).toBe('photo.jpg');
        expect(body).toBe(file);
        expect(options).toMatchObject({
            access: 'public',
            handleUploadUrl: BLOB_UPLOAD_ENDPOINT,
            contentType: 'image/jpeg',
        });
    });

    it('forwards byte progress to the caller', async () => {
        upload.mockImplementation(async (pathname, body, options) => {
            options.onUploadProgress({ loaded: 5, total: 10, percentage: 50 });
            return { url: 'https://store.public.blob.vercel-storage.com/x.jpg' };
        });
        const onProgress = vi.fn();

        await uploadToBlob(fileOfSize(OVER), { onProgress });

        expect(onProgress).toHaveBeenCalledWith(5, 10);
    });

    it('lets the SDK derive the content type when the file reports none', async () => {
        upload.mockResolvedValue({ url: 'https://store.public.blob.vercel-storage.com/x.heic' });

        await uploadToBlob(fileOfSize(OVER, 'photo.heic', ''));

        expect(upload.mock.calls[0][2].contentType).toBeUndefined();
    });

    it('reports a token-handshake failure as unavailable', async () => {
        upload.mockRejectedValue(new Error('Failed to retrieve the client token'));

        await expect(uploadToBlob(fileOfSize(OVER))).rejects.toMatchObject({
            name: 'BlobUploadError',
            code: 'unavailable',
        });
    });

    it('reports a failure after bytes start flowing as failed', async () => {
        upload.mockImplementation(async (pathname, body, options) => {
            options.onUploadProgress({ loaded: 10, total: 100, percentage: 10 });
            throw new Error('network dropped');
        });

        await expect(uploadToBlob(fileOfSize(OVER))).rejects.toMatchObject({ code: 'failed' });
    });

    it('re-throws the original error untouched when the upload was aborted', async () => {
        const controller = new AbortController();
        const original = new Error('aborted');
        upload.mockImplementation(async () => {
            controller.abort();
            throw original;
        });

        await expect(uploadToBlob(fileOfSize(OVER), { signal: controller.signal })).rejects.toBe(original);
    });
});

describe('toProcessBody', () => {
    it('swaps the file for the blob reference and keeps every option field', () => {
        const form = new FormData();
        form.append('file', fileOfSize(OVER));
        form.append('quality', '50');
        form.append('format', 'webp');

        const body = toProcessBody(form, { blobUrl: 'https://store/x.jpg', filename: 'photo.jpg' });

        expect(body.get('file')).toBeNull();
        expect(body.get('blobUrl')).toBe('https://store/x.jpg');
        expect(body.get('quality')).toBe('50');
        expect(body.get('format')).toBe('webp');
        expect(body.get('filename')).toBe('photo.jpg');
    });

    it('omits the filename field when none is given', () => {
        const body = toProcessBody(new FormData(), { blobUrl: 'https://store/x.jpg' });
        expect(body.get('filename')).toBeNull();
        expect(body.get('blobUrl')).toBe('https://store/x.jpg');
    });
});

describe('BlobUploadError', () => {
    it('carries its code', () => {
        const error = new BlobUploadError('unavailable');
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('unavailable');
    });
});

describe('LARGE_FILE_UNAVAILABLE_MESSAGE', () => {
    it('names the fallback size and reads as a finished sentence', () => {
        expect(LARGE_FILE_UNAVAILABLE_MESSAGE).toContain('4 MB');
        expect(LARGE_FILE_UNAVAILABLE_MESSAGE).toMatch(/[.!?]$/);
    });
});
