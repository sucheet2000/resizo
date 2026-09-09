'use client';

/**
 * IntentTool
 *
 * The one client component on an intent route: it picks the tool the entry
 * names and renders it with the entry's preset and copy.
 *
 * It is a CLIENT component with `next/dynamic` on purpose, and that is a
 * bundle decision. The intent route is one route serving every intent, so a
 * static import of all four tools here would ship the resizer, the compressor,
 * the converter and the HEIC decoder's UI on every one of those pages —
 * /resize-jpg and /resize-png, the busiest routes on the site, would pay for
 * three tools they never show. Next only code-splits a dynamic import of a
 * client component from inside a client component (the installed guide says
 * so in as many words), so the switch lives here rather than in the server
 * route, and each page downloads exactly the chunk it renders. The HTML is
 * still prerendered: `next/dynamic` renders on the server by default.
 *
 * The keys must match the tools lib/catalog/validate.js lets an intent hang
 * off. tests/app/intent-route.test.js holds the two lists together.
 */
import dynamic from 'next/dynamic';

const TOOLS = {
    compress: dynamic(() => import('@/app/(tools)/compress/CompressTool')),
    convert: dynamic(() => import('@/app/(tools)/convert/ConvertTool')),
    heic: dynamic(() => import('@/app/(tools)/heic/HeicTool')),
    resize: dynamic(() => import('@/app/(tools)/resize/ResizeTool')),
};

export const INTENT_TOOL_SLUGS = Object.keys(TOOLS);

export default function IntentTool({ tool, ...props }) {
    const Tool = TOOLS[tool];
    if (!Tool) {
        throw new Error(`No intent renderer for the "${tool}" tool — add it to app/(tools)/[slug]/IntentTool.js.`);
    }

    return <Tool {...props} />;
}
