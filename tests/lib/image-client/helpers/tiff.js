/**
 * A TIFF writer for the metadata suites, written from TIFF 6.0 and Exif 2.32.
 *
 * WHY IT EXISTS. sharp writes well-formed Exif and nothing else, so a suite
 * built only from sharp output proves the readers can read correct files —
 * the easy half. What has to be tested is what a stranger's phone, a broken
 * export or an attacker produces: an IFD offset past the end of the block, an
 * entry count of 60,000, an ASCII value whose pointer lands outside the file.
 * This writer is therefore deliberately more capable than the readers are: it
 * will emit both byte orders, out-of-line values, an Exif IFD, a GPS IFD, an
 * IFD1, and counts that do not match what follows them.
 *
 * Shared by exif.test.js and metadata-report.test.js rather than copied into
 * both, because the malformed shapes are the point and two drifting copies of
 * them would be two different definitions of "malformed".
 *
 * tests/helpers/image-containers.js owns the well-formed builders every suite
 * uses; this one stays here, beside the two suites that need broken ones.
 *
 * Test-only. Nothing under lib/ or app/ may import this file.
 */

const TYPE_SIZE = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

export const EXIF_POINTER = 0x8769;
export const GPS_POINTER = 0x8825;

function writeNumber(out, at, value, size, little) {
    if (size === 1) out.writeUInt8(value & 0xFF, at);
    else if (size === 2) {
        if (little) out.writeUInt16LE(value & 0xFFFF, at);
        else out.writeUInt16BE(value & 0xFFFF, at);
    } else if (little) out.writeUInt32LE(value >>> 0, at);
    else out.writeUInt32BE(value >>> 0, at);
}

/** The raw bytes of one entry's value, and how many items that is. */
function encodeValue(type, values, little) {
    if (type === 2) {
        const text = typeof values === 'string' ? values : String(values);
        return { count: text.length + 1, bytes: Buffer.from(`${text}\0`, 'latin1') };
    }

    if (Buffer.isBuffer(values)) return { count: values.length, bytes: Buffer.from(values) };

    const list = Array.isArray(values) ? values : [values];

    if (type === 5 || type === 10) {
        const out = Buffer.alloc(list.length * 8);
        list.forEach(([numerator, denominator], index) => {
            writeNumber(out, index * 8, numerator, 4, little);
            writeNumber(out, index * 8 + 4, denominator, 4, little);
        });
        return { count: list.length, bytes: out };
    }

    const size = TYPE_SIZE[type] ?? 1;
    const out = Buffer.alloc(list.length * size);
    list.forEach((value, index) => writeNumber(out, index * size, value, size, little));
    return { count: list.length, bytes: out };
}

/**
 * A TIFF block: IFD0, an optional Exif IFD, an optional GPS IFD and an optional
 * IFD1, with every value larger than four bytes held out of line.
 *
 * An entry is `{ tag, type, values }`, or `{ tag, type, count, offset }` to
 * write a pointer nothing sane would follow — which is how the malformed cases
 * are made. `ifd0Offset` and `ifd0Count` break the header and the entry count
 * the same way.
 */
export function buildTiff({
    order = 'II',
    ifd0 = [],
    exif = null,
    gps = null,
    ifd1 = null,
    ifd0Offset = 8,
    ifd0Count = null,
} = {}) {
    const little = order === 'II';
    const sizeOf = (list) => 2 + list.length * 12 + 4;

    const ifd0Entries = [...ifd0];
    let at = 8 + sizeOf(ifd0Entries) + (exif ? 12 : 0) + (gps ? 12 : 0);

    const exifAt = exif ? at : 0;
    if (exif) at += sizeOf(exif);
    const gpsAt = gps ? at : 0;
    if (gps) at += sizeOf(gps);
    const ifd1At = ifd1 ? at : 0;
    if (ifd1) at += sizeOf(ifd1);

    if (exif) ifd0Entries.push({ tag: EXIF_POINTER, type: 4, values: [exifAt] });
    if (gps) ifd0Entries.push({ tag: GPS_POINTER, type: 4, values: [gpsAt] });

    const pool = [];
    let poolAt = at;

    const writeIfd = (list, nextIfd, declaredCount) => {
        const out = Buffer.alloc(sizeOf(list));
        writeNumber(out, 0, declaredCount ?? list.length, 2, little);

        list.forEach((entry, index) => {
            const slot = 2 + index * 12;
            writeNumber(out, slot, entry.tag, 2, little);
            writeNumber(out, slot + 2, entry.type, 2, little);

            if (entry.offset !== undefined) {
                writeNumber(out, slot + 4, entry.count ?? 1, 4, little);
                writeNumber(out, slot + 8, entry.offset, 4, little);
                return;
            }

            const { count, bytes } = encodeValue(entry.type, entry.values, little);
            writeNumber(out, slot + 4, entry.count ?? count, 4, little);

            if (bytes.length <= 4) {
                bytes.copy(out, slot + 8);
            } else {
                writeNumber(out, slot + 8, poolAt, 4, little);
                pool.push(bytes);
                poolAt += bytes.length;
            }
        });

        writeNumber(out, 2 + list.length * 12, nextIfd, 4, little);
        return out;
    };

    const blocks = [writeIfd(ifd0Entries, ifd1At, ifd0Count)];
    if (exif) blocks.push(writeIfd(exif, 0));
    if (gps) blocks.push(writeIfd(gps, 0));
    if (ifd1) blocks.push(writeIfd(ifd1, 0));

    const header = Buffer.alloc(8);
    header.write(order, 0, 'latin1');
    writeNumber(header, 2, 42, 2, little);
    writeNumber(header, 4, ifd0Offset, 4, little);

    return Buffer.concat([header, ...blocks, ...pool]);
}
