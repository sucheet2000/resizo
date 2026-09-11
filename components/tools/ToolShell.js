'use client';

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
 *   result → trust strip → direct answer → what this tool changes →
 *   page content → related links
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
import { useEffect, useRef } from 'react';

import Breadcrumb from '@/components/seo/Breadcrumb';
import Alert from '@/components/ui/Alert';
import Spinner from '@/components/ui/Spinner';
import BehaviourSpec from '@/components/tools/BehaviourSpec';
import OperationMark from '@/components/tools/OperationMark';
import RelatedTools from '@/components/tools/RelatedTools';
import TrustStrip from '@/components/tools/TrustStrip';

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
 *
 * `hideProgress` is for a job whose `progress` value is not a measurement —
 * an AVIF encode reports two fixed stage numbers (65, then 95) rather than a
 * continuous count, so a percentage or a bar tied to it would show the
 * visitor a number that looks precise and jumps without warning. Set it and
 * the label plus the spinner still say the job is running; nothing claims a
 * precision the engine did not report.
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
    hideProgress = false,
}) {
    // Cancel unmounts itself the moment the job stops, which would drop focus
    // to <body> and make the next Tab skip the re-enabled action. The action is
    // where the visitor started, so a cancel hands the keyboard back to it —
    // once it is enabled again, which is the render after isProcessing clears.
    const primary = useRef(null);
    const cancelled = useRef(false);

    useEffect(() => {
        if (isProcessing || !cancelled.current) return;
        cancelled.current = false;
        primary.current?.focus();
    }, [isProcessing]);

    const handleCancel = () => {
        cancelled.current = true;
        onCancel?.();
    };

    return (
        <div className={`flex flex-col gap-2 ${className}`.trim()}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                    ref={primary}
                    type={type}
                    onClick={onClick}
                    disabled={disabled || isProcessing}
                    aria-busy={isProcessing || undefined}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-button bg-accent px-5 py-3 text-base font-semibold text-accent-ink transition-[filter] duration-180 ease-snap hover:brightness-95 disabled:opacity-60 sm:w-auto"
                >
                    {isProcessing ? <Spinner size={16} /> : null}
                    {isProcessing ? processingLabel : label}
                    {isProcessing && progress > 0 && !hideProgress ? (
                        <span className="font-data tabular-nums">{progress}%</span>
                    ) : null}
                </button>

                {isProcessing && onCancel ? (
                    <button
                        type="button"
                        onClick={handleCancel}
                        className="inline-flex w-full items-center justify-center rounded-button border border-line px-5 py-3 text-base font-semibold text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken sm:w-auto"
                    >
                        Cancel
                    </button>
                ) : null}
            </div>

            {isProcessing && !hideProgress ? (
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
    preset,
    mark,
    breadcrumb,
    settings,
    settingsLabel = 'Settings',
    panel,
    error,
    action,
    result,
    keepActionWithResult = false,
    privacyNote = null,
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

                    {/* THE FOUR FACTS, NOT A SENTENCE ABOUT THEM.
                      *
                      * This was one line of prose — "Your image never leaves
                      * your device — the work happens here, in this browser
                      * tab. No account, no watermark." — written out again in
                      * slightly different words on the homepage and in the
                      * directory, which is three copies of one claim and three
                      * places for it to drift. TrustStrip is that claim as
                      * data: its first fact reads "Processed on your device"
                      * and the rest say no image upload, no account, no
                      * watermark. Same promise, one source, and a shape a
                      * reader can scan rather than parse.
                      *
                      * `privacyNote` still renders when a caller passes one —
                      * a page with something extra to say about its own file
                      * type keeps somewhere to say it — but it is no longer
                      * the default line, so no tool repeats the strip. */}
                    <TrustStrip className="mt-5 border-t border-line pt-4" />

                    {privacyNote ? (
                        <p className="mt-3 text-micro text-ink-muted">
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

            {/* What the tool does to the file, between the paragraph that
                answers the search and the page's own prose. It is the first
                question a visitor asks after "will this work", and putting it
                anywhere lower means every page answers it in a different
                place. `slug` is the tool's slug on both a tool page and an
                intent page, so one lookup serves both; `preset` is what an
                intent pins, and it is what turns "depends on the output
                format" into the single answer that page actually gives. */}
            <BehaviourSpec slug={slug} preset={preset} className="mt-12" />

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
