/**
 * Where the favicon package's sizes and filenames come from.
 *
 * Six files and one manifest come out of /favicon-generator, and not one of
 * their dimensions is Resizo's opinion. `favicon.ico` holds 16, 32 and 48
 * because Microsoft's own icon document encourages those three; the touch icon
 * is 180 because Apple's example markup says 180; the 192 and the 512 are the
 * two sizes Chrome names in its installability criteria. A page that printed
 * those numbers as house style would be asking to be believed rather than
 * checked — so each one is an entry here with the document behind it and the
 * day somebody read it.
 *
 * This is the same argument `lib/catalog/application-presets/` makes about a
 * passport photograph, and the validator is strict for the same reason: an
 * uncited icon size is a guess, and a guess is what somebody's site would ship.
 *
 * ONE FIELD CARRIES MORE WEIGHT THAN THE REST. `status` separates a
 * requirement from a recommendation, and only one document here requires
 * anything: Chrome's criteria say an installable site "must include a 192px and
 * a 512px icon". Microsoft encourages three sizes, Apple documents its own, and
 * the W3C manifest specification mandates no icon size whatsoever. Promoting
 * any of those into a requirement would be the cheapest lie on the page, so
 * `tests/lib/catalog/icon-sources.test.js` asserts the word `required` appears
 * in no claim outside the Chrome pair.
 *
 * COPY, NOT ENGINE. lib/image-client/ must never import this (CLAUDE.md rule
 * 3). The filenames it describes are the engine's, in `lib/format/icon-package.js`,
 * and the test above holds the two lists equal rather than letting the page
 * keep a second private copy of them.
 */

/**
 * What standing a claim has, and what a page is allowed to call it.
 *
 * 'required-by-chrome'  Chrome will not offer to install the site without it.
 * 'documented-by-apple' Apple publishes the size or the guidance; nothing enforces it.
 * 'common'              A widespread convention with a source, required by nobody.
 * 'specification'       Defined by a published specification, which is not the
 *                       same as being mandatory — the manifest specification
 *                       defines the icons member and demands no size at all.
 */
export const ICON_SOURCE_STATUSES = ['required-by-chrome', 'documented-by-apple', 'common', 'specification'];

/**
 * One entry per claim, in the order the package writes the files. An asset may
 * appear more than once: `favicon.ico` has a structure and a placement, and the
 * touch icon has a size and a background, and those are four different
 * documents saying four different things.
 */
