/**
 * What an AVIF file DECLARES, read from its own boxes.
 *
 * AVIF is an ISOBMFF container — the same box grammar as MP4 and HEIC — with
 * the picture stored as one or more AV1 items described by a `meta` box. This
 * reader walks that grammar and nothing else. It never decodes a pixel, never
 * loads a codec and never allocates more than the bytes it was handed.
 *
 * THREE THINGS DEPEND ON IT, AND ALL THREE ARE VISIBLE TO A PERSON.
 *
 *  1. ANIMATION HAS TO BE REFUSED BEFORE THE DECODE. `createImageBitmap` on an
 *     animated AVIF succeeds in every engine and hands back the first frame, so
 *     a browser will happily turn a three-second clip into a still JPEG and
 *     report success. The refusal keys on the `avis` brand or a top-level
 *     `moov`, both of which are readable in the first few hundred bytes.
 *
 *  2. THE ENGINE'S OWN CLAIM ABOUT ITS OUTPUT NEEDS AN INDEPENDENT WITNESS.
 *     After an AVIF encode, operations.js checks the finished bytes against
 *     what it asked for using this reader — which shares no code with the
 *     encoder, so it cannot agree with it by construction. Same reasoning as
 *     lib/image-client/image-size.js, which is where the AVIF branch of
 *     `readImageSize` gets its answer from.
 *
 *  3. A 10-BIT SOURCE IS DECODED TO 8-BIT AND THE RESULT PANEL SAYS SO. The
 *     browser's decoder normalises depth silently; `bitDepth` here is the only
 *     place that fact can be recovered from.
 *
 * IT NEVER THROWS PAST ITS OWN BOUNDARY, and a file it cannot make sense of
 * reads as `null`. Every caller is asking about a file it has been given no
 * promises about — that is the same contract image-size.js keeps.
 *
 * WHAT `null` MEANS, PRECISELY. `null` is "these bytes are not a readable
 * ISOBMFF file": no `ftyp` at the front, a box type that is not four printable
 * characters, or a box declaring a size smaller than its own header. A file
 * whose `ftyp` reads fine but whose `meta` is cut short is NOT null — the
 * brands really are what they say — and it reports `width: null` instead, which
 * decode.js turns into the damaged-file sentence once the decoder agrees.
 *
 * Pure: imports nothing, allocates nothing but small strings, and is safe to
 * call on a prefix.
 */

/**
 * How many bytes off the front are enough to answer every question here.
 *
 * `meta` precedes `mdat` in every AVIF this site meets — libavif, libheif and
 * every browser's own writer emit it that way — and a still image's `meta` box
 * measured 214 bytes for a 61x43 picture and 368 with an alpha plane. 256 KB is
 * that with four orders of magnitude of headroom, and it is a bound rather than
 * a measurement: the point is that a 20 MB photograph is never copied to learn
 * how wide it is.
 */
export const AVIF_HEADER_SCAN_BYTES = 256 * 1024;

/**
 * The two sentences an AVIF can be refused with before anything decodes it.
 * Stated once, here, because the intake hook and the engine both refuse on
 * the same header read and a visitor must meet one wording for one fault.
 */
export const AVIF_ANIMATED_MESSAGE = 'Animated AVIF is not supported yet.';
export const AVIF_DAMAGED_MESSAGE = 'This AVIF file is damaged or incomplete and could not be read.';

/**
 * Box-walk safety rails. An ISOBMFF file is a tree of length-prefixed boxes,
 * and a malformed one can describe a cycle-shaped structure that a naive walker
 * follows forever. Neither number is a format limit — a real still AVIF uses a
 * handful of boxes and three levels — they are the point past which the file is
 * not something this build is going to open anyway.
 */
const MAX_BOXES = 512;
const MAX_DEPTH = 6;

/** The container boxes worth descending into. Everything else is skipped whole. */
const CONTAINERS = new Set(['meta', 'iprp', 'ipco', 'iinf']);

/**
 * Boxes that are FullBoxes carrying children: the four header bytes (a version
 * and three flag bytes) sit between the box header and the first child.
 */
const FULL_BOX_CONTAINERS = new Set(['meta', 'iinf']);

/** The aux type every alpha plane in an AVIF declares. */
const ALPHA_AUX_URN = 'urn:mpeg:mpegB:cicp:systems:auxiliary:alpha';

function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return null;
}

function big16(bytes, at) {
    return (bytes[at] << 8) | bytes[at + 1];
}

