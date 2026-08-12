/**
 * HowToSteps
 *
 * The visible procedure below a tool. It takes the SAME array that feeds
 * `howTo()` in lib/schema.js, exactly as FaqList takes the array that feeds
 * `faqPage()`, so the HowTo markup can never describe a step the page does not
 * show. Google requires the two to match, and a mismatch is a manual-action
 * risk rather than a ranking trick.
 *
 * Each step is a short imperative name and the sentence that explains it, which
 * is what a HowToStep wants (`name` + `text`) and also what reads best as a
 * numbered list.
 *
 * @param {Array<{ name: string, text: string }>} steps
 * @param {import('react').ReactNode} [intro]     prose above the list
 * @param {import('react').ReactNode} [children]  prose below the list
 */
import ContentSection from '@/components/content/ContentSection';

export default function HowToSteps({
    steps,
    heading,
    id = 'how-to',
    intro,
    children,
    className = '',
}) {
    const list = (Array.isArray(steps) ? steps : []).filter((step) => step?.name && step?.text);
    if (list.length === 0) return null;

    return (
        <ContentSection id={id} heading={heading} className={className}>
            {intro}
            <ol className="flex list-decimal flex-col gap-2 pl-5">
                {list.map((step) => (
                    <li key={step.name}>
                        <strong className="font-semibold text-ink">{step.name}.</strong>{' '}
                        {step.text}
                    </li>
                ))}
            </ol>
            {children}
        </ContentSection>
    );
}
