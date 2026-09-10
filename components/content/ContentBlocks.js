/**
 * ContentBlocks
 *
 * The prose of an intent page, rendered from data. A section in the registry
 * is a list of blocks — paragraphs, bulleted lists and small tables — written
 * as plain text with `[label](/path)` for a link, and this turns them into the
 * exact markup the hand-written pages used, so a page that moved into the
 * registry reads the same as it did before.
 *
 * Only these four block kinds exist, and an unknown one throws rather than
 * rendering nothing: a section that silently lost a paragraph is the failure
 * this whole arrangement exists to prevent. lib/catalog/validate.js refuses
 * the same block before it ever reaches here.
 *
 * The fourth is `figure`, which is how a registry page shows what the tool did
 * to a file rather than describing it. The tool pages that were written by
 * hand reach for components/content/Figure directly; an intent page has no
 * file of its own to reach from, so the block carries the two images and the
 * caption and this hands them to the same component. One renderer, so a
 * demonstration on /png-to-jpg cannot drift from the one on /compress.
 */
import Link from 'next/link';
import { Fragment } from 'react';

import Figure from '@/components/content/Figure';
import { parseInline } from '@/lib/catalog/inline';

export const inlineLinkClass = 'rounded-input font-medium text-accent underline underline-offset-4';

export function InlineText({ text }) {
    return parseInline(text).map((run, index) =>
        run.type === 'link' ? (
            <Link key={index} href={run.href} className={inlineLinkClass}>
                {run.label}
            </Link>
        ) : (
            <Fragment key={index}>{run.value}</Fragment>
        ),
    );
}

function headerClass(column, isLast) {
    return ['py-2', isLast ? '' : 'pr-4', 'text-ui text-ink'].filter(Boolean).join(' ');
}

function rowHeaderClass(column) {
    return column.mono
        ? 'py-2 pr-4 font-data text-ui font-medium text-ink'
        : 'py-2 pr-4 text-base font-normal text-ink';
}

function cellClass(column, isLast) {
    return ['py-2', isLast ? '' : 'pr-4', column.mono ? 'font-data text-ui text-ink' : '']
        .filter(Boolean)
        .join(' ');
}

/**
 * A three-column table needs less room than a four-column one; the classes
 * are spelled out because Tailwind only emits a utility it can read in source.
 */
function tableWidthClass(columns) {
    return columns.length >= 4 ? 'min-w-[32rem]' : 'min-w-[28rem]';
}

function DataTable({ caption, columns, rows }) {
    const rowHeader = columns.find((column) => column.rowHeader) ?? null;
    const last = columns.length - 1;

    return (
        <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
            <table className={`w-full ${tableWidthClass(columns)} border-collapse text-left`}>
                <caption className="sr-only">{caption}</caption>
                <thead>
                    <tr className="border-b border-line">
                        {columns.map((column, index) => (
                            <th key={column.key} scope="col" className={headerClass(column, index === last)}>
                                {column.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rowIndex) => (
                        <tr
                            key={rowHeader ? row[rowHeader.key] : rowIndex}
                            className="border-b border-line align-top"
                        >
                            {columns.map((column, index) =>
                                column.rowHeader ? (
                                    <th key={column.key} scope="row" className={rowHeaderClass(column)}>
                                        {row[column.key]}
                                    </th>
                                ) : (
                                    <td key={column.key} className={cellClass(column, index === last)}>
                                        {row[column.key]}
                                    </td>
                                ),
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export default function ContentBlocks({ blocks }) {
    return (Array.isArray(blocks) ? blocks : []).map((block, index) => {
        if (block.type === 'p') {
            return (
                <p key={index}>
                    <InlineText text={block.text} />
                </p>
            );
        }

        if (block.type === 'ul') {
            return (
                <ul key={index} className="flex list-disc flex-col gap-2 pl-5">
                    {block.items.map((item, itemIndex) => (
                        <li key={itemIndex}>
                            <InlineText text={item} />
                        </li>
                    ))}
                </ul>
            );
        }

        if (block.type === 'table') {
            return <DataTable key={index} caption={block.caption} columns={block.columns} rows={block.rows} />;
        }

        if (block.type === 'figure') {
            const images = block.image
                ? [block.image]
                : [{ label: 'Before', ...block.before }, { label: 'After', ...block.after }];

            // Figure drops a half-written entry rather than rendering an image
            // with no alt or no size, which is right for it and wrong here: a
            // block that produced no figure at all would leave the caption's
            // claim on the page with nothing under it.
            if (images.some((image) => !image?.src)) {
                throw new Error(
                    'A figure block is either { image } or { before, after }, each with src, alt, width and height.',
                );
            }

            return <Figure key={index} images={images} caption={<InlineText text={block.caption} />} />;
        }

        throw new Error(
            `Unknown content block type "${block?.type}" — a section can hold p, ul, table and figure blocks.`,
        );
    });
}
