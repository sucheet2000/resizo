/**
 * THE CONTENT-QUALITY CONTRACT
 *
 * The intent contract (tests/lib/catalog/intent-contract.test.js) proves an
 * entry is WELL-FORMED and the doorway guard proves it is not another page
 * twice. Neither can tell whether the page is worth serving: an entry can have
 * every field, be unlike every sibling, and still open "In today's digital
 * world, images are everywhere", repeat its own headline nine times, offer to
 * take a GIF the tool refuses, and never say where the work happens.
 *
 * These are the rules for that. Each one applies to an indexable intent only —
 * a page kept out of the index is a draft — and each has a code a build failure
 * names, so a red build reads as an instruction.
 *
 * THE STUFFING NUMBERS ARE MEASURED, NOT GUESSED. When the caps were set, the
 * busiest shipped page repeated its exact h1 phrase 4 times and the heaviest
 * single slug word ("png" on /jpg-to-png) took about 3% of its body. The
 * limits are 6 repeats and 5%, at least 1.5x above both, and the margin is
 * asserted below from the LIVE registry the way doorway-guard.test.js pins
 * its own, so a limit cannot be quietly walked down towards the real pages
 * and the exact counts are never retyped here.
 */
import { describe, expect, it } from 'vitest';

import { INTENTS, getIntent } from '@/lib/catalog';
import { formatsFor } from '@/lib/catalog/formats';
import {
    CHANGES_MAX_LENGTH,
    CHANGES_MIN_ENTRIES,
    CHANGES_MIN_LENGTH,
    GENERIC_COPY_PATTERNS,
    H1_PHRASE_CAP,
    SLUG_WORD_SHARE_CAP,
    genericCopyProblems,
    stuffingReport,
} from '@/lib/catalog/quality';
import { TOOLS } from '@/lib/catalog/tools';
import { ALLOWED_OUTPUT_FORMATS, RASTER_INPUT_FORMATS, RESIZE_INPUT_FORMATS } from '@/lib/limits';
import { validateIntent } from '@/lib/catalog/validate';
import { validIntent } from '@/tests/helpers/intent-fixture';

const codes = (intent, options = {}) =>
    validateIntent(intent, { tools: TOOLS, ...options }).map((problem) => problem.code);

/** The fixture with one paragraph swapped in, which is where prose rules bite. */
function withParagraph(text, overrides = {}) {
    const [first, second] = validIntent().sections;
    return validIntent({ sections: [{ ...first, blocks: [{ type: 'p', text }] }, second], ...overrides });
}

describe('the fixture', () => {
    it('meets the quality contract as it stands', () => {
        expect(validateIntent(validIntent(), { tools: TOOLS })).toEqual([]);
    });
});

describe('changes', () => {
    it('needs both lists, written as plain sentences', () => {
        expect(codes(validIntent({ changes: undefined }))).toContain('intent-changes-missing');
        expect(codes(validIntent({ changes: {} }))).toContain('intent-changes-missing');
        expect(codes(validIntent({ changes: 'it compresses' }))).toContain('intent-changes-missing');

        const { does, doesNot } = validIntent().changes;
        expect(codes(validIntent({ changes: { does, doesNot: 'nothing at all' } }))).toContain('intent-changes-missing');
        expect(codes(validIntent({ changes: { does: [does[0], 42], doesNot } }))).toContain('intent-changes-missing');
    });

    it('needs two sentences a side, each between 20 and 160 characters', () => {
        const { does, doesNot } = validIntent().changes;

        expect(CHANGES_MIN_ENTRIES).toBe(2);
        expect(CHANGES_MIN_LENGTH).toBe(20);
        expect(CHANGES_MAX_LENGTH).toBe(160);

        expect(codes(validIntent({ changes: { does: does.slice(0, 1), doesNot } }))).toContain('intent-changes-short');
        expect(codes(validIntent({ changes: { does, doesNot: doesNot.slice(0, 1) } }))).toContain('intent-changes-short');
        expect(codes(validIntent({ changes: { does: [does[0], 'Too short.'], doesNot } }))).toContain('intent-changes-short');
        expect(codes(validIntent({ changes: { does: [does[0], `It ${'goes on '.repeat(25)}forever.`], doesNot } })))
            .toContain('intent-changes-short');
    });

    it('measures a link by its label, not by its markup', () => {
        const { does, doesNot } = validIntent().changes;
        const linked = 'Sends you to [the resizer](/resize) when the picture is simply too wide for the ceiling.';

        expect(codes(validIntent({ changes: { does: [does[0], linked], doesNot } }))).toEqual([]);
    });

    it('refuses the same sentence on both sides', () => {
        const { does, doesNot } = validIntent().changes;

        expect(codes(validIntent({ changes: { does, doesNot: [does[0], doesNot[1]] } })))
            .toContain('intent-changes-duplicate');
        expect(codes(validIntent({ changes: { does, doesNot: [`  ${does[0].toUpperCase()} `, doesNot[1]] } })))
            .toContain('intent-changes-duplicate');
    });
});

