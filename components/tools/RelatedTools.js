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

import { TOOLS, getTool } from '@/lib/constants';

/**
 * Per-tool copy: what a visitor on THIS page might need NEXT, phrased as the
 * situation that would send them there. Anything missing falls back to the
 * registry description, so a new tool never breaks the block.
 */
export const RELATED_COPY = {
    resize: {
        heic: 'iPhone photo? Convert HEIC to JPG before resizing',
        compress: 'Right dimensions but the file is still too heavy? Compress it',
        crop: 'Need a different shape, not a different size? Crop it',
        convert: 'Wrong format for the upload form? Convert it',
        'jpg-to-pdf': 'Several photos that have to arrive as one file? Put them in a PDF',
    },
    'bulk-resize': {
        resize: 'Only one image to do? Use the single resizer',
        compress: 'Batch still over the upload cap? Compress each one',
    },
    compress: {
        resize: 'Smaller dimensions shrink a file faster than quality alone — resize it',
        convert: 'WebP usually beats JPEG at the same quality — convert it',
        heic: 'iPhone photo that will not open? Convert HEIC to JPG',
        crop: 'Cropping away what you do not need also drops the size — crop it',
        'jpg-to-pdf': 'A set of scans that has to go out as one document? Make a PDF',
    },
    convert: {
        compress: 'Converted and still too big? Compress it',
        resize: 'Need exact pixel dimensions too? Resize it',
        heic: 'Converting an iPhone photo? Use the HEIC tool',
        crop: 'Trim the frame before converting — crop it',
        'jpg-to-pdf': 'Need a document instead of an image? Combine the photos into a PDF',
    },
    crop: {
        resize: 'Cropped to the right shape but the wrong size? Resize it',
        compress: 'Shrink the cropped file for upload — compress it',
        convert: 'Save the crop as a different format — convert it',
        'jpg-to-pdf': 'Trimmed a stack of scans? Bind them into one PDF',
    },
    heic: {
        resize: 'Converted your iPhone photo? Resize it to the size you need',
        compress: 'iPhone photos are large — compress the JPG',
        crop: 'Straighten up the frame — crop it',
        convert: 'Need WebP or PNG instead of JPG? Convert it',
        'jpg-to-pdf': 'A whole set of iPhone photos to send at once? Make one PDF',
    },
    'jpg-to-pdf': {
        compress: 'PDF too heavy for the form that wants it? Compress the photos first',
        resize: 'Full-size camera files make a very large document — resize them first',
        crop: 'Trim the desk out of a scan before it becomes a page — crop it',
        convert: 'Want the pictures back as images rather than pages? Convert them',
        heic: 'HEIC photos go straight in, but if you also want the JPGs, convert them',
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
                            className="rounded-input font-medium text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                        >
                            {tool.title}
                            <span aria-hidden="true"> →</span>
                        </Link>
                    </li>
                ))}
            </ul>

            {current ? <p className="sr-only">You are on the {current.title} tool.</p> : null}
        </section>
    );
}
