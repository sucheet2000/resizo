/**
 * Upload Validation
 *
 * A fixed gate order shared by every upload route: is-it-a-File, then type,
 * then size. The File check has to come first — a plain text form field has no
 * `size`, so the size gate silently passes and a later `file.name` access
 * throws a 500 for what is plainly a 400.
 */
import { MAX_FILE_SIZE } from '@/lib/constants';

function megabytes(bytes) {
    return Math.round(bytes / (1024 * 1024));
}

function matchesType(fileType, allowedTypes) {
    if (typeof fileType !== 'string' || fileType === '') return false;
    const normalized = fileType.toLowerCase();
    return allowedTypes.some((allowed) => {
        const candidate = String(allowed).toLowerCase();
        if (candidate.endsWith('/*')) return normalized.startsWith(candidate.slice(0, -1));
        return normalized === candidate;
    });
}

function matchesExtension(fileName, allowedExtensions) {
    if (typeof fileName !== 'string' || fileName === '') return false;
    const normalized = fileName.toLowerCase();
    return allowedExtensions.some((extension) => normalized.endsWith(String(extension).toLowerCase()));
}

/**
 * Returns { ok: true } or { ok: false, error, status }.
 *
 * `allowedExtensions` is an OR with `allowedTypes` — HEIC uploads often arrive
 * with an empty or generic MIME type, so the extension is the only signal.
 */
export function validateUpload(file, { allowedTypes = ['image/*'], allowedExtensions = [], maxBytes = MAX_FILE_SIZE } = {}) {
    if (file === null || file === undefined || file === '') {
        return { ok: false, status: 400, error: 'No file provided in the request.' };
    }

    if (typeof file?.arrayBuffer !== 'function') {
        return { ok: false, status: 400, error: 'No valid file was uploaded.' };
    }

    const typeAllowed = matchesType(file.type, allowedTypes)
        || (allowedExtensions.length > 0 && matchesExtension(file.name, allowedExtensions));

    if (!typeAllowed) {
        return { ok: false, status: 400, error: 'Invalid file type. Only images are allowed.' };
    }

    if (typeof file.size !== 'number' || !Number.isFinite(file.size)) {
        return { ok: false, status: 400, error: 'No valid file was uploaded.' };
    }

    if (file.size === 0) {
        return { ok: false, status: 400, error: 'The uploaded file is empty.' };
    }

    if (file.size > maxBytes) {
        return { ok: false, status: 400, error: `File exceeds the maximum allowed size of ${megabytes(maxBytes)}MB.` };
    }

    return { ok: true };
}