describe('limitations', () => {
    it('requires an indexable page to state at least one limit', () => {
        expect(codes(validIntent({ limitations: [] }))).toContain('intent-limitations-missing');
        expect(codes(validIntent({ limitations: undefined }))).toContain('intent-limitations-missing');
    });
});

describe('the processing statement', () => {
    const silent = {
        answer: 'A 50 KB ceiling is tight, and the target on this page is already filled in for you.',
        intro: 'The target is already set to 50 KB.',
    };

    it('requires the answer or the intro to say where the work happens', () => {
        expect(codes(validIntent(silent))).toContain('intent-processing-missing');
    });

    it.each([
        'on your own device',
        'on your own computer',
        'on your own machine',
        'in your browser',
        'in this tab',
        'it never leaves your computer',
        'the file is not uploaded',
        'nothing is uploaded',
        'nothing is ever sent',
    ])('accepts an answer that says the work happens %s', (phrase) => {
        expect(codes(validIntent({ ...silent, answer: `A 50 KB ceiling is tight, and the work happens ${phrase}.` })))
            .not.toContain('intent-processing-missing');
    });

    it('accepts the statement in the intro when the answer does not carry it', () => {
        expect(codes(validIntent({ ...silent, intro: 'The target is set to 50 KB and the work happens in this tab.' })))
            .not.toContain('intent-processing-missing');
    });
});

describe('related pages', () => {
    it('requires a site path besides the parent tool', () => {
        expect(codes(validIntent(), { links: () => ['/compress'] })).toContain('intent-related-missing');
        expect(codes(validIntent(), { links: () => [] })).toContain('intent-related-missing');
        expect(codes(validIntent(), { links: () => ['/compress', '/resize'] })).not.toContain('intent-related-missing');
    });

    it('is satisfied by the real link graph on a shipped page', () => {
        expect(codes(getIntent('png-to-jpg'))).not.toContain('intent-related-missing');
    });
});

describe('generic copy', () => {
    it.each([
        "In today's digital world, a form will ask for a small file.",
        'In today’s digital age, a form will ask for a small file.',
        'In todays digital era, a form will ask for a small file.',
        'Images are everywhere on an application form.',
        'An image is essential to almost every application.',
        'Images are crucial to a modern application form.',
        "Whether you're a student or a designer, the ceiling is the same.",
        'Whether youre a student or a designer, the ceiling is the same.',
        'Look no further for a way under the ceiling.',
        'With just a few clicks the picture is under the line.',
        'A hassle-free way to reach the ceiling every time.',
        'A hassle free way to reach the ceiling every time.',
        'Fast and easy compression for any application form.',
        'Quick and easy compression for any application form.',
        'The best free online compressor for an application form.',
        'It is 100% free and it always will be.',
        'In the modern world a form will ask for a small file.',
        'In the modern era a form will ask for a small file.',
        'A one-stop answer to every upload ceiling.',
        'A cutting-edge compressor for an application form.',
        'A seamless way under the ceiling every time.',
        'It works seamlessly on any application form.',
        'Unleash the pictures you already have.',
        'Elevate your application photographs today.',
        'A game-changer for anybody filling in a form.',
        'A game changer for anybody filling in a form.',
    ])('refuses %j', (text) => {
        expect(codes(withParagraph(text))).toContain('intent-generic-copy');
    });

    it('reads every string of the copy, not only the sections', () => {
        expect(codes(validIntent({ blurb: 'Look no further, the ceiling is preset' }))).toContain('intent-generic-copy');
        expect(codes(validIntent({ faqs: [
            { question: 'Is it free?', answer: 'It is 100% free.' },
            { question: 'What if it cannot get there?', answer: 'You are told the smallest size it reached.' },
            { question: 'Is it uploaded?', answer: 'No — it stays on your own device.' },
        ] }))).toContain('intent-generic-copy');
    });

    it('leaves the shipped registry alone', () => {
        for (const intent of INTENTS) {
            expect(codes(intent), `${intent.slug} tripped the generic-copy list`).not.toContain('intent-generic-copy');
        }
    });
});

