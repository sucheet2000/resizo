/**
 * RelatedTools
 *
 * Contextual sentences, not a card grid. "iPhone photo? Convert HEIC to JPG
 * before resizing" tells a visitor why they would click; "Convert HEIC" does
 * not, and four identical link strips across four pages told Google that the
 * strongest secondary heading on each tool page was a navigation label.
 *
 * The link targets come from the TOOLS registry so a route change moves every
 * one of them at once.
 */
import Link from 'next/link';

import { TOOLS, getTool } from '@/lib/catalog/tools';

/**
 * Per-tool copy: what a visitor on THIS page might need NEXT, phrased as the
 * situation that would send them there. Anything missing falls back to the
 * registry description, so a new tool never breaks the block.
 */
export const RELATED_COPY = {
    resize: {
        'change-image-dpi': 'A print shop asking for 300 DPI? That is a label, and this changes it without touching the pixels',
        heic: 'iPhone photo? Convert HEIC to JPG before resizing',
        compress: 'Right dimensions but the file is still too heavy? Compress it',
        crop: 'Need a different shape, not a different size? Crop it',
        convert: 'Wrong format for the upload form? Convert it',
        'jpg-to-pdf': 'Several photos that have to arrive as one file? Put them in a PDF',
        'merge-pdf': 'Already have the PDFs and just need one of them? Combine them',
    },
    'bulk-resize': {
        resize: 'Only one image to do? Use the single resizer',
        compress: 'Batch still over the upload cap? Compress each one',
    },
    compress: {
        'signature-resizer': 'A signature for a form with a byte limit? The signature resizer crops, sizes and compresses it in one go',
        resize: 'Smaller dimensions shrink a file faster than quality alone — resize it',
        convert: 'WebP usually beats JPEG at the same quality — convert it',
        heic: 'iPhone photo that will not open? Convert HEIC to JPG',
        crop: 'Cropping away what you do not need also drops the size — crop it',
        'jpg-to-pdf': 'A set of scans that has to go out as one document? Make a PDF',
        'merge-pdf': 'Several PDFs the form will only take as one? Combine them',
    },
    convert: {
        'remove-image-metadata': 'Converting to share it? Remove the camera data as well',
        compress: 'Converted and still too big? Compress it',
        resize: 'Need exact pixel dimensions too? Resize it',
        heic: 'Converting an iPhone photo? Use the HEIC tool',
        crop: 'Trim the frame before converting — crop it',
        'jpg-to-pdf': 'Need a document instead of an image? Combine the photos into a PDF',
        'merge-pdf': 'Ended up with two PDFs and need one? Combine them',
    },
    crop: {
        'signature-resizer': 'Cropping a signature for a form? There is a workflow for exactly that',
        resize: 'Cropped to the right shape but the wrong size? Resize it',
        compress: 'Shrink the cropped file for upload — compress it',
        convert: 'Save the crop as a different format — convert it',
        'jpg-to-pdf': 'Trimmed a stack of scans? Bind them into one PDF',
        'merge-pdf': 'The other half of the paperwork is already a PDF? Combine them',
    },
    heic: {
        resize: 'Converted your iPhone photo? Resize it to the size you need',
        compress: 'iPhone photos are large — compress the JPG',
        crop: 'Straighten up the frame — crop it',
        convert: 'Need WebP or PNG instead of JPG? Convert it',
        'jpg-to-pdf': 'A whole set of iPhone photos to send at once? Make one PDF',
        'merge-pdf': 'That PDF has to go out with another one? Combine them',
    },
    'jpg-to-pdf': {
        'merge-pdf': 'Made one PDF and already had another? Combine the two',
        compress: 'PDF too heavy for the form that wants it? Compress the photos first',
        resize: 'Full-size camera files make a very large document — resize them first',
        crop: 'Trim the desk out of a scan before it becomes a page — crop it',
        convert: 'Want the pictures back as images rather than pages? Convert them',
        heic: 'HEIC photos go straight in, but if you also want the JPGs, convert them',
    },
    'merge-pdf': {
        'jpg-to-pdf': 'One of the things you are combining is still photos? Turn them into a PDF first',
        compress: 'Merged file too heavy for the form that wants it? Compress the images going in',
        heic: 'iPhone photos in the pile? Convert HEIC to JPG on the way to a PDF',
        resize: 'Camera-sized scans make a very heavy document — resize them first',
        crop: 'Straighten up a photographed page before it becomes part of the file — crop it',
        convert: 'Need the pictures as images rather than as pages? Convert them',
    },
    'signature-resizer': {
        compress: 'The rest of the application has a byte limit too? Compress each file',
        resize: 'A photo rather than a signature to bring to a size? Use the resizer',
        crop: 'Only the framing is wrong? Crop it on its own',
        convert: 'The form wants a format this page does not write? Convert it',
        'jpg-to-pdf': 'The signature has to arrive inside a document? Put it in a PDF',
        'remove-image-metadata': 'Sending a photo with the form? Take the camera data out of it first',
    },
    'change-image-dpi': {
        'remove-image-metadata': 'Sharing the file afterwards? Strip the metadata that names where it was taken',
        resize: 'The print shop wants more pixels, not a different label — resize it',
        compress: 'Same picture, smaller file? Compress it',
        convert: 'A format this page cannot write the DPI into? Convert it first',
        'jpg-to-pdf': 'Printing a set of photos? Put them in a PDF at the page size you want',
        'passport-photo-print': 'Need to print several copies? Lay them out on 4 × 6 or A4 at exact size',
    },
    'remove-image-metadata': {
        'change-image-dpi': 'Keep the metadata that matters — set the print resolution instead',
        compress: 'Metadata gone but the file still too big? Compress it',
        resize: 'Posting it somewhere with a size limit? Resize it',
        convert: 'Need it in another format as well? Convert it',
        'signature-resizer': 'A signature scan for a form? The dedicated workflow crops and sizes it',
        heic: 'An iPhone photo that will not open? Convert HEIC to JPG',
    },
    'passport-photo': {
        'passport-photo-print': 'Need to print several copies? Lay them out on 4 × 6 or A4 at exact size',
    },
    'image-size-fitter': {
        'passport-photo-print': 'Need to print several copies? Lay them out on 4 × 6 or A4 at exact size',
    },
    'passport-photo-print': {
        'passport-photo': 'Need to crop the photo to a country’s own size first, with the head guide? Do that there',
        'image-size-fitter': 'Need the photo at an exact pixel size or byte ceiling before it goes on the sheet? Fit it first',
        'change-image-dpi': 'Only the DPI label needs to change, not the pixels? Set that instead',
    },
};

