"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase";

export default function Dashboard() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState([]);
    const [error, setError] = useState(null);

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
            </main>
        </div>
    );
}
