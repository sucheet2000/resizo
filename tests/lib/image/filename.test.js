import { describe, expect, it } from 'vitest';
import {
    buildOutputFilename,
    contentDispositionValue,
    contentTypeFor,
    extensionFor,
    sanitizeBaseName,
    uniqueName,
} from '@/lib/image/filename';

describe('sanitizeBaseName', () => {
    it.each([
        ['photo.jpg', 'photo'],
        ['photo', 'photo'],
        ['my photo.jpg', 'my-photo'],
        ['my   photo.jpg', 'my-photo'],
        ['a.b.c.png', 'a.b.c'],
        ['photo.jpg.png', 'photo.jpg'],
        ['photo(1).jpg', 'photo1'],
        ['photo (1).jpg', 'photo-1'],
        ['IMG_0001.JPEG', 'IMG_0001'],
        ['--photo--.jpg', 'photo'],
        ['__photo__.png', 'photo'],
    ])('sanitizes %s to %s', (input, expected) => {
        expect(sanitizeBaseName(input)).toBe(expected);
    });

    describe('path traversal', () => {
        it('neutralizes ../../etc/passwd.jpg', () => {
            const result = sanitizeBaseName('../../etc/passwd.jpg');
            expect(result).toBe('passwd');
            expect(result).not.toContain('/');
            expect(result).not.toContain('..');
        });

        it('neutralizes windows-style traversal', () => {
            const result = sanitizeBaseName('..\\..\\windows\\win.ini');
            expect(result).toBe('win');
            expect(result).not.toContain('\\');
        });

        it('drops a leading absolute path', () => {
            expect(sanitizeBaseName('/etc/passwd')).toBe('passwd');
        });

        it('drops a drive letter and colon', () => {
            const result = sanitizeBaseName('C:\\temp\\x.jpg');
            expect(result).toBe('x');
            expect(result).not.toContain(':');
        });

        it('collapses a bare dot run to nothing usable', () => {
            expect(sanitizeBaseName('....jpg')).toBe('image');
        });
    });

    describe('unicode', () => {
        it('keeps CJK characters instead of collapsing to an empty base', () => {
            const result = sanitizeBaseName('日本語.jpg');
            expect(result).toBe('日本語');
            expect(result).not.toBe('');
        });

        it('keeps accented latin characters', () => {
            expect(sanitizeBaseName('résumé.png')).toBe('résumé');
        });

        it('keeps cyrillic characters', () => {
            expect(sanitizeBaseName('фото.png')).toBe('фото');
        });

        it('falls back to image for an emoji-only name', () => {
            expect(sanitizeBaseName('🙂.png')).toBe('image');
        });

        it('normalizes decomposed sequences to NFC', () => {
            expect(sanitizeBaseName('cafe\u0301.jpg')).toBe('café');
        });
    });

    describe('fallbacks', () => {
        it.each([
            ['.jpg', 'image'],
            ['.gitignore', 'image'],
            ['', 'image'],
            ['   ', 'image'],
            ['---', 'image'],
            ['!!!.png', 'image'],
        ])('falls back to image for %s', (input, expected) => {
            expect(sanitizeBaseName(input)).toBe(expected);
        });

        it.each([
            ['undefined', undefined],
            ['null', null],
            ['a number', 42],
            ['an object', {}],
            ['an array', []],
        ])('falls back to image for %s', (_label, input) => {
            expect(sanitizeBaseName(input)).toBe('image');
        });

        it('never returns an empty string', () => {
            const nasty = ['', '   ', '🙂', '///', '...', '\u0000', '@#$%^&*()', '.hidden'];
            for (const input of nasty) {
                expect(sanitizeBaseName(input).length).toBeGreaterThan(0);
            }
        });
    });

    describe('bounds', () => {
        it('caps a 300-character name at 100 code points', () => {
            expect(sanitizeBaseName(`${'a'.repeat(300)}.jpg`)).toHaveLength(100);
        });

        it('caps a long CJK name at 100 code points', () => {
            const result = sanitizeBaseName(`${'字'.repeat(300)}.jpg`);
            expect(Array.from(result)).toHaveLength(100);
        });
    });

    describe('header safety', () => {
        it('strips CR and LF from a header-injection attempt', () => {
            const result = sanitizeBaseName('a\r\nX-Injected: 1.jpg');
            expect(result).toBe('a-X-Injected-1');
            expect(result).not.toMatch(/[\r\n]/);
        });

        it.each([
            ['a"b.jpg', '"'],
            ['a;b.jpg', ';'],
            ['a,b.jpg', ','],
            ["a'b.jpg", "'"],
            ['a\tb.jpg', '\t'],
            ['a\u0000b.jpg', '\u0000'],
        ])('removes %s from %s', (input, forbidden) => {
            expect(sanitizeBaseName(input)).not.toContain(forbidden);
        });

        it('only ever emits letters, digits, dot, dash and underscore', () => {
            const inputs = [
                'a"b;c,d.jpg',
                'a\r\nb.jpg',
                '<script>alert(1)</script>.png',
                '$(rm -rf /).jpg',
                '../../%2e%2e/passwd.jpg',
            ];
            for (const input of inputs) {
                expect(sanitizeBaseName(input)).toMatch(/^[\p{L}\p{N}._-]+$/u);
            }
        });
    });
});