function sentenceFor(fromSlug, tool) {
    return RELATED_COPY[fromSlug]?.[tool.slug] ?? tool.description;
}

export default function RelatedTools({
    slug,
    heading = 'What to do next',
    headingLevel = 'h2',
    headingId,
    limit,
    className = '',
}) {
    const Heading = headingLevel;
    const resolvedHeadingId = headingId ?? `related-tools-${slug ?? 'all'}`;

    const copy = RELATED_COPY[slug] ?? {};
    const current = getTool(slug);

    const candidates = TOOLS.filter((tool) => tool.hasOwnPage && tool.slug !== slug);

    // Tools with hand-written contextual copy come first; the rest keep
    // registry order so the block is stable between renders.
    const ordered = [
        ...candidates.filter((tool) => copy[tool.slug]),
        ...candidates.filter((tool) => !copy[tool.slug]),
    ];

    const items = Number.isFinite(limit) ? ordered.slice(0, limit) : ordered;
    if (items.length === 0) return null;

    return (
        <section
            aria-labelledby={resolvedHeadingId}
            className={`border-t border-line pt-8 ${className}`.trim()}
        >
            <Heading id={resolvedHeadingId} className="font-display text-title font-bold text-ink">
                {heading}
            </Heading>

            <ul className="mt-4 flex flex-col gap-3">
                {items.map((tool) => (
                    <li key={tool.slug} className="text-base text-ink-muted">
                        {sentenceFor(slug, tool)}{' '}
                        <Link
                            href={tool.href}
                            className="rounded-input font-medium text-accent underline underline-offset-4 transition-[text-decoration-thickness] duration-120 ease-snap hover:decoration-2"
                        >
                            {tool.title}
                            <span aria-hidden="true">&nbsp;→</span>
                        </Link>
                    </li>
                ))}
            </ul>

            {current ? <p className="sr-only">You are on the {current.title} tool.</p> : null}
        </section>
    );
}
