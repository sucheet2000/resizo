/**
 * The copy of an intent entry, as the strings a visitor reads.
 *
 * An entry stores its prose in a handful of fields and a list of blocks; the
 * validator, the link graph, the doorway-page guard and the truthfulness tests
 * all need "everything this page says" as flat text. This is the one place
 * that walks the entry, so a new field or block kind is added to the walk
 * once and every reader sees it.
 *
 * `part` picks the headline copy (title, h1, intro, description, answer, the
 * link label and blurb), the body (procedure, sections, limits, FAQs, the
 * feature list), or both. Link markup is reduced to its labels.
 */
import { plainText } from './inline';

function blockText(block) {
    if (block.type === 'p') return [plainText(block.text)];
    if (block.type === 'ul') return block.items.map(plainText);
    if (block.type === 'table') {
        return [
            block.caption,
            ...block.columns.map((column) => column.label),
            ...block.rows.flatMap((row) => block.columns.map((column) => row[column.key])),
        ];
    }
    return [];
}

export function intentCopy(intent, { part = 'all' } = {}) {
    const headline = [intent.title, intent.h1, intent.intro, intent.description, intent.answer, intent.label, intent.blurb];

    const body = [
        ...(intent.application?.features ?? []),
        intent.howTo?.heading,
        intent.howTo?.description,
        ...(intent.howTo?.steps ?? []).flatMap((step) => [step.name, step.text]),
        ...(intent.sections ?? []).flatMap((section) => [section.heading, ...section.blocks.flatMap(blockText)]),
        ...(intent.limitations ?? []),
        ...(intent.faqs ?? []).flatMap((faq) => [faq.question, faq.answer]),
    ];

    const chosen = part === 'headline' ? headline : part === 'body' ? body : [...headline, ...body];

    return chosen.filter((value) => typeof value === 'string' && value.trim() !== '');
}