describe('extensionFor', () => {
    it.each([
        ['jpeg', 'jpg'],
        ['jpg', 'jpg'],
        ['JPEG', 'jpg'],
        ['  jpeg  ', 'jpg'],
        ['png', 'png'],
        ['PNG', 'png'],
        ['webp', 'webp'],
        ['gif', 'gif'],
        ['heic', 'heic'],
        ['zip', 'zip'],
    ])('maps %s to %s', (input, expected) => {
        expect(extensionFor(input)).toBe(expected);
    });

    it.each([
        ['an unknown format', 'exe'],
        ['an empty string', ''],
        ['a traversal attempt', '../../etc'],
        ['a script tag', '<script>'],
        ['null', null],
        ['undefined', undefined],
        ['a number', 3],
        ['an object', {}],
    ])('falls back to jpg for %s', (_label, input) => {
        expect(extensionFor(input)).toBe('jpg');
    });
});

describe('contentTypeFor', () => {
    it.each([
        ['jpeg', 'image/jpeg'],
        ['jpg', 'image/jpeg'],
        ['png', 'image/png'],
        ['webp', 'image/webp'],
        ['gif', 'image/gif'],
        ['heic', 'image/heic'],
        ['heif', 'image/heif'],
        ['JPEG', 'image/jpeg'],
        ['  png ', 'image/png'],
    ])('maps %s to %s', (input, expected) => {
        expect(contentTypeFor(input)).toBe(expected);
    });

    it.each([
        ['an unknown format', 'exe'],
        ['an empty string', ''],
        ['a header-injection attempt', 'png\r\nX-Injected: 1'],
        ['a parameter-injection attempt', 'png; charset=evil'],
        ['null', null],
        ['undefined', undefined],
        ['an object', {}],
    ])('returns application/octet-stream for %s', (_label, input) => {
        expect(contentTypeFor(input)).toBe('application/octet-stream');
    });

    it('never returns a value containing CR, LF or a semicolon', () => {
        const inputs = ['jpeg', 'png', 'webp', 'gif', 'png\r\nX: 1', 'png;x=1', '', null, undefined, 7, {}];
        for (const input of inputs) {
            expect(contentTypeFor(input)).not.toMatch(/[\r\n;]/);
        }
    });
});

describe('buildOutputFilename', () => {
    it('joins prefix, base and extension', () => {
        expect(buildOutputFilename({ name: 'photo.jpg', prefix: 'resizo-processed', format: 'jpeg' }))
            .toBe('resizo-processed-photo.jpg');
    });

    it('appends the bulk dimension suffix', () => {
        expect(buildOutputFilename({ name: 'photo.jpg', prefix: 'resizo', format: 'jpeg', suffix: '800x600' }))
            .toBe('resizo-photo-800x600.jpg');
    });

    it('omits an absent prefix and suffix', () => {
        expect(buildOutputFilename({ name: 'photo.png', format: 'png' })).toBe('photo.png');
    });

    it('strips unsafe characters from the prefix and suffix', () => {
        expect(buildOutputFilename({
            name: 'photo.jpg',
            prefix: 'res;izo"',
            format: 'webp',
            suffix: '800x600\r\n',
        })).toBe('resizo-photo-800x600.webp');
    });

    it('keeps a unicode base name', () => {
        expect(buildOutputFilename({ name: '日本語.png', prefix: 'resizo', format: 'png' }))
            .toBe('resizo-日本語.png');
    });

    it('uses the image fallback for an emoji-only name', () => {
        expect(buildOutputFilename({ name: '🙂.png', prefix: 'resizo', format: 'png' }))
            .toBe('resizo-image.png');
    });

    it('never produces a dangling separator for an unusable name', () => {
        expect(buildOutputFilename({ name: '', prefix: 'resizo', format: 'jpeg' })).toBe('resizo-image.jpg');
    });

    it('falls back to jpg for an unknown format', () => {
        expect(buildOutputFilename({ name: 'photo.png', format: 'tga' })).toBe('photo.jpg');
    });

    it('does not throw without arguments', () => {
        expect(buildOutputFilename()).toBe('image.jpg');
    });
});

