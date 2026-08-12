/**
 * ToolShell
 *
 * The one repeated primitive. Every tool is this layout with different
 * controls, which is why it is entirely slot-driven: no tool may invent its
 * own page skeleton, and the six clients that each hand-rolled the same
 * header/dropzone/preview/spinner cannot drift apart again.
 *
 * Fixed order, and the order is the design:
 *   breadcrumb → h1 → one-line sub → settings → panel → error → action →
 *   result → direct answer → page content → related links
 *
 * That is the DOM order, which is the order a crawler and a screen reader read.
 * The one-line sub is the single element painted somewhere else on a phone —
 * after the panel rather than before it — so it costs the fold nothing while
 * still existing for a mobile-first crawler.
 *
 * THE `answer` SLOT
 *
 * A short, self-contained paragraph that answers the question the page is
 * ranked for, in a form that can be quoted on its own: what the job is, what
 * you actually do here, and where the work happens. It is the copy that has to
 * win the click at position 9, so it is rendered at EVERY width — never hidden,
 * never `sm:` gated — and it sits immediately below the tool panel on every
 * page, which is the one place it can be unconditionally visible without
 * pushing the drop zone off a phone screen. It is deliberately not the `intro`
 * slot: the sub-line is one line under the h1, this is three sentences of
 * substance, and a page needs both.
 *
 * Settings sit ABOVE the drop zone so a file lands already configured. No CTA
 * that scrolls to the tool: the tool is the first thing painted.
 */
import Breadcrumb from '@/components/seo/Breadcrumb';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import OperationMark from '@/components/tools/OperationMark';
import RelatedTools from '@/components/tools/RelatedTools';

/**
 * The submit control, and the first half of the CTA morph: label → spinner and
 * a real progress bar → gone, replaced in place by the Download button inside
 * ResultPanel. `progress` is the engine's own stage reading from
 * useLocalProcess — decode, resize, encode — not a decorative animation. It
 * used to be measured upload bytes; nothing is uploaded now, so the bar counts
 * the work instead of the transfer.
 *
 * `onCancel` surfaces useLocalProcess's abort while a job is running, and it
 * now genuinely stops the work rather than merely stopping us listening to it.
 * The button appears alongside the working state and disappears the moment the
 * job settles.
 */
export function ToolAction({
    label,
    processingLabel = 'Working…',
    isProcessing = false,
    progress = 0,
    disabled = false,
    onClick,
    onCancel,
    type = 'button',
    hint,
    className = '',
}) {
    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                    type={type}
                    onClick={onClick}
                    disabled={disabled || isProcessing}
                    aria-busy={isProcessing || undefined}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-opacity duration-180 ease-snap hover:opacity-90 disabled:opacity-60 sm:w-auto"
                >
                    {isProcessing ? <Spinner size={16} /> : null}
                    {isProcessing ? processingLabel : label}
                    {isProcessing && progress > 0 ? (
                        <span className="font-data tabular-nums">{progress}%</span>
                    ) : null}
                </button>

                {isProcessing && onCancel ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="inline-flex w-full items-center justify-center rounded-button border border-line px-5 py-3 text-base font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken sm:w-auto"
                    >
                        Cancel
                    </button>
                ) : null}
            </div>

            {isProcessing ? (
                <div
                    role="progressbar"
                    aria-label={processingLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    className="h-1 w-full overflow-hidden rounded-pill bg-surface-sunken sm:max-w-xs"
                >
                    <span
                        className="block h-full bg-accent transition-[width] duration-240 ease-snap"
                        style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
                    />
                </div>
            ) : null}

            {hint && !isProcessing ? <p className="text-micro text-ink-muted">{hint}</p> : null}
        </div>
    );
}

export default function ToolShell({
    slug,
    title,
    intro,
    answer,
    mark,
    breadcrumb,
    settings,
    settingsLabel = 'Settings',
    panel,
    error,
    action,
    result,
    keepActionWithResult = false,
    privacyNote = 'Your image never leaves your device — the work happens here, in this browser tab. No account, no watermark.',
    related,
    relatedHeading,
    children,
    className = '',
}) {
    const markNode = mark === false
        ? null
        : (typeof mark === 'string' ? <OperationMark mark={mark} size="lead" /> : (mark ?? (slug ? <OperationMark tool={slug} size="lead" /> : null)));

    return (
        <div className={`shell py-4 md:py-12 ${className}`.trim()}>
            {breadcrumb?.length ? <Breadcrumb items={breadcrumb} className="mb-3 md:mb-6" /> : null}

            {/*
              * Flex column so the intro can be painted in a different place on a
              * phone than in the DOM. Order in the DOM is fixed and is what a
              * crawler and a screen reader read: h1 → intro → panel.
              */}
            <div className="flex flex-col">
                <header className="max-w-[72ch]">
                    <div className="flex flex-wrap items-baseline gap-3">
                        <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                            {title}
                        </h1>
                        {/* Decorative operation mark wraps to its own line on a phone
                            and only costs vertical space, so it is desktop-only. */}
                        {markNode ? <span className="hidden sm:inline-flex">{markNode}</span> : null}
                    </div>
                </header>

                {/* This line was `hidden … sm:block`, which meant it did not exist
                    for a mobile-first crawler — the copy that has to win the click
                    was invisible to the thing ranking the page. The reason behind
                    it was real, though: above the panel it costs ~70px and pushes
                    the drop zone off a 640px phone screen, and the tool is the
                    hero. So on a phone it is painted after the panel instead of
                    hidden — the fold is untouched — and from sm up it sits back
                    under the h1 where DESIGN.md puts it. */}
                {intro ? (
                    <p className="order-last mt-6 max-w-[72ch] text-base text-ink-muted sm:order-none sm:mt-3 md:text-lead">
                        {intro}
                    </p>
                ) : null}

                {/* Spacing lives here rather than in a flex `gap` so the
                    headline keeps its own tighter 12px sub-line spacing at
                    every width, exactly as before. */}
                <section
                    aria-label={`${title} tool`}
                    className="mt-4 rounded-panel border border-line bg-surface-raised p-4 shadow-raised md:mt-6 md:p-6"
                >
                    {settings ? (
                        <div className="mb-5">
                            <h2 className="sr-only">{settingsLabel}</h2>
                            {settings}
                        </div>
                    ) : null}

                    {panel}

                    {error ? <Alert className="mt-4">{error}</Alert> : null}

                    {/* The morph: once a result exists the submit control is gone
                        and the Download button inside ResultPanel takes its place,
                        rather than both sitting on the panel at once. */}
                    {action && (!result || keepActionWithResult) ? (
                        <div className="mt-5">{action}</div>
                    ) : null}

                    {result ? <div className="mt-6">{result}</div> : null}

                    {privacyNote ? (
                        <p className="mt-5 border-t border-line pt-4 text-micro text-ink-muted">
                            {privacyNote}
                        </p>
                    ) : null}
                </section>
            </div>

            {/* Below the panel, at every width, on every page. Above the panel
                it would cost the fold three lines on a phone, and the tool is
                the hero; hiding it on small screens would take it away from the
                mobile-first crawler that decides whether anyone gets here. */}
            {answer ? (
                <p className="mt-6 max-w-[72ch] text-base text-ink-muted">
                    {answer}
                </p>
            ) : null}

            {children ? (
                <div className="mt-12 flex max-w-[72ch] flex-col gap-10">{children}</div>
            ) : null}

            {related === false ? null : (
                <div className="mt-12">
                    {related ?? <RelatedTools slug={slug} heading={relatedHeading} />}
                </div>
            )}
        </div>
    );
}
