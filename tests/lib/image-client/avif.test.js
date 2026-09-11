/**
 * The AVIF header reader: lib/image-client/avif.js.
 *
 * WHY A READER EXISTS AT ALL. Nothing else in this build can answer three
 * questions about an AVIF before a decoder touches it — is it animated, how big
 * is the picture, does it carry an alpha plane — and all three decide something
 * the visitor sees. An animated AVIF has to be refused BEFORE the decode,
 * because every browser will happily hand back its first frame and call that a
 * conversion. The dimensions are what `validateOutput` holds the engine's own
 * claim to. And the alpha item is the only evidence, outside the pixels, that
 * transparency survived the encode.
 *
 * It shares no code with the encoder, so an encoder that wrote the wrong thing
 * cannot talk this reader into agreeing with it. That is the same reason
 * image-size.js is a leaf.
 *
 * The fixtures are real files: sharp writes them through libheif and libaom,
 * and the malformed ones are built by hand from the ISO 14496-12 box grammar.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { readAvifHeader, AVIF_HEADER_SCAN_BYTES } from '@/lib/image-client/avif';
import { readImageSize } from '@/lib/image-client/image-size';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

let opaque;
let transparent;
let odd;
let tenBit;

beforeAll(async () => {
    opaque = await sharp({
        create: { width: 61, height: 43, channels: 3, background: { r: 200, g: 40, b: 80 } },
    }).avif({ quality: 50 }).toBuffer();

    transparent = await sharp({
        create: { width: 61, height: 43, channels: 4, background: { r: 200, g: 40, b: 80, alpha: 0.5 } },
    }).avif({ quality: 50 }).toBuffer();

    odd = await sharp({
        create: { width: 1001, height: 333, channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).avif({ quality: 40, chromaSubsampling: '4:2:0' }).toBuffer();

    tenBit = await sharp({
        create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).avif({ quality: 50, bitdepth: 10 }).toBuffer();
}, 60_000);

/** The four-byte big-endian size a box declares. */
function boxSize(bytes, at) {
    return (bytes[at] << 24 >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

/** A copy of `bytes` with the major brand at 8..12 replaced. */
function withMajorBrand(bytes, brand) {
    const copy = Buffer.from(bytes);
    copy.write(brand, 8, 4, 'latin1');
    return copy;
}

/** A copy of `bytes` with a top-level `moov` box appended. */
function withTopLevelMoov(bytes) {
    const moov = Buffer.alloc(16);
    moov.writeUInt32BE(16, 0);
    moov.write('moov', 4, 4, 'latin1');
    moov.writeUInt32BE(8, 8);
    moov.write('free', 12, 4, 'latin1');
    return Buffer.concat([Buffer.from(bytes), moov]);
}

/* ------------------------------------------------------------------ *
 * 1. What a real AVIF declares
 * ------------------------------------------------------------------ */

describe('a still AVIF written by libavif', () => {
    it('reports the brand and the compatible brands it actually carries', () => {
        const header = readAvifHeader(opaque);

        expect(header.brand).toBe('avif');
        expect(header.compatibleBrands).toContain('mif1');
        expect(header.compatibleBrands).toContain('avif');
    });

    it('reports the dimensions from ispe, not from a guess', () => {
        expect(readAvifHeader(opaque)).toMatchObject({ width: 61, height: 43 });
        expect(readAvifHeader(odd)).toMatchObject({ width: 1001, height: 333 });
    });

    it('is not animated', () => {
        expect(readAvifHeader(opaque).animated).toBe(false);
    });

    it('carries no Exif item, no XMP item and no ICC profile', () => {
        const header = readAvifHeader(opaque);

        expect(header.hasExif).toBe(false);
        expect(header.hasXmp).toBe(false);
        expect(header.hasIcc).toBe(false);
    });

    it('is not rotated and not mirrored', () => {
        expect(readAvifHeader(opaque)).toMatchObject({ rotation: 0, mirror: null });
    });
});

/* ------------------------------------------------------------------ *
 * 2. Alpha — the one row the batch and the output validator both read
 * ------------------------------------------------------------------ */

describe('the alpha auxiliary item', () => {
    it('is absent from an opaque file', () => {
        expect(readAvifHeader(opaque).alpha).toBe(false);
    });

    it('is present in a file with transparency', () => {
        expect(readAvifHeader(transparent).alpha).toBe(true);
    });

    /**
     * The alpha plane is a SECOND av1C, monochrome 4:0:0, and reading the wrong
     * one would report every transparent AVIF as greyscale. The primary item is
     * resolved through pitm and ipma rather than by taking the first av1C in
     * the property container.
     */
    it('does not let the alpha plane masquerade as the picture', () => {
        const header = readAvifHeader(transparent);

        expect(header.chroma).not.toBe('4:0:0');
        expect(header.width).toBe(61);
    });
});

/* ------------------------------------------------------------------ *
 * 3. What av1C says about the picture
 * ------------------------------------------------------------------ */

describe('chroma and bit depth, from the primary item’s av1C', () => {
    it('reads 4:4:4 and 4:2:0 apart', () => {
        expect(readAvifHeader(opaque).chroma).toBe('4:4:4');
        expect(readAvifHeader(odd).chroma).toBe('4:2:0');
    });

    it('reports 8-bit for an ordinary file and 10-bit for a high-depth one', () => {
        expect(readAvifHeader(opaque).bitDepth).toBe(8);
        expect(readAvifHeader(tenBit).bitDepth).toBe(10);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Animation, refused before anything decodes
 * ------------------------------------------------------------------ */

describe('an animated AVIF', () => {
    it('is caught by the avis major brand', () => {
        expect(readAvifHeader(withMajorBrand(opaque, 'avis')).animated).toBe(true);
    });

    it('is caught by a top-level moov box even when the brand says still', () => {
        const header = readAvifHeader(withTopLevelMoov(opaque));

        expect(header.brand).toBe('avif');
        expect(header.animated).toBe(true);
    });

    it('still reports the dimensions, so a refusal can say what was refused', () => {
        expect(readAvifHeader(withTopLevelMoov(opaque)).width).toBe(61);
    });
});

/* ------------------------------------------------------------------ *
 * 5. Malformed input is null, never a throw
 * ------------------------------------------------------------------ */

describe('anything that is not a readable AVIF reads as null', () => {
    it.each([
        ['nothing', null],
        ['undefined', undefined],
        ['an empty buffer', new Uint8Array(0)],
        ['four bytes', new Uint8Array([0, 0, 0, 24])],
        ['a JPEG', Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])],
    ])('reads %s as null', (_label, input) => {
        expect(readAvifHeader(input)).toBeNull();
    });

    it('reads a file truncated inside its ftyp as null', () => {
        expect(readAvifHeader(opaque.subarray(0, 10))).toBeNull();
    });

    it('reads garbage after a valid ftyp as null rather than inventing a picture', () => {
        const ftypLength = boxSize(opaque, 0);
        const garbage = Buffer.alloc(64, 0x7f);
        expect(readAvifHeader(Buffer.concat([opaque.subarray(0, ftypLength), garbage]))).toBeNull();
    });

    it('reads a box that claims an impossible size as null', () => {
        const ftypLength = boxSize(opaque, 0);
        const broken = Buffer.from(opaque);
        broken.writeUInt32BE(3, ftypLength);
        expect(readAvifHeader(broken)).toBeNull();
    });

    /**
     * A file cut off after a valid ftyp and a partial meta is NOT null — the
     * brands read fine and that is a true answer — but the picture it could not
     * reach is reported as unknown rather than guessed at. decode.js turns that
     * into the damaged-file sentence once the decoder agrees.
     */
    it('reads a truncated meta box as an unknown picture, not as a lie', () => {
        const header = readAvifHeader(opaque.subarray(0, boxSize(opaque, 0) + 20));

        expect(header).not.toBeNull();
        expect(header.width).toBeNull();
        expect(header.height).toBeNull();
    });
});

/* ------------------------------------------------------------------ *
 * 6. It is bounded
 * ------------------------------------------------------------------ */

describe('the walk is bounded', () => {
    it('publishes how many bytes off the front are enough to read a header', () => {
        expect(AVIF_HEADER_SCAN_BYTES).toBeGreaterThan(4096);
        expect(AVIF_HEADER_SCAN_BYTES).toBeLessThanOrEqual(1024 * 1024);
    });

    /**
     * The meta box always precedes mdat in every encoder this site meets, so a
     * prefix is enough — and reading a 20 MB file into a second buffer to learn
     * its width is exactly what this reader exists to avoid.
     */
    it('reads a real file from a prefix alone', async () => {
        // Noise, so the picture data is far larger than the prefix under test —
        // a flat colour compresses to under 400 bytes and would prove nothing.
        const pixels = Buffer.alloc(1200 * 900 * 3);
        for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 131) % 251;

        const big = await sharp(pixels, { raw: { width: 1200, height: 900, channels: 3 } })
            .avif({ quality: 60 })
            .toBuffer();

        expect(big.length).toBeGreaterThan(4096);
        expect(readAvifHeader(big.subarray(0, 512))).toMatchObject({ width: 1200, height: 900 });
    }, 60_000);

    it('never throws, whatever it is handed', () => {
        const random = Buffer.alloc(4096);
        for (let index = 0; index < random.length; index += 1) random[index] = (index * 37) % 256;
        random.write('ftyp', 4, 4, 'latin1');
        random.writeUInt32BE(24, 0);

        expect(() => readAvifHeader(random)).not.toThrow();
    });
});

/* ------------------------------------------------------------------ *
 * 7. The size reader every validator already uses
 * ------------------------------------------------------------------ */

describe('readImageSize on an AVIF', () => {
    /**
     * `readImageSize` is what validateOutput holds the pipeline's own claims
     * to, and it returned null for an AVIF until this branch existed — which
     * would have made every AVIF row in the bulk converter and every AVIF
     * output check unverifiable rather than merely unchecked.
     */
    it('reports the dimensions and the alpha channel, like the other three', () => {
        expect(readImageSize(opaque)).toEqual({ width: 61, height: 43, hasAlpha: false });
        expect(readImageSize(transparent)).toEqual({ width: 61, height: 43, hasAlpha: true });
        expect(readImageSize(odd)).toEqual({ width: 1001, height: 333, hasAlpha: false });
    });

    it('reads null for an AVIF whose picture it could not reach, never a guess', () => {
        expect(readImageSize(opaque.subarray(0, boxSize(opaque, 0) + 20))).toBeNull();
    });

    it('still reads null for bytes that are not an image at all', () => {
        expect(readImageSize(Buffer.alloc(64, 0x7f))).toBeNull();
    });

    it('is not fooled by a HEIC, which shares the container', async () => {
        const heic = await sharp({
            create: { width: 40, height: 30, channels: 3, background: { r: 5, g: 5, b: 5 } },
        }).heif({ compression: 'hevc', quality: 50 }).toBuffer().catch(() => null);

        if (!heic) return;
        expect(readImageSize(heic)).toBeNull();
    }, 60_000);
});

describe('the walk stays bounded', () => {
    it('never throws on adversarial bytes', () => {
        const random = Buffer.alloc(4096);
        for (let index = 0; index < random.length; index += 1) random[index] = (index * 37) % 256;
        random.write('ftyp', 4, 4, 'latin1');
        random.writeUInt32BE(24, 0);

        expect(() => readAvifHeader(random)).not.toThrow();
    });
});
