/**
 * The guide validator.
 *
 * Same job as lib/catalog/validate.js does for intents, for a content type
 * whose failure modes are different. An intent page can be wrong by
 * preconfiguring a tool with settings it cannot honour; a guide can be wrong
 * by claiming a finding it never measured, by citing a source nobody checked,
 * by carrying a revision date that predates its own publication, or by being
 * another page with the numbers swapped. Each of those is a rule below, and
 * each returns a problem naming the entry, so a failure reads as a fix.
 *
 * Pure functions over plain data: the shipped registry is the default, and a
 * test can hand in a broken one to prove a rule fires. The guide route calls
 * assertGuidesValid() from generateStaticParams, so a broken entry fails
 * `next build` rather than shipping.
 *
 * This module reads the intent and tool registries but nothing reads it back —
 * lib/catalog/guides/index.js deliberately does not import it, because a
 * registry that imported its own validator would be a static cycle.
 *
 * It reads nothing outside lib/catalog/ either. AUTHOR_NAME lives in
 * lib/seo.js, which the catalogue package may not import
 * (tests/lib/module-boundaries.test.js), so the expected byline is INJECTED:
 * the route passes it in, and with nothing passed the weaker rule still holds —
 * every guide must at least agree with every other on who wrote it.
 */
import { GUIDES } from './index';
import { inlineLinks, isLinkTarget, plainText } from '../inline';
import { INTENTS } from '../intents';
import { genericCopyProblems, stuffingReportFor, H1_PHRASE_CAP, SLUG_WORD_SHARE_CAP } from '../quality';
import { bodySimilarity } from '../similarity';
import { TOOLS } from '../tools';

/**
 * Slugs a route under /guides already owns, or would read as a directory
 * rather than a page. `/guides/index` and `/guides/guides` are the two a
 * writer reaches for without thinking.
 */
