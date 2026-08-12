/**
 * EXIF Orientation
 *
 * A phone taking a portrait photo does not rotate the sensor. It writes the
 * pixels out in the sensor's own landscape order and adds one small number —
 * EXIF tag 0x0112, Orientation — telling whoever displays it how far to turn it.
 * Every viewer honours that number, so the file looks upright everywhere and
 * nobody ever notices the pixels are sideways.
 *
 * This engine throws every byte of metadata away. That is deliberate and it is
 * the whole privacy promise: an EXIF block carries the camera, the timestamp
 * and, on a phone, the GPS coordinates of the user's home. But dropping the
 * block drops the Orientation tag with it, and the moment that number is gone
 * the sideways pixels are all that is left. Removing the tag and ignoring it are
 * only safe together — which is exactly the bug PR #10 fixed on the server, by
 * adding `.rotate()` to lib/image/pipeline.js. This module is that fix for the
 * code that runs in the tab.
 *
 * WHO NEEDS IT, MEASURED PATH BY PATH
 *
 *   NATIVE   createImageBitmap applies the tag itself. Measured in Chromium
 *            against all eight values: upright pixels and swapped dimensions,
 *            with the option and without it, and the turn happens BEFORE any
 *            requested resize. decode.js pins `imageOrientation: 'from-image'`
 *            so that is a decision rather than a default we happen to be
 *            inheriting. Nothing in this module runs on that route.
 *
 *   WASM     @jsquash/jpeg does NOT turn the pixels. Its `defaultDecodeOptions`
 *            are `{ preserveOrientation: false }`, and decoding an Orientation-6
 *            fixture at that default was measured returning a 40x20 buffer where
 *            upright is 20x40. This module is what makes that path agree with
 *            the other two. The package's own `preserveOrientation: true` would
 *            also work for JPEG, but it is a per-codec flag that turns the image
 *            inside the WASM heap; one implementation here can be unit tested
 *            without a browser and reused by any decoder added later.
 *
 *   HEIC     libheif applies the container's transform without being asked.
 *            Measured: heif-enc turned Exif orientations 1/2/4/6/8 into `irot`
 *            and `imir` boxes, and libheif-js decoded those files back to
 *            upright pixels with swapped dimensions on its own. The HEIC path
 *            must therefore NOT call this module — a second turn on top of
 *            libheif's would be wrong in a way no test on the server would catch.
 *
 * JPEG ONLY, ON PURPOSE
 *
 * A PNG (`eXIf` chunk) and a WebP (`EXIF` RIFF chunk) can both legally carry an
 * Orientation tag, and this reader ignores both. Browsers do not agree about
 * honouring them, so applying one here would make the WASM fallback disagree
 * with the browser's own decoder for the same file — inventing a new
 * inconsistency rather than closing the existing one. In practice the tag on
 * those formats is vanishingly rare; on JPEG it is on nearly every phone photo,
 * every browser applies it, and so does sharp. Widening this beyond JPEG is only
 * safe alongside a decision about what the native path should do, which is a
 * product question, not a parsing one.
 *
 * Nothing in here imports anything. It is plain arithmetic over bytes so it can
 * be unit tested in Node with no browser, no codec and no canvas.
 */

/** The tag that needs no turning, and what an unreadable file is treated as. */
export const ORIENTATION_NONE = 1;

/** TIFF tag 0x0112. The single number this whole module exists to find. */
export const ORIENTATION_TAG = 0x0112;

/** TIFF type 3, SHORT. An Orientation of any other type is not one. */
const TIFF_TYPE_SHORT = 3;

/**
 * How much of a file the reader needs.
 *
 * An Exif APP1 segment is length-prefixed with 16 bits, so it can never exceed
 * 65533 bytes, and it is written near the front — after at most a JFIF APP0 and
 * whatever else a camera puts first. 128 KB is double the largest legal segment
 * and lets a caller read a fixed head of the file instead of pulling 20 MB into
 * memory to find two bytes.
 */
export const EXIF_SCAN_BYTES = 128 * 1024;

/* ----------------------------------------------------------------- input */

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

