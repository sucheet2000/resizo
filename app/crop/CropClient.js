"use client";

import { useState, useRef, useEffect } from "react";
import Link from 'next/link';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export default function CropClient() {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    const [imgWidth, setImgWidth] = useState(0);
    const [imgHeight, setImgHeight] = useState(0);

    const [cropX, setCropX] = useState(0);
    const [cropY, setCropY] = useState(0);
    const [cropWidth, setCropWidth] = useState(0);
    const [cropHeight, setCropHeight] = useState(0);

    const [isProcessing, setIsProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [downloadError, setDownloadError] = useState(null);

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

        const img = new Image();
        img.onload = () => {
            setImgWidth(img.width);
            setImgHeight(img.height);
            setCropX(0);
            setCropY(0);
            setCropWidth(img.width);
            setCropHeight(img.height);
        };
        img.src = objectUrl;
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

    const handleCrop = async () => {
        if (!file) return;

        if (cropX < 0 || cropY < 0 || cropWidth <= 0 || cropHeight <= 0 || cropX + cropWidth > imgWidth || cropY + cropHeight > imgHeight) {
            setDownloadError("Invalid crop parameters. Ensure the region fits inside the image.");
            return;
        }

        setIsProcessing(true);
        setDownloadError(null);

        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("crop_x", cropX);
            formData.append("crop_y", cropY);
            formData.append("crop_width", cropWidth);
            formData.append("crop_height", cropHeight);

            const response = await fetch('/api/crop', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errorData;
                try { errorData = await response.json(); } catch (e) { }
                throw new Error(errorData?.error || "Crop failed.");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
            a.download = `cropped-${file.name.split('.')[0]}.${ext}`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

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
        <div className="bg-[#0D0A08] min-h-screen text-[#F5ECD7] font-sans selection:bg-[#B8860B]/30 pb-20">
            <header className="fixed top-0 z-50 w-full border-b border-[#2C1F15] bg-[#0D0A08]/80 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-[#B8860B] to-[#8B6914] rounded-xl shadow-[0_0_20px_rgba(184,134,11,0.5)]">
                            <svg aria-hidden="true" className="w-5 h-5 text-[#F5ECD7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </div>
                        <span className="text-2xl font-bold tracking-tight">Resizo</span>
                    </Link>
                    <Link href="/" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Back to all tools</Link>
                </div>
            </header>

            <main className="pt-32 px-4 max-w-4xl mx-auto flex flex-col items-center">
                <h1 className="text-4xl md:text-6xl font-black mb-4 text-center text-transparent bg-clip-text bg-gradient-to-b from-[#F5ECD7] to-slate-400">Crop Images Online</h1>
                <p className="text-xl text-[#A89070] text-center mb-12">Remove unwanted areas with pixel-perfect precision</p>

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
                                <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#3D2B1F] bg-[#0D0A08]">
                                    {previewUrl && (
                     /* eslint-disable-next-line @next/next/no-img-element */
                     <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
                   )}
                                </div>
                                <div>
                                    <p className="font-bold truncate max-w-[200px]">{file.name}</p>
                                    <p className="text-sm text-[#A89070]">{formatFileSize(file.size)}</p>
                                </div>
                            </div>
                            <button onClick={() => setFile(null)} className="text-[#A89070] hover:text-red-400 transition-colors">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="w-full bg-[#0D0A08] rounded-xl border border-[#3D2B1F] flex items-center justify-center p-4 min-h-[200px] relative overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} className="max-w-full max-h-[300px] object-contain opacity-50" alt="Preview Background" />
                                <div className="absolute font-mono text-xs text-[#B8860B] bg-[#1A1410] px-3 py-1 rounded-full border border-[#3D2B1F]">
                                    {imgWidth} x {imgHeight} px
                                </div>
                            </div>

                            <div className="text-center">
                                <p className="text-[#F5ECD7] text-lg mb-4">Cropping <span className="text-[#B8860B] font-bold">{cropWidth}x{cropHeight}</span> from position <span className="text-[#B8860B] font-bold">({cropX}, {cropY})</span></p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-[#A89070] tracking-wider mb-2">X Position (left)</label>
                                    <input type="number" value={cropX} onChange={(e) => setCropX(parseInt(e.target.value) || 0)} className="w-full px-4 py-3 bg-[#0D0A08] border border-[#3D2B1F] rounded-xl focus:border-[#B8860B] outline-none transition-colors" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-[#A89070] tracking-wider mb-2">Y Position (top)</label>
                                    <input type="number" value={cropY} onChange={(e) => setCropY(parseInt(e.target.value) || 0)} className="w-full px-4 py-3 bg-[#0D0A08] border border-[#3D2B1F] rounded-xl focus:border-[#B8860B] outline-none transition-colors" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-[#A89070] tracking-wider mb-2">Crop Width</label>
                                    <input type="number" value={cropWidth} onChange={(e) => setCropWidth(parseInt(e.target.value) || 0)} className="w-full px-4 py-3 bg-[#0D0A08] border border-[#3D2B1F] rounded-xl focus:border-[#B8860B] outline-none transition-colors" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-[#A89070] tracking-wider mb-2">Crop Height</label>
                                    <input type="number" value={cropHeight} onChange={(e) => setCropHeight(parseInt(e.target.value) || 0)} className="w-full px-4 py-3 bg-[#0D0A08] border border-[#3D2B1F] rounded-xl focus:border-[#B8860B] outline-none transition-colors" />
                                </div>
                            </div>

                            <div className="pt-4">
                                <button
                                    onClick={handleCrop}
                                    disabled={isProcessing}
                                    className="w-full py-4 font-bold text-lg bg-gradient-to-r from-[#B8860B] to-[#8B6914] text-[#F5ECD7] rounded-xl hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? (
                                        <><svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Cropping...</>
                                    ) : (
                                        'Crop & Download'
                                    )}
                                </button>
                                {downloadError && <p className="mt-4 text-center text-red-400 text-sm bg-red-400/10 py-2 rounded-lg">{downloadError}</p>}
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-32 w-full max-w-4xl border-t border-[#3D2B1F] pt-16">
                    <h2 className="text-2xl font-bold mb-8 text-center">Related Tools</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Link href="/compress" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Compress Image</h3>
                            <p className="text-sm text-[#A89070]">Reduce file size without losing quality.</p>
                        </Link>
                        <Link href="/resize" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Resize Image</h3>
                            <p className="text-sm text-[#A89070]">Change image dimensions with pixel-perfect precision.</p>
                        </Link>
                        <Link href="/convert" className="block p-6 bg-[#1A1410] border border-[#3D2B1F] rounded-2xl hover:border-[#B8860B]/50 transition-colors group">
                            <h3 className="font-bold text-[#F5ECD7] mb-2 group-hover:text-[#B8860B] transition-colors">Convert Format</h3>
                            <p className="text-sm text-[#A89070]">Switch between JPEG, PNG, and WebP instantly.</p>
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
