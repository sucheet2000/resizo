/**
 * THE CONTENT-QUALITY RULES
 *
 * lib/catalog/validate.js proves an entry is well-formed and
 * lib/catalog/similarity.js proves it is not a sibling with the numbers
 * swapped. Neither can tell whether the page is worth serving. An entry can
 * carry every field, be unlike every other page in the registry, and still be
 * the thing nobody should publish: a generic opener, its own headline repeated
 * down the page, an offer to take a format the drop zone refuses, and no
 * statement anywhere of where the work happens.
 *
 * These are the rules for that half, and they apply to an indexable entry only
 * — a page kept out of the index is a draft and is allowed to be unfinished.
 *
 * THE NUMBERS ARE MEASURED. The limits below sit at least 1.5x above the worst
 * real page in the shipped registry, and tests/lib/catalog/quality.test.js
 * re-measures the live registry and asserts that margin, so a limit cannot be
 * walked down towards the pages it is meant to police. Raising one to admit a
 * page is the wrong move; write a different page.
 */
import { intentCopy } from './copy';
import { formatsFor } from './formats';
import { plainText } from './inline';

/** A "what changes" sentence: long enough to say something, short enough to read. */
export const CHANGES_MIN_ENTRIES = 2;
export const CHANGES_MIN_LENGTH = 20;
export const CHANGES_MAX_LENGTH = 160;

/**
 * How many times the exact h1 phrase may appear in the body. Measured across
 * the shipped registry the worst page repeats it 4 times in roughly 1,280 body
 * words, which is a page that keeps re-stating its own job in headings and
 * questions rather than a page written for a crawler.
 *
 * Named a CAP rather than a MAX because MAX_* in this repo means a limit the
 * engine enforces and lib/limits.js owns — tests/lib/module-boundaries.js
 * fails a catalogue file that declares one. This is an editorial ceiling on
 * prose, and it sits beside DOORWAY_SIMILARITY and SLUG_FAMILY_CAP.
 */
export const H1_PHRASE_CAP = 6;

/**
 * The largest share of the body one content word of the slug may take.
 * Measured, the heaviest real word is "png" on /jpg-to-png at 3.13% — 34 uses
 * in 1,085 words, on a page whose whole subject is that format.
 */
export const SLUG_WORD_SHARE_CAP = 0.05;

/**
 * Openers that say nothing. Every one of these is a sentence a page can carry
 * without having been written, and a page that opens on one has not earned an
 * index entry. Several are already banned as UI vocabulary by DESIGN.md; this
 * is the same list applied to prose, where it actually gets typed.
 */
