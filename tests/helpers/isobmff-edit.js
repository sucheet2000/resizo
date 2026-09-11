/**
 * Fixture surgery on an ISOBMFF file — A TEST HELPER, NOT PRODUCT CODE.
 *
 * WHY THIS EXISTS. Four of the AVIF cases the engine has to get right cannot
 * be produced by an encoder, because no encoder will write them on purpose:
 *
 *   a still that declares itself a sequence   ftyp major brand 'avis'
 *   a still with 'avis' among its compatible  the same refusal reached by the
 *   brands                                    other half of the same rule
 *   a still carrying a movie box              a file whose ftyp says 'avif'
 *                                             and whose top level says otherwise
 *   a picture with an irot or an imir on it   libheif writes neither for a
 *                                             file it encodes from raw pixels
 *
 * The alternative is committing four binaries somebody downloaded, whose
 * provenance is a promise. These are made HERE, from a file libheif wrote a
 * moment ago, by moving the bytes the format's own document says carry that
 * meaning — so a fixture's claim about itself is reproducible arithmetic
 * rather than trust.
 *
 * THE ONE THING THAT MAKES THIS HARD, AND THE BUG IT EXISTS TO AVOID.
 * `iloc` holds where each item's bytes are, and libheif writes those as
 * ABSOLUTE FILE OFFSETS (base_offset, with the extent offsets at zero). Any
 * edit that grows a box ahead of `mdat` moves the picture out from under
 * them. The resulting file still PARSES — every box is intact, every size adds
 * up — and decodes to nothing, or to whatever bytes now sit at the old
 * address. So every operation here that changes a length patches `iloc`, and
 * tests/lib/image-client/avif-reader.test.js proves it by decoding the edited
 * file with libvips and comparing the pixels.
 *
 * Written from ISO/IEC 14496-12 (the box grammar and `iloc`) and ISO/IEC
 * 23008-12 (`ipco`, `ipma`, `irot`, `imir`). Imports nothing from lib/.
 *
 * CommonJS on purpose, like the reader beside it.
 */

const BOX_HEADER = 8;

/** ISO/IEC 23008-12 § 6.5.10: transformative properties SHALL be essential. */
const ESSENTIAL = true;

function toBuffer(input) {
    if (Buffer.isBuffer(input)) return Buffer.from(input);
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    throw new Error(`isobmff-edit needs bytes, not ${input === null ? 'null' : typeof input}`);
}

const fourcc = (buffer, at) => buffer.subarray(at, at + 4).toString('latin1');

/**
 * Every box between two offsets, one level deep. Deliberately a second, much
 * smaller walker than the reader's: this module moves bytes and must not
 * inherit any interpretation from the file that is supposed to be checking it.
 */
function boxes(buffer, start, end) {
    const found = [];
    let at = start;

    while (at + BOX_HEADER <= end) {
        let size = buffer.readUInt32BE(at);
        let header = BOX_HEADER;

        if (size === 1) {
            size = Number(buffer.readBigUInt64BE(at + 8));
            header = 16;
        } else if (size === 0) {
            size = end - at;
        }

        if (size < header || at + size > end) {
            throw new Error(`isobmff-edit: box "${fourcc(buffer, at + 4)}" at ${at} declares ${size} bytes`);
        }

        found.push({ type: fourcc(buffer, at + 4), at, size, header, body: at + header, end: at + size });
        at += size;
    }

    return found;
}

function must(list, type, where) {
    const found = list.find((box) => box.type === type);
    if (!found) throw new Error(`isobmff-edit: no ${type} box in ${where}`);
    return found;
}

/** meta, iinf and iref carry four bytes of version and flags before their children. */
const FULL_CONTAINERS = new Set(['meta', 'iinf', 'iref']);

function childrenOf(buffer, box) {
    const skip = FULL_CONTAINERS.has(box.type) ? 4 : 0;
    return boxes(buffer, box.body + skip, box.end);
}

