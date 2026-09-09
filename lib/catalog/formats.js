/**
 * What an intent page accepts and what it saves — derived, never typed.
 *
 * Every intent page carries a line naming the formats it takes and the format
 * it writes, and that line is the single most quotable factual claim on the
 * page: get it wrong and a visitor arrives with a file the tool refuses. So it
 * is not written in the entry. It is read off lib/limits.js through the same
 * table each tool reads, plus whatever the entry's preset fixes — a converter
 * with `{ from: 'png' }` narrows its own drop zone to PNG (see the `accept`
 * memo in app/(tools)/convert/ConvertTool.js), so the page must say PNG and
 * nothing else.
 *
 * The same derivation is what lib/catalog/quality.js checks the prose against:
 * a paragraph that offers to take a GIF is offering something the drop zone
 * will reject, and that is a build failure rather than a support email.
 *
 * COMPRESS keeps the format it was given, and offers WebP where a lossless
 * source has no quality dial to turn down, so its output set is its input set.
 * RESIZE's format select sits on "Same as the original" and can be moved to any
 * encodable output, which is the same three formats again.
 */
import {
    ALLOWED_OUTPUT_FORMATS,
    CONVERT_INPUT_FORMATS,
    CONVERT_OUTPUT_FORMATS,
    HEIC_INPUT_FORMATS,
    RASTER_INPUT_FORMATS,
    RESIZE_INPUT_FORMATS,
} from '@/lib/limits';
import { TOOLS } from './tools';

/** What the HEIC page writes when its entry fixes no output format. */
const HEIC_DEFAULT_OUTPUT = 'jpeg';

const RULES = {
    compress: () => ({ input: RASTER_INPUT_FORMATS, output: RASTER_INPUT_FORMATS }),
    convert: (preset) => ({
        input: preset?.from ? [preset.from] : CONVERT_INPUT_FORMATS,
        output: preset?.to ? [preset.to] : CONVERT_OUTPUT_FORMATS,
    }),
    heic: (preset) => ({ input: HEIC_INPUT_FORMATS, output: [preset?.format ?? HEIC_DEFAULT_OUTPUT] }),
    resize: () => ({ input: RESIZE_INPUT_FORMATS, output: ALLOWED_OUTPUT_FORMATS }),
};

/**
 * `{ input, output }` for one intent, as registry format keys. A tool with no
 * rule cannot host an intent page at all, and returns two empty lists rather
 * than a guess.
 */
export function formatsFor(intent, tools = TOOLS) {
    const registry = Array.isArray(tools) ? tools : TOOLS;
    const tool = registry.find((candidate) => candidate.slug === intent?.tool);
    const rule = tool ? RULES[tool.slug] : undefined;

    if (!rule) return { input: [], output: [] };

    const { input, output } = rule(intent?.preset ?? null);

    return { input: [...input], output: [...output] };
}
