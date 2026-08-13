import { describe, expect, it } from 'vitest';
import {
    buildOutputFilename,
    contentTypeFor,
    extensionFor,
    joinZipPath,
    sanitizeBaseName,
    sanitizeFolderPath,
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

        /**
         * The dot-run collapse, where it is actually load-bearing.
         *
         * The case above is carried entirely by the leading-dot strip that runs
         * after it: '....' loses every dot to `^[._-]+` whether the runs were
         * collapsed or not. Measured by mutation — disabling the collapse
         * altogether left the whole suite green, because no test put a dot run
         * anywhere except at the very start of a name.
         *
         * A run in the MIDDLE is the only place the rule does the work, and it
         * is what stops a traversal-looking segment surviving into a download
         * name that a person then sees and a script may later re-split.
         */
        it.each([
            ['a..b.jpg', 'a.b'],
            ['photo..2024.png', 'photo.2024'],
            ['x.....y.jpg', 'x.y'],
            ['a..b..c.jpg', 'a.b.c'],
        ])('collapses the dot run inside %s to %s', (input, expected) => {
            expect(sanitizeBaseName(input)).toBe(expected);
        });

        it('leaves no double dot anywhere in the result', () => {
            for (const input of ['a..b.jpg', '..a..b..jpg', 'a...b.png', '../a..b.jpg']) {
                expect(sanitizeBaseName(input)).not.toContain('..');
            }
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

describe('sanitizeFolderPath', () => {
    it('keeps the directories and drops the file name', () => {
        expect(sanitizeFolderPath('Holiday/2024/IMG_0001.jpg')).toBe('Holiday/2024');
    });

    it('returns nothing for a file that sat at the top level', () => {
        expect(sanitizeFolderPath('IMG_0001.jpg')).toBe('');
    });

    it.each([
        ['not a string', 42],
        ['undefined', undefined],
        ['empty', ''],
    ])('returns nothing for %s', (_label, value) => {
        expect(sanitizeFolderPath(value)).toBe('');
    });

    it('drops traversal segments rather than carrying them into an archive', () => {
        expect(sanitizeFolderPath('../../etc/photo.jpg')).toBe('etc');
        expect(sanitizeFolderPath('a/../../b/photo.jpg')).toBe('a/b');
    });

    it('drops the empty segment a leading separator makes', () => {
        expect(sanitizeFolderPath('/var/photos/photo.jpg')).toBe('var/photos');
    });

    it('splits backslashes too, so no segment can hide a separator', () => {
        expect(sanitizeFolderPath('C:\\Users\\me\\photo.jpg')).toBe('C/Users/me');
    });

    it('cleans a segment the same way a base name is cleaned', () => {
        expect(sanitizeFolderPath('my holiday/#2024!/photo.jpg')).toBe('my-holiday/2024');
    });

    it('keeps non-latin folder names', () => {
        expect(sanitizeFolderPath('休暇/2024/photo.jpg')).toBe('休暇/2024');
    });

    it('caps the depth so a pathological pick cannot build an unopenable archive', () => {
        const deep = `${Array.from({ length: 30 }, (_, index) => `d${index}`).join('/')}/photo.jpg`;
        expect(sanitizeFolderPath(deep).split('/')).toHaveLength(8);
    });

    it('caps the length of one segment', () => {
        const long = `${'a'.repeat(200)}/photo.jpg`;
        expect(sanitizeFolderPath(long)).toHaveLength(60);
    });
});

describe('joinZipPath', () => {
    it('prefixes the folder when there is one', () => {
        expect(joinZipPath('Holiday/2024', 'resizo-photo.jpg')).toBe('Holiday/2024/resizo-photo.jpg');
    });

    it.each([
        ['empty', ''],
        ['undefined', undefined],
        ['null', null],
        ['a number', 7],
    ])('returns the bare name when the folder is %s', (_label, folder) => {
        expect(joinZipPath(folder, 'resizo-photo.jpg')).toBe('resizo-photo.jpg');
    });

    it('re-cleans whatever it is handed rather than trusting it', () => {
        expect(joinZipPath('../secret', 'a.jpg')).toBe('secret/a.jpg');
        expect(joinZipPath('/', 'a.jpg')).toBe('a.jpg');
        expect(joinZipPath('..', 'a.jpg')).toBe('a.jpg');
    });

    it('keeps the dedup working on the whole path', () => {
        const used = new Set();
        const first = uniqueName(joinZipPath('jan', 'IMG_0001.jpg'), used);
        const second = uniqueName(joinZipPath('feb', 'IMG_0001.jpg'), used);
        const third = uniqueName(joinZipPath('jan', 'IMG_0001.jpg'), used);

        expect(first).toBe('jan/IMG_0001.jpg');
        expect(second).toBe('feb/IMG_0001.jpg');
        expect(third).toBe('jan/IMG_0001-2.jpg');
        expect(new Set([first, second, third]).size).toBe(3);
    });
});
