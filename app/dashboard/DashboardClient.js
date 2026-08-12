'use client';

/**
 * DashboardClient
 *
 * The signed-in view: what you have processed, and the two controls that make
 * the privacy policy's export and erasure rights real.
 *
 * Byte counts come from the shared formatFileSize — this file used to carry a
 * private formatMB that reported everything in megabytes, so a 40 KB thumbnail
 * showed as "0.04 MB" here and as "40 KB" in the tool that produced it. The
 * totals come from batchTotals, the same reducer the batch result panel uses.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AuthModal from '@/components/AuthModal';
import Alert from '@/components/ui/Alert';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { formatFileSize } from '@/lib/format-bytes';
import { batchTotals, formatSavings, savingsPercent } from '@/lib/hooks/submit-helpers';
import { createClient } from '@/lib/supabase/client';

const HISTORY_ERROR = 'Your history could not be loaded. Try again.';

const panelClass = 'rounded-panel border border-line bg-surface-raised';

const buttonClass =
    'inline-flex items-center justify-center gap-2 rounded-button border border-line px-4 py-2.5 text-ui text-ink transition-colors duration-120 ease-snap hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60';

const accentButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-button bg-accent px-4 py-2.5 text-ui font-semibold text-accent-ink transition-opacity duration-180 ease-snap hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60';

const destructiveButtonClass =
    'inline-flex items-center justify-center gap-2 rounded-button border border-accent px-4 py-2.5 text-ui text-accent transition-colors duration-120 ease-snap hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-60';

const cellClass = 'px-4 py-3.5 align-top';

/** ISO, not toLocaleDateString: the format must not change with the visitor. */
function isoDay(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}

