/**
 * IntentPage
 *
 * One renderer for every intent entry in lib/catalog/intents/. The ten
 * long-tail pages were ten copies of the same skeleton — structured data, the
 * parent tool preconfigured and re-headlined, the procedure, the sections, a
 * sibling block on some, the FAQ — and this is that skeleton once, reading an
 * entry. A new intent is a new entry, not a new component.
 *
 * Everything here renders on the server. The tool itself is the one client
 * island, handed in as `Tool` by the route so this component never has to
 * know which client bundle a tool lives in: app/(tools)/[slug]/IntentTool.js
 * loads exactly the tool the entry names and nothing else.
 *
 * The order of the children is the order the old pages used and the order a
 * crawler reads: procedure → sections → limits → siblings → FAQ. HowToSteps
 * and FaqList take the SAME arrays the JSON-LD is built from, so the markup
 * can never describe a step or a question the page does not show.
 */
import ContentBlocks from '@/components/content/ContentBlocks';
import ContentSection from '@/components/content/ContentSection';
import FaqList from '@/components/content/FaqList';
import HowToSteps from '@/components/content/HowToSteps';
import IntentLinks from '@/components/content/IntentLinks';
import JsonLd from '@/components/seo/JsonLd';
import { getTool } from '@/lib/catalog';
import { breadcrumbList, faqPage, howTo, softwareApplication } from '@/lib/schema';

/** Home → the parent tool → this page. The parent's title is the registry's. */
export function intentBreadcrumb(intent) {
    const tool = getTool(intent.tool);

    return [
        { name: 'Home', path: '/' },
        { name: tool.title, path: tool.href },
        { name: intent.label, path: intent.path },
    ];
}

export default function IntentPage({ intent, Tool }) {
    const breadcrumb = intentBreadcrumb(intent);
    const limitations = Array.isArray(intent.limitations) ? intent.limitations : [];

    // A tool that takes no preset is not handed one: `preset={undefined}` is
    // an own property the tool would still see.
    const toolProps = {
        title: intent.h1,
        intro: intent.intro,
        answer: intent.answer,
        breadcrumb,
        ...(intent.preset ? { preset: intent.preset } : {}),
    };

    return (
        <>
            <JsonLd
                id={`${intent.slug}-schema`}
                data={[
                    softwareApplication({
                        name: intent.application.name,
                        description: intent.description,
                        path: intent.path,
                        features: intent.application.features,
                    }),
                    breadcrumbList(breadcrumb),
                    howTo({
                        name: intent.howTo.heading,
                        description: intent.howTo.description,
                        path: intent.path,
                        anchor: intent.howTo.id,
                        steps: intent.howTo.steps,
                    }),
                    faqPage(intent.faqs),
                ]}
            />

            <Tool {...toolProps}>
                <HowToSteps id={intent.howTo.id} heading={intent.howTo.heading} steps={intent.howTo.steps} />

                {intent.sections.map((section) => (
                    <ContentSection key={section.id} id={section.id} heading={section.heading}>
                        <ContentBlocks blocks={section.blocks} />
                    </ContentSection>
                ))}

                {limitations.length > 0 ? (
                    <ContentSection id={`${intent.slug}-limits`} heading="Limits">
                        <ul className="flex list-disc flex-col gap-2 pl-5">
                            {limitations.map((limitation) => (
                                <li key={limitation}>{limitation}</li>
                            ))}
                        </ul>
                    </ContentSection>
                ) : null}

                {intent.siblingLinks ? (
                    <IntentLinks
                        tool={intent.tool}
                        exclude={intent.slug}
                        id={`${intent.slug}-related`}
                        heading={intent.siblingLinks.heading}
                    />
                ) : null}

                <FaqList items={intent.faqs} id={`${intent.slug}-faq`} />
            </Tool>
        </>
    );
}