/** Adds `delta` to the size field of the box whose header starts at `at`. */
function growBox(buffer, at, delta) {
    const size = buffer.readUInt32BE(at);
    if (size === 0 || size === 1) throw new Error('isobmff-edit: cannot grow a largesize or to-end-of-file box');
    buffer.writeUInt32BE(size + delta, at);
}

/**
 * Moves every absolute item offset in `iloc` that points at or after
 * `insertedAt` along by `delta`.
 *
 * ISO/IEC 14496-12 § 8.11.3. The field widths are declared in the box itself,
 * which is why this reads them rather than assuming libheif's 4/4/4: a file
 * from another encoder states different ones and would otherwise be silently
 * corrupted.
 *
 * construction_method 1 means the offset is relative to an `idat` box rather
 * than to the file, so those are left alone — moving them would be the same
 * bug in the opposite direction.
 */
function shiftItemLocations(buffer, iloc, insertedAt, delta) {
    if (delta === 0) return;

    const version = buffer.readUInt8(iloc.body);
    let at = iloc.body + 4;

    const sizes = buffer.readUInt8(at);
    const offsetSize = sizes >> 4;
    const lengthSize = sizes & 0x0F;
    at += 1;

    const baseSizes = buffer.readUInt8(at);
    const baseOffsetSize = baseSizes >> 4;
    const indexSize = version === 1 || version === 2 ? (baseSizes & 0x0F) : 0;
    at += 1;

    let itemCount;
    if (version < 2) {
        itemCount = buffer.readUInt16BE(at);
        at += 2;
    } else {
        itemCount = buffer.readUInt32BE(at);
        at += 4;
    }

    const readAt = (position, width) => (width === 0 ? 0 : buffer.readUIntBE(position, width));
    const writeAt = (position, width, value) => {
        if (width === 0) return;
        if (width > 6) throw new Error('isobmff-edit: a 64-bit iloc offset is beyond this helper');
        buffer.writeUIntBE(value, position, width);
    };

    for (let item = 0; item < itemCount; item += 1) {
        at += version < 2 ? 2 : 4; // item_ID

        let constructionMethod = 0;
        if (version === 1 || version === 2) {
            constructionMethod = buffer.readUInt16BE(at) & 0x0F;
            at += 2;
        }

        at += 2; // data_reference_index

        const baseAt = at;
        const baseOffset = readAt(baseAt, baseOffsetSize);
        at += baseOffsetSize;

        const extentCount = buffer.readUInt16BE(at);
        at += 2;

        const fileRelative = constructionMethod === 0;

        if (fileRelative && baseOffset >= insertedAt) {
            writeAt(baseAt, baseOffsetSize, baseOffset + delta);
        }

        for (let extent = 0; extent < extentCount; extent += 1) {
            at += indexSize;
            const offsetAt = at;
            const extentOffset = readAt(offsetAt, offsetSize);
            at += offsetSize;
            at += lengthSize;

            // With a base offset in play the extent is relative to it, and
            // moving both would move the item twice.
            if (fileRelative && baseOffset === 0 && extentOffset >= insertedAt) {
                writeAt(offsetAt, offsetSize, extentOffset + delta);
            }
        }
    }
}

/** The meta box and its iloc, or a clear failure. */
function locate(buffer) {
    const topLevel = boxes(buffer, 0, buffer.length);
    const ftyp = must(topLevel, 'ftyp', 'the file');
    const meta = must(topLevel, 'meta', 'the file');
    const metaChildren = childrenOf(buffer, meta);
    return { topLevel, ftyp, meta, metaChildren, iloc: metaChildren.find((box) => box.type === 'iloc') ?? null };
}

/**
 * Splices `insert` into `buffer` at `at`, growing the boxes named in
 * `grow` and moving every item offset that sat after the insertion point.
 */
