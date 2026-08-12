import { describe, expect, it } from 'vitest';
import { isAcceptedType, sniffImageType } from '@/lib/image/magic-bytes';

function ascii(text) {
    return Array.from(text, (character) => character.charCodeAt(0));
}

function bytes(...parts) {
    const flat = [];
    for (const part of parts) {
        if (typeof part === 'string') flat.push(...ascii(part));
        else if (Array.isArray(part)) flat.push(...part);
        else flat.push(part);
    }
    return Buffer.from(flat);
}

const JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0], [0x00, 0x10], 'JFIF');
const PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const WEBP = bytes('RIFF', [0x24, 0x00, 0x00, 0x00], 'WEBP', 'VP8 ');
const GIF87A = bytes('GIF87a', [0x01, 0x00]);
const GIF89A = bytes('GIF89a', [0x01, 0x00]);
const HEIC = bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'heic', 'mif1');
const MP4 = bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'isom', 'isom');
// The brand list a real AVIF encoder writes: major brand 'avif', with 'mif1'
// and 'miaf' following as compatible brands.
const AVIF = bytes([0x00, 0x00, 0x00, 0x1C], 'ftyp', 'avif', '    ', 'avifmif1miaf');
const AVIS = bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'avis', 'avismif1');

describe('sniffImageType', () => {
    describe('empty and short input', () => {
        it('returns null for an empty buffer', () => {
            expect(sniffImageType(Buffer.alloc(0))).toBeNull();
        });

        it('returns null for a single byte', () => {
            expect(sniffImageType(Buffer.alloc(1))).toBeNull();
        });

        it.each([
            ['null', null],
            ['undefined', undefined],
            ['a string', 'RIFFWEBP'],
            ['a number', 12345],
            ['a plain object', {}],
            ['a boolean', true],
        ])('returns null for %s without throwing', (_label, input) => {
            expect(() => sniffImageType(input)).not.toThrow();
            expect(sniffImageType(input)).toBeNull();
        });
    });

    describe('JPEG', () => {
        it('accepts FF D8 FF', () => {
            expect(sniffImageType(JPEG)).toBe('jpeg');
        });

        it('rejects a two-byte truncation', () => {
            expect(sniffImageType(bytes([0xFF, 0xD8]))).toBeNull();
        });

        it('rejects a wrong third byte', () => {
            expect(sniffImageType(bytes([0xFF, 0xD8, 0x00, 0xE0]))).toBeNull();
        });
    });

    describe('PNG', () => {
        it('accepts the full 8-byte signature', () => {
            expect(sniffImageType(PNG)).toBe('png');
        });

        it('rejects a three-byte truncation', () => {
            expect(sniffImageType(bytes([0x89, 0x50, 0x4E]))).toBeNull();
        });

        it('accepts on the first four bytes alone (documented rule)', () => {
            expect(sniffImageType(bytes([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x00, 0x00]))).toBe('png');
        });
    });

    describe('WebP', () => {
        it('accepts RIFF at 0-3 with WEBP at 8-11', () => {
            expect(sniffImageType(WEBP)).toBe('webp');
        });

        it('rejects an eight-byte truncation that stops before the form type', () => {
            expect(sniffImageType(bytes('RIFF', [0x24, 0x00, 0x00, 0x00]))).toBeNull();
        });

        it('rejects a WAVE file that shares the RIFF container', () => {
            expect(sniffImageType(bytes('RIFF', [0x24, 0x00, 0x00, 0x00], 'WAVE', 'fmt '))).toBeNull();
        });

        it('rejects the eight-zero-bytes + WEBP polyglot', () => {
            expect(sniffImageType(bytes([0, 0, 0, 0, 0, 0, 0, 0], 'WEBP'))).toBeNull();
        });

        it('rejects the SVG comment polyglot <!--1234WEBP-->', () => {
            expect(sniffImageType(bytes('<!--1234WEBP-->'))).toBeNull();
        });

        it('rejects an SVG whose comment carries WEBP at offset 8', () => {
            expect(sniffImageType(bytes('<svg><!--WEBP--><rect/></svg>'))).toBeNull();
        });

        it('rejects a ten-byte RIFF buffer', () => {
            expect(sniffImageType(bytes('RIFF', [0x24, 0x00, 0x00, 0x00], 'WE'))).toBeNull();
        });
    });

    describe('GIF', () => {
        it('accepts GIF87a', () => {
            expect(sniffImageType(GIF87A)).toBe('gif');
        });

        it('accepts GIF89a', () => {
            expect(sniffImageType(GIF89A)).toBe('gif');
        });

        it('rejects a two-byte GI prefix followed by junk', () => {
            expect(sniffImageType(bytes('GIZZZZ'))).toBeNull();
        });

        it('rejects GIF88a', () => {
            expect(sniffImageType(bytes('GIF88a'))).toBeNull();
        });

        it('rejects a five-byte truncation', () => {
            expect(sniffImageType(bytes('GIF89'))).toBeNull();
        });
    });

    describe('HEIC', () => {
        it('accepts ftyp with the heic brand', () => {
            expect(sniffImageType(HEIC)).toBe('heic');
        });

        it.each(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'])('accepts the %s brand', (brand) => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', brand))).toBe('heic');
        });

        it('rejects an MP4 whose ftyp brand is isom', () => {
            expect(sniffImageType(MP4)).toBeNull();
        });

        it.each(['mp42', 'qt  ', '3gp5', 'M4A '])('rejects the non-image brand %s', (brand) => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', brand))).toBeNull();
        });

        it('rejects a buffer that ends before the brand', () => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp'))).toBeNull();
        });

        it('rejects a seven-byte buffer whose ftyp is itself truncated', () => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'fty'))).toBeNull();
        });
    });

    describe('AVIF', () => {
        it('accepts ftyp with the avif brand', () => {
            expect(sniffImageType(AVIF)).toBe('avif');
        });

        it('accepts the avis image-sequence brand', () => {
            expect(sniffImageType(AVIS)).toBe('avif');
        });

        // The whole reason the AVIF set is consulted first: 'mif1' is a HEIC
        // brand AND the compatible brand every AVIF encoder emits. Only the
        // major brand at offset 8 decides.
        it('reads the major brand, not the compatible brands', () => {
            expect(sniffImageType(AVIF)).toBe('avif');
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'mif1', 'avif'))).toBe('heic');
        });

        it('accepts a mixed-case brand', () => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'AVIF'))).toBe('avif');
        });

        it('rejects an MP4 whose ftyp brand is isom', () => {
            expect(sniffImageType(MP4)).toBeNull();
        });

        it.each(['av01', 'avi1', 'avcx', 'avc1'])('rejects the near-miss brand %s', (brand) => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x18], 'ftyp', brand))).toBeNull();
        });

        it('rejects a buffer that ends before the brand', () => {
            expect(sniffImageType(bytes([0x00, 0x00, 0x00, 0x1C], 'ftyp', 'avi'))).toBeNull();
        });

        it('rejects the brand appearing at the wrong offset', () => {
            expect(sniffImageType(bytes('avif', [0x00, 0x00, 0x00, 0x1C], 'ftyp'))).toBeNull();
        });

        it('never reports an AVIF as a HEIC', () => {
            expect(sniffImageType(AVIF)).not.toBe('heic');
            expect(sniffImageType(HEIC)).not.toBe('avif');
        });

        it('reads a real sharp-encoded AVIF as avif', async () => {
            const { default: sharp } = await import('sharp');
            const encoded = await sharp({
                create: { width: 32, height: 24, channels: 3, background: { r: 10, g: 90, b: 200 } },
            }).avif({ quality: 40 }).toBuffer();

            expect(sniffImageType(encoded)).toBe('avif');
        });
    });

    describe('other formats are never image types', () => {
        it.each([
            ['BMP', bytes('BM', [0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])],
            ['PDF', bytes('%PDF-1.7\n%\xE2\xE3')],
            ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg">')],
            ['ZIP', bytes([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00])],
            ['TIFF little endian', bytes('II', [0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])],
            ['TIFF big endian', bytes('MM', [0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00])],
            ['ICO', bytes([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x00, 0x00])],
            ['HTML', bytes('<!DOCTYPE html><html>')],
            ['all 0xFF', Buffer.alloc(32, 0xFF)],
            ['all zero', Buffer.alloc(32, 0x00)],
        ])('rejects %s', (_label, buffer) => {
            expect(sniffImageType(buffer)).toBeNull();
        });
    });

    describe('input containers', () => {
        it('treats a Uint8Array the same as a Buffer', () => {
            expect(sniffImageType(new Uint8Array(JPEG))).toBe('jpeg');
        });

        it('accepts an ArrayBuffer', () => {
            const view = new Uint8Array(PNG);
            expect(sniffImageType(view.buffer.slice(0))).toBe('png');
        });

        it('accepts a plain number array', () => {
            expect(sniffImageType(Array.from(WEBP))).toBe('webp');
        });

        it('accepts a DataView over the same bytes', () => {
            const source = new Uint8Array(JPEG);
            expect(sniffImageType(new DataView(source.buffer.slice(0)))).toBe('jpeg');
        });

        it('accepts a signed typed array', () => {
            expect(sniffImageType(new Int8Array(new Uint8Array(PNG).buffer.slice(0)))).toBe('png');
        });

        it('respects a byte offset on a typed-array view', () => {
            const padded = Buffer.concat([Buffer.alloc(4, 0x00), GIF89A]);
            const view = new Uint8Array(padded.buffer, padded.byteOffset + 4, GIF89A.length);
            expect(sniffImageType(view)).toBe('gif');
        });
    });
});