function big32(bytes, at) {
    return ((bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]);
}

function ascii(bytes, at, length) {
    let out = '';
    for (let index = at; index < at + length; index += 1) out += String.fromCharCode(bytes[index]);
    return out;
}

/** A NUL-terminated string starting at `at`, bounded by `end`. */
function cString(bytes, at, end) {
    let out = '';
    for (let index = at; index < end; index += 1) {
        if (bytes[index] === 0) break;
        out += String.fromCharCode(bytes[index]);
    }
    return out;
}

/**
 * A box type is four characters. Requiring them to be printable is what turns
 * "random bytes where a box should be" into a refusal instead of a walk over
 * whatever the noise happened to encode — the difference between reporting a
 * damaged file and reporting a picture that does not exist.
 */
function isBoxType(type) {
    for (let index = 0; index < type.length; index += 1) {
        const code = type.charCodeAt(index);
        if (code < 0x20 || code > 0x7E) return false;
    }
    return type.length === 4;
}

/** Raised inside the walk and caught at the boundary. Never escapes. */
const MALFORMED = Symbol('avif-malformed');

/**
 * Walks the boxes between `start` and `end`, calling `visit` with each.
 *
 * A box whose declared size runs past `end` STOPS the walk rather than failing
 * it: that is what the end of a bounded prefix looks like, and it is also what
 * a half-downloaded file looks like. A box that is structurally impossible —
 * a size below its own header, a type that is not four printable characters —
 * throws MALFORMED, because no amount of further reading makes those bytes into
 * a file.
 */
function walk(bytes, start, end, depth, state, visit) {
    if (depth > MAX_DEPTH) return;

    let at = start;

    while (at + 8 <= end) {
        state.boxes += 1;
        if (state.boxes > MAX_BOXES) return;

        let size = big32(bytes, at);
        const type = ascii(bytes, at + 4, 4);
        let headerSize = 8;

        if (!isBoxType(type)) throw MALFORMED;

        if (size === 1) {
            // A 64-bit size. Anything past 2^32 is not a file a tab can open,
            // so the high word must be zero for this to be readable at all.
            if (at + 16 > end) return;
            if (big32(bytes, at + 8) !== 0) return;
            size = big32(bytes, at + 12);
            headerSize = 16;
        } else if (size === 0) {
            // "To the end of the file" — only ever the last box.
            size = end - at;
        }

        if (size < headerSize) throw MALFORMED;
        if (at + size > end) {
            // Truncated here. What has been read so far still stands.
            visit(type, at + headerSize, Math.min(at + size, end), true);
            return;
        }

        visit(type, at + headerSize, at + size, false);
        at += size;
    }
}

/** Descends into a container box, accounting for the FullBox header. */
function descend(bytes, type, contentStart, contentEnd, depth, state, visit) {
    let start = contentStart;

    if (FULL_BOX_CONTAINERS.has(type)) {
        // version + flags, then (for iinf) a 16- or 32-bit entry count.
        if (start + 4 > contentEnd) return;
        const version = bytes[start];
        start += 4;
        if (type === 'iinf') start += version === 0 ? 2 : 4;
    }

    walk(bytes, start, contentEnd, depth + 1, state, visit);
}

/* ----------------------------------------------------------- properties */

/**
 * `ipco` holds the properties in order and `ipma` refers to them by a 1-based
 * index, so the container is collected as a plain list first and resolved
 * against the primary item afterwards. Reading the first `av1C` in the list
 * instead would report the ALPHA plane's codec configuration — monochrome,
 * 4:0:0 — as the picture's, which is exactly the bug this indirection exists to
 * avoid.
 */
