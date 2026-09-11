/**
 * The tests' own AVIF reader and the fixture surgery beside it, proved against
 * bytes this file lays out by hand.
 *
 * WHY A PARSER NEEDS ITS OWN TESTS AT ALL. `tests/helpers/avif.js` exists to
 * give a second opinion on the AVIF the engine writes and on the AVIF the
 * engine is handed — but a second opinion nobody has checked is just a second
 * guess. The engine will grow its own header reader (`lib/image-client/avif.js`)
 * and will check its own output with it; that check can only ever prove the
 * writer agrees with the reader sitting next to it. One wrong constant shared
 * by both — an `ispe` read at the wrong offset, an `ipma` association counted
 * in bits instead of bytes — is invisible from inside.
 *
 * So every fault the reader claims to catch is produced here on purpose, one
 * byte at a time, on a file that was valid until that byte moved.
 *
 * WRITTEN FROM THE DOCUMENTS, NOT FROM lib/:
 *
 *   ISO/IEC 14496-12 (ISOBMFF)   the box grammar: size, type, largesize,
 *                                FullBox version/flags, and the containers
 *                                `meta`, `iinf`, `iprp`, `ipco`, `iref`
 *   ISO/IEC 23008-12 (HEIF)      `pitm`, `infe`, `iloc`, `ipma`, `auxC`,
 *                                `irot`, `imir`, `pixi`
 *   AV1 Image File Format        https://aomediacodec.github.io/av1-avif/
 *                                the `avif`/`avis` brands, the `av1C` property
 *                                and the alpha URN
 *
 * THE FIXTURES BELOW ARE DELIBERATELY NOT THE ENGINE'S. Real AVIFs come from
 * sharp — the repo's independent libvips reference (CLAUDE.md > Gotchas),
 * libheif 1.23.1 over aom 3.14.1 — and the broken ones are made by moving a
 * byte of one of those. Nothing here imports `lib/`, and the day it does is
 * the day the two agree with each other for a reason that has nothing to do
 * with the format.
 */
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { AVIF_ALPHA_URN, assertAvif, parseAvif } from '../../helpers/avif.js';
import {
    addCompatibleBrand, appendMoov, imirProperty, insertItemProperty, irotProperty,
    setMajorBrand, truncate,
} from '../../helpers/isobmff-edit.js';

const WIDTH = 64;
const HEIGHT = 48;

/** An opaque AVIF and an AVIF with a real alpha channel, both from libheif. */
let opaque;
let transparent;

function flatPixels(channels, alphaOf = () => 255) {
    const raw = Buffer.alloc(WIDTH * HEIGHT * channels);
    for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
        raw[index * channels] = 40 + ((index * 7) % 180);
        raw[index * channels + 1] = 90;
        raw[index * channels + 2] = 200 - ((index * 3) % 150);
        if (channels === 4) raw[index * channels + 3] = alphaOf(index);
    }
    return raw;
}

