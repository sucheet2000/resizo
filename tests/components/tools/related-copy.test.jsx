/**
 * THE "WHAT TO DO NEXT" SENTENCES ARE SENTENCES
 *
 * RelatedTools is the strongest secondary block on every tool page and every
 * intent page — it is the internal link graph, and its anchor context is what
 * tells a crawler what the linked page is about. Four identical link strips
 * saying "Convert HEIC · Compress · Crop" is what it used to be, and the
 * measurable damage was that the most prominent secondary heading on each tool
 * page read as a navigation label rather than as content.
 *
 * So the copy has a contract, and it is a contract about writing, which is
 * exactly the kind of rule that decays without a test: DESIGN.md forbade banned
 * copy for months and an agent wrote it anyway, which is why
 * tests/design/contract.test.js exists. This is the same argument for the one
 * block whose job is to explain the next job.
 *
 * A sentence here must:
 *   - contain a verb, because a phrase with no verb is a label
 *   - end in a word, not in the arrow that decorates the link after it
 *   - not be Title Case, which is what a heading looks like, not a sentence
 *   - not open with Best / Free / Online, the three words that make a line
 *     read as ad copy rather than as help
 *   - not be a tool title restated, which says nothing the link does not
 *
 * The verb list below is the assertion, not an exception list: a genuinely new
 * verb belongs in it. The detector is tested against a verbless phrase in the
 * same file, so it can never pass by returning true for everything.
 */
import { describe, expect, it } from 'vitest';

import { RELATED_COPY } from '@/components/tools/RelatedTools';
import { TOOLS } from '@/lib/catalog';

const TOOL_SLUGS = new Set(TOOLS.map((tool) => tool.slug));
const TOOL_TITLES = new Set(TOOLS.flatMap((tool) => [tool.title, tool.shortTitle]));

/**
 * The verbs this copy actually uses, plus the auxiliaries English needs to
 * make a clause. Inflections are derived, not listed: `-s`, `-es`, `-ed` and
 * `-ing`, including the doubled-consonant ("cropped") and dropped-e
 * ("sharing") spellings.
 */
const VERBS = new Set([
    // The operations the site performs.
    'resize', 'compress', 'convert', 'crop', 'combine', 'merge', 'strip', 'size',
    'change', 'reduce', 'shrink', 'trim', 'straighten', 'rotate', 'flatten', 'encode',
    // What a person does with a file.
    'save', 'send', 'share', 'print', 'post', 'keep', 'download', 'upload', 'open',
    'read', 'write', 'add', 'cut', 'bind', 'put', 'turn', 'drop', 'pick', 'choose',
    'bring', 'take', 'make', 'use', 'want', 'need', 'go', 'do', 'have', 'get', 'give',
    'ask', 'meet', 'fit', 'hit', 'land', 'leave', 'look', 'move', 'run', 'start',
    'stop', 'try', 'hand', 'work', 'arrive', 'beat', 'name', 'touch', 'show', 'tell',
    'remove', 'set', 'let', 'find', 'know', 'come', 'sit', 'pay', 'say', 'see',
    // Copulas, modals and the irregular pasts this copy uses.
    'is', 'are', 'was', 'were', 'be', 'been', 'am', 'has', 'have', 'had',
    'will', 'would', 'can', 'cannot', 'could', 'may', 'might', 'must', 'should',
    'does', 'did', 'done', 'got', 'made', 'went', 'took', 'kept', 'sent', 'ran',
    'came', 'said', 'gone', 'become', 'becomes',
]);

/** Every spelling of `word` that could be the base form of a verb. */
function stems(word) {
    const out = [word];

    for (const suffix of ['s', 'es', 'ed', 'ing']) {
        if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
        const stem = word.slice(0, -suffix.length);
        out.push(stem, `${stem}e`);
        // "cropped" -> "crop", "trimmed" -> "trim"
        if (/(.)\1$/.test(stem)) out.push(stem.slice(0, -1));
    }

    return out;
}

function hasVerb(sentence) {
    return (sentence.toLowerCase().match(/[a-z]+/g) ?? []).some((word) =>
        stems(word).some((stem) => VERBS.has(stem)),
    );
}

/** Every word of four letters or more capitalised — a heading, not a sentence. */
function isTitleCase(sentence) {
    const words = (sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).filter((word) => word.length >= 4);
    return words.length >= 3 && words.every((word) => /^[A-Z]/.test(word));
}

const ENTRIES = Object.entries(RELATED_COPY).flatMap(([from, targets]) =>
    Object.entries(targets).map(([to, sentence]) => ({ from, to, sentence })),
);