function readProperty(bytes, type, start, end) {
    if (type === 'ispe' && start + 12 <= end) {
        return { type, width: big32(bytes, start + 4), height: big32(bytes, start + 8) };
    }

    if (type === 'pixi' && start + 5 <= end) {
        return { type, depth: bytes[start + 5] ?? null };
    }

    if (type === 'av1C' && start + 4 <= end) {
        const flags = bytes[start + 2];
        const highBitDepth = (flags >> 6) & 1;
        const twelveBit = (flags >> 5) & 1;
        const monochrome = (flags >> 4) & 1;
        const subsamplingX = (flags >> 3) & 1;
        const subsamplingY = (flags >> 2) & 1;

        let chroma = '4:4:4';
        if (monochrome) chroma = '4:0:0';
        else if (subsamplingX && subsamplingY) chroma = '4:2:0';
        else if (subsamplingX) chroma = '4:2:2';

        let bitDepth = 8;
        if (highBitDepth) bitDepth = twelveBit ? 12 : 10;

        return { type, chroma, bitDepth };
    }

    if (type === 'irot' && start < end) {
        return { type, rotation: (bytes[start] & 0x03) * 90 };
    }

    if (type === 'imir' && start < end) {
        // ISO 23008-12: axis 0 mirrors about a horizontal axis (a vertical
        // flip), axis 1 about a vertical one.
        return { type, mirror: (bytes[start] & 0x01) === 0 ? 'vertical' : 'horizontal' };
    }

    if (type === 'colr' && start + 4 <= end) {
        const colourType = ascii(bytes, start, 4);
        return { type, icc: colourType === 'prof' || colourType === 'rICC', nclx: colourType === 'nclx' };
    }

    if (type === 'auxC' && start + 4 <= end) {
        return { type, aux: cString(bytes, start + 4, end) };
    }

    return { type };
}

/**
 * `ipma` — which properties belong to which item.
 *
 * FullBox: version and flags, then an entry count, then per entry an item id
 * (16-bit under version 0, 32-bit above it) and a run of association bytes. The
 * low bit of `flags` widens each association from 7 bits to 15; the top bit is
 * "essential" and is not an index, so it is masked off either way.
 */
