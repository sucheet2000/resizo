"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "../../lib/supabase";

export default function Dashboard() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState([]);
    const [error, setError] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [dangerError, setDangerError] = useState(null);

    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUser(user ?? null);
            if (user) {
                fetchHistory(user.id);
            } else {
                setLoading(false);
            }
        });
    }, [supabase]);

    const fetchHistory = async (userId) => {
        setError(null);
        try {
            const { data, error: fetchErr } = await supabase
                .from('resize_history')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (fetchErr) {
                setError('Failed to load your resize history. Please try again.');
            } else {
                setHistory(data || []);
            }
        } catch {
            setError('Failed to load your resize history. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        setIsExporting(true);
        setDangerError(null);
        try {
            const res = await fetch('/api/account/export');
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Export failed. Please try again.');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'resizo-my-data.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setDangerError(err.message || 'Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        setDangerError(null);
        try {
            const res = await fetch('/api/account/delete', { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Account deletion failed. Please try again.');
            }
            await supabase.auth.signOut();
            router.push('/');
        } catch (err) {
            setDangerError(err.message || 'Account deletion failed. Please try again.');
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    const formatMB = (bytes) => {
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0D0A08] text-[#F5ECD7] flex items-center justify-center font-sans">
                <div className="animate-pulse text-[#A89070] font-medium tracking-wide">Loading dashboard...</div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-[#0D0A08] text-[#F5ECD7] flex flex-col items-center justify-center font-sans">
                <div className="bg-[#1A1410] border border-[#3D2B1F] p-10 rounded-3xl max-w-md w-full text-center shadow-2xl">
                    <div className="w-16 h-16 bg-[#B8860B]/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-[#B8860B]/20">
                        <svg className="w-8 h-8 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <h2 className="text-2xl font-bold mb-4 tracking-wide text-[#F5ECD7]">Access Denied</h2>
                    <p className="text-[#A89070] mb-8 leading-relaxed">Please sign in to view your dashboard.</p>
                    <Link
                        href="/"
                        className="inline-flex w-full items-center justify-center px-6 py-3.5 font-bold text-[#F5ECD7] transition-all bg-gradient-to-r from-[#B8860B] to-[#8B6914] rounded-xl hover:scale-105 shadow-[0_0_20px_rgba(184,134,11,0.3)] hover:shadow-[0_0_30px_rgba(184,134,11,0.5)] focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none"
                    >
                        Return to Homepage
                    </Link>
                </div>
            </div>
        );
    }

    // Calculate stats
    const totalResized = history.length;
    const totalBytesSaved = history.reduce((sum, item) => sum + (item.original_size_bytes - item.resized_size_bytes), 0);

    let mostUsedFormat = "N/A";
    if (history.length > 0) {
        const formats = {};
        let maxCount = 0;
        history.forEach(item => {
            const fmt = item.output_format || 'unknown';
            formats[fmt] = (formats[fmt] || 0) + 1;
            if (formats[fmt] > maxCount) {
                maxCount = formats[fmt];
                mostUsedFormat = fmt.toUpperCase();
            }
        });
    }

    return (
        <div className="min-h-screen bg-[#0D0A08] text-[#F5ECD7] font-sans">
            {/* Header */}
            <header className="sticky top-0 z-50 w-full border-b border-[#2C1F15] bg-[#0D0A08]/80 backdrop-blur-2xl">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="flex items-center justify-center p-2 rounded-xl text-[#C4AA87] hover:text-[#F5ECD7] hover:bg-[#1A1410] border border-transparent hover:border-[#3D2B1F] transition-all group focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none">
                            <svg aria-hidden="true" className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </Link>
                        <span className="text-xl font-bold tracking-tight text-[#F5ECD7]">Dashboard</span>
                    </div>
                    <div className="text-sm font-medium text-[#C4AA87]">
                        Welcome, <span className="text-[#F5ECD7]">{user.email}</span>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-12">
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                    <div className="bg-[#1A1410] border border-[#3D2B1F] rounded-3xl p-8 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-[#A89070]">Total Images Resized</h3>
                            <div className="p-2 bg-[#B8860B]/10 rounded-lg text-[#D4A346] border border-[#B8860B]/20">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            </div>
                        </div>
                        <p className="text-4xl font-black text-[#F5ECD7]">{totalResized}</p>
                    </div>

                    <div className="bg-[#1A1410] border border-[#3D2B1F] rounded-3xl p-8 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-[#A89070]">Total Data Saved</h3>
                            <div className="p-2 bg-green-500/10 rounded-lg text-green-400 border border-green-500/20">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                            </div>
                        </div>
                        <p className="text-4xl font-black text-[#F5ECD7]">{formatMB(totalBytesSaved)}</p>
                    </div>

                    <div className="bg-[#1A1410] border border-[#3D2B1F] rounded-3xl p-8 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300 shadow-lg">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-[#A89070]">Most Used Format</h3>
                            <div className="p-2 bg-[#B8860B]/10 rounded-lg text-[#D4A346] border border-[#B8860B]/20">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                            </div>
                        </div>
                        <p className="text-4xl font-black text-[#F5ECD7]">{mostUsedFormat}</p>
                    </div>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[#8B1A1A] bg-[#2C1F15] px-6 py-4">
                        <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#FCA5A5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-[#FCA5A5]">{error}</p>
                        </div>
                        <button
                            onClick={() => fetchHistory(user.id)}
                            className="shrink-0 rounded-lg border border-[#8B1A1A] bg-[#3D1515] px-4 py-1.5 text-xs font-bold text-[#FCA5A5] hover:bg-[#4D1A1A] transition-colors focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none"
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {/* Table Section */}
                <div className="bg-[#1A1410] border border-[#3D2B1F] rounded-3xl overflow-hidden shadow-2xl">
                    <div className="p-6 border-b border-[#2C1F15] bg-[#1A1410]">
                        <h3 className="text-xl font-bold tracking-wide text-[#F5ECD7]">Recent Activity</h3>
                    </div>

                    {history.length === 0 ? (
                        <div className="p-16 text-center">
                            <p className="text-[#A89070] text-lg mb-2">No resize history found.</p>
                            <Link href="/" className="inline-block mt-4 text-[#B8860B] hover:text-[#D4A346] font-bold tracking-wide transition-colors focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none rounded">Start resizing your first image ➔</Link>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-[#0D0A08]/80 border-b border-[#2C1F15]">
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Filename</th>
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Original Size</th>
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Resized To</th>
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Format</th>
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Size Saved</th>
                                        <th className="px-8 py-5 text-xs font-bold uppercase tracking-wider text-[#8C7558]">Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#2C1F15]">
                                    {history.map((item) => {
                                        const savedBytes = item.original_size_bytes - item.resized_size_bytes;
                                        return (
                                            <tr key={item.id} className="hover:bg-[#2C1F15]/30 transition-colors">
                                                <td className="px-8 py-5">
                                                    <div className="font-bold text-[#F5ECD7] max-w-[200px] truncate" title={item.original_filename}>
                                                        {item.original_filename}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="text-[#A89070] text-sm font-medium mb-1">
                                                        {item.original_width} × {item.original_height}
                                                    </div>
                                                    <div className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#0D0A08] text-[#8C7558] border border-[#2C1F15]">
                                                        {formatMB(item.original_size_bytes)}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <div className="text-[#F5ECD7] font-bold text-sm mb-1">
                                                        {item.resized_width} × {item.resized_height}
                                                    </div>
                                                    <div className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#B8860B]/10 text-[#D4A346] border border-[#B8860B]/20">
                                                        {formatMB(item.resized_size_bytes)}
                                                    </div>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold bg-[#3D2B1F] text-[#C4AA87] border border-[#4F3A29]">
                                                        {(item.output_format || 'N/A').toUpperCase()}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <span className="text-green-400 font-bold text-sm">
                                                        {savedBytes > 0 ? formatMB(savedBytes) : '0 MB'}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-5">
                                                    <span className="text-[#A89070] text-sm font-medium whitespace-nowrap">
                                                        {new Date(item.created_at).toLocaleDateString()}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Danger Zone */}
                <div className="mt-10 bg-[#1A1410] border border-red-900/40 rounded-3xl overflow-hidden shadow-2xl">
                    <div className="p-6 border-b border-red-900/30 bg-[#1A1410]">
                        <h3 className="text-xl font-bold tracking-wide text-red-400">Danger Zone</h3>
                        <p className="text-sm text-[#A89070] mt-1">These actions are permanent and cannot be undone.</p>
                    </div>

                    <div className="p-6 flex flex-col sm:flex-row gap-4">
                        {/* Export Data */}
                        <button
                            onClick={handleExport}
                            disabled={isExporting || isDeleting}
                            className={`flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border font-bold text-sm transition-all focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none ${isExporting || isDeleting ? 'opacity-50 cursor-not-allowed bg-[#2C1F15] border-[#3D2B1F] text-[#A89070]' : 'bg-[#2C1F15] border-[#3D2B1F] text-[#C4AA87] hover:bg-[#3D2B1F] hover:border-[#8C7558] hover:text-[#F5ECD7]'}`}
                        >
                            {isExporting ? (
                                <>
                                    <svg aria-hidden="true" className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                    Export My Data
                                </>
                            )}
                        </button>

                        {/* Delete Account */}
                        <button
                            onClick={() => { setShowDeleteConfirm(true); setDangerError(null); }}
                            disabled={isExporting || isDeleting}
                            className={`flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border font-bold text-sm transition-all focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none ${isExporting || isDeleting ? 'opacity-50 cursor-not-allowed bg-red-950/20 border-red-900/30 text-red-400/50' : 'bg-red-950/30 border-red-900/50 text-red-400 hover:bg-red-950/50 hover:border-red-700 hover:text-red-300'}`}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            Delete Account
                        </button>
                    </div>

                    {/* Danger error banner */}
                    {dangerError && (
                        <div className="mx-6 mb-6 flex items-start gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3">
                            <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                            <p className="text-sm text-red-400">{dangerError}</p>
                        </div>
                    )}
                </div>
            </main>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="absolute inset-0 cursor-pointer" onClick={() => !isDeleting && setShowDeleteConfirm(false)} />
                    <div className="relative w-full max-w-md bg-[#1A1410] rounded-3xl border border-red-900/50 shadow-2xl overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-700 via-red-500 to-red-700" />
                        <div className="p-8">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 bg-red-950/40 rounded-xl border border-red-900/40">
                                    <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                                </div>
                                <h2 className="text-xl font-bold text-red-400">Delete Account</h2>
                            </div>
                            <p className="text-[#C4AA87] leading-relaxed mb-2">
                                This will permanently delete your account and all associated resize history. This action <strong className="text-[#F5ECD7]">cannot be undone</strong>.
                            </p>
                            <p className="text-sm text-[#A89070] mb-8">
                                If you want a copy of your data first, close this dialog and use <strong className="text-[#C4AA87]">Export My Data</strong>.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    disabled={isDeleting}
                                    className="flex-1 py-3 rounded-xl border border-[#3D2B1F] bg-[#2C1F15] text-[#C4AA87] font-bold text-sm hover:bg-[#3D2B1F] hover:text-[#F5ECD7] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteAccount}
                                    disabled={isDeleting}
                                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none ${isDeleting ? 'bg-red-900/40 border border-red-900/40 text-red-400/50 cursor-not-allowed' : 'bg-red-700 border border-red-600 text-white hover:bg-red-600 active:scale-[0.98]'}`}
                                >
                                    {isDeleting ? (
                                        <>
                                            <svg aria-hidden="true" className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Deleting...
                                        </>
                                    ) : (
                                        'Yes, Delete My Account'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