beforeAll(async () => {
    opaque = await sharp(flatPixels(3), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
        .avif({ quality: 50 })
        .toBuffer();

    transparent = await sharp(
        flatPixels(4, (index) => (index % (WIDTH * 4) < WIDTH ? 0 : 255)),
        { raw: { width: WIDTH, height: HEIGHT, channels: 4 } },
    )
        .avif({ quality: 50 })
        .toBuffer();
}, 30_000);

/* ------------------------------------------------------------------ *
 * What a real AVIF reads as
 * ------------------------------------------------------------------ */

describe('an AVIF libheif wrote', () => {
    it('reports the brands from the FileTypeBox', () => {
        const avif = parseAvif(opaque);

        expect(avif.brand).toBe('avif');
        // 'miaf' and 'avif' are required by the AVIF spec's general
        // constraints; 'mif1' is the brand that makes AVIF and HEIC share a
        // compatible brand, which is why lib/image/magic-bytes.js checks the
        // AVIF brand set FIRST.
        expect(avif.compatibleBrands).toContain('avif');
        expect(avif.compatibleBrands).toContain('miaf');
        expect(avif.animated).toBe(false);
        expect(avif.hasMoov).toBe(false);
    });

    it('reads the picture size out of the primary item, not out of a guess', () => {
        const avif = parseAvif(opaque);

        expect(avif.primaryItemId).toBeGreaterThan(0);
        expect(avif.primary.type).toBe('av01');
        expect(avif.width).toBe(WIDTH);
        expect(avif.height).toBe(HEIGHT);
        expect(avif.primary.ispe).toEqual({ width: WIDTH, height: HEIGHT });
    });

    it('reads bit depth and chroma out of the AV1 configuration', () => {
        const avif = parseAvif(opaque);

        expect(avif.bitDepth).toBe(8);
        expect(avif.primary.pixi.depths).toEqual([8, 8, 8]);
        expect(['4:2:0', '4:2:2', '4:4:4']).toContain(avif.chroma);
    });

    it('finds no alpha, no rotation, no mirror and no metadata in it', () => {
        const avif = parseAvif(opaque);

        expect(avif.hasAlpha).toBe(false);
        expect(avif.alpha).toBeNull();
        expect(avif.rotation).toBe(0);
        expect(avif.mirrorAxis).toBeNull();
        expect(avif.hasExif).toBe(false);
        expect(avif.hasXmp).toBe(false);
    });
});

describe('an AVIF with an alpha channel', () => {
    it('carries a second item whose auxC names the alpha URN', () => {
        const avif = parseAvif(transparent);

        expect(avif.hasAlpha).toBe(true);
        expect(avif.alpha).not.toBeNull();
        expect(avif.alpha.id).not.toBe(avif.primaryItemId);
        expect(avif.alpha.auxC.auxType).toBe(AVIF_ALPHA_URN);
        // The AVIF spec requires the alpha item to be encoded at the same bit
        // depth as the master item; monochrome is how every encoder writes it.
        expect(avif.alpha.av1C.monochrome).toBe(true);
    });

    it('links the alpha item to the primary with an auxl reference', () => {
        const avif = parseAvif(transparent);

        expect(avif.alphaLinkedToPrimary).toBe(true);
        expect(avif.itemReferences).toContainEqual({
            type: 'auxl',
            from: avif.alpha.id,
            to: [avif.primaryItemId],
        });
    });

    it('agrees with libvips about whether there is an alpha channel at all', async () => {
        const [withAlpha, withoutAlpha] = await Promise.all([
            sharp(transparent).metadata(),
            sharp(opaque).metadata(),
        ]);

        expect(parseAvif(transparent).hasAlpha).toBe(withAlpha.hasAlpha === true);
        expect(parseAvif(opaque).hasAlpha).toBe(withoutAlpha.hasAlpha === true);
    });
});

/* ------------------------------------------------------------------ *
 * Every fault it claims to catch
 * ------------------------------------------------------------------ */

describe('bytes that are not an AVIF', () => {
    it('refuses an empty buffer', () => {
        expect(() => parseAvif(Buffer.alloc(0))).toThrow(/too short/i);
    });

    it('refuses a JPEG', () => {
        expect(() => parseAvif(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46])))
            .toThrow(/ftyp/i);
    });

    it('refuses a file whose first box is not ftyp', () => {
        const moved = Buffer.from(opaque);
        moved.write('ftyq', 4, 'latin1');
        expect(() => parseAvif(moved)).toThrow(/ftyp/i);
    });

    it('refuses a box whose declared size runs past the end of the file', () => {
        const overrun = Buffer.from(opaque);
        overrun.writeUInt32BE(overrun.length + 64, 0);
        expect(() => parseAvif(overrun)).toThrow(/past the end/i);
    });

    it('refuses a box whose declared size is smaller than its own header', () => {
        const tiny = Buffer.from(opaque);
        tiny.writeUInt32BE(4, 0);
        expect(() => parseAvif(tiny)).toThrow(/size 4/i);
    });

    it('refuses an ftyp with a partial compatible brand', () => {
        // The brand list is a whole number of four-byte codes by definition.
        const ragged = Buffer.concat([opaque.subarray(0, opaque.readUInt32BE(0) - 2), opaque.subarray(opaque.readUInt32BE(0))]);
        ragged.writeUInt32BE(opaque.readUInt32BE(0) - 2, 0);
        expect(() => parseAvif(ragged)).toThrow(/compatible brand/i);
    });

    it.each([8, 40, 120, 200])('refuses a file truncated to %i bytes', (length) => {
        expect(() => parseAvif(truncate(opaque, length))).toThrow();
    });

    it('refuses a file with an ftyp and then garbage', () => {
        const ftypLength = opaque.readUInt32BE(0);
        const garbage = Buffer.concat([
            opaque.subarray(0, ftypLength),
            Buffer.from('this is not a box, it is a sentence, and it is 48 bytes long!!!!!', 'latin1'),
        ]);
        expect(() => parseAvif(garbage)).toThrow();
    });
});