/* ---------------------------------------------------------------- reader */

/**
 * The Orientation value inside one Exif APP1 payload.
 *
 * `start` points at the 'E' of "Exif\0\0"; the TIFF header begins six bytes
 * later and every offset inside the block is relative to THAT, not to the file.
 * Getting that base wrong is the classic way to read a plausible-looking number
 * out of the wrong place, so it is computed once and never re-derived.
 */
function orientationFromExifPayload(bytes, start, end) {
    const tiff = start + 6;
    if (tiff + 8 > end) return ORIENTATION_NONE;

    const marker = (bytes[tiff] << 8) | bytes[tiff + 1];
    let littleEndian;
    if (marker === 0x4949) littleEndian = true;
    else if (marker === 0x4D4D) littleEndian = false;
    else return ORIENTATION_NONE;

    const u16 = (at) => (littleEndian
        ? bytes[at] | (bytes[at + 1] << 8)
        : (bytes[at] << 8) | bytes[at + 1]);
    const u32 = (at) => (littleEndian
        ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
        : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0);

    if (u16(tiff + 2) !== 42) return ORIENTATION_NONE;

    const ifd0 = tiff + u32(tiff + 4);
    if (ifd0 + 2 > end || ifd0 < tiff) return ORIENTATION_NONE;

    const entries = u16(ifd0);
    for (let index = 0; index < entries; index += 1) {
        const entry = ifd0 + 2 + (index * 12);
        if (entry + 12 > end) return ORIENTATION_NONE;

        if (u16(entry) !== ORIENTATION_TAG) continue;
        // A real Orientation is one SHORT. Anything else claiming this tag is
        // malformed, and guessing at it is how a reader starts inventing turns.
        if (u16(entry + 2) !== TIFF_TYPE_SHORT || u32(entry + 4) !== 1) return ORIENTATION_NONE;

        // A single SHORT is stored inline in the first two bytes of the
        // four-byte value slot, which is the one place the byte orders differ.
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : ORIENTATION_NONE;
    }

    return ORIENTATION_NONE;
}

const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

function hasExifIdentifier(bytes, at, end) {
    if (at + EXIF_IDENTIFIER.length > end) return false;
    for (let index = 0; index < EXIF_IDENTIFIER.length; index += 1) {
        if (bytes[at + index] !== EXIF_IDENTIFIER[index]) return false;
    }
    return true;
}

/**
 * The EXIF Orientation of a JPEG, as a number from 1 to 8.
 *
 * Returns 1 — "already upright" — for anything else: a PNG, a WebP, a JPEG with
 * no Exif block, a truncated file, a malformed IFD, a value outside the legal
 * range, or a caller that passed something that is not bytes at all. There is no
 * error channel on purpose. A file whose orientation cannot be read is a file
 * that must be left alone, and every caller would have had to turn a thrown
 * error back into exactly that.
 *
 * Only the segment table is walked, never the entropy-coded scan: the loop stops
 * at SOS, so no run of compressed data can be mistaken for a marker.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer|null} source the file, or its first
 *   EXIF_SCAN_BYTES bytes
 * @returns {number} 1-8
 */
export function readExifOrientation(source) {
    const bytes = asBytes(source);
    if (!bytes || bytes.length < 4) return ORIENTATION_NONE;

    // JPEG only. See the module comment for why PNG and WebP are left alone.
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return ORIENTATION_NONE;

    const end = bytes.length;
    let at = 2;

    while (at + 4 <= end) {
        if (bytes[at] !== 0xFF) return ORIENTATION_NONE;

        // Any number of 0xFF fill bytes may precede a marker.
        let marker = bytes[at + 1];
        let markerAt = at + 1;
        while (marker === 0xFF && markerAt + 1 < end) {
            markerAt += 1;
            marker = bytes[markerAt];
        }

        // SOS starts the compressed data and SOI/EOI/RSTn carry no payload; in
        // every one of those cases there is no Exif block still to come.
        if (marker === 0xDA || marker === 0xD9 || marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
            return ORIENTATION_NONE;
        }

        const lengthAt = markerAt + 1;
        if (lengthAt + 2 > end) return ORIENTATION_NONE;

        const length = (bytes[lengthAt] << 8) | bytes[lengthAt + 1];
        if (length < 2) return ORIENTATION_NONE;

        const payload = lengthAt + 2;
        const next = lengthAt + length;
        if (next > end) return ORIENTATION_NONE;

        // APP1 is shared: Exif and XMP both live here, so the identifier decides
        // rather than the marker, and a non-Exif APP1 is stepped over.
        if (marker === 0xE1 && hasExifIdentifier(bytes, payload, end)) {
            return orientationFromExifPayload(bytes, payload, next);
        }

        at = next;
    }

    return ORIENTATION_NONE;
}