export const GENERIC_COPY_PATTERNS = [
    /\bin today['’]?s? digital (?:world|age|era)\b/i,
    /\bimages? (?:are|is) (?:everywhere|important|essential|crucial)\b/i,
    /\bwhether you['’]?re a\b/i,
    /\blook no further\b/i,
    /\bwith just a few clicks\b/i,
    /\bhassle[-\s]?free\b/i,
    /\bfast and easy\b/i,
    /\bquick and easy\b/i,
    /\bbest free online\b/i,
    /\b100% free\b/i,
    /\bin the modern (?:world|era)\b/i,
    /\bone[-\s]?stop\b/i,
    /\bcutting[-\s]?edge\b/i,
    /\bseamless(?:ly)?\b/i,
    /\bunleash\b/i,
    /\belevate your\b/i,
    /\bgame[-\s]?changer\b/i,
];

/**
 * The ways a page may state where the work happens. One of them has to appear
 * in the direct answer or the intro, because those are the two strings a search
 * result quotes: a page whose privacy claim is buried in section four does not
 * make it at all where it counts.
 */
export const PROCESSING_PHRASES = [
    /\byour own (?:device|browser|computer|machine|hardware|phone)\b/i,
    /\bin your browser\b/i,
    /\bin this (?:browser )?tab\b/i,
    /\bnever leaves?\b/i,
    /\bnot uploaded\b/i,
    /\bnothing is (?:ever )?(?:uploaded|sent)\b/i,
    /\bnever (?:uploaded|sent)\b/i,
];

/**
 * Format names the copy might use, folded onto the registry keys. `jpg` and
 * `jpeg` are one format written two ways and a page is free to use either.
 */
const FORMAT_TOKENS = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    heic: 'heic',
    heif: 'heic',
    gif: 'gif',
    avif: 'avif',
    tif: 'tiff',
    tiff: 'tiff',
    bmp: 'bmp',
    svg: 'svg',
    pdf: 'pdf',
};

const TOKEN_PATTERN = Object.keys(FORMAT_TOKENS)
    .sort((a, b) => b.length - a.length)
    .join('|');

/**
 * An OFFER to take a file, which is the only phrasing this rule reads.
 *
 * The verbs are the imperative drop-zone ones — drop, drag, add, bring, hand —
 * and the format has to be their direct object, optionally continuing into
 * "JPEG, PNG or WebP". That narrowness is the whole point and it was arrived at
 * by measurement against the shipped registry. A looser rule ("a format name
 * within forty characters of an accepting verb") fires on eight sentences that
 * are all correct — "a lot of upload forms accept JPG and PNG", "PNG supports
 * transparency", "the reason to choose PNG", "you add the PNG and press Convert
 * to JPEG" — because they are about a form, about a format, or about the
 * OUTPUT. `attach` was in the verb list until "Can I attach a WebP to an
 * email?" on /jpg-to-webp proved that one is about somewhere else too. Only
 * "drop a GIF" is a promise about THIS page's drop zone.
 */
const OFFER = new RegExp(
    `\\b(?:drop|drag|add|bring|hand)\\b(?:\\s+(?:me|it|us))?\\s+(?:a|an|the|your|one|any)?\\s*`
    + `((?:${TOKEN_PATTERN})s?\\b(?:\\s*(?:,|,?\\s*(?:or|and))\\s*(?:a|an|the)?\\s*(?:${TOKEN_PATTERN})s?\\b)*)`,
    'gi',
);

const STOPWORDS = new Set([
    'a', 'an', 'the', 'to', 'for', 'and', 'or', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'your', 'my', 'is', 'it', 'as', 'be',
]);

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** Link markup reduced to its labels, whitespace collapsed, lower-cased. */
const normalise = (text) => plainText(String(text ?? '')).replace(/\s+/g, ' ').trim().toLowerCase();

const words = (text) => text.split(/[^a-z0-9]+/).filter(Boolean);

/** The content words of a slug: no separators, no digits, no stopwords. */
export function slugWords(slug) {
    const found = String(slug ?? '')
        .split('-')
        .map((part) => part.replace(/\d+/g, ''))
        .filter((part) => part.length > 0 && !STOPWORDS.has(part));

    return [...new Set(found)];
}

function countPhrase(haystack, phrase) {
    if (!phrase) return 0;

    let count = 0;
    let index = haystack.indexOf(phrase);
    while (index !== -1) {
        count += 1;
        index = haystack.indexOf(phrase, index + phrase.length);
    }

    return count;
}

/**
 * What the stuffing rule sees: how often the exact headline is repeated in the
 * body, and what share of the body each content word of the slug takes.
 * Exported because the test re-measures the live registry with it and asserts
 * the limits still sit clear of the real pages.
 */
export function stuffingReport(intent) {
    return stuffingReportFor({ slug: intent?.slug, h1: intent?.h1, body: intentCopy(intent, { part: 'body' }) });
}

/**
 * The same measurement over any page shaped as a slug, a headline and a list
 * of body strings — which is how a guide reaches it, since a guide's body is
 * walked by its own validator rather than by intentCopy.
 */
export function stuffingReportFor({ slug, h1, body }) {
    const text = normalise((Array.isArray(body) ? body : [body]).filter((value) => typeof value === 'string').join(' '));
    const all = words(text);

    const shares = slugWords(slug).map((word) => {
        const hits = all.filter((candidate) => candidate === word).length;
        return { word, hits, share: all.length > 0 ? hits / all.length : 0 };
    });

    return {
        phrase: normalise(h1),
        phraseCount: countPhrase(text, normalise(h1)),
        bodyWords: all.length,
        shares,
        worstShare: shares.reduce((worst, entry) => Math.max(worst, entry.share), 0),
    };
}

function changesProblems(intent) {
    const problems = [];
    const changes = intent?.changes;
    const lists = [['does', 'what this changes'], ['doesNot', 'what stays the same']];

    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        return [{
            code: 'intent-changes-missing',
            message: 'needs changes: { does: [...], doesNot: [...] } — what this page changes about a file, and what it leaves alone',
        }];
    }

    for (const [key, label] of lists) {
        const list = changes[key];
        if (!Array.isArray(list) || !list.every(isText)) {
            problems.push({
                code: 'intent-changes-missing',
                message: `changes.${key} (${label}) must be a list of plain-text sentences`,
            });
            continue;
        }

        if (list.length < CHANGES_MIN_ENTRIES) {
            problems.push({
                code: 'intent-changes-short',
                message: `changes.${key} (${label}) needs at least ${CHANGES_MIN_ENTRIES} sentences; it has ${list.length}`,
            });
        }

        for (const entry of list) {
            const length = plainText(entry).trim().length;
            if (length < CHANGES_MIN_LENGTH || length > CHANGES_MAX_LENGTH) {
                problems.push({
                    code: 'intent-changes-short',
                    message: `changes.${key} has a ${length}-character sentence; each must be ${CHANGES_MIN_LENGTH} to ${CHANGES_MAX_LENGTH} characters: "${plainText(entry).slice(0, 60)}"`,
                });
            }
        }
    }

    const does = (Array.isArray(changes.does) ? changes.does : []).filter(isText).map(normalise);
    const doesNot = new Set((Array.isArray(changes.doesNot) ? changes.doesNot : []).filter(isText).map(normalise));
    for (const sentence of does) {
        if (doesNot.has(sentence)) {
            problems.push({
                code: 'intent-changes-duplicate',
                message: `"${sentence.slice(0, 60)}" is on both sides of changes — a page cannot both do a thing and leave it alone`,
            });
        }
    }

    return problems;
}

