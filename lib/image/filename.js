/**
 * Output Filename Construction
 *
 * One sanitisation rule for every download name, on the client and the server,
 * so the browser's suggested name and the server's Content-Disposition always
 * agree. Unicode letters and digits survive; symbols, emoji, path separators
 * and every header-breaking character do not.
 */

const FALLBACK_BASE_NAME = 'image';
const MAX_BASE_NAME_LENGTH = 100;

/**
 * Bounds on a folder path carried into a ZIP. Eight levels and sixty characters
 * a level is more nesting than any photo library has, and it stops a pathological
 * pick from producing an archive some unzip tools refuse to open.
 */
const MAX_PATH_SEGMENTS = 8;
const MAX_SEGMENT_LENGTH = 60;

const EXTENSIONS = new Set(['png', 'webp', 'gif', 'heic', 'heif', 'avif', 'tiff', 'zip', 'pdf']);

// 'pdf' and 'zip' are the two entries here that are not images. Both are
// containers this engine produces — a ZIP from a bulk resize, a PDF from
// /jpg-to-pdf — and both need the same download name and the same declared type
// as everything else, which is why they live in the one builder rather than
// having a second naming rule written next to the tool that emits them.
const CONTENT_TYPES = {
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    heif: 'image/heif',
    avif: 'image/avif',
    tiff: 'image/tiff',
    pdf: 'application/pdf',
};

function sanitizeToken(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/[^a-zA-Z0-9\-_]/g, '');
}

/**
 * Strips the directory, strips the extension, collapses whitespace to '-',
 * drops everything outside letters/digits/'.'/'-'/'_', collapses dot runs and
 * falls back to 'image' when nothing usable is left. A CJK name yields the CJK
 * characters; an emoji-only name yields 'image', never ''.
 */
export function sanitizeBaseName(name) {
    if (typeof name !== 'string') return FALLBACK_BASE_NAME;

    const withoutPath = name.split(/[\\/]/).pop() ?? '';
    const withoutExtension = withoutPath.replace(/\.[^.]*$/, '');

    const cleaned = withoutExtension
        .normalize('NFC')
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}._-]/gu, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '');

    const bounded = Array.from(cleaned).slice(0, MAX_BASE_NAME_LENGTH).join('');
    return bounded || FALLBACK_BASE_NAME;
}

/**
 * One folder name, cleaned by the same rule sanitizeBaseName applies to a file
 * name. Returns '' for anything that survives as nothing — which is what makes
 * a traversal segment impossible: '..' collapses to '.' and then to '', and
 * every separator was already split away before this is called.
 */
function sanitizeSegment(part) {
    if (typeof part !== 'string') return '';

    const cleaned = part
        .normalize('NFC')
        .replace(/\s+/g, '-')
        .replace(/[^\p{L}\p{N}._-]/gu, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^[._-]+/, '')
        .replace(/[._-]+$/, '');

    return Array.from(cleaned).slice(0, MAX_SEGMENT_LENGTH).join('');
}

/**
 * The DIRECTORY half of a folder pick's relative path, cleaned for use as a ZIP
 * entry prefix. `Holiday/2024/IMG_1.jpg` becomes `Holiday/2024`.
 *
 * A folder pick is the one intake path that knows where a file sat, and that
 * placement is worth keeping: two photos called IMG_0001.jpg from two different
 * months are two different photos, and flattening them into one archive would
 * turn the second into `IMG_0001-2.jpg` with nothing left to say which was
 * which. Preserving the path also makes the ZIP unzip back into the shape the
 * person picked.
 *
 * Everything hostile about a path is removed rather than rejected: separators
 * are split on first, so no segment can contain one; '.' and '..' clean down to
 * nothing and are dropped; a leading separator is an empty first segment and is
 * dropped the same way. What comes out can only ever be a relative path of
 * plain names.
 */
export function sanitizeFolderPath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath === '') return '';

    const parts = relativePath.split(/[\\/]/);
    // The last part is the file itself; the folder is what sits in front of it.
    parts.pop();

    const segments = [];
    for (const part of parts) {
        const cleaned = sanitizeSegment(part);
        if (!cleaned) continue;
        segments.push(cleaned);
        if (segments.length === MAX_PATH_SEGMENTS) break;
    }

    return segments.join('/');
}

/**
 * '<folder>/<name>', or just the name when there is no folder. Every folder
 * segment is re-cleaned here rather than trusted, so this is safe to call with
 * whatever a caller happens to be holding.
 */
export function joinZipPath(folder, name) {
    if (typeof folder !== 'string' || folder === '') return name;

    const segments = folder
        .split(/[\\/]/)
        .map(sanitizeSegment)
        .filter(Boolean)
        .slice(0, MAX_PATH_SEGMENTS);

    return segments.length > 0 ? `${segments.join('/')}/${name}` : name;
}

/**
 * Maps an output format to its file extension. Owns the jpeg -> jpg mapping
 * that five routes used to repeat.
 */
export function extensionFor(format) {
    const normalized = typeof format === 'string' ? format.trim().toLowerCase() : '';
    if (normalized === 'jpeg' || normalized === 'jpg') return 'jpg';
    if (EXTENSIONS.has(normalized)) return normalized;
    return 'jpg';
}

/**
 * Maps an output format to a Content-Type value. Allowlist-derived, so no
 * caller-supplied string can ever reach the header.
 */
export function contentTypeFor(format) {
    const normalized = typeof format === 'string' ? format.trim().toLowerCase() : '';
    return CONTENT_TYPES[normalized] ?? 'application/octet-stream';
}

/**
 * Builds '<prefix>-<base>[-<suffix>].<ext>' from the uploaded filename.
 */
export function buildOutputFilename({ name, prefix, format, suffix } = {}) {
    const parts = [sanitizeToken(prefix), sanitizeBaseName(name), sanitizeToken(suffix)];
    return `${parts.filter(Boolean).join('-')}.${extensionFor(format)}`;
}

/**
 * Returns a name that is not already in `usedSet`, appending -2, -3 ... before
 * the extension. Mutates the set so callers can loop over a batch — this is
 * what stops JSZip from silently overwriting colliding entries.
 */
export function uniqueName(name, usedSet) {
    if (!usedSet || typeof usedSet.has !== 'function' || typeof usedSet.add !== 'function') {
        return name;
    }

    if (!usedSet.has(name)) {
        usedSet.add(name);
        return name;
    }

    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';

    let counter = 2;
    let candidate = `${base}-${counter}${extension}`;
    while (usedSet.has(candidate)) {
        counter += 1;
        candidate = `${base}-${counter}${extension}`;
    }

    usedSet.add(candidate);
    return candidate;
}