/* ------------------------------------------------------------------ *
 * The surgery
 * ------------------------------------------------------------------ */

describe('setMajorBrand', () => {
    it('turns a still into one that declares itself a sequence, and nothing else moves', () => {
        const edited = setMajorBrand(opaque, 'avis');
        const avif = parseAvif(edited);

        expect(edited.length).toBe(opaque.length);
        expect(avif.brand).toBe('avis');
        expect(avif.animated).toBe(true);
        // The picture is untouched: the same primary item at the same size.
        expect(avif.width).toBe(WIDTH);
        expect(avif.height).toBe(HEIGHT);
    });

    it('refuses a brand that is not four characters', () => {
        expect(() => setMajorBrand(opaque, 'av')).toThrow(/four/i);
    });
});

describe('addCompatibleBrand', () => {
    it('grows the ftyp by exactly one brand and keeps the file readable', () => {
        const edited = addCompatibleBrand(opaque, 'avis');
        const avif = parseAvif(edited);

        expect(edited.length).toBe(opaque.length + 4);
        expect(avif.brand).toBe('avif');
        expect(avif.compatibleBrands).toContain('avis');
        expect(avif.animated).toBe(true);
        expect(avif.width).toBe(WIDTH);
    });

    /**
     * THE ASSERTION THIS WHOLE MODULE TURNS ON. libheif writes item offsets
     * into `iloc` as ABSOLUTE file positions, so any edit that grows a box
     * ahead of `mdat` moves the picture out from under them. A surgery that
     * forgot to patch them would produce a file that still parses — the boxes
     * are all intact — and decodes to nothing.
     */
    it('leaves a file libvips can still decode to the same pixels', async () => {
        const edited = addCompatibleBrand(opaque, 'avis');

        const [before, after] = await Promise.all([
            sharp(opaque).raw().toBuffer({ resolveWithObject: true }),
            sharp(edited).raw().toBuffer({ resolveWithObject: true }),
        ]);

        expect(after.info.width).toBe(before.info.width);
        expect(after.info.height).toBe(before.info.height);
        expect(Buffer.compare(after.data, before.data)).toBe(0);
    });
});

describe('appendMoov', () => {
    it('adds a top-level movie box that makes the file read as animated', () => {
        const edited = appendMoov(opaque);
        const avif = parseAvif(edited);

        expect(avif.hasMoov).toBe(true);
        expect(avif.animated).toBe(true);
        expect(avif.topLevel).toContain('moov');
        // The brands still say "still image": a reader that only looked at
        // ftyp would call this file a still, which is the trap.
        expect(avif.brand).toBe('avif');
        expect(avif.compatibleBrands).not.toContain('avis');
    });

    it('appends after mdat, so nothing before it moves', async () => {
        const edited = appendMoov(opaque);

        expect(edited.subarray(0, opaque.length).equals(opaque)).toBe(true);
        const meta = await sharp(edited).metadata();
        expect(meta.width).toBe(WIDTH);
    });
});

