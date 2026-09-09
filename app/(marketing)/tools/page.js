/**
 * /tools — the directory.
 *
 * The header can carry seven tools and stay readable; it cannot carry fifty.
 * This page is where the family scales: every category that holds a product,
 * every tool under its category, every intent page under its tool, all read
 * from the registry. It is the second path to every intent page (the first is
 * the parent tool page), which is what keeps a new entry from being an orphan.
 */
import ToolsDirectory from '@/components/marketing/ToolsDirectory';
import Breadcrumb from '@/components/seo/Breadcrumb';
import JsonLd from '@/components/seo/JsonLd';
import { INTENTS, TOOLS } from '@/lib/catalog';
import { breadcrumbList } from '@/lib/schema';
import { buildMetadata } from '@/lib/seo';

const PATH = '/tools';

const BREADCRUMB = [
    { name: 'Home', path: '/' },
    { name: 'All tools', path: PATH },
];

const DESCRIPTION = 'Every Resizo tool, grouped by what you need to do, and every one runs on your own '
    + 'device — nothing is uploaded. Resize, compress, convert, crop, HEIC to JPG, and photos to PDF. '
    + 'Free, no account, no watermark.';

export const metadata = buildMetadata({
    title: 'All Resizo Tools — Free, No Upload | Resizo',
    description: DESCRIPTION,
    path: PATH,
    ogImage: '/og-home.jpg',
});

// Counted, never typed: the homepage once said "Five tools" for as long as
// two more existed.
const TOOL_COUNT = TOOLS.filter((tool) => tool.hasOwnPage).length;
const INTENT_COUNT = INTENTS.length;

export default function ToolsPage() {
    return (
        <div className="shell py-8 md:py-12">
            <JsonLd id="tools-schema" data={[breadcrumbList(BREADCRUMB)]} />

            <Breadcrumb items={BREADCRUMB} className="mb-6" />

            <header className="max-w-3xl">
                <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                    Every Resizo tool
                </h1>
            </header>
            <p className="mt-3 max-w-[60ch] text-base text-ink-muted md:text-lead">
                {TOOL_COUNT} tools and {INTENT_COUNT} pages set up for one job each, grouped by what you
                came to do. All of them run on your own device: the file you drop is read, changed and
                saved by the machine in front of you, and it is never uploaded.
            </p>

            <ToolsDirectory className="mt-10" />
        </div>
    );
}
