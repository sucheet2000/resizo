/**
 * DEAD FILE — SPLIT INTO lib/limits.js AND lib/catalog.js. AWAITING DELETION.
 *
 * This module used to be two unrelated concerns fused together: the engine
 * limits and format allowlists the image pipeline reads, and the site catalogue
 * of tool titles, descriptions and long-tail blurbs the pages read. With 38 of
 * 101 modules importing it, that fusion put marketing copy into the same built
 * chunk as the limits — a chunk the WEB WORKER downloads and parses, for
 * strings it can never render — and made every copy edit invalidate a chunk the
 * image engine depends on.
 *
 * The two halves now live where they belong:
 *
 *   lib/limits.js   MAX_FILE_SIZE, MAX_DIMENSION, MAX_PIXELS, DEFAULT_QUALITY,
 *                   TARGET_SEARCH_ITERATIONS and every format allowlist
 *   lib/catalog.js  TOOLS, LONGTAIL_PAGES, SOCIAL_PRESETS and their lookups
 *
 * EVERY IMPORTER IN THIS REPO HAS BEEN RE-POINTED. Nothing imports this file,
 * so the bundler drops it and it costs no bytes. It survives only because
 * deleting a source file needs the project owner's explicit confirmation, which
 * has not been given. IMPORT FROM lib/limits.js OR lib/catalog.js, NEVER HERE.
 */
export * from '@/lib/limits';
export * from '@/lib/catalog';
