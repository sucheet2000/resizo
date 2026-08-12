import { describe, expect, it } from 'vitest';

import { probeHeicPixels } from '@/lib/image/heic-probe';

/** ISOBMFF box: [size(4)][type(4)][payload]. */
function box(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, payload]);
}

/** ispe box: version+flags(4), width(4), height(4). */
function ispe(width, height) {
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE(width, 4);
    payload.writeUInt32BE(height, 8);
    return box('ispe', payload);
}

/** meta is a FullBox: 4 bytes of version+flags precede its children. */
function meta(children) {
    return box('meta', Buffer.concat([Buffer.alloc(4), children]));
}

const ftyp = () => box('ftyp', Buffer.from('heicmif1', 'latin1'));

describe('probeHeicPixels', () => {
    it('reads the declared extent from an ispe box without decoding', () => {
        const buffer = Buffer.concat([ftyp(), meta(ispe(4000, 3000))]);
        expect(probeHeicPixels(buffer)).toEqual({ width: 4000, height: 3000, pixels: 12_000_000 });
    });

    it('returns the largest extent when several ispe boxes are present', () => {
        const buffer = Buffer.concat([ftyp(), meta(Buffer.concat([ispe(320, 240), ispe(8000, 6000), ispe(1000, 1000)]))]);
        expect(probeHeicPixels(buffer)).toEqual({ width: 8000, height: 6000, pixels: 48_000_000 });
    });

    it('surfaces an oversized extent so the caller can reject before libheif runs', () => {
        const buffer = Buffer.concat([ftyp(), meta(ispe(12000, 10000))]);
        expect(probeHeicPixels(buffer)).toEqual({ width: 12000, height: 10000, pixels: 120_000_000 });
    });

    it('ignores an implausibly large dimension as a mis-parse', () => {
        const buffer = Buffer.concat([ftyp(), meta(ispe(200000, 100))]);
        expect(probeHeicPixels(buffer)).toBeNull();
    });

    it('returns null when there is no meta box', () => {
        expect(probeHeicPixels(Buffer.concat([ftyp(), box('mdat', Buffer.alloc(32))]))).toBeNull();
    });

    it('returns null for a zero-sized extent', () => {
        expect(probeHeicPixels(Buffer.concat([ftyp(), meta(ispe(0, 0))]))).toBeNull();
    });

    it('returns null for non-buffer or too-short input', () => {
        expect(probeHeicPixels(null)).toBeNull();
        expect(probeHeicPixels('not a buffer')).toBeNull();
        expect(probeHeicPixels(Buffer.alloc(4))).toBeNull();
        expect(probeHeicPixels(Buffer.from('ispe', 'latin1'))).toBeNull();
    });
});