/* -------------------------------------------------------------- geometry */

function normalise(orientation) {
    return Number.isInteger(orientation) && orientation >= 1 && orientation <= 8
        ? orientation
        : ORIENTATION_NONE;
}

/**
 * True when the tag turns the image a quarter turn, so the displayed width is
 * the stored height. Orientations 5-8 do; 1-4 are the identity, the two mirrors
 * and the half turn, all of which keep the shape.
 */
export function orientationSwapsAxes(orientation) {
    return normalise(orientation) >= 5;
}

/** The size the image is once the tag has been applied. */
export function orientedSize(width, height, orientation) {
    return orientationSwapsAxes(orientation)
        ? { width: height, height: width }
        : { width, height };
}

/* ------------------------------------------------------------- transform */

/**
 * Where the pixel at source (x, y) belongs in the destination, per orientation.
 *
 * All eight are here, including the four mirrored ones. 2, 4, 5 and 7 are rare
 * — they come from a flipped scan or a front camera — but "rare" is not "never",
 * and treating a mirror as its nearest rotation returns the photo backwards,
 * which is worse than returning it sideways because it looks fine.
 *
 *   1  (x, y)                identity
 *   2  (w-1-x, y)            mirrored left to right
 *   3  (w-1-x, h-1-y)        half turn
 *   4  (x, h-1-y)            mirrored top to bottom
 *   5  (y, x)                transposed about the leading diagonal
 *   6  (h-1-y, x)            quarter turn clockwise
 *   7  (h-1-y, w-1-x)        transposed about the trailing diagonal
 *   8  (y, w-1-x)            quarter turn anticlockwise
 */
const DESTINATION = {
    1: (x, y) => [x, y],
    2: (x, y, w) => [w - 1 - x, y],
    3: (x, y, w, h) => [w - 1 - x, h - 1 - y],
    4: (x, y, w, h) => [x, h - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y, w, h) => [h - 1 - y, x],
    7: (x, y, w, h) => [h - 1 - y, w - 1 - x],
    8: (x, y, w) => [y, w - 1 - x],
};

/**
 * The same picture, turned the way its Orientation tag asks for.
 *
 * Orientation 1 hands the SAME object straight back rather than a copy, so the
 * overwhelmingly common case allocates nothing at all. Every other value costs
 * one full destination surface: a rotation cannot be done in place, because a
 * pixel's new home is somewhere the loop has not read yet. capability.js prices
 * that second surface — see ORIENTATION_SURFACE_COPIES.
 *
 * @param {ImageData} imageData
 * @param {number} orientation 1-8; anything else is treated as 1
 * @returns {ImageData}
 */
export function applyOrientation(imageData, orientation) {
    const tag = normalise(orientation);
    if (tag === ORIENTATION_NONE || !imageData) return imageData;

    const { data, width, height } = imageData;
    const size = orientedSize(width, height, tag);
    const destinationOf = DESTINATION[tag];
    const turned = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [destinationX, destinationY] = destinationOf(x, y, width, height);
            const from = (y * width + x) * 4;
            const to = (destinationY * size.width + destinationX) * 4;

            turned[to] = data[from];
            turned[to + 1] = data[from + 1];
            turned[to + 2] = data[from + 2];
            turned[to + 3] = data[from + 3];
        }
    }

    return new ImageData(turned, size.width, size.height);
}