describe('the RELATED_COPY sentences', () => {
    it('found the copy to check', () => {
        // An empty registry breaks no rule, so the sweep is shown to have read
        // something before anything is asserted about what it did not find.
        expect(Object.keys(RELATED_COPY).length).toBeGreaterThanOrEqual(8);
        expect(ENTRIES.length).toBeGreaterThanOrEqual(40);
    });

    it('has a verb detector that can say no', () => {
        expect(hasVerb('Right dimensions but the file is still too heavy? Compress it')).toBe(true);
        expect(hasVerb('Cropping away what you do not need also drops the size — crop it')).toBe(true);
        expect(hasVerb('Best Free Online Image Resizer Tool')).toBe(false);
        expect(hasVerb('Free JPG PNG WebP HEIC')).toBe(false);
    });

    it('has a Title Case detector that can say no', () => {
        expect(isTitleCase('Convert Your Images Into Every Format')).toBe(true);
        expect(isTitleCase('Free Online Image Compressor')).toBe(true);
        expect(isTitleCase('iPhone photo? Convert HEIC to JPG before resizing')).toBe(false);
    });

    it('knows the tool titles it refuses to see restated', () => {
        // A set built from an empty registry would forbid nothing.
        expect(TOOL_TITLES.size).toBeGreaterThanOrEqual(TOOLS.length);
        expect(TOOL_TITLES.has(TOOLS[0].title)).toBe(true);
        expect(TOOL_TITLES.has(TOOLS.at(-1).title)).toBe(true);
    });

    it.each(ENTRIES.map((entry) => [`${entry.from} → ${entry.to}`, entry]))(
        '%s explains the next job',
        (_label, { from, to, sentence }) => {
            const where = `RELATED_COPY['${from}']['${to}']`;

            expect(typeof sentence, `${where} is not a string`).toBe('string');
            expect(sentence.trim().length, `${where} is too short to be a sentence`).toBeGreaterThan(15);

            expect(hasVerb(sentence), `${where} has no verb, so it is a label: "${sentence}"`).toBe(true);

            expect(
                isTitleCase(sentence),
                `${where} is Title Case, which reads as a heading: "${sentence}"`,
            ).toBe(false);

            expect(sentence, `${where} opens with ad copy: "${sentence}"`).not.toMatch(/^\s*(Best|Free|Online)\b/i);

            expect(
                TOOL_TITLES.has(sentence.trim()),
                `${where} is just the tool's title, which the link already says: "${sentence}"`,
            ).toBe(false);
        },
    );

    it.each(ENTRIES.map((entry) => [`${entry.from} → ${entry.to}`, entry]))(
        '%s ends in words, not in the arrow',
        (_label, { from, to, sentence }) => {
            const where = `RELATED_COPY['${from}']['${to}']`;
            const last = sentence.trim().slice(-1);

            // The block already renders " →" inside the link that follows the
            // sentence. A second arrow in the copy makes the row read as two
            // links, and a trailing arrow is a label's punctuation.
            expect(sentence, `${where} contains the arrow the link renders: "${sentence}"`).not.toContain('→');
            expect(
                /[\p{L}\p{N}.!?)\]"']/u.test(last),
                `${where} ends with "${last}" rather than a word: "${sentence}"`,
            ).toBe(true);
        },
    );
});

describe('the RELATED_COPY keys', () => {
    it('names a real tool on the page the sentence is written for', () => {
        const unknown = Object.keys(RELATED_COPY).filter((slug) => !TOOL_SLUGS.has(slug));
        expect(
            unknown,
            `these RELATED_COPY keys are not tools, so their copy never renders:\n${unknown.join('\n')}`,
        ).toEqual([]);
    });

    it('names a real tool on the page the sentence links to', () => {
        const unknown = ENTRIES
            .filter((entry) => !TOOL_SLUGS.has(entry.to))
            .map((entry) => `${entry.from} → ${entry.to}`);

        expect(
            unknown,
            `these RELATED_COPY targets are not tools, so the sentence is dead copy:\n${unknown.join('\n')}`,
        ).toEqual([]);
    });

    it('never writes a sentence about the page it is on', () => {
        const selfReferences = ENTRIES
            .filter((entry) => entry.from === entry.to)
            .map((entry) => entry.from);

        expect(selfReferences, `RelatedTools never links a page to itself:\n${selfReferences.join('\n')}`).toEqual([]);
    });
});

/**
 * A tool with no hand-written sentence falls back to its registry description,
 * which renders in exactly the same place and has to read the same way.
 */
describe('the registry descriptions that stand in for a missing sentence', () => {
    const FALLBACKS = TOOLS.filter((tool) => tool.hasOwnPage);

    it('found the tools whose descriptions can render', () => {
        expect(FALLBACKS.length).toBeGreaterThanOrEqual(8);
    });

    it.each(FALLBACKS.map((tool) => [tool.slug, tool]))('%s reads as a sentence', (slug, tool) => {
        expect(hasVerb(tool.description), `${slug}'s description has no verb: "${tool.description}"`).toBe(true);
        expect(isTitleCase(tool.description), `${slug}'s description is Title Case`).toBe(false);
        expect(tool.description).not.toMatch(/^\s*(Best|Free|Online)\b/i);
        expect(tool.description).not.toContain('→');
    });
});