export const ICON_SOURCES = [
    {
        asset: 'favicon.ico',
        sizeLabel: '16 × 16, 32 × 32, 48 × 48',
        status: 'specification',
        claim: 'An .ico file is a directory rather than a single picture: a three-field header — a reserved zero, a type of 1 and a count — then one 16-byte entry per image giving its width, height, bit count, byte length and offset, then the image data itself. Microsoft writes that "common sizes include 16, 32, and 48 pixels square" and that developers "are encouraged to include a minimum of" 16 x 16, 32 x 32 and 48 x 48, which is the three Resizo puts in the file.',
        source: {
            title: 'Icons',
            publisher: 'Microsoft',
            url: 'https://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'favicon.ico',
        sizeLabel: 'At the site root',
        status: 'common',
        claim: 'A browser looks for this file at the site root whether or not the HTML links it. MDN notes that "Most browsers and software applications these days automatically use a favicon.ico file found at the site root as a favicon", which is why the package still includes one even though the snippet links the PNGs by size.',
        source: {
            title: 'What’s in the head? Metadata in HTML',
            publisher: 'MDN Web Docs',
            url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Webpage_metadata',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'favicon-16x16.png',
        sizeLabel: '16 × 16',
        status: 'common',
        claim: 'A favicon link may point at a PNG: MDN names .ico, .gif and .png as the formats browsers accept, so this file sits beside favicon.ico rather than replacing it. At 16 × 16 it is the smallest icon in the package, which makes it the one where fine detail in a logo disappears first.',
        source: {
            title: 'What’s in the head? Metadata in HTML',
            publisher: 'MDN Web Docs',
            url: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Webpage_metadata',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'favicon-32x32.png',
        sizeLabel: '32 × 32',
        status: 'common',
        claim: 'Declaring more than one PNG icon is what gives a browser something to choose between. MDN: "If there are multiple <link rel="icon">s, the browser uses their media, type, and sizes attributes to select the most appropriate icon. If several icons are equally appropriate, the last one is used." The 32 × 32 file is the second size the generated snippet declares.',
        source: {
            title: 'rel attribute — icon',
            publisher: 'MDN Web Docs',
            url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#icon',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'apple-touch-icon.png',
        sizeLabel: '180 × 180',
        status: 'documented-by-apple',
        claim: 'Apple’s own example markup is <link rel="apple-touch-icon" sizes="180x180" href="touch-icon-iphone-retina.png">, beside 152 × 152 and 167 × 167 for iPads, and the guide adds that "If no icons are specified using a link element, the website root directory is searched for icons with the apple-touch-icon... prefix." Resizo writes the 180, the largest of the three.',
        source: {
            title: 'Configuring Web Applications — Safari Web Content Guide',
            publisher: 'Apple',
            url: 'https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'apple-touch-icon.png',
        sizeLabel: 'Opaque, full-bleed',
        status: 'documented-by-apple',
        claim: 'Apple argues against transparency behind a home-screen icon. The Human Interface Guidelines ask you to "provide square layers so the system can apply rounded corners", say that "The system masks all layer edges to produce an icon’s final shape", and describe a background layer as "full-bleed and opaque". Choosing a background on this page is what makes the touch icon follow that guidance.',
        source: {
            title: 'App icons — Human Interface Guidelines',
            publisher: 'Apple',
            url: 'https://developer.apple.com/design/human-interface-guidelines/app-icons',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'android-chrome-192x192.png',
        sizeLabel: '192 × 192',
        status: 'required-by-chrome',
        claim: 'Chrome’s installability criteria name two icon sizes and no others: "icons - must include a 192px and a 512px icon". This is the smaller of that pair, and both are listed in the generated site.webmanifest.',
        source: {
            title: 'What does it take to be installable?',
            publisher: 'Chrome (web.dev)',
            url: 'https://web.dev/articles/install-criteria',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'android-chrome-512x512.png',
        sizeLabel: '512 × 512',
        status: 'required-by-chrome',
        claim: 'The larger half of the same pair, from the same line: "icons - must include a 192px and a 512px icon". It is also the biggest icon Resizo generates, so a logo smaller than 512 × 512 is enlarged to make it — which adds pixels and cannot add detail.',
        source: {
            title: 'What does it take to be installable?',
            publisher: 'Chrome (web.dev)',
            url: 'https://web.dev/articles/install-criteria',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'site.webmanifest',
        sizeLabel: 'purpose: any',
        status: 'specification',
        claim: 'The manifest’s icons member takes a src, a sizes string, a type and a purpose, and the specification lists three purpose values: "any", which is the default, "maskable" and "monochrome". No icon size is mandated by the specification itself — the pair above comes from Chrome — and Resizo declares both icons as purpose "any".',
        source: {
            title: 'Web Application Manifest (Working Draft)',
            publisher: 'W3C',
            url: 'https://www.w3.org/TR/appmanifest/',
            verifiedAt: '2026-09-10',
        },
    },
    {
        asset: 'site.webmanifest',
        sizeLabel: 'purpose: maskable — not generated',
        status: 'common',
        claim: 'A maskable icon is drawn to survive Android’s own mask. web.dev describes the safe zone as "a circular area in the center of the icon with a radius equal to 40% of the icon width. The outer 10% edge might be cropped", and warns that "Transparent PWA icons appear inside white circles on Android." Resizo does not generate one: shrinking a logo into that safe zone is a design decision, not a resize, and this tool will not make it for you.',
        source: {
            title: 'Adaptive icons support in PWAs with maskable icons',
            publisher: 'Chrome (web.dev)',
            url: 'https://web.dev/articles/maskable-icon',
            verifiedAt: '2026-09-10',
        },
    },
];

/** Every claim written about one generated file, in registry order. */
export function iconSourcesFor(asset) {
    return ICON_SOURCES.filter((entry) => entry.asset === asset);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const todayUtc = () => new Date().toISOString().slice(0, 10);

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** The citation, or the sentence saying how it is wrong. */
function sourceProblem(source) {
    if (source === null || source === undefined) {
        return 'an icon size needs the document it came from — null is not an option here';
    }
    if (typeof source !== 'object') return 'a source must be an object';
    if (!isText(source.title)) return 'a source needs the title of the page it came from';
    if (!isText(source.publisher)) return 'a source needs the publisher who stands behind it';
    if (typeof source.url !== 'string' || !/^https:\/\/\S+$/.test(source.url)) return 'a source needs an https url';
    if (!ISO_DATE.test(source.verifiedAt ?? '') || source.verifiedAt > todayUtc()) {
        return 'a source needs a verifiedAt calendar date that has already happened';
    }
    return null;
}

/**
 * Every way an icon-source entry can be wrong about itself.
 *
 * Problems come back as [{ code, subject, message }] — the shape
 * lib/catalog/validate.js concatenates, so a broken entry fails the build
 * rather than shipping an uncited number onto the page.
 *
 * @param {Array} [sources]  defaults to the shipped registry
 * @returns {Array<{ code: string, subject: string, message: string }>}
 */
export function validateIconSources(sources = ICON_SOURCES) {
    const problems = [];

    for (const entry of sources) {
        const subject = isText(entry?.asset) ? entry.asset : '(unnamed asset)';
        const where = isText(entry?.sizeLabel) ? `${subject} (${entry.sizeLabel})` : subject;
        const problem = (code, message) => problems.push({ code, subject, message: `${where}: ${message}` });

        if (!entry || typeof entry !== 'object') {
            problems.push({ code: 'icon-source-malformed', subject, message: 'an icon source must be an object' });
            continue;
        }

        for (const field of ['asset', 'sizeLabel', 'claim']) {
            if (!isText(entry[field])) problem('icon-source-fields-missing', `it states no ${field}`);
        }

        if (!ICON_SOURCE_STATUSES.includes(entry.status)) {
            problem(
                'icon-source-status-invalid',
                `status is ${JSON.stringify(entry.status)}; use one of ${ICON_SOURCE_STATUSES.join(', ')}`,
            );
        }

        if (!Object.hasOwn(entry, 'source')) {
            problem('icon-source-invalid', 'it declares no source — cite the document the size came from');
        } else {
            const reason = sourceProblem(entry.source);
            if (reason) problem('icon-source-invalid', reason);
        }
    }

    return problems;
}
