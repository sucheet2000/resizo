/**
 * The registry validator.
 *
 * Every rule here is a way a registry entry can be wrong without anything in
 * the build noticing: two tools on one path, a tool in a category that does
 * not exist, an intent hung off a tool with no page, a preset the resizer would
 * refuse. Each returns a problem naming the entry, so a failure reads as a fix
 * rather than a stack trace.
 *
 * Pure functions over plain data: the shipped registries are the defaults,
 * and a test can hand in a broken one to prove a rule fires. The intent route
 * calls assertCatalogValid() from generateStaticParams, so a broken registry
 * fails `next build` rather than shipping.
 */
import { CATEGORIES } from './categories';
import { inlineLinks, isLinkTarget } from './inline';
import { INTENTS } from './intents';
import { ASPECT_RATIOS, SOCIAL_PRESETS } from './presets';
import { TOOLS } from './tools';
import { withinPixelBudget } from '@/lib/image/dimensions';
import {
    CONVERT_INPUT_FORMATS,
    CONVERT_OUTPUT_FORMATS,
    MAX_DIMENSION,
    MAX_TARGET_BYTES,
    MIN_TARGET_BYTES,
} from '@/lib/limits';

/**
 * Paths a static route or a file convention already owns. An intent slug that
 * lands on one of these would be shadowed by the static route, so it is
 * refused up front rather than silently never served.
 */