function dimensions(width, height) {
    if (!Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return '—';
    return `${width}×${height}`;
}

/** The format that appears most often, or null when there is no history. */
function topFormat(rows) {
    const counts = new Map();
    for (const row of rows) {
        const format = (row.output_format || '').toLowerCase();
        if (!format) continue;
        counts.set(format, (counts.get(format) ?? 0) + 1);
    }

    let best = null;
    for (const [format, count] of counts) {
        if (!best || count > best.count) best = { format, count };
    }

    return best ? best.format.toUpperCase() : null;
}

export default function DashboardClient() {
    const [user, setUser] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [history, setHistory] = useState([]);
    const [historyError, setHistoryError] = useState(null);
    const [accountError, setAccountError] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);

    const cancelRef = useRef(null);
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    const loadHistory = useCallback(async (userId) => {
        setHistoryError(null);

        try {
            const { data, error } = await supabase
                .from('resize_history')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) setHistoryError(HISTORY_ERROR);
            else setHistory(data ?? []);
        } catch {
            setHistoryError(HISTORY_ERROR);
        } finally {
            setIsLoading(false);
        }
    }, [supabase]);

    useEffect(() => {
        let active = true;

        supabase.auth.getUser().then(({ data }) => {
            if (!active) return;
            const nextUser = data?.user ?? null;
            setUser(nextUser);
            if (nextUser) loadHistory(nextUser.id);
            else setIsLoading(false);
        }).catch(() => {
            if (active) setIsLoading(false);
        });

        return () => {
            active = false;
        };
    }, [supabase, loadHistory]);

    const handleExport = async () => {
        setIsExporting(true);
        setAccountError(null);

        try {
            const response = await fetch('/api/account/export');
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || 'The export did not come through. Try again.');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'resizo-my-data.csv';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            setAccountError(error.message || 'The export did not come through. Try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        setAccountError(null);

        try {
            const response = await fetch('/api/account/delete', { method: 'DELETE' });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || 'The account could not be deleted. Try again.');
            }

            await supabase.auth.signOut();
            router.push('/');
        } catch (error) {
            setAccountError(error.message || 'The account could not be deleted. Try again.');
            setIsDeleting(false);
            setConfirmOpen(false);
        }
    };

    const totals = batchTotals(
        history.map((row) => ({
            originalBytes: Number(row.original_size_bytes),
            resultBytes: Number(row.resized_size_bytes),
        })),
    );
    const savedLabel = totals ? formatSavings(totals.savedPercent) : null;
    const format = topFormat(history);

    return (
        <div className="shell py-12">
            <header className="max-w-[60ch]">
                <h1 className="font-display text-headline font-bold tracking-tight text-ink">
                    Dashboard
                </h1>
                <p className="mt-2 text-ui text-ink-muted">
                    {user
                        ? `Signed in as ${user.email}`
                        : 'Every image you process while signed in is listed here.'}
                </p>
            </header>

            {isLoading ? (
                <p className="mt-10 flex items-center gap-2 text-ui text-ink-muted" role="status">
                    <Spinner size={16} />
                    Loading your history…
                </p>
            ) : null}

            {!isLoading && !user ? (
                <div className={`mt-10 max-w-md ${panelClass} p-6`}>
                    <h2 className="font-display text-title font-bold text-ink">
                        Sign in to see your history
                    </h2>
                    <p className="mt-3 text-base text-ink-muted">
                        An account is optional and changes nothing about how the tools work. It adds
                        this page: one row per image you process, with the sizes before and after.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={() => setAuthOpen(true)}
                            className={accentButtonClass}
                        >
                            Sign in
                        </button>
                        <Link href="/resize" className={buttonClass}>
                            Resize an image
                        </Link>
                    </div>
                </div>
            ) : null}

            {!isLoading && user ? (
                <div className="mt-10 flex flex-col gap-8">
                    {historyError ? (
                        <Alert>
                            {historyError}{' '}
                            <button
                                type="button"
                                onClick={() => loadHistory(user.id)}
                                className="rounded-input underline underline-offset-4"
                            >
                                Retry
                            </button>
                        </Alert>
                    ) : null}

                    <section aria-labelledby="totals-heading" className={`${panelClass} p-6`}>
                        <h2 id="totals-heading" className="text-micro font-semibold text-ink">
                            Totals
                        </h2>

                        {totals ? (
                            <dl className="mt-4 flex flex-wrap items-end gap-x-12 gap-y-6">
                                <div>
                                    <dt className="text-ui text-ink-muted">Size saved</dt>
                                    <dd className="font-data text-numeral font-semibold text-accent">
                                        {savedLabel}
                                    </dd>
                                    <p className="font-data text-ui text-ink-muted">
                                        {formatFileSize(Math.max(totals.savedBytes, 0))} smaller
                                    </p>
                                </div>
                                <div>
                                    <dt className="text-ui text-ink-muted">Images</dt>
                                    <dd className="font-data text-title text-ink">{history.length}</dd>
                                </div>
                                <div>
                                    <dt className="text-ui text-ink-muted">Most used format</dt>
                                    <dd className="font-data text-title text-ink">{format ?? '—'}</dd>
                                </div>
                            </dl>
                        ) : (
                            <p className="mt-3 text-base text-ink-muted">
                                Nothing processed yet, so there is nothing to total.
                            </p>
                        )}
                    </section>

                    <section aria-labelledby="history-heading" className={panelClass}>
                        <div className="border-b border-line px-6 py-4">
                            <h2 id="history-heading" className="font-display text-lead font-bold text-ink">
                                History
                            </h2>
                        </div>

                        {history.length === 0 ? (
                            <div className="px-6 py-10">
                                <p className="text-base text-ink-muted">
                                    No images processed on this account yet.
                                </p>
                                <Link
                                    href="/resize"
                                    className="mt-4 inline-flex rounded-input text-accent underline underline-offset-4 transition-opacity duration-120 ease-snap hover:opacity-80"
                                >
                                    Resize your first image
                                </Link>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[44rem] border-collapse text-left">
                                    <caption className="sr-only">
                                        Every image processed on this account, newest first.
                                    </caption>
                                    <thead>
                                        <tr className="border-b border-line">
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>File</th>
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>Before</th>
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>After</th>
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>Format</th>
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>Saved</th>
                                            <th scope="col" className={`${cellClass} text-micro font-semibold text-ink-muted`}>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((row) => {
                                            const before = Number(row.original_size_bytes);
                                            const after = Number(row.resized_size_bytes);
                                            const percent = formatSavings(savingsPercent(before, after));

                                            return (
                                                <tr key={row.id} className="border-b border-line last:border-b-0">
                                                    <td className={cellClass}>
                                                        <span
                                                            className="block max-w-[16rem] truncate text-ui text-ink"
                                                            title={row.original_filename || undefined}
                                                        >
                                                            {row.original_filename || 'Untitled'}
                                                        </span>
                                                    </td>
                                                    <td className={cellClass}>
                                                        <span className="block font-data text-ui text-ink">
                                                            {dimensions(row.original_width, row.original_height)}
                                                        </span>
                                                        <span className="block font-data text-micro text-ink-muted">
                                                            {formatFileSize(before)}
                                                        </span>
                                                    </td>
                                                    <td className={cellClass}>
                                                        <span className="block font-data text-ui text-ink">
                                                            {dimensions(row.resized_width, row.resized_height)}
                                                        </span>
                                                        <span className="block font-data text-micro text-ink-muted">
                                                            {formatFileSize(after)}
                                                        </span>
                                                    </td>
                                                    <td className={cellClass}>
                                                        <span className="font-data text-micro text-ink-muted">
                                                            {(row.output_format || '—').toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className={cellClass}>
                                                        <span className="font-data text-ui text-accent">
                                                            {percent ?? '—'}
                                                        </span>
                                                    </td>
                                                    <td className={cellClass}>
                                                        <span className="whitespace-nowrap font-data text-micro text-ink-muted">
                                                            {isoDay(row.created_at)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="data-heading" className={panelClass}>
                        <div className="border-b border-line px-6 py-4">
                            <h2 id="data-heading" className="font-display text-lead font-bold text-ink">
                                Your data
                            </h2>
                            <p className="mt-1 max-w-[60ch] text-ui text-ink-muted">
                                Download everything this account holds, or erase it. Deleting takes
                                effect immediately and cannot be undone.
                            </p>
                        </div>

                        <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row">
                            <button
                                type="button"
                                onClick={handleExport}
                                disabled={isExporting || isDeleting}
                                className={buttonClass}
                            >
                                {isExporting ? <Spinner size={16} /> : null}
                                {isExporting ? 'Preparing your CSV…' : 'Export my data (CSV)'}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setAccountError(null);
                                    setConfirmOpen(true);
                                }}
                                disabled={isExporting || isDeleting}
                                className={destructiveButtonClass}
                            >
                                Delete account
                            </button>
                        </div>

                        {accountError ? (
                            <div className="px-6 pb-5">
                                <Alert>{accountError}</Alert>
                            </div>
                        ) : null}
                    </section>
                </div>
            ) : null}

            {confirmOpen ? (
                <Modal
                    open
                    onClose={() => {
                        if (!isDeleting) setConfirmOpen(false);
                    }}
                    title="Delete account"
                    description="This removes your sign-in, your history and any review you posted."
                    initialFocusRef={cancelRef}
                    footer={
                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                            <button
                                ref={cancelRef}
                                type="button"
                                onClick={() => setConfirmOpen(false)}
                                disabled={isDeleting}
                                className={buttonClass}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className={accentButtonClass}
                            >
                                {isDeleting ? <Spinner size={16} /> : null}
                                {isDeleting ? 'Deleting…' : 'Delete my account'}
                            </button>
                        </div>
                    }
                >
                    <p className="text-base text-ink-muted">
                        Deletion is immediate and cannot be undone. If you want a copy of your
                        history first, close this dialog and use <strong className="font-semibold text-ink">Export
                        my data</strong>.
                    </p>
                </Modal>
            ) : null}

            {authOpen ? (
                <AuthModal
                    onClose={() => setAuthOpen(false)}
                    onSuccess={(nextUser) => {
                        setAuthOpen(false);
                        setUser(nextUser);
                        setIsLoading(true);
                        loadHistory(nextUser.id);
                    }}
                />
            ) : null}
        </div>
    );
}
