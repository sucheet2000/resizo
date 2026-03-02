"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from 'next/link';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export default function CompressClient() {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    const [quality, setQuality] = useState(80);

    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [downloadError, setDownloadError] = useState(null);

    const [stats, setStats] = useState(null);

    const fileInputRef = useRef(null);

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const processSelectedFile = (selectedFile) => {
        setErrorMsg(null);
        setStats(null);
        setDownloadError(null);
        if (!selectedFile) return;

        if (!selectedFile.type.startsWith('image/')) {
            setErrorMsg("Please select a valid image file.");
            return;
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            setErrorMsg(`File is too large. Maximum allowed size is 20MB.`);
            return;
        }

        setFile(selectedFile);
        const objectUrl = URL.createObjectURL(selectedFile);
        setPreviewUrl(objectUrl);
    };

    // L-3: Revoke old URL before replacing
    const clearFile = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setFile(null);
        setStats(null);
        setDownloadError(null);
    };

    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processSelectedFile(e.dataTransfer.files[0]);
        }
    };

    const handleCompress = async () => {
        if (!file) return;
        setIsProcessing(true);
        setDownloadError(null);
        setStats(null);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("quality", quality.toString());

            const response = await fetch('/api/compress', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errorData;
                try { errorData = await response.json(); } catch (e) { }
                throw new Error(errorData?.error || "Compression failed.");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `compressed-${file.name}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const reduction = ((file.size - blob.size) / file.size) * 100;
            setStats({
                original: file.size,
                compressed: blob.size,
                reduction: reduction > 0 ? reduction.toFixed(1) : 0
            });

        } catch (err) {
            setDownloadError(err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    useEffect(() => {
        return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
    }, [previewUrl]);

    return (
        <div className="bg-[#0D0A08] min-h-screen flex flex-col text-[#F5ECD7] font-sans selection:bg-[#B8860B]/30 pb-20">
            <header className="fixed top-0 z-50 w-full border-b border-[#2C1F15] bg-[#0D0A08]/80 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-[#B8860B] to-[#8B6914] rounded-xl shadow-[0_0_20px_rgba(184,134,11,0.5)]">
                            <svg aria-hidden="true" className="w-5 h-5 text-[#F5ECD7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </div>
                        <span className="text-2xl font-bold tracking-tight">Resizo</span>
                    </Link>
                    <Link href="/" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Back to all tools</Link>
                </div>
            </header>

            <main className="flex-1 pt-32 px-4 max-w-4xl mx-auto flex flex-col items-center">
                <h1 className="text-4xl md:text-6xl font-black mb-4 text-center text-transparent bg-clip-text bg-gradient-to-b from-[#F5ECD7] to-slate-400">Compress Images Online</h1>
                <p className="text-xl text-[#A89070] text-center mb-12">Reduce file size without sacrificing quality</p>

                {!file ? (
                    <div
                        className={`w-full max-w-2xl border-2 border-dashed rounded-3xl p-12 text-center transition-all ${isDragging ? 'border-[#B8860B] bg-[#B8860B]/10' : 'border-[#3D2B1F] bg-[#1A1410] hover:border-[#B8860B]/50'}`}
                        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                    >
                        <div className="w-20 h-20 mx-auto mb-6 bg-[#0D0A08] rounded-2xl flex items-center justify-center border border-[#3D2B1F]">
                            <svg className="w-10 h-10 text-[#B8860B]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        </div>
                        <h3 className="text-2xl font-bold mb-4">Drag & Drop Image Here</h3>
                        <p className="text-[#A89070] mb-8">Supports JPEG, PNG, and WebP up to 20MB</p>
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/jpeg,image/png,image/webp" onChange={(e) => processSelectedFile(e.target.files[0])} />
                        <button onClick={() => fileInputRef.current?.click()} className="px-8 py-3 bg-[#2C1F15] hover:bg-[#3D2B1F] text-[#F5ECD7] rounded-xl font-bold transition-colors">Browse Files</button>
                        {errorMsg && <p className="mt-4 text-red-400 text-sm">{errorMsg}</p>}
                    </div>
                ) : (
                    <div className="w-full max-w-2xl bg-[#1A1410] border border-[#3D2B1F] rounded-3xl p-8">
                        <div className="flex items-center justify-between mb-8 pb-8 border-b border-[#3D2B1F]">
                            <div className="flex items-center gap-4">
                                {/* L-5: use Next.js Image instead of bare img */}
                                <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#3D2B1F] bg-[#0D0A08] relative">
                                    {previewUrl && (
                                        <Image src={previewUrl} className="object-cover" alt="Preview" fill unoptimized />
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold truncate max-w-[200px]">{file.name}</p>
                                    <p className="text-sm text-[#A89070]">{formatFileSize(file.size)}</p>
                                </div>
                            </div>
                            {/* L-3: clearFile revokes blob URL */}
                            <button onClick={clearFile} className="text-[#A89070] hover:text-red-400 transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="space-y-8">
                            <div>
                                <div className="flex justify-between items-end mb-4">
                                    <label className="text-sm font-bold text-[#A89070] uppercase tracking-wider">Compression Quality: {quality}</label>
                                    <span className="text-xs px-2 py-1 rounded bg-[#0D0A08] border border-[#3D2B1F] text-[#D4A346]">
                                        {quality >= 80 ? 'High Quality' : quality >= 50 ? 'Balanced' : 'Maximum Compression'}
                                    </span>
                                </div>
                                <input type="range" min="1" max="100" value={quality} onChange={(e) => setQuality(parseInt(e.target.value))} className="w-full h-2 bg-[#0D0A08] rounded-lg appearance-none cursor-pointer accent-[#B8860B]" />
                            </div>

                            <div className="pt-4">
                                <button
                                    onClick={handleCompress}
                                    disabled={isProcessing}
                                    className="w-full py-4 font-bold text-lg bg-gradient-to-r from-[#B8860B] to-[#8B6914] text-[#F5ECD7] rounded-xl hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <><svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Compressing...</>
                                    ) : (
                                        'Compress & Download'
                                    )}
                                </button>
                                {downloadError && <p className="mt-4 text-center text-red-400 text-sm bg-red-400/10 py-2 rounded-lg">{downloadError}</p>}

                                {stats && (
                                    <div className="mt-6 p-4 bg-[#0D0A08] border border-[#3D2B1F] rounded-xl flex justify-between items-center animate-[fade-in-up_0.3s_ease-out_forwards]">
                                        <div className="text-center">
                                            {/* L-1: "Original Node" → "Original Size" */}
                                            <p className="text-xs text-[#A89070] uppercase tracking-wider mb-1">Original Size</p>
                                            <p className="font-bold">{formatFileSize(stats.original)}</p>
                                        </div>
                                        <div className="flex flex-col items-center px-4">
                                            <span className="text-[#B8860B] font-bold text-lg">-{stats.reduction}%</span>
                                            <svg className="w-5 h-5 text-[#3D2B1F] mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xs text-[#A89070] uppercase tracking-wider mb-1">Compressed</p>
                                            <p className="font-bold text-[#D4A346]">{formatFileSize(stats.compressed)}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* L-4: All four sibling tools linked */}
                <div className="mt-32 w-full max-w-4xl border-t border-[#3D2B1F] pt-16">
                    <h2 className="text-2xl font-bold mb-8 text-center">Related Tools</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Link href="/resize" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Resize Image</h3>
                            <p className="text-sm text-[#A89070]">Change image dimensions with pixel-perfect precision.</p>
                        </Link>
                        <Link href="/convert" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Convert Format</h3>
                            <p className="text-sm text-[#A89070]">Switch between JPEG, PNG, and WebP instantly.</p>
                        </Link>
                        <Link href="/crop" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Crop Image</h3>
                            <p className="text-sm text-[#A89070]">Remove unwanted areas exactly how you want.</p>
                        </Link>
                        <Link href="/heic" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Convert HEIC</h3>
                            <p className="text-sm text-[#A89070]">Convert iPhone HEIC photos to universal JPEG.</p>
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
