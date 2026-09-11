/**
 * The tool registry — the core products.
 *
 * One entry per tool, in the order the site presents them. `hasOwnPage: false`
 * means the tool lives inside another route (bulk resize is a tab on /resize),
 * so it is linked but never emitted as a separate sitemap entry. `category` is
 * the id of a row in lib/catalog/categories.js — the need a visitor arrives
 * with — and lib/catalog/validate.js refuses an id that does not exist there.
 *
 * `nav` is the header BAR, not the header. Three tools carry it — the three
 * people arrive for — and the bar's length is deliberately not a function of
 * this registry's: seven links already crowded a 64px bar and fifty would be
 * absurd. Every other tool reaches the header through the Tools menu, which
 * groups the whole family by category and is built from `hasOwnPage` and
 * `category`, so a tool added below appears there with no header edit at all.
 *
 * This package holds COPY: titles, descriptions and blurbs that change whenever
 * the marketing does. It is deliberately separate from lib/limits.js, which
 * holds the numbers and format lists the image engine reads. They used to be
 * one module, so the chunk the engine and the WEB WORKER depend on carried
 * tool descriptions the worker can never use, and editing a description
 * invalidated the engine's chunk.
 */
export const TOOLS = [
    {
        slug: 'resize',
        href: '/resize',
        title: 'Resize Image',
        shortTitle: 'Resize',
        description: 'Change image dimensions with pixel-perfect precision.',
        hasOwnPage: true,
        nav: true,
        category: 'resize-crop',
    },
    {
        slug: 'bulk-resize',
        href: '/resize#bulk',
        title: 'Bulk Resize',
        shortTitle: 'Bulk Resize',
        description: 'Resize up to 20 images at once and download them as a ZIP.',
        hasOwnPage: false,
        nav: false,
        category: 'resize-crop',
    },
    {
        slug: 'compress',
        href: '/compress',
        title: 'Compress Image',
        shortTitle: 'Compress',
        description: 'Reduce file size without visible quality loss.',
        hasOwnPage: true,
        nav: true,
        category: 'compress',
    },
    // The second batch tool, and the one that is a route where bulk resize is a
    // tab. The difference is what a visitor arrives having been told: a form
    // names a kilobyte ceiling — "each photo under 200 KB" — and they arrive
    // searching for that sentence, not for a mode of another tool. Bulk resize
    // has no such query behind it, so it stays a tab on /resize and this is a
    // page with its own copy, its own FAQ and its own answer.
    {
        slug: 'bulk-image-compressor',
        href: '/bulk-image-compressor',
        title: 'Bulk Image Compressor',
        shortTitle: 'Bulk compress',
        description: 'Compress many JPG, PNG and WebP files to a maximum size each, then download them one by one or as a ZIP.',
        hasOwnPage: true,
        nav: false,
        category: 'compress',
    },
    {
        slug: 'convert',
        href: '/convert',
        title: 'Convert Format',
        shortTitle: 'Convert',
        description: 'Convert between JPEG, PNG and WebP instantly.',
        hasOwnPage: true,
        nav: true,
        category: 'convert',
    },
    // The third batch tool, and a second product on the same platform as the
    // batch compressor rather than a mode of /convert. The need is the one a
    // folder of mixed files creates — a screenshot, a photo and a logo that all
    // have to leave as WebP — and /convert answers it one file at a time. What
    // a visitor arrives having been told is a format, not a setting: "send them
    // all as JPG" is the sentence, so it gets a URL, its own copy and its own
    // FAQ. The output format is picked once and applies to the whole queue.
    {
        slug: 'bulk-image-converter',
        href: '/bulk-image-converter',
        title: 'Bulk Image Converter',
        shortTitle: 'Bulk convert',
        description: 'Convert many JPG, PNG and WebP files to one format at once, then download them one by one or as a ZIP.',
        hasOwnPage: true,
        nav: false,
        category: 'convert',
    },
    {
        slug: 'crop',
        href: '/crop',
        title: 'Crop Image',
        shortTitle: 'Crop',
        description: 'Remove unwanted areas with exact pixel control.',
        hasOwnPage: true,
        nav: false,
        category: 'resize-crop',
    },
    // A resize-and-crop tool by what it does, even though nobody searches for
    // it that way: one square composition, resampled to six sizes and written
    // into seven files. It sits here rather than in a category of its own
    // because a category with one member is a heading, not a need — and the
    // need it answers, "make this logo the right shape and size", is the one
    // /resize and /crop answer one output at a time.
    //
    // Its sizes are nobody's opinion: lib/catalog/icon-sources.js carries the
    // document behind each of them, because a page that prints 180 and 192 as
    // house style is asking to be believed rather than checked.
    {
        slug: 'favicon-generator',
        href: '/favicon-generator',
        title: 'Favicon & App Icon Generator',
        shortTitle: 'Favicons',
        description: 'Make favicon.ico, the PNG icons and an Apple touch icon from one logo in your browser — nothing is uploaded.',
        hasOwnPage: true,
        nav: false,
        category: 'resize-crop',
    },
    {
        slug: 'heic',
        href: '/heic',
        title: 'Convert HEIC',
        shortTitle: 'HEIC to JPEG',
        description: 'Convert iPhone HEIC photos to universal JPEG.',
        hasOwnPage: true,
        nav: false,
        category: 'convert',
    },
    // The three September tools. Each is a page of its own and none is in the
    // bar: the bar carries the three tools people arrive for, and these reach
    // the header through its Tools menu, /tools and the Related Tools block of
    // every page. The first is a workflow — crop, size, format, byte ceiling in one pass —
    // for the one document form fields ask for by the pixel and the kilobyte.
    // The other two never touch a pixel: one rewrites the resolution a file
    // claims, the other removes the blocks a camera or an editor wrote into it.
    {
        slug: 'signature-resizer',
        href: '/signature-resizer',
        title: 'Signature Resizer',
        shortTitle: 'Signature',
        description: 'Crop, size and compress a scanned signature for an online form.',
        hasOwnPage: true,
        nav: false,
        category: 'forms',
    },
    // The second tool in the forms category, and the one that made the
    // requirement fitter worth building: a photograph that has to be an exact
    // shape, an exact pixel count, under a byte ceiling and carrying a print
    // resolution, all at once. Its four presets are somebody's published rules
    // rather than this site's opinion — lib/catalog/application-presets/ —
    // and every one of them also asks for things no software can check, which
    // is why the page states what it cannot verify beside what it can.
    {
        slug: 'passport-photo',
        href: '/passport-photo',
        title: 'Passport & ID Photo',
        shortTitle: 'Passport photo',
        description: 'Crop and size a passport or ID photo to exact pixels, file size, format and DPI.',
        hasOwnPage: true,
        nav: false,
        category: 'forms',
    },
    // The third tool in the forms category, and the general case of the two
    // beside it. The signature resizer answers one document's rules and the
    // passport tool answers four authorities'; this one is handed the rules
    // themselves — the pixels, the kilobyte ceiling, the format and the print
    // resolution a form names — and fits a picture to all of them in one pass,
    // then checks the finished file against every one of them before offering
    // it. Its example chips say they are examples: the numbers that matter come
    // from the form in front of the visitor, not from this registry.
    {
        slug: 'image-size-fitter',
        href: '/image-size-fitter',
        title: 'Image Size Fitter',
        shortTitle: 'Size fitter',
        description: 'Fit an image to exact pixels and a maximum file size in one step — crop or pad, encode, write DPI and check the file before download.',
        hasOwnPage: true,
        nav: false,
        category: 'forms',
    },
    // The fourth tool in the forms category, and the only one whose output is
    // a sheet rather than a photo. The three above it all answer "make this
    // one picture the right shape and size"; this one starts where they stop —
    // the photo is already right, and what is left is getting several copies
    // of it onto paper at the size they were measured in. A print shop asks
    // for a 4 × 6 and a home printer has A4 in it, so the paper is a registry
    // of its own (lib/catalog/paper-sizes.js) and the layout is arithmetic
    // rather than a template. Off the bar like every tool below /convert.
    {
        slug: 'passport-photo-print',
        href: '/passport-photo-print',
        title: 'Passport Photo Print Sheet',
        shortTitle: 'Print sheet',
        description: 'Lay out several copies of a passport or ID photo at exact physical size on 4 × 6, 5 × 7, Letter or A4 paper, as a JPEG or PDF to print at 100 %.',
        hasOwnPage: true,
        nav: false,
        category: 'forms',
    },
    {
        slug: 'change-image-dpi',
        href: '/change-image-dpi',
        title: 'Change Image DPI',
        shortTitle: 'DPI',
        description: 'Set the print resolution a JPEG or PNG claims, without re-encoding it.',
        hasOwnPage: true,
        nav: false,
        category: 'privacy-metadata',
    },
    // The one tool here that hands back nothing. Every other entry takes a
    // picture and returns another one; this reads what a file already says
    // about itself and prints it on the page. It is a route of its own rather
    // than a panel inside /remove-image-metadata because "what is in this
    // photo" and "take it out of this photo" are two different arrivals — the
    // first is a question, the second a decision made after seeing the answer,
    // and a page that answers the question is what earns the second click.
    {
        slug: 'image-metadata-viewer',
        href: '/image-metadata-viewer',
        title: 'Image Metadata Viewer',
        shortTitle: 'Metadata viewer',
        description: 'See the EXIF, GPS, XMP and colour-profile data stored in a photo without uploading it — the file is read in your browser and never changed.',
        hasOwnPage: true,
        nav: false,
        category: 'privacy-metadata',
    },
    {
        slug: 'remove-image-metadata',
        href: '/remove-image-metadata',
        title: 'Remove Image Metadata',
        shortTitle: 'Metadata',
        description: 'Strip EXIF, GPS and XMP from a photo without touching its pixels.',
        hasOwnPage: true,
        nav: false,
        category: 'privacy-metadata',
    },
    // An image tool whose output happens to be a document. It is listed here,
    // beside the other five, and deliberately NOT under a "PDF tools" heading:
    // there is no PDF hub, no PDF section in the navigation and no second
    // product. A visitor arrives with photos and leaves with a file they can
    // email, which is the same shape as every other entry above — and the
    // category it sits in is named for that need, not for the file type.
    {
        slug: 'jpg-to-pdf',
        href: '/jpg-to-pdf',
        title: 'JPG to PDF',
        shortTitle: 'JPG to PDF',
        description: 'Combine photos into one PDF, in the order you choose.',
        hasOwnPage: true,
        nav: false,
        category: 'combine',
    },
    // The second entry whose files are documents, and it sits in this same flat
    // list for the same reason /jpg-to-pdf does. A visitor arrives with a
    // handful of files and leaves with one they can send, which is the shape of
    // every row above.
    {
        slug: 'merge-pdf',
        href: '/merge-pdf',
        title: 'Merge PDF',
        shortTitle: 'Merge PDF',
        description: 'Combine several PDFs into one file, in the order you choose.',
        hasOwnPage: true,
        nav: false,
        category: 'combine',
    },
];

export function getTool(slug) {
    return TOOLS.find((tool) => tool.slug === slug) ?? null;
}

export function sitemapTools() {
    return TOOLS.filter((tool) => tool.hasOwnPage);
}