const RESERVED_PATHS = ['/', '/about', '/tools', '/api', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const isText = (value) => typeof value === 'string' && value.trim() !== '';

const isTextList = (value) => Array.isArray(value) && value.every(isText);

/**
 * What kind of job an intent page answers. The distinction matters to the
 * validator: a page built on an external standard (a passport photo size, a
 * platform's published spec) must cite where the numbers came from and when
 * they were last checked, or its copy is an unverifiable claim.
 */
export const INTENT_KINDS = ['format', 'conversion', 'target', 'standard'];

/**
 * The preset each tool can honour, or null where the tool takes no preset yet.
 * A tool absent from this table cannot host an intent at all: the shared route
 * would render it with settings it does not understand. Extend the table when
 * a tool learns a `preset` prop, in the same change that teaches it.
 */
const PRESET_RULES = {
    compress(preset) {
        if (!preset || typeof preset !== 'object') return 'needs a { targetKb } preset';
        const keys = Object.keys(preset);
        if (keys.length !== 1 || keys[0] !== 'targetKb') return 'may only set targetKb';
        const floor = Math.ceil(MIN_TARGET_BYTES / 1024);
        const ceiling = Math.floor(MAX_TARGET_BYTES / 1024);
        if (!Number.isSafeInteger(preset.targetKb) || preset.targetKb < floor || preset.targetKb > ceiling) {
            return `targetKb must be a whole number from ${floor} to ${ceiling}`;
        }
        return null;
    },
    convert(preset) {
        if (!preset || typeof preset !== 'object') return 'needs a { from, to } preset';
        const keys = Object.keys(preset).sort();
        if (keys.join(',') !== 'from,to') return 'may only set from and to';
        if (!CONVERT_INPUT_FORMATS.includes(preset.from)) return `from must be one of ${CONVERT_INPUT_FORMATS.join(', ')}`;
        if (!CONVERT_OUTPUT_FORMATS.includes(preset.to)) return `to must be one of ${CONVERT_OUTPUT_FORMATS.join(', ')}`;
        if (preset.from === preset.to) return 'from and to must differ';
        return null;
    },
    resize(preset) {
        return preset === null ? null : 'takes no preset yet — the resizer has no preset prop';
    },
    heic(preset) {
        return preset === null ? null : 'takes no preset yet — the HEIC converter has no preset prop';
    },
};

/** The tools an intent may hang off, which the route's component map must match. */
export const INTENT_CAPABLE_TOOLS = Object.keys(PRESET_RULES);

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

function linkProblems(text) {
    return inlineLinks(text)
        .filter((link) => !isText(link.label) || !isLinkTarget(link.href))
        .map((link) => `[${link.label}](${link.href})`);
}

function sourceProblem(source) {
    if (!source || typeof source !== 'object') return 'a source must be an object';
    if (typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) return 'a source needs an https url';
    if (!isText(source.title)) return 'a source needs a title';
    if (!ISO_DATE.test(source.verifiedAt ?? '') || source.verifiedAt > todayUtc()) {
        return 'a source needs a verifiedAt calendar date that has already happened';
    }
    return null;
}

/**
 * Every way one entry can render wrong. `tools` is the tool registry the
 * intent must belong to; the tool's preset rule decides what the intent may
 * preconfigure.
 */
export function validateIntent(intent, { tools = TOOLS } = {}) {
    const problems = [];
    const subject = intent?.slug ?? '(unnamed intent)';
    const problem = (code, message) => problems.push({ code, subject, message });

    for (const field of [
        'slug', 'tool', 'kind', 'label', 'blurb', 'title', 'h1', 'intro', 'description', 'ogImage', 'answer', 'lastModified',
    ]) {
        if (!isText(intent?.[field])) problem(`intent-${field}-missing`, `intent "${subject}" has no ${field}`);
    }

    if (isText(intent?.kind) && !INTENT_KINDS.includes(intent.kind)) {
        problem('intent-kind-unknown', `intent "${subject}" is of kind "${intent.kind}"; use one of ${INTENT_KINDS.join(', ')}`);
    }

    const tool = tools.find((candidate) => candidate.slug === intent?.tool);
    const rule = tool ? PRESET_RULES[tool.slug] : undefined;
    if (!rule) {
        problem('intent-tool-unsupported', `intent "${subject}" hangs off "${intent?.tool}", which cannot host an intent page — only ${INTENT_CAPABLE_TOOLS.join(', ')} can`);
    } else {
        const presetProblem = rule(intent.preset === undefined ? null : intent.preset);
        if (presetProblem) problem('intent-preset-invalid', `intent "${subject}": the ${tool.slug} preset ${presetProblem}`);
    }

    const application = intent?.application;
    if (!application || !isText(application.name) || !isTextList(application.features) || application.features.length === 0) {
        problem('intent-application-invalid', `intent "${subject}" needs application: { name, features: [...] }`);
    }

    const howTo = intent?.howTo;
    const steps = Array.isArray(howTo?.steps) ? howTo.steps : [];
    if (
        !howTo
        || !SLUG.test(howTo.id ?? '')
        || !isText(howTo.heading)
        || !isText(howTo.description)
        || steps.length < 3
        || !steps.every((step) => step && isText(step.name) && isText(step.text))
    ) {
        problem('intent-howto-invalid', `intent "${subject}" needs howTo: { id, heading, description, steps: [three or more { name, text }] }`);
    }

    const sections = Array.isArray(intent?.sections) ? intent.sections : [];
    if (
        sections.length < 2
        || !sections.every((section) => section && SLUG.test(section.id ?? '') && isText(section.heading) && Array.isArray(section.blocks) && section.blocks.length > 0)
    ) {
        problem('intent-sections-invalid', `intent "${subject}" needs at least two sections, each with an id, a heading and a block`);
    }
    for (const id of duplicates(sections.map((section) => section?.id))) {
        problem('intent-section-id-duplicate', `intent "${subject}" uses the section id "${id}" twice`);
    }
    for (const section of sections) {
        for (const block of Array.isArray(section?.blocks) ? section.blocks : []) {
            const found = blockProblem(block);
            if (found) problem('intent-block-invalid', `intent "${subject}", section "${section.id}": ${found}`);

            const texts = block?.type === 'ul' ? (block.items ?? []) : [block?.text];
            for (const link of texts.flatMap((text) => linkProblems(text))) {
                problem('intent-link-invalid', `intent "${subject}", section "${section.id}": the link ${link} needs a label and a site path or https target`);
            }
        }
    }

    if (intent?.limitations !== undefined && !isTextList(intent.limitations)) {
        problem('intent-limitations-invalid', `intent "${subject}": limitations must be a list of sentences`);
    }

    const faqs = Array.isArray(intent?.faqs) ? intent.faqs : [];
    if (faqs.length < 3 || !faqs.every((faq) => faq && isText(faq.question) && isText(faq.answer))) {
        problem('intent-faqs-invalid', `intent "${subject}" needs at least three FAQs, each with a question and an answer`);
    }

    const siblings = intent?.siblingLinks;
    if (siblings !== null && siblings !== undefined && !(typeof siblings === 'object' && isText(siblings.heading))) {
        problem('intent-siblings-invalid', `intent "${subject}": siblingLinks must be null or { heading }`);
    }

    const sources = Array.isArray(intent?.sources) ? intent.sources : [];
    if (intent?.kind === 'standard' && sources.length === 0) {
        problem('intent-sources-required', `intent "${subject}" is built on an external standard and must cite its sources with a verifiedAt date`);
    }
    for (const source of sources) {
        const found = sourceProblem(source);
        if (found) problem('intent-source-invalid', `intent "${subject}": ${found}`);
    }

    if (isText(intent?.lastModified) && (!ISO_DATE.test(intent.lastModified) || intent.lastModified > todayUtc())) {
        problem('intent-lastmodified-invalid', `intent "${subject}": lastModified must be a YYYY-MM-DD date that has already happened`);
    }

    if (typeof intent?.indexable !== 'boolean') {
        problem('intent-indexable-invalid', `intent "${subject}": indexable must be true or false`);
    }

    if (isText(intent?.ogImage) && !intent.ogImage.startsWith('/')) {
        problem('intent-ogimage-invalid', `intent "${subject}": ogImage must be a path under public/`);
    }

    return problems;
}

/** Every intent against the contract, plus the things only a pair can get wrong. */
export function validateIntents(intents, { tools = TOOLS } = {}) {
    const problems = intents.flatMap((intent) => validateIntent(intent, { tools }));

    for (const field of ['title', 'h1', 'description', 'answer']) {
        const values = intents.map((intent) => (intent?.[field] ?? '').trim().toLowerCase());
        for (const value of duplicates(values.filter(Boolean))) {
            const owners = intents.filter((intent) => (intent?.[field] ?? '').trim().toLowerCase() === value).map((intent) => intent.slug);
            problems.push({
                code: `intent-${field}-duplicate`,
                subject: owners.join(', '),
                message: `${owners.join(' and ')} share a ${field}, which is the doorway-page shape`,
            });
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

export function validateCatalog({
    tools = TOOLS,
    categories = CATEGORIES,
    presets = SOCIAL_PRESETS,
    ratios = ASPECT_RATIOS,
    intents = INTENTS,
} = {}) {
    const problems = [];
    const problem = (code, subject, message) => problems.push({ code, subject, message });

    const categoryIds = new Set(categories.map((category) => category.id));
    for (const id of duplicates(categories.map((category) => category.id))) {
        problem('category-id-duplicate', id, `category id "${id}" is declared more than once`);
    }

    for (const slug of duplicates(tools.map((tool) => tool.slug))) {
        problem('tool-slug-duplicate', slug, `tool slug "${slug}" is declared more than once`);
    }
    for (const tool of tools) {
        if (!SLUG.test(tool.slug)) {
            problem('slug-malformed', tool.slug, `tool slug "${tool.slug}" is not lower-case words joined by hyphens`);
        }
        if (!categoryIds.has(tool.category)) {
            problem('tool-category-unknown', tool.slug, `tool "${tool.slug}" is in category "${tool.category}", which does not exist`);
        }
        if (tool.hasOwnPage && tool.href !== `/${tool.slug}`) {
            problem('tool-href-mismatch', tool.slug, `tool "${tool.slug}" has a page but its href is ${tool.href}`);
        }
    }

    const ownPageTools = new Map(tools.filter((tool) => tool.hasOwnPage).map((tool) => [tool.slug, tool]));

    for (const slug of duplicates(intents.map((intent) => intent.slug))) {
        problem('intent-slug-duplicate', slug, `intent slug "${slug}" is declared more than once`);
    }
    for (const intent of intents) {
        if (!SLUG.test(intent.slug)) {
            problem('slug-malformed', intent.slug, `intent slug "${intent.slug}" is not lower-case words joined by hyphens`);
        }
        if (intent.path !== `/${intent.slug}`) {
            problem('intent-path-mismatch', intent.slug, `intent "${intent.slug}" is served at /${intent.slug} but declares ${intent.path}`);
        }
        if (!ownPageTools.has(intent.tool)) {
            problem('intent-parent-invalid', intent.slug, `intent "${intent.slug}" belongs to "${intent.tool}", which is not a tool with a page of its own`);
        }
        if (RESERVED_PATHS.includes(intent.path) || intent.path.startsWith('/api/')) {
            problem('path-reserved', intent.slug, `intent "${intent.slug}" claims ${intent.path}, which a static route already owns`);
        }
    }

    const paths = [
        ...tools.map((tool) => tool.href),
        ...intents.map((intent) => intent.path),
    ];
    for (const path of duplicates(paths)) {
        problem('path-duplicate', path, `${path} is claimed by more than one route`);
    }

    for (const id of duplicates(presets.map((preset) => preset.id))) {
        problem('preset-id-duplicate', id, `preset id "${id}" is declared more than once`);
    }
    for (const preset of presets) {
        const inRange = Number.isSafeInteger(preset.width) && Number.isSafeInteger(preset.height)
            && preset.width > 0 && preset.height > 0
            && preset.width <= MAX_DIMENSION && preset.height <= MAX_DIMENSION
            && withinPixelBudget(preset.width, preset.height);
        if (!inRange) {
            problem('preset-out-of-range', preset.id, `preset "${preset.id}" is ${preset.width}×${preset.height}, which the resizer would refuse`);
        }
    }

    for (const id of duplicates(ratios.map((ratio) => ratio.id))) {
        problem('ratio-id-duplicate', id, `aspect ratio id "${id}" is declared more than once`);
    }

    problems.push(...validateIntents(intents, { tools }));

    return problems;
}

export function assertCatalogValid(registry) {
    const problems = validateCatalog(registry);
    if (problems.length === 0) return;

    throw new Error(
        `The site catalogue is invalid:\n${problems.map((entry) => `  - [${entry.code}] ${entry.message}`).join('\n')}`,
    );
}