function readItemProperties(bytes, start, end) {
    const associations = new Map();
    if (start + 8 > end) return associations;

    const version = bytes[start];
    const flags = (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
    const wideIndexes = (flags & 1) === 1;

    let at = start + 4;
    const entryCount = big32(bytes, at);
    at += 4;

    for (let entry = 0; entry < entryCount; entry += 1) {
        if (at + (version < 1 ? 2 : 4) + 1 > end) break;

        const itemId = version < 1 ? big16(bytes, at) : big32(bytes, at);
        at += version < 1 ? 2 : 4;

        const count = bytes[at];
        at += 1;

        const indexes = [];
        for (let association = 0; association < count; association += 1) {
            if (at + (wideIndexes ? 2 : 1) > end) return associations;
            indexes.push(wideIndexes ? (big16(bytes, at) & 0x7FFF) : (bytes[at] & 0x7F));
            at += wideIndexes ? 2 : 1;
        }

        associations.set(itemId, indexes);
    }

    return associations;
}

/** `pitm` — which item is the picture. FullBox, then a 16- or 32-bit id. */
function readPrimaryItem(bytes, start, end) {
    if (start + 6 > end) return null;
    const version = bytes[start];
    return version === 0 ? big16(bytes, start + 4) : big32(bytes, start + 4);
}

/**
 * `infe` — one item's id and what kind of thing it is.
 *
 * Version 2 and 3 are the only ones AVIF uses: id, protection index, a
 * four-character item type, then a NUL-terminated name. A `mime` item also
 * carries its content type, which is how an XMP packet is told from anything
 * else stored the same way.
 */
function readItemInfo(bytes, start, end) {
    if (start + 8 > end) return null;

    const version = bytes[start];
    let at = start + 4;

    if (version !== 2 && version !== 3) return null;

    const itemId = version === 2 ? big16(bytes, at) : big32(bytes, at);
    at += version === 2 ? 2 : 4;
    at += 2; // protection index

    if (at + 4 > end) return null;
    const itemType = ascii(bytes, at, 4);
    at += 4;

    const name = cString(bytes, at, end);
    const contentType = itemType === 'mime' ? cString(bytes, at + name.length + 1, end) : '';

    return { itemId, itemType, contentType };
}

/* --------------------------------------------------------------- public */

/**
 * What an AVIF declares about itself.
 *
 * @param {Uint8Array|ArrayBuffer} input  the whole file, or a prefix of at
 *   least AVIF_HEADER_SCAN_BYTES
 * @returns {{
 *   brand: string,
 *   compatibleBrands: string[],
 *   animated: boolean,
 *   width: number|null,
 *   height: number|null,
 *   alpha: boolean,
 *   bitDepth: number|null,
 *   chroma: '4:4:4'|'4:2:2'|'4:2:0'|'4:0:0'|null,
 *   rotation: 0|90|180|270,
 *   mirror: null|'horizontal'|'vertical',
 *   hasExif: boolean,
 *   hasXmp: boolean,
 *   hasIcc: boolean,
 *   hasNclx: boolean,
 * }|null} null when the bytes are not a readable ISOBMFF file
 */
export function readAvifHeader(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length < 16) return null;

    const state = { boxes: 0 };

    let brand = '';
    const compatibleBrands = [];
    let animated = false;
    let primaryItem = null;
    let associations = new Map();
    const properties = [];
    const items = new Map();
    const alphaItems = new Set();

    try {
        if (ascii(bytes, 4, 4) !== 'ftyp') return null;

        walk(bytes, 0, bytes.length, 0, state, (type, start, end, truncated) => {
            if (type === 'ftyp') {
                if (truncated || start + 8 > end) throw MALFORMED;
                brand = ascii(bytes, start, 4);
                for (let at = start + 8; at + 4 <= end; at += 4) {
                    compatibleBrands.push(ascii(bytes, at, 4));
                }
                return;
            }

            // An animated AVIF is a movie wearing an image's clothes: the frames
            // live in a `moov`/`mdat` pair exactly as they would in an MP4.
            // Either signal is enough on its own.
            if (type === 'moov') {
                animated = true;
                return;
            }

            if (type !== 'meta') return;

            descend(bytes, 'meta', start, end, 0, state, (metaType, metaStart, metaEnd) => {
                if (metaType === 'pitm') {
                    primaryItem = readPrimaryItem(bytes, metaStart, metaEnd);
                    return;
                }

                if (metaType === 'iinf') {
                    descend(bytes, 'iinf', metaStart, metaEnd, 1, state, (infeType, infeStart, infeEnd) => {
                        if (infeType !== 'infe') return;
                        const info = readItemInfo(bytes, infeStart, infeEnd);
                        if (info) items.set(info.itemId, info);
                    });
                    return;
                }

                if (metaType !== 'iprp') return;

                walk(bytes, metaStart, metaEnd, 2, state, (iprpType, iprpStart, iprpEnd) => {
                    if (iprpType === 'ipma') {
                        associations = readItemProperties(bytes, iprpStart, iprpEnd);
                        return;
                    }
                    if (iprpType !== 'ipco') return;

                    walk(bytes, iprpStart, iprpEnd, 3, state, (propType, propStart, propEnd) => {
                        properties.push(readProperty(bytes, propType, propStart, propEnd));
                    });
                });
            });
        });
    } catch (error) {
        if (error === MALFORMED) return null;
        // A reader that shares no code with the pipeline is also a reader with
        // nobody to hand an exception to. Anything unexpected reads as "cannot
        // be read", which is the same answer every other branch gives.
        return null;
    }

    if (brand === '') return null;

    if (brand.toLowerCase() === 'avis') animated = true;
    if (compatibleBrands.some((entry) => entry.toLowerCase() === 'avis')) animated = true;

    // Which items carry an alpha plane. The association is read for every item
    // rather than only the primary one, because the alpha plane is a SEPARATE
    // item that points back at the picture through an `auxl` reference.
    for (const [itemId, indexes] of associations) {
        for (const index of indexes) {
            const property = properties[index - 1];
            if (property?.type === 'auxC' && property.aux === ALPHA_AUX_URN) alphaItems.add(itemId);
        }
    }

    const primaryIndexes = primaryItem === null
        ? (associations.values().next().value ?? [])
        : (associations.get(primaryItem) ?? []);
    const primaryProperties = primaryIndexes
        .map((index) => properties[index - 1])
        .filter(Boolean);

    const find = (type) => primaryProperties.find((property) => property.type === type) ?? null;

    const ispe = find('ispe');
    const av1C = find('av1C');
    const irot = find('irot');
    const imir = find('imir');
    const colr = find('colr');

    return {
        brand,
        compatibleBrands,
        animated,
        width: ispe?.width ?? null,
        height: ispe?.height ?? null,
        alpha: alphaItems.size > 0,
        bitDepth: av1C?.bitDepth ?? null,
        chroma: av1C?.chroma ?? null,
        rotation: irot?.rotation ?? 0,
        mirror: imir?.mirror ?? null,
        hasExif: [...items.values()].some((item) => item.itemType === 'Exif'),
        hasXmp: [...items.values()].some(
            (item) => item.itemType === 'mime' && item.contentType.includes('xmp'),
        ),
        hasIcc: Boolean(colr?.icc),
        hasNclx: Boolean(colr?.nclx),
    };
}
