/**
 * Site Catalogue
 *
 * The one front door to the product registries: the tools, their categories,
 * the intent routes, the platform presets, the relationships between them and
 * the validator that keeps the lot consistent. Pages, the site chrome, the
 * sitemap and the tests import `@/lib/catalog` and nothing below it needs to
 * know which module an export lives in.
 *
 * This package is COPY — titles, descriptions, blurbs — and it may read
 * lib/limits.js to quote a number. The reverse edge is the forbidden one:
 * nothing under lib/image-client/ may reach this package, because the worker
 * downloads the engine's chunk and page copy has no business in it.
 * tests/architecture/boundaries.test.js holds that line.
 */
export { BEHAVIOUR, behaviourFor, validateBehaviour } from './behaviour';
export { CATEGORIES, categoriesWithProducts, getCategory, toolsInCategory } from './categories';
export { GUIDES, getGuide, indexableGuides } from './guides';
export { assertGuidesValid, validateGuide, validateGuides } from './guides/validate';
export { INTENTS, getIntent, intentsFor } from './intents';
export { ASPECT_RATIOS, SOCIAL_PRESETS, getSocialPreset, socialPresetGroups } from './presets';
export { intentCopy } from './copy';
export { inboundLinks, intentLinks, relatedTools } from './relations';
export { TOOLS, getTool, sitemapTools } from './tools';
export { assertCatalogValid, validateCatalog } from './validate';
