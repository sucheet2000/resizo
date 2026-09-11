/**
 * An AVIF/ISOBMFF reader written from the format's own documents — A TEST
 * HELPER, NOT PRODUCT CODE.
 *
 * IT NEVER IMPORTS ANYTHING FROM lib/, AND THAT IS THE WHOLE POINT. The engine
 * writes an AVIF and then reads its own file back to check it
 * (`lib/image-client/avif.js`). That check is worth having, but it can only
 * ever prove the writer agrees with the reader sitting next to it: one wrong
 * constant shared by both — an `ispe` read four bytes early, an `ipma`
 * association counted with the wrong index width, an alpha item found by
 * counting items instead of by reading its `auxC` — is invisible from inside.
 * This file is the second opinion, written from the documents rather than from
 * the code:
 *
 *   ISO/IEC 14496-12, ISO base media file format
 *     every box is  unsigned int(32) size; unsigned int(32) type;
 *                   if (size == 1) unsigned int(64) largesize;
 *                   if (type == 'uuid') unsigned int(8)[16] usertype;
 *     size == 0 means "to the end of the enclosing box".
 *     A FullBox adds unsigned int(8) version; bit(24) flags.
 *
 *   ISO/IEC 23008-12, HEIF — the item model this format is built on:
 *     'pitm' the primary item, 'iinf'/'infe' what each item is,
 *     'iloc' where its bytes are, 'iprp' { 'ipco' the properties,
 *     'ipma' which item has which }, 'iref' how items point at each other.
 *
 *   AV1 Image File Format, https://aomediacodec.github.io/av1-avif/
 *     the 'avif' and 'avis' brands, the 'av1C' configuration property, and
 *     the alpha URN below. Read 2026-09-11.
 *
 * WHAT IT REPORTS AND WHY EACH ONE EARNS ITS PLACE:
 *
 *   brand / compatibleBrands   'avis' anywhere is an animation, and an
 *                              animation has to be refused BEFORE a decoder
 *                              is handed 30 frames
 *   animated                   the same question asked once: either brand, or
 *                              a top-level 'moov'. A file can carry a movie
 *                              box and still say 'avif' in its ftyp
 *   width / height             from the primary item's 'ispe', which is what
 *                              a decoder sizes its surface from
 *   alpha                      the auxiliary item whose 'auxC' carries the
 *                              alpha URN — NOT "there are two items", which
 *                              is also true of a file with a depth map or a
 *                              gain map in it
 *   bitDepth / chroma          from 'av1C', so "10-bit source decoded to
 *                              8-bit" is a measurement rather than a hope
 *   rotation / mirrorAxis      'irot' / 'imir', the two transformative
 *                              properties a browser applies for you and a
 *                              WASM lane does not
 *   hasExif / hasXmp / hasIcc  the three ways metadata rides along, so
 *                              "nothing from the source is written" can be
 *                              checked rather than asserted
 *
 * WHAT IT THROWS ON, and why each is a fault rather than a curiosity:
 *
 *   fewer than 8 bytes                    not a box at all
 *   a first box that is not 'ftyp'        ISOBMFF requires it first
 *   a declared size below the header      two boxes over one byte
 *   a box that runs past its container    a truncated download
 *   an ftyp whose brand list is ragged    brands are four bytes each
 *   a property index with no property     an association pointing at nothing
 *
 * A fault is thrown rather than returned because a test asking "is this an
 * AVIF" wants the byte named. The ENGINE's reader returns null instead, on
 * purpose: a visitor's damaged file is an expected branch there, not an
 * incident.
 *
 * ON 'imir'. The two editions of HEIF word the axis field in opposite
 * directions, so this reader reports the RAW BIT as `mirrorAxis` and labels it
 * with the reading libavif implements (axis 0 exchanges top and bottom, axis 1
 * exchanges left and right). Any test that cares which way the picture went
 * asks libvips for the pixels rather than believing the label.
 *
 * CommonJS on purpose: the Playwright specs require it and the vitest suite
 * imports it, so a flow and a unit test cannot disagree about what "this file
 * has an alpha channel" means.
 */

