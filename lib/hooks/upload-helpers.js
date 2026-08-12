/**
 * Upload Helpers
 *
 * The pure half of useImageUpload: constraint copy, accept attributes and the
 * reject messages. Kept out of the hook so it is unit-testable without a DOM,
 * and so the dropzone's constraint line and its error text can never disagree
 * about what the tool accepts.
 */
import {
    MAX_BULK_FILES,
    MAX_BULK_TOTAL_BYTES,
    MAX_DIMENSION,
    MAX_FILE_SIZE,
} from '@/lib/constants';
import { formatFileSize } from '@/lib/format-bytes';

const FORMAT_LABELS = {
    jpeg: 'JPEG',
    jpg: 'JPEG',
    png: 'PNG',
    webp: 'WebP',
    gif: 'GIF',
    heic: 'HEIC',
    heif: 'HEIF',
    avif: 'AVIF',
};

const FORMAT_MIME = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
};

const FORMAT_EXTENSIONS = {
    jpeg: ['.jpg', '.jpeg'],
    jpg: ['.jpg', '.jpeg'],
    png: ['.png'],
    webp: ['.webp'],
    gif: ['.gif'],
    heic: ['.heic', '.heif'],
    heif: ['.heic', '.heif'],
    avif: ['.avif'],
};

function unique(values) {
    return Array.from(new Set(values));
}

/** 'jpeg' -> 'JPEG'. Unknown tokens are upper-cased rather than dropped. */
export function formatLabel(format) {
    const key = String(format ?? '').toLowerCase();
    return FORMAT_LABELS[key] ?? key.toUpperCase();
}

/** ['jpeg','png','webp'] -> 'JPEG, PNG, WebP' */
export function formatList(formats) {
    const list = Array.isArray(formats) ? formats : [];
    return unique(list.map(formatLabel).filter(Boolean)).join(', ');
}

/**
 * ['a','b','c'] -> 'a, b and c'. The joiner every format sentence goes through,
 * kept separate from formatLabel so a lower-case token list ('jpeg, png or
 * webp' in an API error) and a labelled one read the same way.
 */
export function joinProse(items, conjunction = 'and') {
    const list = unique((Array.isArray(items) ? items : []).filter(Boolean));
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`;
}

/**
 * ['jpeg','png','webp'] -> 'JPEG, PNG and WebP'. The prose form of formatList,
 * for sentences rather than for the constraint line inside a drop zone.
 */
export function formatProse(formats, conjunction = 'and') {
    return joinProse((Array.isArray(formats) ? formats : []).map(formatLabel), conjunction);
}

/**
 * The `accept` attribute for the file input. Extensions are included next to
 * the MIME types because iOS and Android hand HEIC files an empty type, and a
 * MIME-only accept hides them from the picker entirely.
 */
export function acceptAttribute(formats) {
    const list = Array.isArray(formats) ? formats : [];
    const tokens = [];

    for (const format of list) {
        const key = String(format ?? '').toLowerCase();
        if (FORMAT_MIME[key]) tokens.push(FORMAT_MIME[key]);
        for (const extension of FORMAT_EXTENSIONS[key] ?? []) tokens.push(extension);
    }

    return unique(tokens).join(',');
}

/**
 * The line that sits INSIDE the drop zone. Constraints belong in the control,
 * not in a paragraph above it.
 */
export function constraintsLine({ formats, maxBytes = MAX_FILE_SIZE, maxFiles } = {}) {
    const parts = [];

    const list = formatList(formats);
    if (list) parts.push(list);

    if (Number.isFinite(maxBytes) && maxBytes > 0) {
        parts.push(`up to ${formatFileSize(maxBytes)}`);
    }

    if (Number.isFinite(maxFiles) && maxFiles > 1) {
        parts.push(`${maxFiles} files max`);
    }

    return parts.join(' · ');
}

/**
 * Every reject message the drop zone can show. Each one names the fix, and
 * none of them blame the visitor.
 */
export const rejectReason = {
    empty: () => 'That file is empty. Pick a file with content in it.',
    tooLarge: (size, maxBytes = MAX_FILE_SIZE) =>
        `That file is ${formatFileSize(size)}. The limit is ${formatFileSize(maxBytes)} — compress it first, or pick a smaller one.`,
    wrongType: (formats) =>
        `That file is not a ${formatList(formats)} image. Pick one of those formats.`,
    unreadable: () => 'That file could not be read as an image. It may be damaged.',
    tooManyPixels: (maxDimension = MAX_DIMENSION) =>
        `That image is wider or taller than ${maxDimension} px. Scale it down in a desktop app first, then bring it back here.`,
    tooManyFiles: (maxFiles = MAX_BULK_FILES) =>
        `You can process ${maxFiles} files at a time. Remove a few and try again.`,
    batchTooLarge: (maxTotalBytes = MAX_BULK_TOTAL_BYTES) =>
        `Those files add up to more than ${formatFileSize(maxTotalBytes)}. Remove a few and try again.`,
};

/**
 * Size gate only — the signature check needs to read bytes, so it lives in the
 * hook. Returns null when the file passes.
 */
export function checkFileSize(file, maxBytes = MAX_FILE_SIZE) {
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size <= 0) return rejectReason.empty();
    if (size > maxBytes) return rejectReason.tooLarge(size, maxBytes);
    return null;
}

/** Returns null when the batch fits, otherwise the reason it does not. */
export function checkBatchLimits({
    incomingCount = 0,
    existingCount = 0,
    incomingBytes = 0,
    existingBytes = 0,
    maxFiles = MAX_BULK_FILES,
    maxTotalBytes = MAX_BULK_TOTAL_BYTES,
} = {}) {
    if (existingCount + incomingCount > maxFiles) return rejectReason.tooManyFiles(maxFiles);
    if (existingBytes + incomingBytes > maxTotalBytes) return rejectReason.batchTooLarge(maxTotalBytes);
    return null;
}

/** Returns null when the pixel dimensions are within the cap. */
export function checkDimensions(width, height, maxDimension = MAX_DIMENSION) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return rejectReason.unreadable();
    }
    if (width > maxDimension || height > maxDimension) {
        return rejectReason.tooManyPixels(maxDimension);
    }
    return null;
}

/**
 * Drop-zone visual state, resolved from the three inputs the hook owns.
 * 'reject' outranks a hover so an error is never hidden by a second drag.
 */
export function dropzoneState({ isDragging = false, hasFile = false, error = null } = {}) {
    if (error) return 'reject';
    if (isDragging) return 'dragover';
    if (hasFile) return 'accepted';
    return 'rest';
}
