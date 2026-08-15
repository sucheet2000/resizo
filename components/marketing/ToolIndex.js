/**
 * ToolIndex
 *
 * The tool grid, sized by what each tool is actually worth rather than by a
 * loop over an array. Resize and compress are what people arrive for, so they
 * take the whole first row; HEIC earns the widest cell on the second because
 * it is the highest-demand thing the site owns; crop takes the narrowest.
 *
 * Twelve columns, three rows of unequal spans — never the equal-column card
 * row on the reject list, and never an icon tile above a heading: the
 * identity mark is a typographic operation token in mono.
 *
 * CELLS is written by hand on purpose: a loop over the registry cannot know
 * that resize is worth seven columns and crop three. The cost is that a tool
 * can ship without ever reaching this grid, which is exactly what happened —
 * /jpg-to-pdf and /merge-pdf launched and the homepage went on showing five
 * cards under the words "Five tools". A test now compares these slugs against
 * every tool with `hasOwnPage`, so adding a cell is part of adding a tool.
 */
import Link from 'next/link';

import OperationMark from '@/components/tools/OperationMark';
import { getTool } from '@/lib/catalog';

const CELLS = [
    {
        slug: 'resize',
        span: 'md:col-span-7',
        weight: 'lead',
        line: 'Type exact pixel dimensions, scale by a percentage, or tap a platform size such as 1080×1080. The aspect-ratio lock fills in the side you did not type.',
        extra: { href: '/resize#bulk', label: 'Or resize up to 20 at once, back as one ZIP' },
    },
    {
        slug: 'compress',
        span: 'md:col-span-5',
        weight: 'lead',
        line: 'Aim at a byte target — 100 KB for a form that rejects anything larger, a few MB for an email — and see exactly what you got.',
    },
    {
        slug: 'heic',
        span: 'md:col-span-5',
        weight: 'quiet',
        line: 'The iPhone photo that Windows, Android and half the upload forms on the internet refuse to open, turned into a JPG.',
    },
    {
        slug: 'convert',
        span: 'md:col-span-4',
        weight: 'quiet',
        line: 'JPEG, PNG and WebP, in any direction.',
    },
    {
        slug: 'crop',
        span: 'md:col-span-3',
        weight: 'quiet',
        line: 'Trim to exact pixel coordinates.',
    },
    {
        slug: 'jpg-to-pdf',
        span: 'md:col-span-7',
        weight: 'quiet',
        line: 'Photos into one PDF, in the order you set. Page size and orientation are chosen per image, so a portrait scan and a landscape photo both come out the right way up.',
    },
    {
        slug: 'merge-pdf',
        span: 'md:col-span-5',
        weight: 'quiet',
        line: 'Several PDFs into one file. Reorder them first, and take every page or only the ones you name.',
    },
];

export default function ToolIndex({ className = '' }) {
    return (
        <ul className={`grid gap-4 md:grid-cols-12 ${className}`.trim()}>
            {CELLS.map((cell) => {
                const tool = getTool(cell.slug);
                if (!tool) return null;

                const isLead = cell.weight === 'lead';

                return (
                    <li
                        key={cell.slug}
                        className={[
                            'flex flex-col rounded-panel border border-line bg-surface-raised shadow-edge',
                            'transition-colors duration-120 ease-snap hover:border-ink-muted',
                            isLead ? 'p-6' : 'p-5',
                            cell.span,
                        ].join(' ')}
                    >
                        <OperationMark tool={cell.slug} size={isLead ? 'title' : 'lead'} />

                        <h3
                            className={[
                                'mt-2 font-display font-bold text-ink',
                                isLead ? 'text-headline' : 'text-title',
                            ].join(' ')}
                        >
                            <Link
                                href={tool.href}
                                className="rounded-input transition-opacity duration-120 ease-snap hover:opacity-80"
                            >
                                {tool.title}
                                <span aria-hidden="true"> →</span>
                            </Link>
                        </h3>

                        <p className={`mt-2 flex-1 text-ink-muted ${isLead ? 'text-base' : 'text-ui'}`}>
                            {cell.line}
                        </p>

                        {cell.extra ? (
                            <p className="mt-4">
                                <Link
                                    href={cell.extra.href}
                                    className="rounded-input text-ui text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                                >
                                    {cell.extra.label}
                                    <span aria-hidden="true"> →</span>
                                </Link>
                            </p>
                        ) : null}
                    </li>
                );
            })}
        </ul>
    );
}
