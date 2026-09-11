/**
 * The Favicon Package
 *
 * What /favicon-generator hands back, named once: the files, their order, the
 * manifest that points at two of them and the HTML that points at four.
 *
 * WHY THIS IS ONE ARRAY AND NOT THREE LISTS
 *
 * Three parts of the product have to agree about these seven names. The engine
 * encodes one PNG per entry and packs three of them into the ICO; the page
 * lists the assets, builds the ZIP and draws the previews; the snippet tells a
 * visitor what to paste into their own <head>. A filename typed a second time
 * anywhere in that chain produces a snippet that references a file the ZIP does
 * not contain — and nothing in a browser reports a missing favicon. So the
 * order, the filenames and the sizes are stated here and everywhere else
 * derives from them.
 *
 * WHY IT IS lib/format/ AND NOT lib/image-client/
 *
 * It touches no pixel and imports nothing. The worker needs the list (it
 * encodes from it) and so does the page (it renders from it), and lib/format/
 * is the shelf both may read: pure, React-free, worker-importable. It is also
 * emphatically NOT lib/catalog/ — the engine may never reach the catalogue, and
 * these are output filenames rather than page copy.
 *
 * THE MANIFEST CARRIES THE VISITOR'S OWN TEXT, AND IS THEREFORE UNTRUSTED
 *
 * `name` and `short_name` come out of two free-text inputs and land in a file a
 * browser parses. A writer that concatenated them would break on the first
 * quote and would happily write a backslash that changes what follows it. So
 * the document is built as an object and serialised by JSON.stringify, once,
 * and no branch of this file appends a user string to a template. The same rule
 * is why buildHtmlSnippet takes no text at all: the snippet is fixed filenames
 * and nothing else, so there is no injection surface to escape.
 */

/**
 * The package, in order. This order is the ZIP order, the asset-list order and
 * the order the engine returns its assets in.
 *
 * The ICO is first because it is the one file a browser looks for without being
 * told to, and the manifest is last because it is the only entry that is not a
 * picture — it is text the page builds from the fields the visitor filled in,
 * which is why it carries no size.
 *
 * 16, 32 and 48 are the three sizes Microsoft's own icon documentation
 * encourages a developer to include; 180 is Apple's current touch-icon size;
 * 192 and 512 are the two Chrome requires before it will offer to install a
 * site. Sources are cited on the page, not here.
 */
export const ICON_ASSETS = [
    { id: 'favicon-ico', filename: 'favicon.ico', kind: 'ico', sizes: [16, 32, 48], type: 'image/x-icon' },
    { id: 'favicon-16', filename: 'favicon-16x16.png', kind: 'png', width: 16, height: 16 },
    { id: 'favicon-32', filename: 'favicon-32x32.png', kind: 'png', width: 32, height: 32 },
    { id: 'apple-touch-icon', filename: 'apple-touch-icon.png', kind: 'png', width: 180, height: 180 },
    { id: 'android-192', filename: 'android-chrome-192x192.png', kind: 'png', width: 192, height: 192 },
    { id: 'android-512', filename: 'android-chrome-512x512.png', kind: 'png', width: 512, height: 512 },
    { id: 'manifest', filename: 'site.webmanifest', kind: 'manifest', type: 'application/manifest+json' },
];

/**
 * The sizes inside favicon.ico. 48 appears ONLY there — it is a desktop
 * shortcut size rather than a tab size, and shipping it as a seventh loose PNG
 * nobody links to would be a file with no instruction attached.
 */
export const ICO_SIZES = [16, 32, 48];

/** The one archive the page offers. */
export const ZIP_FILENAME = 'resizo-favicon-package.zip';

/** The biggest square in the package — the one a small logo is enlarged for. */
export const LARGEST_ICON_SIZE = Math.max(...ICON_ASSETS.flatMap((asset) => asset.sizes ?? [asset.width ?? 0]));

/**
 * The square the icons will be made from, when it is smaller than the largest
 * icon — or null when nothing is enlarged.
 *
 * ONE RULE, READ TWICE. The page warns before the job runs and the engine
 * reports `enlargedFrom` after it; neither can read the other's number, so
 * both call this and cannot disagree by value. A crop keeps the frame's
 * square (or the largest centred square when there is no frame yet), so that
 * square is what is enlarged; a fit keeps the whole picture, scaled until its
 * LONGER edge meets the icon, so the whole picture is what is enlarged and
 * the whole picture is what is reported.
 *
 * @param {{ sourceWidth: number, sourceHeight: number, geometry: 'cover'|'contain',
 *           frameRect?: { width: number, height: number }|null, largest?: number }} input
 * @returns {{ width: number, height: number }|null}
 */