/** ISO/IEC 14496-12: size (4) + type (4). */
const BOX_HEADER = 8;

/** The aux_type every AVIF alpha plane is tagged with — AV1-AVIF § 4. */
const AVIF_ALPHA_URN = 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha';

/** The brands that make a file an AVIF, and the one that makes it a sequence. */
const AVIF_BRANDS = ['avif', 'avis'];
const SEQUENCE_BRAND = 'avis';

/** Boxes whose payload is nothing but more boxes. */
const CONTAINERS = new Set(['meta', 'iprp', 'ipco', 'iinf', 'iref', 'moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);

/** Containers that are FullBoxes: four bytes of version and flags come first. */
const FULL_CONTAINERS = new Set(['meta', 'iinf', 'iref']);

function toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (input instanceof ArrayBuffer) return Buffer.from(input);
    if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) return Buffer.from(input);
    throw new Error(`parseAvif needs bytes, not ${input === null ? 'null' : typeof input}`);
}

const fourcc = (buffer, at) => buffer.subarray(at, at + 4).toString('latin1');

/** The first bytes as hex, so a "not an AVIF" failure says what it found. */
function head(bytes, count = 12) {
    return [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}

/**
 * Every box between `start` and `end`, one level deep.
 *
 * `body` is the payload after the header — after the version and flags too,
 * for the FullBox containers — so a caller reads fields at the offsets its
 * own document states rather than at offsets adjusted for a header.
 */
function boxesIn(buffer, start, end, where) {
    const boxes = [];
    let at = start;

    while (at < end) {
        if (at + BOX_HEADER > end) {
            throw new Error(`${where}: ${end - at} bytes left over — too few for a box header`);
        }

        let size = buffer.readUInt32BE(at);
        const type = fourcc(buffer, at + 4);
        let header = BOX_HEADER;

        if (size === 1) {
            if (at + 16 > end) throw new Error(`${where}: a largesize box with no largesize behind it`);
            size = Number(buffer.readBigUInt64BE(at + 8));
            header = 16;
        } else if (size === 0) {
            size = end - at;
        }

        if (type === 'uuid') header += 16;

        if (size < header) {
            throw new Error(`${where}: box "${type}" declares size ${size}, below its own ${header}-byte header`);
        }
        if (at + size > end) {
            throw new Error(
                `${where}: box "${type}" at ${at} runs to ${at + size}, past the end of the `
                + `${end}-byte region it sits in`,
            );
        }

        boxes.push({ type, at, size, header, body: at + header, end: at + size });
        at += size;
    }

    return boxes;
}

/** The children of a container box, with the FullBox prefix skipped where there is one. */
function childrenOf(buffer, box) {
    const skip = FULL_CONTAINERS.has(box.type) ? 4 : 0;
    // 'iinf' states how many entries follow before the entries themselves: a
    // 16-bit count in version 0, a 32-bit one after that.
    const extra = box.type === 'iinf' ? (buffer[box.body] === 0 ? 2 : 4) : 0;
    return boxesIn(buffer, box.body + skip + extra, box.end, box.type);
}

const findBox = (boxes, type) => boxes.find((box) => box.type === type) ?? null;

/* ------------------------------------------------------------------ *
 * The individual boxes
 * ------------------------------------------------------------------ */

/** ImageSpatialExtentsProperty — ISO/IEC 23008-12 § 6.5.3. */
function readIspe(buffer, box) {
    return { width: buffer.readUInt32BE(box.body + 4), height: buffer.readUInt32BE(box.body + 8) };
}

/** PixelInformationProperty — a channel count and one depth per channel. */
function readPixi(buffer, box) {
    const channels = buffer.readUInt8(box.body + 4);
    const depths = [];
    for (let index = 0; index < channels; index += 1) depths.push(buffer.readUInt8(box.body + 5 + index));
    return { channels, depths };
}

/**
 * AV1CodecConfigurationBox — AV1-AVIF § 2.2.1, which quotes the AV1 codec
 * ISOBMFF binding:
 *
 *   marker (1) version (7)
 *   seq_profile (3) seq_level_idx_0 (5)
 *   seq_tier_0 (1) high_bitdepth (1) twelve_bit (1) monochrome (1)
 *   chroma_subsampling_x (1) chroma_subsampling_y (1) chroma_sample_position (2)
 *
 * Not a FullBox: the payload starts straight after the header.
 */
function readAv1C(buffer, box) {
    const marker = buffer.readUInt8(box.body);
    const second = buffer.readUInt8(box.body + 1);
    const third = buffer.readUInt8(box.body + 2);

    const highBitDepth = (third & 0x40) !== 0;
    const twelveBit = (third & 0x20) !== 0;
    const monochrome = (third & 0x10) !== 0;
    const subsamplingX = (third & 0x08) !== 0 ? 1 : 0;
    const subsamplingY = (third & 0x04) !== 0 ? 1 : 0;

    let chroma;
    if (monochrome) chroma = '4:0:0';
    else if (subsamplingX === 1 && subsamplingY === 1) chroma = '4:2:0';
    else if (subsamplingX === 1 && subsamplingY === 0) chroma = '4:2:2';
    else chroma = '4:4:4';

    return {
        marker: (marker & 0x80) !== 0,
        version: marker & 0x7F,
        seqProfile: (second & 0xE0) >> 5,
        seqLevelIdx0: second & 0x1F,
        highBitDepth,
        twelveBit,
        monochrome,
        chroma,
        bitDepth: highBitDepth ? (twelveBit ? 12 : 10) : 8,
    };
}

/** AuxiliaryTypeProperty — a FullBox holding a null-terminated URN. */
function readAuxC(buffer, box) {
    const start = box.body + 4;
    let end = start;
    while (end < box.end && buffer[end] !== 0) end += 1;
    return { auxType: buffer.subarray(start, end).toString('latin1') };
}

/** ImageRotation — six reserved bits and a two-bit anti-clockwise quarter turn. */
const readIrot = (buffer, box) => ({ angle: (buffer.readUInt8(box.body) & 0x03) * 90 });

/** ImageMirror — seven reserved bits and one axis bit. See the note at the top. */
const readImir = (buffer, box) => {
    const axis = buffer.readUInt8(box.body) & 0x01;
    return { axis, exchanges: axis === 0 ? 'top-bottom' : 'left-right' };
};

/** ColourInformationBox — an on-the-wire CICP triple, or an embedded profile. */
function readColr(buffer, box) {
    const colourType = fourcc(buffer, box.body);
    if (colourType === 'nclx') {
        return {
            colourType,
            primaries: buffer.readUInt16BE(box.body + 4),
            transfer: buffer.readUInt16BE(box.body + 6),
            matrix: buffer.readUInt16BE(box.body + 8),
            fullRange: (buffer.readUInt8(box.body + 10) & 0x80) !== 0,
        };
    }
    return { colourType, profileBytes: box.end - (box.body + 4) };
}

const PROPERTY_READERS = {
    ispe: readIspe,
    pixi: readPixi,
    av1C: readAv1C,
    auxC: readAuxC,
    irot: readIrot,
    imir: readImir,
    colr: readColr,
};

/** ItemInfoEntry — version 2 and 3 are the ones HEIF items use. */
function readInfe(buffer, box) {
    const version = buffer.readUInt8(box.body);
    let at = box.body + 4;

    let id;
    if (version === 2) {
        id = buffer.readUInt16BE(at);
        at += 2;
    } else if (version === 3) {
        id = buffer.readUInt32BE(at);
        at += 4;
    } else {
        throw new Error(`infe: version ${version} is not the item-based form this format uses`);
    }

    at += 2; // item_protection_index
    const type = fourcc(buffer, at);
    at += 4;

    const readString = () => {
        let end = at;
        while (end < box.end && buffer[end] !== 0) end += 1;
        const value = buffer.subarray(at, end).toString('utf8');
        at = end + 1;
        return value;
    };

    const name = readString();
    // A 'mime' item states what it holds; an XMP packet is the one that matters
    // here, and it is recognised by its content type rather than by its name.
    const contentType = type === 'mime' ? readString() : null;

    return { id, type, name, contentType };
}

/** ItemPropertyAssociation — the map from item to the 1-based ipco index. */
function readIpma(buffer, box) {
    const version = buffer.readUInt8(box.body);
    const flags = buffer.readUIntBE(box.body + 1, 3);
    const wideIndex = (flags & 1) === 1;

    let at = box.body + 4;
    const count = buffer.readUInt32BE(at);
    at += 4;

    const associations = new Map();

    for (let entry = 0; entry < count; entry += 1) {
        let id;
        if (version < 1) {
            id = buffer.readUInt16BE(at);
            at += 2;
        } else {
            id = buffer.readUInt32BE(at);
            at += 4;
        }

        const associationCount = buffer.readUInt8(at);
        at += 1;

        const list = [];
        for (let index = 0; index < associationCount; index += 1) {
            if (wideIndex) {
                const value = buffer.readUInt16BE(at);
                list.push({ essential: (value & 0x8000) !== 0, index: value & 0x7FFF });
                at += 2;
            } else {
                const value = buffer.readUInt8(at);
                list.push({ essential: (value & 0x80) !== 0, index: value & 0x7F });
                at += 1;
            }
        }

        associations.set(id, list);
    }

    return associations;
}

/** ItemReferenceBox — one box per reference type, from one item to several. */
function readIref(buffer, box) {
    const version = buffer.readUInt8(box.body);
    const references = [];

    for (const child of childrenOf(buffer, box)) {
        let at = child.body;
        const readId = () => {
            if (version === 0) {
                const value = buffer.readUInt16BE(at);
                at += 2;
                return value;
            }
            const value = buffer.readUInt32BE(at);
            at += 4;
            return value;
        };

        const from = readId();
        const count = buffer.readUInt16BE(at);
        at += 2;

        const to = [];
        for (let index = 0; index < count; index += 1) to.push(readId());

        references.push({ type: child.type, from, to });
    }

    return references;
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

/**
 * Reads an AVIF and reports everything in it, or throws naming the fault.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|number[]} input  the file's bytes
 * @returns {{
 *   bytes: number,
 *   brand: string, minorVersion: number, compatibleBrands: string[],
 *   topLevel: string[], animated: boolean, hasMoov: boolean,
 *   primaryItemId: number|null,
 *   items: Array<object>, primary: object|null, alpha: object|null,
 *   alphaLinkedToPrimary: boolean, hasAlpha: boolean,
 *   width: number|null, height: number|null,
 *   bitDepth: number|null, chroma: string|null,
 *   rotation: number, mirrorAxis: number|null, mirror: string|null,
 *   hasExif: boolean, hasXmp: boolean, hasIcc: boolean, hasNclx: boolean,
 *   itemReferences: Array<{type: string, from: number, to: number[]}>,
 * }}
 */
function parseAvif(input) {
    const buffer = toBuffer(input);

    if (buffer.length < BOX_HEADER) {
        throw new Error(`not an AVIF: ${buffer.length} bytes is too short to hold a box header`);
    }

    // Asked BEFORE the walk rather than after it. A JPEG read as a box tree
    // produces a size field of four megabytes and a complaint about a region
    // it overruns, which tells a reader nothing; "there is no ftyp here, the
    // file starts ff d8 ff e0" tells them what they are holding.
    if (fourcc(buffer, 4) !== 'ftyp') {
        throw new Error(`not an AVIF: no ftyp at offset 4 — the file starts ${head(buffer)}`);
    }

    const topLevel = boxesIn(buffer, 0, buffer.length, 'file');
    const ftyp = topLevel[0];

    const brand = fourcc(buffer, ftyp.body);
    const minorVersion = buffer.readUInt32BE(ftyp.body + 4);
    const brandBytes = ftyp.end - (ftyp.body + 8);

    if (brandBytes < 0 || brandBytes % 4 !== 0) {
        throw new Error(`ftyp: ${brandBytes} bytes of compatible brands is not a whole number of four-byte codes`);
    }

    const compatibleBrands = [];
    for (let at = ftyp.body + 8; at < ftyp.end; at += 4) compatibleBrands.push(fourcc(buffer, at));

    const hasMoov = topLevel.some((box) => box.type === 'moov');
    const animated = brand === SEQUENCE_BRAND || compatibleBrands.includes(SEQUENCE_BRAND) || hasMoov;

    const meta = findBox(topLevel, 'meta');
    const result = {
        bytes: buffer.length,
        brand,
        minorVersion,
        compatibleBrands,
        topLevel: topLevel.map((box) => box.type),
        animated,
        hasMoov,
        primaryItemId: null,
        items: [],
        primary: null,
        alpha: null,
        alphaLinkedToPrimary: false,
        hasAlpha: false,
        width: null,
        height: null,
        bitDepth: null,
        chroma: null,
        rotation: 0,
        mirrorAxis: null,
        mirror: null,
        hasExif: false,
        hasXmp: false,
        hasIcc: false,
        hasNclx: false,
        itemReferences: [],
    };

    if (!meta) {
        throw new Error(`not an AVIF still: no meta box among ${result.topLevel.join(', ')}`);
    }

    const metaChildren = childrenOf(buffer, meta);

    const pitm = findBox(metaChildren, 'pitm');
    if (pitm) {
        const version = buffer.readUInt8(pitm.body);
        result.primaryItemId = version === 0 ? buffer.readUInt16BE(pitm.body + 4) : buffer.readUInt32BE(pitm.body + 4);
    }

    const iinf = findBox(metaChildren, 'iinf');
    const entries = iinf
        ? childrenOf(buffer, iinf).filter((box) => box.type === 'infe').map((box) => readInfe(buffer, box))
        : [];

    const iprp = findBox(metaChildren, 'iprp');
    const ipco = iprp ? findBox(boxesIn(buffer, iprp.body, iprp.end, 'iprp'), 'ipco') : null;
    const properties = ipco
        ? childrenOf(buffer, ipco).map((box, index) => ({
            index: index + 1,
            type: box.type,
            ...(PROPERTY_READERS[box.type] ? PROPERTY_READERS[box.type](buffer, box) : {}),
        }))
        : [];

    const ipma = iprp ? findBox(boxesIn(buffer, iprp.body, iprp.end, 'iprp'), 'ipma') : null;
    const associations = ipma ? readIpma(buffer, ipma) : new Map();

    const iref = findBox(metaChildren, 'iref');
    result.itemReferences = iref ? readIref(buffer, iref) : [];

    result.items = entries.map((entry) => {
        const list = associations.get(entry.id) ?? [];
        const owned = list.map(({ index, essential }) => {
            const property = properties[index - 1];
            if (!property) {
                throw new Error(`ipma: item ${entry.id} claims property ${index}, and there are only ${properties.length}`);
            }
            return { ...property, essential };
        });

        const byType = (type) => owned.find((property) => property.type === type) ?? null;

        return {
            ...entry,
            properties: owned,
            ispe: byType('ispe') ? { width: byType('ispe').width, height: byType('ispe').height } : null,
            pixi: byType('pixi'),
            av1C: byType('av1C'),
            auxC: byType('auxC'),
            irot: byType('irot'),
            imir: byType('imir'),
            colr: byType('colr'),
        };
    });

    result.primary = result.items.find((item) => item.id === result.primaryItemId) ?? null;

    result.alpha = result.items.find(
        (item) => item.auxC && item.auxC.auxType === AVIF_ALPHA_URN,
    ) ?? null;
    result.hasAlpha = result.alpha !== null;
    result.alphaLinkedToPrimary = result.alpha !== null && result.itemReferences.some(
        (reference) => reference.type === 'auxl'
            && reference.from === result.alpha.id
            && reference.to.includes(result.primaryItemId),
    );

    if (result.primary) {
        if (result.primary.ispe) {
            result.width = result.primary.ispe.width;
            result.height = result.primary.ispe.height;
        }
        if (result.primary.av1C) {
            result.bitDepth = result.primary.av1C.bitDepth;
            result.chroma = result.primary.av1C.chroma;
        }
        if (result.primary.irot) result.rotation = result.primary.irot.angle;
        if (result.primary.imir) {
            result.mirrorAxis = result.primary.imir.axis;
            result.mirror = result.primary.imir.exchanges;
        }
        if (result.primary.colr) {
            result.hasNclx = result.primary.colr.colourType === 'nclx';
            result.hasIcc = ['rICC', 'prof'].includes(result.primary.colr.colourType);
        }
    }

    result.hasExif = result.items.some((item) => item.type === 'Exif');
    result.hasXmp = result.items.some(
        (item) => item.type === 'mime' && /rdf\+xml/i.test(item.contentType ?? ''),
    );

    return result;
}

/**
 * `parseAvif`, plus the things an AVIF this product wrote or accepted must
 * also be true of.
 *
 * Kept separate because they are different questions. An animated AVIF is a
 * legal file and a wrong Resizo output; a parser that refused to read one
 * could not tell a test which of the two it was looking at.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|number[]} input  the file's bytes
 * @param {{ width?: number, height?: number, alpha?: boolean, bitDepth?: number }} [expected]
 */
function assertAvif(input, { width, height, alpha, bitDepth } = {}) {
    const avif = parseAvif(input);

    if (!AVIF_BRANDS.includes(avif.brand) && !avif.compatibleBrands.some((code) => AVIF_BRANDS.includes(code))) {
        throw new Error(
            `not an AVIF: major brand "${avif.brand}", compatible brands ${avif.compatibleBrands.join(', ') || 'none'}`,
        );
    }

    if (avif.animated) {
        throw new Error(
            `this file is an animated AVIF: brand "${avif.brand}", compatible brands `
            + `${avif.compatibleBrands.join(', ')}${avif.hasMoov ? ', and a top-level moov' : ''}`,
        );
    }

    if (!avif.primary) throw new Error('the AVIF has no primary item — nothing to decode');
    if (avif.width === null) throw new Error(`item ${avif.primaryItemId} has no ispe, so the file states no size`);

    if (width !== undefined && height !== undefined && (avif.width !== width || avif.height !== height)) {
        throw new Error(`the AVIF holds ${avif.width} × ${avif.height} — expected ${width} × ${height}`);
    }

    if (alpha !== undefined && avif.hasAlpha !== alpha) {
        throw new Error(
            alpha
                ? 'the AVIF carries no alpha auxiliary item — the transparency did not survive'
                : `the AVIF carries an alpha auxiliary item (item ${avif.alpha.id}) and was not expected to`,
        );
    }

    if (bitDepth !== undefined && avif.bitDepth !== bitDepth) {
        throw new Error(`the AVIF is ${avif.bitDepth}-bit — expected ${bitDepth}-bit`);
    }

    return avif;
}

module.exports = {
    parseAvif,
    assertAvif,
    boxesIn,
    AVIF_ALPHA_URN,
    AVIF_BRANDS,
    SEQUENCE_BRAND,
    BOX_HEADER,
    CONTAINERS,
};