function spliceAndPatch(buffer, at, insert, grow) {
    const out = Buffer.concat([buffer.subarray(0, at), insert, buffer.subarray(at)]);

    for (const boxAt of grow) growBox(out, boxAt, insert.length);

    const { iloc } = locate(out);
    if (iloc) shiftItemLocations(out, iloc, at, insert.length);

    return out;
}

/* ------------------------------------------------------------------ *
 * The edits
 * ------------------------------------------------------------------ */

function checkBrand(brand) {
    if (typeof brand !== 'string' || Buffer.byteLength(brand, 'latin1') !== 4) {
        throw new Error(`a brand is four characters; "${brand}" is ${brand ? brand.length : 0}`);
    }
}

/** Rewrites the major brand in place. The file's length does not change. */
function setMajorBrand(input, brand) {
    checkBrand(brand);
    const buffer = toBuffer(input);
    const { ftyp } = locate(buffer);
    buffer.write(brand, ftyp.body, 'latin1');
    return buffer;
}

/** Appends one code to the compatible-brand list, growing the ftyp by four bytes. */
function addCompatibleBrand(input, brand) {
    checkBrand(brand);
    const buffer = toBuffer(input);
    const { ftyp } = locate(buffer);
    return spliceAndPatch(buffer, ftyp.end, Buffer.from(brand, 'latin1'), [ftyp.at]);
}

/** A whole box: an 8-byte header and a payload. */
function box(type, payload) {
    const header = Buffer.alloc(BOX_HEADER);
    header.writeUInt32BE(BOX_HEADER + payload.length, 0);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, payload]);
}

/**
 * ImageRotation — ISO/IEC 23008-12 § 6.5.10. Six reserved bits and a two-bit
 * quarter turn, ANTI-CLOCKWISE, which is the direction a test comparing
 * against libvips has to get right rather than guess.
 */
function irotProperty(degrees) {
    if (![0, 90, 180, 270].includes(degrees)) {
        throw new Error(`an irot holds a multiple of 90 below 360; ${degrees} is not one`);
    }
    return box('irot', Buffer.from([degrees / 90]));
}

/** ImageMirror — seven reserved bits and one axis bit. See tests/helpers/avif.js. */
function imirProperty(axis) {
    if (axis !== 0 && axis !== 1) throw new Error(`an imir axis is 0 or 1; ${axis} is neither`);
    return box('imir', Buffer.from([axis]));
}

/**
 * Appends a property to `ipco` and associates it with the primary item.
 *
 * Appending rather than inserting is deliberate: `ipma` indexes properties by
 * their POSITION in `ipco`, one-based, so a property put anywhere but the end
 * renumbers every association after it. At the end, every existing index still
 * means what it did and the new one is simply the next number.
 */
