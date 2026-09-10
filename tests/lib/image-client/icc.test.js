/**
 * The ICC profile header, read for a report and never for a pipeline.
 *
 * WHAT THIS IS AND IS NOT. An ICC profile is colour, not identity, and the
 * metadata remover deliberately keeps it — dropping it shifts every pixel a
 * viewer draws while telling the person their privacy improved. So the viewer
 * has to be able to say what the profile IS, in a sentence: "sRGB, RGB, version
 * 4.2, 3,144 bytes". That is the whole job. Nothing here transforms a colour.
 *
 * TWO WAYS A PROFILE NAMES ITSELF, and both are tested against the real thing.
 * ICC v2 uses a `desc` textDescription — a length and an ASCII string. ICC v4
 * uses `mluc`, a table of language records holding UTF-16BE. sharp's sRGB
 * profile is a v4 `mluc`, which is what a browser hands us in practice; the v2
 * shape is built by hand here because nothing installed writes one any more and
 * plenty of files in the world still carry it.
 *
 * AND EVERY OFFSET IN IT CAME FROM THE FILE. The tag table is a list of
 * (signature, offset, size) triples a writer chooses, so a description can
 * claim to be 400 MB long and start past the end of the profile. Those cases
 * return nulls. A colour profile is never worth a thrown page.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { readIccProfile } from '@/lib/image-client/icc';
import { locateMetadata } from '@/lib/image-client/metadata-strip';

/* ---------------------------------------------------------- a v2 profile */

const HEADER_LENGTH = 128;
const TAG_ENTRY_LENGTH = 12;

/** A profile with a real header and whichever tags the caller asks for. */
function buildProfile({
    version = [2, 0x10],
    deviceClass = 'mntr',
    colourSpace = 'GRAY',
    pcs = 'Lab ',
    tags = [],
} = {}) {
    const table = Buffer.alloc(4 + tags.length * TAG_ENTRY_LENGTH);
    table.writeUInt32BE(tags.length, 0);

    let at = HEADER_LENGTH + table.length;
    const bodies = [];

    tags.forEach((tag, index) => {
        const slot = 4 + index * TAG_ENTRY_LENGTH;
        table.write(tag.signature, slot, 'latin1');
        table.writeUInt32BE(tag.offset ?? at, slot + 4);
        table.writeUInt32BE(tag.size ?? tag.body.length, slot + 8);

        if (tag.offset === undefined) {
            bodies.push(tag.body);
            at += tag.body.length;
        }
    });

    const header = Buffer.alloc(HEADER_LENGTH);
    header.write('lcms', 4, 'latin1');
    header[8] = version[0];
    header[9] = version[1];
    header.write(deviceClass, 12, 'latin1');
    header.write(colourSpace, 16, 'latin1');
    header.write(pcs, 20, 'latin1');
    header.write('acsp', 36, 'latin1');

    const profile = Buffer.concat([header, table, ...bodies]);
    profile.writeUInt32BE(profile.length, 0);
    return profile;
}

/** ICC v2's textDescription: a signature, a reserved word, a count, a string. */
function descriptionTag(text, { count = null } = {}) {
    const ascii = Buffer.from(`${text}\0`, 'latin1');
    const body = Buffer.alloc(12 + ascii.length);
    body.write('desc', 0, 'latin1');
    body.writeUInt32BE(count ?? ascii.length, 8);
    ascii.copy(body, 12);
    return { signature: 'desc', body };
}

/** ICC v4's mluc: a record table, then UTF-16BE text at an offset. */
function multiLocalisedTag(text, { language = 'en', country = 'US' } = {}) {
    const encoded = Buffer.from(text, 'utf16le').swap16();
    const body = Buffer.alloc(28 + encoded.length);
    body.write('mluc', 0, 'latin1');
    body.writeUInt32BE(1, 8);
    body.writeUInt32BE(12, 12);
    body.write(language, 16, 'latin1');
    body.write(country, 18, 'latin1');
    body.writeUInt32BE(encoded.length, 20);
    body.writeUInt32BE(28, 24);
    encoded.copy(body, 28);
    return { signature: 'desc', body };
}

/* --------------------------------------------------------- real profiles */

const canvas = () => sharp({
    create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 40, b: 80 } },
});

