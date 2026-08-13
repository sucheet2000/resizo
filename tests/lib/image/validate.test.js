import { describe, expect, it } from 'vitest';
import { HEIC_EXTENSIONS, HEIC_MIME_TYPES, MAX_FILE_SIZE } from '@/lib/limits';
import { validateUpload } from '@/lib/image/validate';

function fakeFile({ name = 'photo.jpg', type = 'image/jpeg', size = 1024 } = {}) {
    return {
        name,
        type,
        size,
        arrayBuffer: async () => new ArrayBuffer(0),
    };
}

describe('validateUpload', () => {
    it('accepts a normal image upload', () => {
        expect(validateUpload(fakeFile())).toEqual({ ok: true });
    });

    describe('gate 1: a file must be present', () => {
        it.each([
            ['null', null],
            ['undefined', undefined],
            ['an empty string', ''],
        ])('rejects %s with a no-file message', (_label, file) => {
            expect(validateUpload(file)).toEqual({
                ok: false,
                status: 400,
                error: 'No file provided in the request.',
            });
        });
    });

    describe('gate 2: a text form field can never reach the size gate', () => {
        it('rejects a plain string value', () => {
            expect(validateUpload('photo.jpg')).toEqual({
                ok: false,
                status: 400,
                error: 'No valid file was uploaded.',
            });
        });

        it('rejects an object without arrayBuffer even when it claims a legal size', () => {
            expect(validateUpload({ name: 'photo.jpg', type: 'image/jpeg', size: 1024 }).error)
                .toBe('No valid file was uploaded.');
        });

        it('rejects an object without arrayBuffer before complaining about its size', () => {
            const result = validateUpload({ name: 'big.jpg', type: 'image/jpeg', size: MAX_FILE_SIZE + 1 });
            expect(result.error).toBe('No valid file was uploaded.');
        });

        it.each([
            ['a number', 42],
            ['true', true],
            ['an array', ['photo.jpg']],
        ])('rejects %s', (_label, file) => {
            expect(validateUpload(file).error).toBe('No valid file was uploaded.');
        });
    });

    describe('gate 3: type', () => {
        it.each([
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
        ])('accepts %s by prefix', (type) => {
            expect(validateUpload(fakeFile({ type })).ok).toBe(true);
        });

        // Real browsers and phones send these. An exact-match list rejected
        // them at the door even though the bytes were a perfectly good image,
        // and the client-side gate (file.type.startsWith('image/')) let them
        // through — so the upload failed only after it had been sent.
        it.each([
            ['image/jpg', 'the alias Windows and some Android cameras send'],
            ['image/pjpeg', 'progressive JPEG as older IE and some scanners label it'],
            ['image/x-png', 'the legacy PNG spelling'],
        ])('accepts the %s alias — %s', (type) => {
            expect(validateUpload(fakeFile({ type }))).toEqual({ ok: true });
        });

        it('accepts an image subtype nobody has enumerated yet', () => {
            expect(validateUpload(fakeFile({ type: 'image/avif' })).ok).toBe(true);
            expect(validateUpload(fakeFile({ type: 'image/tiff' })).ok).toBe(true);
        });

        it('is case-insensitive about the MIME type', () => {
            expect(validateUpload(fakeFile({ type: 'IMAGE/PNG' })).ok).toBe(true);
        });

        it.each([
            ['text/plain', 'text/plain'],
            ['application/pdf', 'application/pdf'],
            ['video/mp4', 'video/mp4'],
            ['an empty type', ''],
        ])('rejects %s against the default image/* allowlist', (_label, type) => {
            expect(validateUpload(fakeFile({ type }))).toEqual({
                ok: false,
                status: 400,
                error: 'Invalid file type. Only images are allowed.',
            });
        });

        it('honours an exact-type allowlist', () => {
            const options = { allowedTypes: ['image/jpeg', 'image/png'] };
            expect(validateUpload(fakeFile({ type: 'image/png' }), options).ok).toBe(true);
            expect(validateUpload(fakeFile({ type: 'image/webp' }), options).ok).toBe(false);
        });

        it('accepts a HEIC upload with an empty MIME type via its extension', () => {
            const result = validateUpload(
                fakeFile({ name: 'IMG_0001.heic', type: '' }),
                { allowedTypes: HEIC_MIME_TYPES, allowedExtensions: HEIC_EXTENSIONS },
            );
            expect(result).toEqual({ ok: true });
        });

        it('matches the extension case-insensitively', () => {
            const result = validateUpload(
                fakeFile({ name: 'IMG_0001.HEIF', type: 'application/octet-stream' }),
                { allowedTypes: HEIC_MIME_TYPES, allowedExtensions: HEIC_EXTENSIONS },
            );
            expect(result.ok).toBe(true);
        });

        it('accepts a HEIC upload on its MIME type alone', () => {
            const result = validateUpload(
                fakeFile({ name: 'photo', type: 'image/heic' }),
                { allowedTypes: HEIC_MIME_TYPES, allowedExtensions: HEIC_EXTENSIONS },
            );
            expect(result.ok).toBe(true);
        });

        it('rejects a file with no usable name when the MIME type is not allowed', () => {
            const nameless = { type: 'application/octet-stream', size: 1024, arrayBuffer: async () => new ArrayBuffer(0) };
            const result = validateUpload(nameless, {
                allowedTypes: HEIC_MIME_TYPES,
                allowedExtensions: HEIC_EXTENSIONS,
            });
            expect(result.error).toBe('Invalid file type. Only images are allowed.');
        });

        it('rejects an empty filename when the MIME type is not allowed', () => {
            const result = validateUpload(
                fakeFile({ name: '', type: 'application/octet-stream' }),
                { allowedTypes: HEIC_MIME_TYPES, allowedExtensions: HEIC_EXTENSIONS },
            );
            expect(result.error).toBe('Invalid file type. Only images are allowed.');
        });

        it('rejects a wrong extension and a wrong MIME type together', () => {
            const result = validateUpload(
                fakeFile({ name: 'movie.mp4', type: 'video/mp4' }),
                { allowedTypes: HEIC_MIME_TYPES, allowedExtensions: HEIC_EXTENSIONS },
            );
            expect(result.error).toBe('Invalid file type. Only images are allowed.');
        });
    });

    describe('gates 4 to 6: size', () => {
        it.each([
            ['NaN', NaN],
            ['Infinity', Infinity],
            ['a numeric string', '1024'],
            ['null', null],
        ])('rejects a %s size as an invalid upload', (_label, size) => {
            expect(validateUpload(fakeFile({ size }))).toEqual({
                ok: false,
                status: 400,
                error: 'No valid file was uploaded.',
            });
        });

        it('rejects a file object with no size property at all', () => {
            const sizeless = { name: 'photo.jpg', type: 'image/jpeg', arrayBuffer: async () => new ArrayBuffer(0) };
            expect(validateUpload(sizeless)).toEqual({
                ok: false,
                status: 400,
                error: 'No valid file was uploaded.',
            });
        });

        it('rejects a zero-byte file with its own message', () => {
            expect(validateUpload(fakeFile({ size: 0 }))).toEqual({
                ok: false,
                status: 400,
                error: 'The uploaded file is empty.',
            });
        });

        it('accepts a file exactly at the cap', () => {
            expect(validateUpload(fakeFile({ size: MAX_FILE_SIZE })).ok).toBe(true);
        });

        it('rejects one byte past the cap with the shipped message', () => {
            expect(validateUpload(fakeFile({ size: MAX_FILE_SIZE + 1 }))).toEqual({
                ok: false,
                status: 400,
                error: 'File exceeds the maximum allowed size of 20MB.',
            });
        });

        it('reports a caller-supplied cap in megabytes', () => {
            expect(validateUpload(fakeFile({ size: 6 * 1024 * 1024 }), { maxBytes: 5 * 1024 * 1024 }).error)
                .toBe('File exceeds the maximum allowed size of 5MB.');
        });

        it('defaults its cap to the shared 20MB limit', () => {
            expect(MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
            expect(validateUpload(fakeFile({ size: 20 * 1024 * 1024 })).ok).toBe(true);
            expect(validateUpload(fakeFile({ size: 20 * 1024 * 1024 + 1 })).ok).toBe(false);
        });
    });

    it('always answers with status 400 when it rejects', () => {
        const rejections = [
            validateUpload(null),
            validateUpload('text'),
            validateUpload(fakeFile({ type: 'text/plain' })),
            validateUpload(fakeFile({ size: 0 })),
            validateUpload(fakeFile({ size: MAX_FILE_SIZE + 1 })),
        ];
        for (const rejection of rejections) {
            expect(rejection.ok).toBe(false);
            expect(rejection.status).toBe(400);
        }
    });
});
