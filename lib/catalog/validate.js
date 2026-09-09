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
import { LONGTAIL_PAGES } from './intents';
import { ASPECT_RATIOS, SOCIAL_PRESETS } from './presets';
import { TOOLS } from './tools';
import { withinPixelBudget } from '@/lib/image/dimensions';
import { MAX_DIMENSION } from '@/lib/limits';

/**
 * Paths a static route or a file convention already owns. An intent slug that
 * lands on one of these would be shadowed by the static route, so it is
 * refused up front rather than silently never served.
 */
const RESERVED_PATHS = ['/', '/about', '/tools', '/api', '/sitemap.xml', '/robots.txt', '/manifest.webmanifest'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    intents = LONGTAIL_PAGES,
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

    return problems;
}

export function assertCatalogValid(registry) {
    const problems = validateCatalog(registry);
    if (problems.length === 0) return;

    throw new Error(
        `The site catalogue is invalid:\n${problems.map((entry) => `  - [${entry.code}] ${entry.message}`).join('\n')}`,
    );
}