function processingProblems(intent) {
    const stated = [intent?.answer, intent?.intro]
        .filter(isText)
        .some((text) => PROCESSING_PHRASES.some((pattern) => pattern.test(plainText(text))));

    return stated ? [] : [{
        code: 'intent-processing-missing',
        message: 'neither the answer nor the intro says where the work happens — one of them must ("on your own device", "in this tab", "never leaves your computer")',
    }];
}

/**
 * Every generic line in a list of strings, as `{ pattern, match, text }`.
 *
 * A function over STRINGS rather than over intent entries, because the guide
 * registry checks the same thing against a different shape:
 * lib/catalog/guides/validate.js calls this instead of keeping a second copy of
 * the list. Two lists is how one of them quietly stops matching what the other
 * rejects. Link markup is reduced to its labels first, so filler hidden inside
 * a link is still filler.
 */
export function genericCopyProblems(strings) {
    const list = Array.isArray(strings) ? strings : [strings];
    const problems = [];

    for (const entry of list) {
        if (typeof entry !== 'string') continue;

        const text = plainText(entry);
        for (const pattern of GENERIC_COPY_PATTERNS) {
            const found = text.match(pattern);
            if (found) problems.push({ pattern, match: found[0], text });
        }
    }

    return problems;
}

function intentGenericCopyProblems(intent) {
    return genericCopyProblems(intentCopy(intent)).map((found) => ({
        code: 'intent-generic-copy',
        message: `"${found.match}" is filler that any page could carry — rewrite the sentence around it: "${found.text.slice(0, 60)}"`,
    }));
}

function stuffingProblems(intent) {
    const problems = [];
    const report = stuffingReport(intent);

    if (report.phraseCount > H1_PHRASE_CAP) {
        problems.push({
            code: 'intent-keyword-stuffing',
            message: `the body repeats the exact headline "${report.phrase}" ${report.phraseCount} times; the limit is ${H1_PHRASE_CAP}`,
        });
    }

    for (const entry of report.shares) {
        if (entry.share > SLUG_WORD_SHARE_CAP) {
            problems.push({
                code: 'intent-keyword-stuffing',
                message: `"${entry.word}" is ${(entry.share * 100).toFixed(1)}% of the ${report.bodyWords} words in the body (${entry.hits} uses); the limit is ${(SLUG_WORD_SHARE_CAP * 100).toFixed(0)}%`,
            });
        }
    }

    return problems;
}

function formatClaimProblems(intent, tools) {
    const { input } = formatsFor(intent, tools);
    if (input.length === 0) return [];

    const accepted = new Set(input.map((format) => FORMAT_TOKENS[format] ?? format));
    const problems = [];

    for (const text of intentCopy(intent)) {
        for (const match of plainText(text).matchAll(OFFER)) {
            for (const token of match[1].toLowerCase().match(new RegExp(`\\b(?:${TOKEN_PATTERN})\\b`, 'g')) ?? []) {
                const format = FORMAT_TOKENS[token];
                if (!accepted.has(format)) {
                    problems.push({
                        code: 'intent-format-claim',
                        message: `the copy offers to take a ${token.toUpperCase()}, which this page's drop zone refuses — it accepts ${input.join(', ')}: "${plainText(text).slice(0, 60)}"`,
                    });
                }
            }
        }
    }

    return problems;
}

/** Every quality rule, for one indexable entry. */
export function qualityProblems(intent, { tools } = {}) {
    return [
        ...changesProblems(intent),
        ...processingProblems(intent),
        ...intentGenericCopyProblems(intent),
        ...stuffingProblems(intent),
        ...formatClaimProblems(intent, tools),
    ];
}
