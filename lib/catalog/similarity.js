/**
 * How alike two intent pages are, with the keywords taken out.
 *
 * The doorway-page move is to copy a page and change the number or the format
 * name — "100 KB" to "50 KB", "PNG" to "JPG" — and call it a new intent. Such
 * a copy is word-for-word identical once those tokens are masked, and a page
 * that is genuinely about a different job is not: measured on the shipped
 * registry, the closest real pair scores 0.094 here while a number-swapped
 * clone scores 1.000. The comparison is over three-word runs (shingles), so
 * two pages may share vocabulary — they are all about images — but not
 * phrasing.
 *
 * Only the body is compared (sections, procedure, FAQs, features): headlines
 * and descriptions are short and legitimately formulaic.
 */
import { intentCopy } from './copy';

const FORMAT = /\b(?:jpe?gs?|pngs?|webps?|heics?|heifs?|pdfs?|gifs?|avifs?|tiffs?|tifs?)\b/g;

const NUMBER = /\b\d[\d,.]*\s*(?:kb|mb|gb|px|mp|%|percent)?\b/g;

/** Lower-case text with every number and format name folded to one token. */
export function maskCopy(text) {
    return String(text ?? '')
        .toLowerCase()
        .replace(FORMAT, ' fmt ')
        .replace(NUMBER, ' # ')
        .replace(/[^a-z#]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Overlapping three-word runs, which is what a rewritten sentence loses. */
export function shingles(text) {
    const words = maskCopy(text).split(' ').filter(Boolean);
    const out = new Set();
    for (let index = 0; index + 2 < words.length; index += 1) {
        out.add(words.slice(index, index + 3).join(' '));
    }
    return out;
}

export function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let shared = 0;
    for (const shingle of a) if (b.has(shingle)) shared += 1;
    return shared / (a.size + b.size - shared);
}

/** 0 for unrelated pages, 1 for the same page with the keywords swapped. */
export function bodySimilarity(first, second) {
    return jaccard(
        shingles(intentCopy(first, { part: 'body' }).join(' ')),
        shingles(intentCopy(second, { part: 'body' }).join(' ')),
    );
}