describe('uniqueName', () => {
    it('returns the name unchanged when it is free', () => {
        const used = new Set();
        expect(uniqueName('photo.jpg', used)).toBe('photo.jpg');
    });

    it('adds the returned name to the set', () => {
        const used = new Set();
        uniqueName('photo.jpg', used);
        expect(used.has('photo.jpg')).toBe(true);
    });

    it('inserts -2 before the extension on a collision', () => {
        const used = new Set(['photo.jpg']);
        expect(uniqueName('photo.jpg', used)).toBe('photo-2.jpg');
    });

    it('keeps counting past -2', () => {
        const used = new Set(['photo.jpg', 'photo-2.jpg']);
        expect(uniqueName('photo.jpg', used)).toBe('photo-3.jpg');
    });

    it('gives 20 identically named files 20 distinct entries', () => {
        const used = new Set();
        const names = Array.from({ length: 20 }, () => uniqueName('resizo-IMG_0001-800x600.jpg', used));
        expect(new Set(names).size).toBe(20);
        expect(names[0]).toBe('resizo-IMG_0001-800x600.jpg');
        expect(names[19]).toBe('resizo-IMG_0001-800x600-20.jpg');
    });

    it('keeps two files whose base names collapse to the same base distinct', () => {
        const used = new Set();
        const first = uniqueName(buildOutputFilename({ name: 'photo(1).jpg', prefix: 'resizo', format: 'jpeg' }), used);
        const second = uniqueName(buildOutputFilename({ name: 'photo[1].jpg', prefix: 'resizo', format: 'jpeg' }), used);
        expect(first).toBe('resizo-photo1.jpg');
        expect(second).toBe('resizo-photo1-2.jpg');
        expect(first).not.toBe(second);
    });

    it('appends to a name without an extension', () => {
        const used = new Set(['photo']);
        expect(uniqueName('photo', used)).toBe('photo-2');
    });

    it('treats a leading dot as part of the base', () => {
        const used = new Set(['.gitignore']);
        expect(uniqueName('.gitignore', used)).toBe('.gitignore-2');
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a plain object', {}],
        ['an array', []],
    ])('returns the name unchanged when the used set is %s', (_label, used) => {
        expect(uniqueName('photo.jpg', used)).toBe('photo.jpg');
    });
});

describe('contentDispositionValue', () => {
    it('emits both the ascii and the RFC 5987 form', () => {
        expect(contentDispositionValue('photo.jpg'))
            .toBe("attachment; filename=\"photo.jpg\"; filename*=UTF-8''photo.jpg");
    });

    it('honours an explicit disposition', () => {
        expect(contentDispositionValue('photo.jpg', { disposition: 'inline' }))
            .toMatch(/^inline; filename="photo\.jpg"/);
    });

    it('replaces non-ascii characters in the ascii form and percent-encodes the utf-8 form', () => {
        const value = contentDispositionValue('日本語.jpg');
        expect(value).toContain('filename="___.jpg"');
        expect(value).toContain("filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.jpg");
    });

    it('produces no CR or LF for a header-injection attempt', () => {
        const value = contentDispositionValue('a\r\nX-Injected: 1.jpg');
        expect(value).not.toMatch(/[\r\n]/);
        expect(value).toContain('filename="a__X-Injected: 1.jpg"');
    });

    it.each([
        ['a double quote', 'a"b.jpg'],
        ['a backslash', 'a\\b.jpg'],
        ['a semicolon', 'a;b.jpg'],
        ['a comma', 'a,b.jpg'],
    ])('keeps %s out of the ascii form', (_label, filename) => {
        const value = contentDispositionValue(filename);
        const ascii = value.match(/filename="([^"]*)"/)[1];
        expect(ascii).not.toMatch(/["\\;,]/);
    });

    it('emits an RFC 5987 attr-char string for a hostile filename', () => {
        const value = contentDispositionValue('a b(c)*d!e\'f"g;h,i\r\nj日.jpg');
        const encoded = value.split("filename*=UTF-8''")[1];
        expect(encoded).toMatch(/^[A-Za-z0-9\-_.~%]+$/);
    });

    it('percent-encodes a space rather than leaving it bare in the ext-value', () => {
        const encoded = contentDispositionValue('my photo.jpg').split("filename*=UTF-8''")[1];
        expect(encoded).toBe('my%20photo.jpg');
    });

    it.each([
        ['an empty string', ''],
        ['whitespace only', '   '],
        ['undefined', undefined],
        ['null', null],
        ['a number', 5],
        ['an object', {}],
    ])('falls back to download for %s', (_label, input) => {
        expect(contentDispositionValue(input)).toBe("attachment; filename=\"download\"; filename*=UTF-8''download");
    });

    it('falls back to download when every ascii character is stripped', () => {
        expect(contentDispositionValue('日本語')).toContain('filename="___"');
    });

    it('never emits a control character for any input', () => {
        const inputs = ['photo.jpg', 'a\r\nb.jpg', '日本語.jpg', '\u0000\u0001.jpg', 'a"b;c,d.jpg', ''];
        for (const input of inputs) {
            const codes = Array.from(contentDispositionValue(input), (character) => character.charCodeAt(0));
            expect(codes.every((code) => code >= 0x20 && code !== 0x7F)).toBe(true);
        }
    });
});