async function profileFrom(bytes) {
    const source = new Uint8Array(bytes);
    const block = locateMetadata(source).blocks.find((entry) => entry.kind === 'icc');
    return source.subarray(block.start, block.end);
}

/* ------------------------------------------------------------------ tests */

describe('readIccProfile, real profiles', () => {
    it('names the sRGB profile a JPEG carries in APP2', async () => {
        const profile = await profileFrom(await canvas().withIccProfile('srgb').jpeg().toBuffer());
        const result = readIccProfile(profile);

        expect(result.description).toMatch(/^sRGB/);
        expect(result.colourSpace).toBe('RGB');
        expect(result.deviceClass).toBe('mntr');
        expect(result.pcs).toBe('XYZ');
        expect(result.version).toBe('4.2');
        expect(result.bytes).toBe(profile.length);
    });

    it('reads the same profile out of a WebP ICCP chunk', async () => {
        const fromJpeg = readIccProfile(await profileFrom(await canvas().withIccProfile('srgb').jpeg().toBuffer()));
        const fromWebp = readIccProfile(await profileFrom(await canvas().withIccProfile('srgb').webp().toBuffer()));

        expect(fromWebp).toEqual(fromJpeg);
    });
});

describe('readIccProfile, both description shapes', () => {
    it('reads an ICC v2 textDescription', () => {
        const profile = buildProfile({ tags: [descriptionTag('Generic Gray Gamma 2.2')] });
        const result = readIccProfile(profile);

        expect(result.description).toBe('Generic Gray Gamma 2.2');
        expect(result.colourSpace).toBe('GRAY');
        expect(result.pcs).toBe('Lab');
        expect(result.version).toBe('2.1');
    });

    it('reads the first record of an ICC v4 mluc', () => {
        const profile = buildProfile({
            version: [4, 0x30],
            colourSpace: 'CMYK',
            tags: [multiLocalisedTag('Coated FOGRA39')],
        });

        expect(readIccProfile(profile).description).toBe('Coated FOGRA39');
        expect(readIccProfile(profile).colourSpace).toBe('CMYK');
        expect(readIccProfile(profile).version).toBe('4.3');
    });

    it('reports a profile with no description at all', () => {
        const result = readIccProfile(buildProfile({ tags: [] }));

        expect(result.description).toBe(null);
        expect(result.colourSpace).toBe('GRAY');
        expect(result.bytes).toBeGreaterThan(0);
    });
});

describe('readIccProfile, malformed input', () => {
    it('returns nulls rather than throwing, whatever the bytes are', () => {
        const cases = [
            new Uint8Array(0),
            new Uint8Array(4),
            new Uint8Array(127).fill(0xAB),
            new Uint8Array(200).fill(0xFF),
            null,
            'not bytes',
        ];

        for (const input of cases) {
            expect(() => readIccProfile(input)).not.toThrow();
            expect(readIccProfile(input).description).toBe(null);
        }
    });

    it('refuses a tag whose offset points past the end of the profile', () => {
        const profile = buildProfile({
            tags: [{ signature: 'desc', body: Buffer.alloc(0), offset: 900000, size: 64 }],
        });

        expect(readIccProfile(profile).description).toBe(null);
        expect(readIccProfile(profile).colourSpace).toBe('GRAY');
    });

    it('refuses a description that claims to be longer than the profile', () => {
        const profile = buildProfile({ tags: [descriptionTag('Short', { count: 900000 })] });

        expect(readIccProfile(profile).description).toBe(null);
    });

    it('ignores a tag count no profile could hold', () => {
        const profile = Buffer.from(buildProfile({ tags: [descriptionTag('Present')] }));
        profile.writeUInt32BE(500000, HEADER_LENGTH);

        expect(() => readIccProfile(profile)).not.toThrow();
        expect(readIccProfile(profile).colourSpace).toBe('GRAY');
    });

    it('caps a description that is long but legal', () => {
        const profile = buildProfile({ tags: [descriptionTag('n'.repeat(5000))] });
        const result = readIccProfile(profile);

        expect(result.description.length).toBeLessThanOrEqual(256);
    });

    it('leaves the caller\'s bytes exactly as they were', () => {
        const profile = new Uint8Array(buildProfile({ tags: [descriptionTag('Untouched')] }));
        const copy = Buffer.from(profile);

        readIccProfile(profile);

        expect(Buffer.from(profile).equals(copy)).toBe(true);
    });
});