describe('insertItemProperty', () => {
    it('adds an irot the reader then reports as a rotation', () => {
        const edited = insertItemProperty(opaque, irotProperty(90));
        const avif = parseAvif(edited);

        expect(avif.rotation).toBe(90);
        expect(avif.width).toBe(WIDTH);
        expect(avif.primary.properties.map((property) => property.type)).toContain('irot');
    });

    it.each([0, 90, 180, 270])('round-trips an irot of %i degrees', (angle) => {
        expect(parseAvif(insertItemProperty(opaque, irotProperty(angle))).rotation).toBe(angle);
    });

    it('refuses an angle the box cannot hold', () => {
        expect(() => irotProperty(45)).toThrow(/90/);
    });

    it('adds an imir the reader then reports as a mirror axis', () => {
        const edited = insertItemProperty(opaque, imirProperty(1));
        const avif = parseAvif(edited);

        expect(avif.mirrorAxis).toBe(1);
        expect(avif.primary.properties.map((property) => property.type)).toContain('imir');
    });

    it('associates the new property with the primary item only', () => {
        const avif = parseAvif(insertItemProperty(transparent, irotProperty(90)));

        expect(avif.primary.properties.map((property) => property.type)).toContain('irot');
        expect(avif.alpha.properties.map((property) => property.type)).not.toContain('irot');
    });

    /**
     * The same argument as the compatible-brand case, and the reason the
     * rotation fixtures are worth committing: a transformative property makes
     * the picture come back a different SHAPE, and that is only observable if
     * the file still decodes at all.
     *
     * THE TWO SIZES ARE DIFFERENT NUMBERS AND BOTH ARE RIGHT. `ispe` states
     * what is stored — 64 × 48, untouched by an irot — and a decoder that
     * honours the property hands back 48 × 64. libheif honours it, so the two
     * disagree here on purpose, and a test that read only one of them could
     * not tell a rotation that was applied from one that was ignored.
     */
    it('leaves a file libvips can decode, turned a quarter of the way round', async () => {
        const edited = insertItemProperty(opaque, irotProperty(90));

        expect(parseAvif(edited).primary.ispe).toEqual({ width: WIDTH, height: HEIGHT });

        const decoded = await sharp(edited).raw().toBuffer({ resolveWithObject: true });
        expect(decoded.info.width).toBe(HEIGHT);
        expect(decoded.info.height).toBe(WIDTH);
    });

    /**
     * WHICH WAY THE PICTURE WENT, read off the pixels rather than off the
     * label. The two editions of HEIF word the imir axis in opposite
     * directions (see tests/helpers/avif.js), so the only thing worth
     * asserting is what a decoder actually does: axis 1 puts the source's
     * top-RIGHT pixel in the top-left corner.
     */
    it('mirrors left to right on axis 1, as libvips reads it', async () => {
        // Two halves left-to-right, so a horizontal exchange is visible in one pixel.
        const split = Buffer.alloc(WIDTH * HEIGHT * 3);
        for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
            split[index * 3] = index % WIDTH < WIDTH / 2 ? 240 : 20;
            split[index * 3 + 1] = 60;
            split[index * 3 + 2] = 60;
        }
        const striped = await sharp(split, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
            .avif({ quality: 60 })
            .toBuffer();

        const before = await sharp(striped).raw().toBuffer();
        const after = await sharp(insertItemProperty(striped, imirProperty(1))).raw().toBuffer();

        expect(before[0]).toBeGreaterThan(200);
        expect(after[0]).toBeLessThan(80);
    });
});

/* ------------------------------------------------------------------ *
 * assertAvif — the shorthand every AVIF assertion in the suite uses
 * ------------------------------------------------------------------ */

describe('assertAvif', () => {
    it('passes a real AVIF of the size and alpha it was promised', () => {
        expect(() => assertAvif(opaque, { width: WIDTH, height: HEIGHT, alpha: false })).not.toThrow();
        expect(() => assertAvif(transparent, { width: WIDTH, height: HEIGHT, alpha: true })).not.toThrow();
    });

    it('fails a file that is not an AVIF at all', async () => {
        const jpeg = await sharp(flatPixels(3), { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
            .jpeg()
            .toBuffer();
        expect(() => assertAvif(jpeg, { width: WIDTH, height: HEIGHT })).toThrow();
    });

    it('fails on the wrong dimensions', () => {
        expect(() => assertAvif(opaque, { width: WIDTH + 1, height: HEIGHT })).toThrow(/64 × 48/);
    });

    it('fails when alpha was promised and is not there', () => {
        expect(() => assertAvif(opaque, { width: WIDTH, height: HEIGHT, alpha: true })).toThrow(/alpha/i);
    });

    it('fails when alpha is there and was not expected', () => {
        expect(() => assertAvif(transparent, { width: WIDTH, height: HEIGHT, alpha: false })).toThrow(/alpha/i);
    });

    it('fails an animated file even when every other claim holds', () => {
        expect(() => assertAvif(setMajorBrand(opaque, 'avis'), { width: WIDTH, height: HEIGHT }))
            .toThrow(/animat/i);
    });
});
