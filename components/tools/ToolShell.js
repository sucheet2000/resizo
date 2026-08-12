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
 *   result → page content → related links
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
 * ResultPanel. `progress` is measured upload progress from useToolSubmit, not
 * a decorative animation.
 */
export function ToolAction({
    label,
    processingLabel = 'Working…',
    isProcessing = false,
    progress = 0,
    disabled = false,
    onClick,
    type = 'button',
    hint,
    className = '',
}) {
    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
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
    mark,
    breadcrumb,
    settings,
    settingsLabel = 'Settings',
    panel,
    error,
    action,
    result,
    keepActionWithResult = false,
    privacyNote = 'Processed in memory on our server — never written to disk, deleted the moment your download starts.',
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

            <header className="mb-4 max-w-[72ch] md:mb-6">
                <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="font-display text-headline font-bold tracking-tight text-ink md:text-display">
                        {title}
                    </h1>
                    {/* Decorative operation mark wraps to its own line on a phone
                        and only costs vertical space, so it is desktop-only. */}
                    {markNode ? <span className="hidden sm:inline-flex">{markNode}</span> : null}
                </div>
                {/* The h1 already states the operation; on a phone the 20px intro
                    is what pushes the drop zone below the fold, so it is hidden
                    there and the tool stays the hero. Shown from sm up. */}
                {intro ? <p className="mt-3 hidden text-base text-ink-muted sm:block md:text-lead">{intro}</p> : null}
            </header>

            <section
                aria-label={`${title} tool`}
                className="rounded-panel border border-line bg-surface-raised p-4 shadow-raised md:p-6"
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