/**
 * The list is shared with the guide registry (lib/catalog/guides/validate.js),
 * so the check is a function over strings rather than one over intent entries.
 * Filler is filler whichever content type types it, and two copies of the list
 * is how one of them quietly stops matching what the other rejects.
 */
describe('genericCopyProblems', () => {
    it('reads any list of strings and names the pattern and the sentence it hit', () => {
        const found = genericCopyProblems([
            'A hassle-free way to reach the ceiling.',
            'A ceiling that low is a database column, not a taste.',
            'Look no further, and it is 100% free.',
        ]);

        expect(found.map((problem) => problem.match)).toEqual(['hassle-free', 'Look no further', '100% free']);
        expect(found.map((problem) => problem.text)).toEqual([
            'A hassle-free way to reach the ceiling.',
            'Look no further, and it is 100% free.',
            'Look no further, and it is 100% free.',
        ]);
        expect(found.every((problem) => GENERIC_COPY_PATTERNS.includes(problem.pattern))).toBe(true);
    });

    it('takes one string as readily as a list, and reads a link by its label', () => {
        expect(genericCopyProblems('It is [100% free](/about) today.').map((problem) => problem.match))
            .toEqual(['100% free']);
    });

    it('finds nothing in copy that says something', () => {
        expect(genericCopyProblems(['A ceiling that low is a database column, not a taste.'])).toEqual([]);
        expect(genericCopyProblems([])).toEqual([]);
        expect(genericCopyProblems(undefined)).toEqual([]);
    });
});

describe('keyword stuffing', () => {
    it('sets both limits from the shipped pages, with the margin pinned', () => {
        expect(H1_PHRASE_CAP).toBe(6);
        expect(SLUG_WORD_SHARE_CAP).toBe(0.05);

        let repeats = 0;
        let share = 0;
        for (const intent of INTENTS) {
            const report = stuffingReport(intent);
            repeats = Math.max(repeats, report.phraseCount);
            share = Math.max(share, report.worstShare);
        }

        expect(repeats * 1.5, 'the busiest shipped page must stay 1.5x clear of the h1 repeat limit')
            .toBeLessThanOrEqual(H1_PHRASE_CAP);
        expect(share * 1.5, 'the heaviest shipped slug word must stay 1.5x clear of the share limit')
            .toBeLessThanOrEqual(SLUG_WORD_SHARE_CAP);
    });

    it('refuses a body that repeats the exact headline past the limit', () => {
        const sentence = 'Compress an Image to 50 KB, then check the figure. ';
        expect(codes(withParagraph(sentence.repeat(H1_PHRASE_CAP)))).toContain('intent-keyword-stuffing');
        expect(codes(withParagraph(sentence.repeat(2)))).not.toContain('intent-keyword-stuffing');
    });

    it('refuses one slug word that takes over the body', () => {
        expect(codes(withParagraph(`An ${'image '.repeat(60)}again.`))).toContain('intent-keyword-stuffing');
    });

    it('leaves the shipped registry alone', () => {
        for (const intent of INTENTS) {
            expect(codes(intent), `${intent.slug} tripped the stuffing limits`).not.toContain('intent-keyword-stuffing');
        }
    });
});