function insertItemProperty(input, property) {
    const buffer = toBuffer(input);
    const { meta, metaChildren } = locate(buffer);

    const pitm = must(metaChildren, 'pitm', 'meta');
    const pitmVersion = buffer.readUInt8(pitm.body);
    const primaryId = pitmVersion === 0 ? buffer.readUInt16BE(pitm.body + 4) : buffer.readUInt32BE(pitm.body + 4);

    const iprp = must(metaChildren, 'iprp', 'meta');
    const iprpChildren = boxes(buffer, iprp.body, iprp.end);
    const ipco = must(iprpChildren, 'ipco', 'iprp');
    const ipma = must(iprpChildren, 'ipma', 'iprp');

    if (ipma.at < ipco.end) {
        throw new Error('isobmff-edit: this file lists ipma before ipco, which this helper does not handle');
    }

    const index = boxes(buffer, ipco.body, ipco.end).length + 1;

    // Where the primary item's association list ends, and the byte that counts it.
    const ipmaVersion = buffer.readUInt8(ipma.body);
    const wideIndex = (buffer.readUIntBE(ipma.body + 1, 3) & 1) === 1;
    let at = ipma.body + 4;
    const entryCount = buffer.readUInt32BE(at);
    at += 4;

    let countAt = null;
    let insertAt = null;

    for (let entry = 0; entry < entryCount; entry += 1) {
        let id;
        if (ipmaVersion < 1) {
            id = buffer.readUInt16BE(at);
            at += 2;
        } else {
            id = buffer.readUInt32BE(at);
            at += 4;
        }

        const associations = buffer.readUInt8(at);
        const thisCountAt = at;
        at += 1 + associations * (wideIndex ? 2 : 1);

        if (id === primaryId) {
            countAt = thisCountAt;
            insertAt = at;
            break;
        }
    }

    if (insertAt === null) {
        throw new Error(`isobmff-edit: the primary item ${primaryId} has no ipma entry to add a property to`);
    }

    if (!wideIndex && index > 0x7F) {
        throw new Error(`isobmff-edit: property index ${index} does not fit in this ipma's seven bits`);
    }

    const association = wideIndex
        ? Buffer.from([((ESSENTIAL ? 0x80 : 0) | (index >> 8)) & 0xFF, index & 0xFF])
        : Buffer.from([(ESSENTIAL ? 0x80 : 0) | index]);

    // Two inserts, back to front so the first one's offsets stay valid: the
    // association inside ipma, then the property at the end of ipco.
    let out = spliceAndPatch(buffer, insertAt, association, [ipma.at, iprp.at, meta.at]);
    out.writeUInt8(buffer.readUInt8(countAt) + 1, countAt);

    out = spliceAndPatch(out, ipco.end, property, [ipco.at, iprp.at, meta.at]);

    return out;
}

/**
 * Appends a movie box — the third way a file says "animation", and the one a
 * reader that only looked at the brands would miss.
 *
 * Appended AFTER everything else, so no offset in the file moves and the
 * picture is byte-identical to the one that went in. The `mvhd` inside is a
 * real one (version 0, the 100-byte payload the document lists) so the box is
 * a movie box rather than four bytes of filler in a costume.
 */
function appendMoov(input) {
    const buffer = toBuffer(input);

    const mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(0, 0); // version 0, flags 0
    mvhd.writeUInt32BE(0, 4); // creation_time
    mvhd.writeUInt32BE(0, 8); // modification_time
    mvhd.writeUInt32BE(1000, 12); // timescale
    mvhd.writeUInt32BE(1000, 16); // duration — one second
    mvhd.writeUInt32BE(0x00010000, 20); // rate 1.0
    mvhd.writeUInt16BE(0x0100, 24); // volume 1.0
    // The unity matrix, which every file writes and no reader here reads.
    const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
    matrix.forEach((value, cell) => mvhd.writeUInt32BE(value, 36 + cell * 4));
    mvhd.writeUInt32BE(2, 96); // next_track_ID

    return Buffer.concat([buffer, box('moov', box('mvhd', mvhd))]);
}

/** The first `length` bytes — a download that stopped. */
function truncate(input, length) {
    const buffer = toBuffer(input);
    if (length < 0 || length > buffer.length) {
        throw new Error(`cannot truncate ${buffer.length} bytes to ${length}`);
    }
    return buffer.subarray(0, length);
}

/**
 * A valid ftyp, and then something that is not a box at all.
 *
 * The sniffer reads the first sixteen bytes, so this file is recognised as an
 * AVIF and then falls apart — which is the shape of a real damaged download
 * and the one case where "refuse it" and "read it anyway" are hardest to tell
 * apart from the outside.
 */
function garbageAfterFtyp(input, filler = 'not a box — this file stops making sense after its ftyp.') {
    const buffer = toBuffer(input);
    const { ftyp } = locate(buffer);
    const junk = Buffer.from(filler, 'latin1');
    return Buffer.concat([buffer.subarray(0, ftyp.end), junk]);
}

module.exports = {
    addCompatibleBrand,
    appendMoov,
    box,
    boxes,
    garbageAfterFtyp,
    imirProperty,
    insertItemProperty,
    irotProperty,
    setMajorBrand,
    shiftItemLocations,
    truncate,
};
