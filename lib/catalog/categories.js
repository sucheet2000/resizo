/**
 * Product categories — the need a visitor arrives with.
 *
 * A category groups tools by the job somebody came to do, never by file type
 * or by which library does the work: "Combine into one file" holds the two
 * tools whose output is a PDF because that is the need, and there is still no
 * PDF product, PDF hub or PDF heading anywhere on the site.
 *
 * Every tool names its category in lib/catalog/tools.js; this file only
 * describes the categories and derives their members. A category with nothing
 * in it is never shown — categoriesWithProducts() is what the /tools directory
 * reads, and it drops any category without a tool that has a page of its own.
 * Add a category here when its first tool lands, not before.
 */
import { TOOLS } from './tools';

export const CATEGORIES = [
    {
        id: 'resize-crop',
        title: 'Resize & Crop',
        blurb: 'Change how big a picture is, or which part of it you keep.',
    },
    {
        id: 'compress',
        title: 'Compress & Optimise',
        blurb: 'Bring a file under the size a form, an email or a web page will take.',
    },
    {
        id: 'convert',
        title: 'Convert',
        blurb: 'Turn the file you have into the format the other side will open.',
    },
    {
        id: 'combine',
        title: 'Combine into one file',
        blurb: 'Several photos or PDFs that have to go out as a single document.',
    },
];

export function getCategory(id) {
    return CATEGORIES.find((category) => category.id === id) ?? null;
}

/** The tools in one category, in registry order — bulk resize included. */
export function toolsInCategory(id, tools = TOOLS) {
    return tools.filter((tool) => tool.category === id);
}

/**
 * The categories worth a heading: those holding at least one tool with a page
 * of its own. Takes the registries as an argument so the rule can be proved
 * on a synthetic registry rather than by shipping an empty category.
 */
export function categoriesWithProducts({ tools = TOOLS, categories = CATEGORIES } = {}) {
    return categories.filter((category) =>
        toolsInCategory(category.id, tools).some((tool) => tool.hasOwnPage),
    );
}