describe('formatsFor', () => {
    it('reads what each page accepts and saves off lib/limits.js', () => {
        expect(formatsFor(getIntent('png-to-jpg'), TOOLS)).toEqual({ input: ['png'], output: ['jpeg'] });
        expect(formatsFor(getIntent('webp-to-png'), TOOLS)).toEqual({ input: ['webp'], output: ['png'] });
        expect(formatsFor(getIntent('heic-to-jpg'), TOOLS)).toEqual({ input: ['heic'], output: ['jpeg'] });
        expect(formatsFor(getIntent('heic-to-png'), TOOLS)).toEqual({ input: ['heic'], output: ['png'] });
        // The unpreset pages read a whole list, and WHICH list is the thing
        // that goes wrong: /resize takes anything it can decode and writes
        // anything it can encode, while /compress keeps the format it was
        // given, so its two sides are one narrower list. Naming the constants
        // is what stops a format joining one of them and quietly joining the
        // other page's copy with it.
        expect(formatsFor(getIntent('resize-jpg'), TOOLS)).toEqual({
            input: RESIZE_INPUT_FORMATS,
            output: ALLOWED_OUTPUT_FORMATS,
        });
        expect(RESIZE_INPUT_FORMATS).toContain('avif');
        expect(formatsFor(validIntent(), TOOLS)).toEqual({
            input: RASTER_INPUT_FORMATS,
            output: RASTER_INPUT_FORMATS,
        });
        expect(RASTER_INPUT_FORMATS, 'the compressor does not take AVIF').not.toContain('avif');
    });

    it('returns nothing for a tool that cannot host a page', () => {
        expect(formatsFor(validIntent({ tool: 'crop' }), TOOLS)).toEqual({ input: [], output: [] });
    });
});

describe('format claims', () => {
    it('reports copy that offers to take a format the tool refuses', () => {
        expect(codes(withParagraph('Drop a GIF onto the panel and it comes back under the ceiling.')))
            .toContain('intent-format-claim');
        // /compress is the fixture's tool and AVIF is deliberately not on its
        // list — no rate controller, so a byte target would cost eight searched
        // encodes. An offer to take one there is still a false promise even
        // though /convert takes AVIF now.
        expect(codes(withParagraph('Bring an AVIF and it is squeezed down the same way.')))
            .toContain('intent-format-claim');
    });

    it('reports a format the parent tool takes but this page does not', () => {
        const convert = validIntent({
            tool: 'convert',
            kind: 'conversion',
            preset: { from: 'png', to: 'jpeg' },
            sections: [
                { id: 'a', heading: 'A', blocks: [{ type: 'p', text: 'Drag a WebP into the panel and it converts.' }] },
                validIntent().sections[1],
            ],
        });

        expect(codes(convert)).toContain('intent-format-claim');
    });

    it('leaves an accurate offer, and a mention that is not an offer, alone', () => {
        expect(codes(withParagraph('Drag a JPEG, PNG or WebP into the panel above.'))).not.toContain('intent-format-claim');
        expect(codes(withParagraph('A GIF is not something this page can read, and it says so.')))
            .not.toContain('intent-format-claim');
        expect(codes(withParagraph('An AVIF is read by the browser itself, and this page still refuses one.')))
            .not.toContain('intent-format-claim');
        expect(codes(withParagraph('Can you attach a GIF to an email? That is a question about the email.')))
            .not.toContain('intent-format-claim');
    });

    it('leaves the shipped registry alone', () => {
        for (const intent of INTENTS) {
            expect(codes(intent), `${intent.slug} tripped the format-claim rule`).not.toContain('intent-format-claim');
        }
    });
});

describe('a page kept out of the index', () => {
    it('is exempt from every quality rule', () => {
        const draft = validIntent({
            indexable: false,
            changes: undefined,
            limitations: [],
            answer: 'A 50 KB ceiling is tight, and the target on this page is already filled in for you.',
            blurb: 'Look no further, the ceiling is preset',
        });

        for (const code of codes(draft)) {
            expect(code).not.toMatch(/^intent-(changes|limitations|processing|related|generic-copy|keyword-stuffing|format-claim)/);
        }
    });
});