export function iconEnlargedFrom({ sourceWidth, sourceHeight, geometry, frameRect = null, largest = LARGEST_ICON_SIZE }) {
    if (!(sourceWidth > 0) || !(sourceHeight > 0) || !(largest > 0)) return null;

    if (geometry === 'contain') {
        return Math.max(sourceWidth, sourceHeight) < largest ? { width: sourceWidth, height: sourceHeight } : null;
    }

    const rect = frameRect && frameRect.width > 0 && frameRect.height > 0
        ? frameRect
        : { width: sourceWidth, height: sourceHeight };
    const side = Math.min(rect.width, rect.height);
    return side < largest ? { width: side, height: side } : null;
}

/** The two icons Chrome asks for before it will offer to install a site. */
const MANIFEST_ICON_IDS = ['android-192', 'android-512'];

/**
 * `purpose` is stated rather than left to default, because the default is what
 * we mean: these icons are drawn as they are. A maskable icon is a different
 * drawing with a 40%-radius safe zone, and this tool does not produce one — so
 * claiming "maskable" would be a lie Android would then crop.
 */
const ICON_PURPOSE = 'any';

/** Longest name the manifest will carry. Past this it is not a name. */
const MAX_NAME_LENGTH = 200;

/** #rgb or #rrggbb, and nothing else. Anything else is dropped, never guessed. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

function assetById(id) {
    return ICON_ASSETS.find((asset) => asset.id === id) ?? null;
}

/** A trimmed, length-capped name, or null when there is no name to write. */
function usableName(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text === '' ? null : text.slice(0, MAX_NAME_LENGTH);
}

/** A colour the specification can carry, or null. Never a corrected guess. */
function usableColour(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return HEX_COLOUR.test(text) ? text : null;
}

/**
 * The site.webmanifest for this package, as text.
 *
 * Every optional field is absent unless it was given: a manifest with an empty
 * name is worse than one with no name, because a browser will show the empty
 * string. The icons array is always both installability sizes, built from
 * ICON_ASSETS so a filename cannot drift from the file the engine wrote.
 *
 * @param {{ name?: string, shortName?: string, themeColor?: string, backgroundColor?: string }} [fields]
 * @returns {string} JSON, two-space indented
 */
export function buildManifest({ name, shortName, themeColor, backgroundColor } = {}) {
    const document = {};

    const appName = usableName(name);
    if (appName) document.name = appName;

    const short = usableName(shortName);
    if (short) document.short_name = short;

    document.icons = MANIFEST_ICON_IDS.map((id) => {
        const asset = assetById(id);
        return {
            src: `/${asset.filename}`,
            sizes: `${asset.width}x${asset.height}`,
            type: 'image/png',
            purpose: ICON_PURPOSE,
        };
    });

    const theme = usableColour(themeColor);
    if (theme) document.theme_color = theme;

    const background = usableColour(backgroundColor);
    if (background) document.background_color = background;

    // The whole document at once. No branch of this function appends a user
    // string to a template, which is the property the hostile-name test proves.
    return JSON.stringify(document, null, 2);
}

/**
 * The <head> lines for this package, as text.
 *
 * Fixed filenames only — no argument of this function can put a character into
 * the output. favicon.ico is deliberately not linked: browsers look for it at
 * the site root on their own, and a link element for it only adds a line to
 * copy. The 32 is listed before the 16 because when several icons are equally
 * appropriate a browser takes the LAST one, and 16 is the safer last resort.
 *
 * @param {{ manifest?: boolean }} [options]
 * @returns {string} newline-separated lines
 */
export function buildHtmlSnippet({ manifest = true } = {}) {
    const png = (id, size) => {
        const asset = assetById(id);
        return `<link rel="icon" type="image/png" sizes="${size}x${size}" href="/${asset.filename}">`;
    };

    const apple = assetById('apple-touch-icon');

    const lines = [
        png('favicon-32', 32),
        png('favicon-16', 16),
        `<link rel="apple-touch-icon" sizes="${apple.width}x${apple.height}" href="/${apple.filename}">`,
    ];

    if (manifest) {
        lines.push(`<link rel="manifest" href="/${assetById('manifest').filename}">`);
    }

    return lines.join('\n');
}

/**
 * The five characters that change the meaning of markup, for any place a page
 * prints visitor text inside an attribute.
 *
 * React text nodes need none of this — it escapes them itself — so this exists
 * for the one case React cannot help with. The ampersand is replaced in the
 * same pass as the rest rather than in a first pass of its own, because two
 * passes would turn `&lt;` into `&amp;amp;lt;`.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}
