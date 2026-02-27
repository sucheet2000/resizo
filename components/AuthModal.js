"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase";

export default function AuthModal({ onClose, onSuccess }) {
    const [activeTab, setActiveTab] = useState("signin"); // 'signin' | 'signup'
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    const supabase = createClient();

    // Reset errors when swapping tabs
    const handleTabSwitch = (tab) => {
        setActiveTab(tab);
        setErrorMsg(null);
    };

    const handleAuth = async (e) => {
        e.preventDefault();
        setErrorMsg(null);

        if (!email || !password) {
            setErrorMsg("Please provide both an email address and a password.");
            return;
        }

        if (password.length < 6) {
            setErrorMsg("Password must be at least 6 characters long.");
            return;
        }

        setLoading(true);

        try {
            if (activeTab === "signup") {
                const { error, data } = await supabase.auth.signUp({
                    email,
                    password,
                });

                if (error) throw error;

                // Next.js SSR Auth flow might require email confirmation based on Supabase settings.
                // If auto-confirm is off, tell the user to check their email.
                if (data?.user && data.user.identities && data.user.identities.length === 0) {
                    setErrorMsg("This email is already registered. Please sign in instead.");
                    setLoading(false);
                    return;
                }

                if (data?.session) {
                    onSuccess(data.session.user);
                } else {
                    // If no session exists immediately after signup, email verification is likely required
                    setErrorMsg("Registration successful! Please check your email inbox to verify your account.");
                    // Clear inputs but don't close modal to let them read the message
                    setEmail("");
                    setPassword("");
                }

            } else {
                // Sign In Flow
                const { error, data } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) throw error;

                if (data?.session) {
                    onSuccess(data.session.user);
                }
            }
        } catch (err) {
            console.error("Auth Error:", err);
            setErrorMsg(err.message || "An error occurred during authentication.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-[fade-in_0.2s_ease-out_forwards]">
            {/* Click-away backdrop */}
            <div className="absolute inset-0 cursor-pointer" onClick={onClose} />

            {/* Modal Dialog */}
            <div className="relative w-full max-w-md bg-[#1A1410] rounded-3xl border border-[#3D2B1F] shadow-2xl overflow-hidden animate-[fade-in-up_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards]">

                {/* Top Gradient Bar */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#B8860B] via-[#D4A346] to-[#8B6914]" />

                <div className="p-8">

                    <div className="flex justify-between items-start mb-8">
                        <h2 className="text-2xl font-bold tracking-wide text-[#F5ECD7]">
                            Account Access
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1.5 bg-[#2C1F15] rounded-lg text-[#A89070] hover:text-[#F5ECD7] hover:bg-[#3D2B1F] transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    {/* Error Message */}
                    {errorMsg && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start gap-3">
                            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <p className="text-red-400 text-sm">{errorMsg}</p>
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex bg-[#2C1F15]/50 p-1.5 rounded-2xl border border-[#3D2B1F] mb-6">
                        <button
                            onClick={() => handleTabSwitch("signin")}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'signin' ? 'bg-[#3D2B1F] shadow text-[#F5ECD7]' : 'text-[#A89070] hover:text-[#F5ECD7]'}`}
                        >
                            Sign In
                        </button>
                        <button
                            onClick={() => handleTabSwitch("signup")}
                            className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'signup' ? 'bg-[#3D2B1F] shadow text-[#F5ECD7]' : 'text-[#A89070] hover:text-[#F5ECD7]'}`}
                        >
                            Sign Up
                        </button>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-[#C4AA87]">Email Address</label>
                            <input
                                type="email"
                                autoComplete="email"
                                required
                                disabled={loading}
                                className="w-full bg-[#0D0A08] border border-[#3D2B1F] rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-[#B8860B] focus:border-[#B8860B] transition-all text-[#F5ECD7] placeholder:text-[#6B573F]"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-[#C4AA87]">Password</label>
                            <input
                                type="password"
                                autoComplete={activeTab === "signin" ? "current-password" : "new-password"}
                                required
                                disabled={loading}
                                className="w-full bg-[#0D0A08] border border-[#3D2B1F] rounded-xl px-4 py-3 outline-none focus:ring-1 focus:ring-[#B8860B] focus:border-[#B8860B] transition-all text-[#F5ECD7] placeholder:text-[#6B573F]"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-3.5 text-[#F5ECD7] font-bold rounded-xl transition-all border border-[#3D2B1F] flex justify-center items-center gap-2 mt-4 ${loading ? 'bg-[#2C1F15] cursor-not-allowed text-[#A89070]' : 'bg-gradient-to-r from-[#B8860B] to-[#8B6914] hover:from-[#B8860B] hover:to-[#8B6914] active:scale-[0.98] shadow-[0_0_20px_rgba(184,134,11,0.2)] hover:shadow-[0_0_30px_rgba(184,134,11,0.4)]'}`}
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-[#F5ECD7]" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Authenticating...
                                </>
                            ) : (
                                activeTab === "signin" ? "Sign In to Account" : "Create Account"
                            )}
                        </button>
                    </form>

                </div>
            </div>
        </div>
    );
}