describe('isAcceptedType', () => {
    it('accepts a JPEG for the raster allowlist', () => {
        expect(isAcceptedType(JPEG, ['jpeg', 'png', 'webp'])).toBe(true);
    });

    it('rejects a GIF for the raster allowlist', () => {
        expect(isAcceptedType(GIF89A, ['jpeg', 'png', 'webp'])).toBe(false);
    });

    it('accepts a GIF for the resize allowlist', () => {
        expect(isAcceptedType(GIF89A, ['jpeg', 'png', 'webp', 'gif'])).toBe(true);
    });

    it('rejects an MP4 renamed as HEIC', () => {
        expect(isAcceptedType(MP4, ['heic'])).toBe(false);
    });

    it('accepts a real HEIC for the HEIC allowlist', () => {
        expect(isAcceptedType(HEIC, ['heic'])).toBe(true);
    });

    it('accepts an AVIF only for the convert allowlist', () => {
        expect(isAcceptedType(AVIF, ['jpeg', 'png', 'webp', 'avif'])).toBe(true);
        expect(isAcceptedType(AVIF, ['jpeg', 'png', 'webp'])).toBe(false);
        expect(isAcceptedType(AVIF, ['heic'])).toBe(false);
    });

    it('rejects an AVIF renamed as HEIC', () => {
        expect(isAcceptedType(AVIF, ['heic'])).toBe(false);
    });

    it.each([
        ['a missing buffer', undefined],
        ['a null buffer', null],
        ['an unrecognised buffer', bytes('%PDF-1.7\n%\xE2\xE3')],
    ])('returns false for %s', (_label, input) => {
        expect(isAcceptedType(input, ['jpeg', 'png', 'webp', 'gif', 'heic'])).toBe(false);
    });

    it.each([
        ['an empty allowlist', []],
        ['a missing allowlist', undefined],
        ['a non-array allowlist', 'jpeg'],
    ])('returns false for %s', (_label, allowed) => {
        expect(isAcceptedType(JPEG, allowed)).toBe(false);
    });
});