const RESERVED_GUIDE_SLUGS = ['index', 'guides', 'api', 'sitemap', 'robots'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const isText = (value) => typeof value === 'string' && value.trim() !== '';

const isTextList = (value) => Array.isArray(value) && value.every(isText);

/**
 * The answer is the whole reason the page ranks: it sits first, it is what a
 * snippet quotes, and it has to be readable with nothing else around it. Three
 * to five sentences is the spec; this is the floor below which it is a
 * headline pretending to be a finding.
 */
const MIN_ANSWER_LENGTH = 120;

/** A next-job line is a sentence a reader can act on, not a link label. */
const MIN_NEXT_JOB_LENGTH = 30;

function blockProblem(block) {
    if (!block || typeof block !== 'object') return 'a block must be an object';

    if (block.type === 'p') {
        return isText(block.text) ? null : 'a paragraph needs text';
    }

    if (block.type === 'ul') {
        return isTextList(block.items) && block.items.length > 0 ? null : 'a list needs at least one non-empty item';
    }

    if (block.type === 'table') {
        if (!isText(block.caption)) return 'a table needs a caption';
        if (!Array.isArray(block.columns) || block.columns.length < 2) return 'a table needs at least two columns';
        if (!block.columns.every((column) => column && isText(column.key) && isText(column.label))) {
            return 'every table column needs a key and a label';
        }
        if (block.columns.filter((column) => column.rowHeader).length > 1) return 'a table may have one row-header column';
        if (!Array.isArray(block.rows) || block.rows.length === 0) return 'a table needs at least one row';
        const keys = block.columns.map((column) => column.key);
        if (!block.rows.every((row) => row && typeof row === 'object' && keys.every((key) => isText(row[key])))) {
            return 'every table row needs text under every column key';
        }
        return null;
    }

    return `unknown block type "${block?.type}"`;
}

const asList = (value) => (Array.isArray(value) ? value : []);

function blockLinkProblems(block) {
    const texts = block?.type === 'ul' ? asList(block.items) : [block?.text];
    return texts
        .flatMap((text) => inlineLinks(text))
        .filter((link) => !isText(link.label) || !isLinkTarget(link.href))
        .map((link) => `[${link.label}](${link.href})`);
}

function sourceProblem(source) {
    if (!source || typeof source !== 'object') return 'a source must be an object';
    if (typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) return 'a source needs an absolute https url';
    if (!isText(source.label)) return 'a source needs a label';
    if (!ISO_DATE.test(source.verifiedAt ?? '') || source.verifiedAt > todayUtc()) {
        return 'a source needs a verifiedAt calendar date that has already happened';
    }
    return null;
}

const isBadDate = (value) => !ISO_DATE.test(value ?? '') || value > todayUtc();

/**
 * The guide's own prose, in the shape lib/catalog/similarity.js compares.
 *
 * bodySimilarity() walks an intent — sections and FAQs — and a guide keeps
 * both of those field names on purpose, so the only work here is folding the
 * methodology in as one more section. That is what lets a guide be measured
 * against every intent as well as every other guide: the doorway move does not
 * care which content type it is copying from.
 */
function comparableBody(guide) {
    const methodology = asList(guide?.methodology).length > 0
        ? [{ id: 'methodology', heading: 'Methodology', blocks: guide.methodology }]
        : [];

    return {
        sections: [...asList(guide?.sections), ...methodology],
        faqs: asList(guide?.faqs),
    };
}

/**
 * Every sentence a reader sees, which is what the quality rules read. Nothing
 * here may assume a field is the shape it should be: the quality rules run
 * alongside the shape rules, on the same broken entry, not after them.
 */
function guideProse(guide) {
    const fromBlocks = (blocks) => asList(blocks).flatMap((block) => {
        if (block?.type === 'p') return [block.text];
        if (block?.type === 'ul') return asList(block.items);
        return [];
    });

    return [
        guide?.answer,
        ...fromBlocks(guide?.methodology),
        ...asList(guide?.sections).flatMap((section) => [section?.heading, ...fromBlocks(section?.blocks)]),
        ...asList(guide?.faqs).flatMap((faq) => [faq?.question, faq?.answer]),
    ]
        .filter((value) => typeof value === 'string')
        .map(plainText);
}

/**
 * Every way one guide can render or rank wrong on its own. `tools` and
 * `intents` are the registries a `relatedTools` entry must point into.
 */
export function validateGuide(guide, { tools = TOOLS, intents = INTENTS, author } = {}) {
    const problems = [];
    const subject = guide?.slug ?? '(unnamed guide)';
    const problem = (code, message) => problems.push({ code, subject, message });

    for (const field of ['slug', 'title', 'h1', 'description', 'answer', 'author']) {
        if (!isText(guide?.[field])) problem(`guide-${field}-missing`, `guide "${subject}" has no ${field}`);
    }

    if (isText(guide?.slug) && !SLUG.test(guide.slug)) {
        problem('guide-slug-malformed', `guide slug "${guide.slug}" is not lower-case words joined by hyphens`);
    }

    if (isText(author) && isText(guide?.author) && guide.author !== author) {
        problem('guide-author-invalid', `guide "${subject}" is bylined "${guide.author}"; this site has one author and it is ${author}`);
    }

    if (isText(guide?.answer) && plainText(guide.answer).trim().length < MIN_ANSWER_LENGTH) {
        problem('guide-answer-missing', `guide "${subject}" has an answer of ${plainText(guide.answer).trim().length} characters; the finding goes first and has to read on its own, so it needs at least ${MIN_ANSWER_LENGTH}`);
    }

    if (isBadDate(guide?.published) || isBadDate(guide?.modified)) {
        problem('guide-dates-invalid', `guide "${subject}" needs published and modified as YYYY-MM-DD dates that have already happened (got ${guide?.published} and ${guide?.modified})`);
    } else if (guide.modified < guide.published) {
        problem('guide-dates-invalid', `guide "${subject}" was modified ${guide.modified}, before it was published ${guide.published}`);
    }

    if (typeof guide?.basedOnOfficialRequirements !== 'boolean') {
        problem('guide-official-invalid', `guide "${subject}": basedOnOfficialRequirements must be true or false`);
    }

    const sources = asList(guide?.sources);
    if (guide?.basedOnOfficialRequirements === true && sources.length === 0) {
        problem('guide-sources-missing', `guide "${subject}" rests on an official requirement and must cite it, with the date the source was checked`);
    }
    for (const source of sources) {
        const found = sourceProblem(source);
        if (found) problem('guide-source-invalid', `guide "${subject}": ${found}`);
    }

    const related = asList(guide?.relatedTools);
    if (related.length === 0 || !related.every((entry) => entry && isText(entry.slug) && isText(entry.nextJob) && plainText(entry.nextJob).trim().length >= MIN_NEXT_JOB_LENGTH)) {
        problem('guide-related-invalid', `guide "${subject}" needs relatedTools: [{ slug, nextJob }], each nextJob a sentence of at least ${MIN_NEXT_JOB_LENGTH} characters saying what the reader does there`);
    }
    const destinations = new Set([...tools.map((tool) => tool.slug), ...intents.map((intent) => intent.slug)]);
    for (const entry of related) {
        if (isText(entry?.slug) && !destinations.has(entry.slug)) {
            problem('guide-related-unknown', `guide "${subject}" sends the reader to "${entry.slug}", which is neither a tool nor an intent page`);
        }
    }

    if (guide?.methodology !== undefined) {
        const methodology = Array.isArray(guide.methodology) ? guide.methodology : null;
        if (!methodology || methodology.length === 0 || methodology.some((block) => blockProblem(block) !== null)) {
            problem('guide-methodology-invalid', `guide "${subject}": methodology must be a non-empty list of p, ul and table blocks describing how the numbers were produced`);
        }
    }

    const sections = asList(guide?.sections);
    if (
        sections.length < 2
        || !sections.every((section) => section && SLUG.test(section.id ?? '') && isText(section.heading) && Array.isArray(section.blocks) && section.blocks.length > 0)
    ) {
        problem('guide-sections-invalid', `guide "${subject}" needs at least two sections, each with an id, a heading and a block`);
    }
    for (const id of duplicates(sections.map((section) => section?.id))) {
        problem('guide-section-id-duplicate', `guide "${subject}" uses the section id "${id}" twice`);
    }

    for (const [where, blocks] of [
        ['methodology', Array.isArray(guide?.methodology) ? guide.methodology : []],
        ...sections.map((section) => [`section "${section?.id}"`, Array.isArray(section?.blocks) ? section.blocks : []]),
    ]) {
        for (const block of blocks) {
            const found = blockProblem(block);
            if (found && where !== 'methodology') problem('guide-block-invalid', `guide "${subject}", ${where}: ${found}`);

            for (const link of blockLinkProblems(block)) {
                problem('guide-link-invalid', `guide "${subject}", ${where}: the link ${link} needs a label and a site path or https target`);
            }
        }
    }

    if (guide?.faqs !== undefined) {
        const faqs = Array.isArray(guide.faqs) ? guide.faqs : null;
        if (!faqs || faqs.length === 0 || !faqs.every((faq) => faq && isText(faq.question) && isText(faq.answer))) {
            problem('guide-faqs-invalid', `guide "${subject}": faqs must be omitted or a non-empty list of { question, answer }`);
        }
    }

    if (typeof guide?.indexable !== 'boolean') {
        problem('guide-indexable-invalid', `guide "${subject}": indexable must be true or false`);
    }

    // The filler rule is lib/catalog/quality.js's, called rather than copied:
    // filler is filler whichever content type types it, and two lists is how
    // one of them quietly stops matching what the other rejects.
    const stuffing = stuffingReportFor({ slug: guide?.slug, h1: guide?.h1, body: guideProse(guide) });
    if (stuffing.phraseCount > H1_PHRASE_CAP || stuffing.worstShare > SLUG_WORD_SHARE_CAP) {
        problem('guide-keyword-stuffing',
            `guide "${subject}" repeats its headline ${stuffing.phraseCount} times or leans on one slug word for `
            + `${(stuffing.worstShare * 100).toFixed(1)}% of its body; the caps are ${H1_PHRASE_CAP} and `
            + `${SLUG_WORD_SHARE_CAP * 100}%`);
    }

    for (const found of genericCopyProblems(guideProse(guide))) {
        problem('guide-generic-copy', `guide "${subject}": "${found.match}" is filler any page could carry — a guide earns its URL by answering something, so write the finding instead: "${found.text.slice(0, 60)}"`);
    }

    return problems;
}

/**
 * Two pages whose bodies still match this closely once numbers and format
 * names are masked are one page twice. The same limit the intent registry
 * uses, deliberately: a guide copied from an intent page, or from another
 * guide with the format names swapped, is the same defect either way.
 */
export const GUIDE_DOORWAY_SIMILARITY = 0.35;

/**
 * Every guide against the contract, plus the things only a pair can get
 * wrong: a slug something else already answers to, a title or headline
 * another page carries, and a body that reads as another page's.
 */
export function validateGuides(guides, { tools = TOOLS, intents = INTENTS, author } = {}) {
    const list = Array.isArray(guides) ? guides : [];
    const problems = list.flatMap((guide) => validateGuide(guide, { tools, intents, author }));
    const problem = (code, subject, message) => problems.push({ code, subject, message });

    // With no expected byline injected, the rule is still that this site has
    // one author: two guides claiming different ones is a contradiction the
    // registry can see without knowing which is right.
    const bylines = [...new Set(list.map((guide) => guide?.author).filter(isText))];
    if (!isText(author) && bylines.length > 1) {
        problem('guide-author-invalid', bylines.join(', '), `the registry is bylined to ${bylines.length} different people (${bylines.join(', ')}); this site has one author`);
    }

    const taken = new Map([
        ...tools.map((tool) => [tool.slug, `the ${tool.slug} tool`]),
        ...intents.map((intent) => [intent.slug, `the ${intent.path} intent page`]),
        ...RESERVED_GUIDE_SLUGS.map((slug) => [slug, 'a reserved path']),
    ]);

    for (const guide of list) {
        const owner = taken.get(guide?.slug);
        if (owner) {
            problem('guide-slug-collision', guide.slug, `guide "${guide.slug}" claims a slug ${owner} already answers to`);
        }
    }
    for (const slug of duplicates(list.map((guide) => guide?.slug).filter(Boolean))) {
        problem('guide-slug-collision', slug, `guide slug "${slug}" is declared more than once`);
    }

    const titles = new Map([
        ...tools.map((tool) => [tool.title?.trim().toLowerCase(), `the ${tool.slug} tool`]),
        ...intents.map((intent) => [intent.title?.trim().toLowerCase(), `the ${intent.path} intent page`]),
    ]);
    for (const guide of list) {
        const owner = titles.get(guide?.title?.trim().toLowerCase());
        if (owner) {
            problem('guide-title-duplicate', guide.slug, `guide "${guide.slug}" carries the same title as ${owner}; two results with one title are one result Google collapses`);
        }
    }

    for (const field of ['title', 'h1', 'description']) {
        const values = list.map((guide) => (guide?.[field] ?? '').trim().toLowerCase());
        for (const value of duplicates(values.filter(Boolean))) {
            const owners = list.filter((guide) => (guide?.[field] ?? '').trim().toLowerCase() === value).map((guide) => guide.slug);
            problem(`guide-${field}-duplicate`, owners.join(', '), `${owners.join(' and ')} share a ${field}, which is the doorway-page shape`);
        }
    }

    const others = [
        ...list.map((guide) => ({ slug: guide?.slug, kind: 'guide', body: comparableBody(guide) })),
        ...intents.map((intent) => ({ slug: intent.slug, kind: 'intent page', body: intent })),
    ];

    for (const guide of list) {
        const body = comparableBody(guide);
        for (const other of others) {
            if (other.kind === 'guide' && other.slug === guide?.slug) continue;

            const score = bodySimilarity(body, other.body);
            if (score >= GUIDE_DOORWAY_SIMILARITY) {
                problem('guide-doorway', `${guide?.slug}, ${other.slug}`, `guide "${guide?.slug}" reads as the ${other.kind} "${other.slug}" once numbers and format names are masked (${score.toFixed(2)} of their three-word runs are shared; the limit is ${GUIDE_DOORWAY_SIMILARITY}). Write a different page, with its own job and its own answer`);
            }
        }
    }

    return problems;
}

function duplicates(values) {
    const seen = new Set();
    const repeated = new Set();
    for (const value of values) {
        if (seen.has(value)) repeated.add(value);
        seen.add(value);
    }
    return [...repeated];
}

/**
 * Throws with every problem at once, so one build failure fixes one page.
 * The route passes `{ author: AUTHOR_NAME }` — see the note at the top of this
 * file for why the name is not read from lib/seo.js here.
 */
export function assertGuidesValid(guides = GUIDES, options) {
    const problems = validateGuides(guides, options);
    if (problems.length === 0) return;

    throw new Error(
        `The guide registry is invalid:\n${problems.map((entry) => `  - [${entry.code}] ${entry.message}`).join('\n')}`,
    );
}
