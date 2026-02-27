"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import AuthModal from "../components/AuthModal";
import { createClient } from "../lib/supabase";

// Magic Bytes definitions
const MAGIC_BYTES = {
  JPEG: [0xFF, 0xD8, 0xFF],
  PNG: [0x89, 0x50, 0x4E, 0x47],
  WEBP: [0x52, 0x49, 0x46, 0x46]
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_DIMENSION = 8000;

export default function Home() {
  const [fileSelected, setFileSelected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState("dimensions");
  const [keepAspectRatio, setKeepAspectRatio] = useState(true);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [originalStats, setOriginalStats] = useState({ width: 0, height: 0, sizeText: "", sizeBytes: 0, type: "" });
  const [newStats, setNewStats] = useState(null);

  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [scalePercent, setScalePercent] = useState(100);
  const [outputFormat, setOutputFormat] = useState("original");

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const fileInputRef = useRef(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase.auth]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("translate-y-0", "opacity-100");
            entry.target.classList.remove("translate-y-12", "opacity-0");
          }
        });
      },
      { threshold: 0.1 }
    );

    const elements = document.querySelectorAll(".scroll-animate");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [fileSelected, errorMsg]);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const checkMagicBytes = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = (e) => {
        if (!e.target || !e.target.result) {
          return reject("Failed to read file.");
        }
        const arr = new Uint8Array(e.target.result);
        if (arr.length < 4) return resolve(false);

        const isJPEG = arr[0] === MAGIC_BYTES.JPEG[0] && arr[1] === MAGIC_BYTES.JPEG[1] && arr[2] === MAGIC_BYTES.JPEG[2];
        const isPNG = arr[0] === MAGIC_BYTES.PNG[0] && arr[1] === MAGIC_BYTES.PNG[1] && arr[2] === MAGIC_BYTES.PNG[2] && arr[3] === MAGIC_BYTES.PNG[3];
        const isWEBP = arr[0] === MAGIC_BYTES.WEBP[0] && arr[1] === MAGIC_BYTES.WEBP[1] && arr[2] === MAGIC_BYTES.WEBP[2] && arr[3] === MAGIC_BYTES.WEBP[3];

        resolve(isJPEG || isPNG || isWEBP);
      };
      reader.onerror = () => reject("Error reading file signatures.");
      reader.readAsArrayBuffer(file.slice(0, 4));
    });
  };

  const processSelectedFile = async (file) => {
    setErrorMsg(null);

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg("Please select a valid image file (JPEG, PNG, or WebP).");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setErrorMsg(`File is too large. Maximum allowed size is 20MB. (Your file: ${formatFileSize(file.size)})`);
      return;
    }

    try {
      let isValidMagic = await checkMagicBytes(file);
      if (!isValidMagic) {
        await new Promise(resolve => setTimeout(resolve, 100));
        isValidMagic = await checkMagicBytes(file);
      }
      if (!isValidMagic) {
        setErrorMsg("Invalid file signature. This file does not appear to be a genuine image.");
        return;
      }

      setNewStats(null);
      setImageFile(file);

      const objectUrl = URL.createObjectURL(file);
      setImagePreview(objectUrl);

      const img = new Image();
      img.onload = () => {
        if (img.width > MAX_DIMENSION || img.height > MAX_DIMENSION) {
          setErrorMsg(`Image dimensions too large (${img.width}x${img.height}). Maximum allowed is 8000x8000 pixels.`);
          setImageFile(null);
          setImagePreview(null);
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setOriginalStats({
          width: img.width,
          height: img.height,
          sizeText: formatFileSize(file.size),
          sizeBytes: file.size,
          type: file.type
        });

        setTargetWidth(img.width);
        setTargetHeight(img.height);
        setScalePercent(100);

        setFileSelected(true);
        scrollToTool();
      };

      img.onerror = () => {
        setErrorMsg("Could not read file. Please try again.");
        URL.revokeObjectURL(objectUrl);
      };

      img.src = objectUrl;

    } catch (err) {
      setErrorMsg("An error occurred while validating the file.");
      console.error(err);
    }
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

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const scrollToTool = () => {
    setTimeout(() => {
      document.getElementById("config-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  };

  const handleBrowseFilesClick = (e) => {
    e.stopPropagation();
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleWidthChange = (val) => {
    const w = parseInt(val) || 0;
    setTargetWidth(val);
    if (keepAspectRatio && originalStats.width > 0 && w > 0) {
      const ratio = originalStats.height / originalStats.width;
      setTargetHeight(Math.round(w * ratio));
    }
  };

  const handleHeightChange = (val) => {
    const h = parseInt(val) || 0;
    setTargetHeight(val);
    if (keepAspectRatio && originalStats.height > 0 && h > 0) {
      const ratio = originalStats.width / originalStats.height;
      setTargetWidth(Math.round(h * ratio));
    }
  };

  const handleScaleChange = (val) => { setScalePercent(val); };

  const sanitizeFilename = (filename) => {
    const baseNameMatch = filename.match(/(.+?)(?:\.[^.]*$|$)/);
    const baseName = baseNameMatch ? baseNameMatch[1] : "image";
    return baseName.replace(/[^a-zA-Z0-9-_]/g, '');
  };

  const handleResize = async () => {
    if (!imageFile || !originalStats.width) return;

    setDownloadError(null);
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("format", outputFormat === 'original' ? 'jpeg' : outputFormat);

      if (activeTab === 'dimensions') {
        const finalW = parseInt(targetWidth) || originalStats.width;
        const finalH = parseInt(targetHeight) || originalStats.height;

        if (finalW > MAX_DIMENSION || finalH > MAX_DIMENSION) {
          throw new Error(`Target dimensions too large. Max allowed is ${MAX_DIMENSION}x${MAX_DIMENSION} pixels.`);
        }

        formData.append("width", finalW);
        formData.append("height", finalH);
      } else {
        formData.append("scale", scalePercent);
      }

      const response = await fetch('/api/resize', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          throw new Error("Received an unexpected response from the server.");
        }
        throw new Error(errorData.error || "Failed to process image on the server.");
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("Server returned an empty image file. Compression might have failed.");
      }

      const newWidthStr = activeTab === 'dimensions' ? (targetWidth || originalStats.width) : Math.round(originalStats.width * (parseFloat(scalePercent) / 100));
      const newHeightStr = activeTab === 'dimensions' ? (targetHeight || originalStats.height) : Math.round(originalStats.height * (parseFloat(scalePercent) / 100));

      setNewStats({ width: newWidthStr, height: newHeightStr, sizeText: formatFileSize(blob.size) });

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      let extName = outputFormat;
      if (outputFormat === 'original') {
        extName = originalStats.type.split('/')[1] || "img";
        if (extName === "jpeg") extName = "jpg";
      }

      const cleanName = sanitizeFilename(imageFile.name) || "image";
      a.download = `resizo-${cleanName}-${newWidthStr}x${newHeightStr}.${extName}`;

      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setIsProcessing(false);
      }, 100);

      if (user) {
        const finalW = parseInt(newWidthStr, 10);
        const finalH = parseInt(newHeightStr, 10);
        supabase.from('resize_history').insert({
          user_id: user.id,
          original_filename: imageFile.name,
          original_width: originalStats.width,
          original_height: originalStats.height,
          resized_width: finalW,
          resized_height: finalH,
          output_format: extName,
          original_size_bytes: originalStats.sizeBytes,
          resized_size_bytes: blob.size
        }).then(({ error }) => {
          if (error) {
            console.error("Error saving to resize_history:", error);
          }
        });
      }

    } catch (error) {
      console.error("Resize error:", error);
      setDownloadError(error.message || "Failed to process image.");
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    return () => { if (imagePreview) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  return (
    <div className="bg-[#0D0A08] text-[#F5ECD7] selection:bg-[#B8860B]/30 font-sans">

      {/* Header - Fixed */}
      <header className="fixed top-0 z-50 w-full border-b border-[#2C1F15] bg-[#0D0A08]/50 backdrop-blur-2xl transition-all duration-500">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-[#B8860B] to-[#8B6914] rounded-xl shadow-[0_0_20px_rgba(184,134,11,0.5)] group-hover:shadow-[0_0_30px_rgba(184,134,11,0.8)] transition-all duration-500">
              <svg className="w-5 h-5 text-[#F5ECD7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </div>
            <span className="text-2xl font-bold tracking-wide tracking-tight text-[#F5ECD7]">Resizo</span>
          </div>
          <nav className="hidden md:flex gap-8 items-center">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Home</button>
            <button onClick={() => document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Features</button>
            <button onClick={() => document.getElementById('tool-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Tool</button>
            <a href="/about" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors pr-4">About</a>
            {user && (
              <a href="/dashboard" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors">Dashboard</a>
            )}

            <div className="h-6 w-px bg-[#2C1F15]" />

            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-[#A89070] truncate max-w-[150px]">{user.email}</span>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="px-4 py-2 text-sm font-bold bg-[#1A1410] border border-[#3D2B1F] text-[#8C7558] rounded-xl hover:text-[#F5ECD7] hover:border-[#F5ECD7]/30 transition-all flex items-center gap-2"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-5 py-2 text-sm font-bold bg-gradient-to-r from-[#B8860B] to-[#8B6914] text-[#F5ECD7] rounded-xl hover:scale-105 transition-all shadow-[0_0_15px_rgba(184,134,11,0.3)] hover:shadow-[0_0_20px_rgba(184,134,11,0.5)] flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                Sign In
              </button>
            )}
          </nav>
          {/* Hamburger Menu Icon */}
          <div className="md:hidden flex items-center">
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-[#F5ECD7] p-2 focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Nav Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[#2C1F15] bg-[#0D0A08]/95 backdrop-blur-3xl px-6 py-4 space-y-4 shadow-xl">
            <div className="flex flex-col space-y-4">
              <button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setMobileMenuOpen(false); }} className="text-left text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7]">Home</button>
              <button onClick={() => { document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false); }} className="text-left text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7]">Features</button>
              <button onClick={() => { document.getElementById('tool-section')?.scrollIntoView({ behavior: 'smooth' }); setMobileMenuOpen(false); }} className="text-left text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7]">Tool</button>
              <a href="/about" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7]">About</a>
              {user && (
                <a href="/dashboard" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7]">Dashboard</a>
              )}
              <div className="h-px w-full bg-[#2C1F15]" />
              {user ? (
                <div className="flex flex-col gap-3">
                  <span className="text-sm text-[#A89070] truncate">{user.email}</span>
                  <button
                    onClick={() => { supabase.auth.signOut(); setMobileMenuOpen(false); }}
                    className="w-full py-2 text-sm font-bold bg-[#1A1410] border border-[#3D2B1F] text-[#8C7558] rounded-xl hover:text-[#F5ECD7] transition-all flex justify-center items-center gap-2"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowAuthModal(true); setMobileMenuOpen(false); }}
                  className="w-full py-2 text-sm font-bold bg-gradient-to-r from-[#B8860B] to-[#8B6914] text-[#F5ECD7] rounded-xl transition-all shadow-md flex justify-center items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" /></svg>
                  Sign In
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Snap Container */}
      <main className="h-screen w-full overflow-y-auto no-scrollbar overflow-x-hidden snap-y snap-mandatory scroll-smooth relative">

        {/* Background Effects */}
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[#9E7206]/20 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#9E7206]/20 blur-[120px]" />
        </div>

        {/* 1. Hero Section */}
        <section id="hero-section" className="relative z-10 w-full min-h-screen snap-center flex flex-col items-center justify-center px-4 pt-20">
          <div className="max-w-5xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center px-4 py-2 rounded-full border border-[#B8860B]/30 bg-[#B8860B]/10 text-[#E6BA65] text-sm font-medium tracking-wide backdrop-blur-sm animate-[fade-in-up_1s_cubic-bezier(0.16,1,0.3,1)_forwards]">
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4A346] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#B8860B]"></span>
              </span>
              Premium Image Processing
            </div>

            <h1 className="text-4xl md:text-8xl lg:text-9xl font-black tracking-tight leading-[1.1] text-transparent bg-clip-text bg-gradient-to-b from-[#F5ECD7] to-slate-400 opacity-0 animate-[fade-in-up_1s_cubic-bezier(0.16,1,0.3,1)_200ms_forwards]">
              Resize Your <br />
              <span className="bg-gradient-to-r from-[#B8860B] via-[#D4A346] to-[#8B6914] bg-clip-text text-transparent text-glow">
                Images Instantly
              </span>
            </h1>

            <p className="text-xl md:text-2xl text-[#A89070] max-w-2xl mx-auto leading-relaxed font-light opacity-0 animate-[fade-in-up_1s_cubic-bezier(0.16,1,0.3,1)_400ms_forwards]">
              Fast, free, and secure in-browser image resizing. Experience professional-grade tools with zero friction.
            </p>

            <div className="pt-8 opacity-0 animate-[fade-in-up_1s_cubic-bezier(0.16,1,0.3,1)_600ms_forwards]">
              <button
                onClick={() => document.getElementById("tool-section")?.scrollIntoView({ behavior: "smooth" })}
                className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-[#F5ECD7] transition-all duration-300 bg-gradient-to-r from-[#B8860B] to-[#8B6914] rounded-full hover:scale-105 shadow-[0_0_40px_rgba(184,134,11,0.4)] hover:shadow-[0_0_60px_rgba(184,134,11,0.6)]"
              >
                <span className="mr-2 text-lg">Start Resizing Now</span>
                <svg className="w-5 h-5 group-hover:translate-y-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
              </button>
            </div>
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce cursor-pointer text-[#8C7558] hover:text-[#F5ECD7] transition-colors" onClick={() => document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' })}>
            <span className="text-xs uppercase tracking-widest font-semibold block mb-2 opacity-50 text-center">Scroll</span>
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </div>
        </section>

        {/* 2. Features Section */}
        <section id="features-section" className="relative z-10 w-full min-h-screen snap-center flex flex-col items-center justify-center px-4 py-20">
          <div className="max-w-6xl mx-auto w-full">
            <div className="text-center mb-20 scroll-animate opacity-0 translate-y-12 transition-all duration-1000 ease-out">
              <h2 className="text-4xl md:text-5xl font-bold tracking-wide mb-6">Why Choose Resizo?</h2>
              <p className="text-xl text-[#A89070] max-w-2xl mx-auto">Built for professionals, available to everyone. Uncompromising quality and speed.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform duration-500 group scroll-animate opacity-0 translate-y-12 delay-[100ms]">
                <div className="w-14 h-14 bg-[#B8860B]/20 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#B8860B]/30 transition-colors border border-[#B8860B]/20">
                  <svg className="w-7 h-7 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <h3 className="text-2xl font-bold tracking-wide mb-4 text-[#F5ECD7]">Lightning Fast</h3>
                <p className="text-[#A89070] leading-relaxed">Processing happens entirely in your browser. Zero upload wait times, instant results.</p>
              </div>

              <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform duration-500 group scroll-animate opacity-0 translate-y-12 delay-[200ms]">
                <div className="w-14 h-14 bg-[#B8860B]/20 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#B8860B]/30 transition-colors border border-[#B8860B]/20">
                  <svg className="w-7 h-7 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <h3 className="text-2xl font-bold tracking-wide mb-4 text-[#F5ECD7]">100% Private</h3>
                <p className="text-[#A89070] leading-relaxed">Your images never leave your device. We respect your privacy by operating strictly client-side.</p>
              </div>

              <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform duration-500 group scroll-animate opacity-0 translate-y-12 delay-[300ms]">
                <div className="w-14 h-14 bg-[#B8860B]/20 rounded-2xl flex items-center justify-center mb-8 group-hover:bg-[#B8860B]/30 transition-colors border border-[#B8860B]/20">
                  <svg className="w-7 h-7 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <h3 className="text-2xl font-bold tracking-wide mb-4 text-[#F5ECD7]">Always Free</h3>
                <p className="text-[#A89070] leading-relaxed">Enterprise-grade functionality without the paywall. Resize as many images as you need.</p>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Tool Section */}
        <section id="tool-section" className="relative z-10 w-full min-h-screen snap-start flex flex-col items-center justify-center px-4 py-20 pt-28">
          <div className="w-full max-w-4xl mx-auto flex flex-col items-center">

            <div className="text-center mb-8 scroll-animate opacity-0 translate-y-12 transition-all duration-1000">
              <h2 className="text-4xl md:text-5xl font-bold tracking-wide mb-4">The Workspace</h2>
              <p className="text-[#A89070]">Drop your file below to begin configuring.</p>
            </div>

            {/* Ad Banner Top */}
            <div id="ad-banner-top" className="w-full max-w-3xl h-[90px] mb-8 bg-transparent border border-[#2C1F15] flex items-start justify-end p-2 relative">
              <span className="text-[10px] text-[#8C7558]/50 uppercase tracking-widest font-medium">Advertisement</span>
            </div>

            {/* ERROR ALERT */}
            {errorMsg && (
              <div className="w-full max-w-4xl mb-6 bg-red-500/10 border border-red-500/50 rounded-2xl p-5 flex items-start gap-4 animate-[fade-in-up_0.3s_ease-out_forwards] backdrop-blur-md">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 border border-red-500/30">
                  <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>
                <div className="flex-1 pt-1">
                  <h3 className="text-red-400 font-bold mb-1">Validation Error</h3>
                  <p className="text-red-200/80 text-sm">{errorMsg}</p>
                </div>
                <button onClick={() => setErrorMsg(null)} className="p-2 hover:bg-red-500/20 rounded-lg transition-colors text-red-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Upload Zone / Media Preview Block */}
            {!fileSelected ? (
              <div
                className={`w-full relative group rounded-[2.5rem] border-2 border-dashed transition-all duration-500 ease-out scroll-animate opacity-0 translate-y-12 delay-200 ${isDragging
                  ? "border-[#B8860B] bg-[#B8860B]/10 scale-[1.02] shadow-[0_0_50px_rgba(184,134,11,0.2)]"
                  : errorMsg ? "border-red-500/50 bg-[#120E0A]" : "border-[#4F3A29] bg-[#120E0A] hover:border-[#B8860B]/50 hover:bg-[#3D2B1F] shadow-2xl backdrop-blur-xl hover:shadow-[0_0_30px_rgba(184,134,11,0.2)]"
                  } p-8 md:p-16 text-center cursor-pointer overflow-hidden`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowseFilesClick}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] bg-gradient-to-br from-[#B8860B]/0 via-[#B8860B]/5 to-[#8B6914]/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                <input type="file" ref={fileInputRef} className="hidden" accept=".jpg,.jpeg,.png,.webp,image/*" onChange={handleFileChange} />

                <div className="relative z-10 flex flex-col items-center justify-center space-y-6 pointer-events-none">
                  <div className={`p-6 rounded-3xl transition-all duration-500 border ${isDragging
                    ? "bg-[#B8860B]/20 border-[#B8860B]/30 scale-110"
                    : errorMsg ? "bg-red-500/10 border-red-500/30" : "bg-[#2C1F15] border-[#3D2B1F] group-hover:bg-[#B8860B]/10 group-hover:border-[#B8860B]/20 group-hover:scale-110 group-hover:-translate-y-2"
                    }`}>
                    <svg className={`w-14 h-14 transition-colors duration-500 ${isDragging ? "text-[#D4A346]" : errorMsg ? "text-red-400" : "text-[#C4AA87] group-hover:text-[#D4A346]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>

                  <div className="space-y-2">
                    <p className="text-2xl font-bold tracking-wide text-[#F5ECD7] transition-colors duration-300 group-hover:text-[#FDEBCC]">Drag & Drop your high-res image</p>
                    <p className="text-lg text-[#A89070]">or click to browse your device</p>
                  </div>

                  <button className="mt-4 px-8 py-3.5 bg-gradient-to-r from-[#B8860B] to-[#8B6914] text-[#F5ECD7] font-bold rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(184,134,11,0.3)] hover:shadow-[0_0_50px_rgba(184,134,11,0.5)] pointer-events-auto">
                    Browse Files
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full relative group rounded-[2.5rem] border border-[#3D2B1F] glass-panel p-6 flex flex-col md:flex-row items-center gap-8 overflow-hidden animate-[fade-in-up_0.8s_cubic-bezier(0.16,1,0.3,1)_forwards]">
                <button
                  onClick={handleBrowseFilesClick}
                  className="absolute top-4 right-4 bg-[#1A1410]/80 hover:bg-[#2C1F15] text-[#C4AA87] hover:text-[#F5ECD7] p-2 border border-[#3D2B1F] rounded-xl backdrop-blur flex items-center gap-2 text-xs font-bold transition-colors z-20"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Replace Image
                </button>
                <input type="file" ref={fileInputRef} className="hidden" accept=".jpg,.jpeg,.png,.webp,image/*" onChange={handleFileChange} />

                <div className="w-40 h-40 shrink-0 rounded-2xl overflow-hidden bg-[#1A1410]/50 border border-[#3D2B1F] flex items-center justify-center relative shadow-inner">
                  {imagePreview && <img src={imagePreview} alt="Preview" className="max-w-full max-h-full object-contain" />}
                </div>

                <div className="flex-1 space-y-3 w-full">
                  <h3 className="text-2xl font-bold tracking-wide truncate pr-28" title={imageFile?.name}>{imageFile?.name || "Image Document"}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#1A1410]/50 rounded-xl p-4 border border-[#2C1F15] space-y-1">
                      <span className="text-xs uppercase font-bold tracking-wider text-[#8C7558]">Original</span>
                      <p className="font-medium text-[#F5ECD7] text-lg">{originalStats.width} × {originalStats.height} <span className="text-sm text-[#A89070] ml-1">px</span></p>
                      <p className="text-sm text-[#A89070]">{originalStats.sizeText}</p>
                    </div>
                    {newStats && (
                      <div className="bg-[#1A1410]/20 rounded-xl p-4 border border-[#B8860B]/20 space-y-1 animate-[fade-in-up_0.5s_ease-out]">
                        <span className="text-xs uppercase font-bold tracking-wider text-[#D4A346]">Resized Result</span>
                        <p className="font-medium text-[#F5ECD7] text-lg">{newStats.width} × {newStats.height} <span className="text-sm text-[#E6BA65] ml-1">px</span></p>
                        <p className="text-sm text-[#E6BA65]">{newStats.sizeText}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Configuration Panel */}
            {fileSelected && (
              <div id="config-panel" className="w-full mt-8 glass-panel rounded-[2rem] p-6 md:p-10 overflow-hidden relative animate-[fade-in-up_0.8s_cubic-bezier(0.16,1,0.3,1)_forwards]">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#B8860B] via-[#B8860B] to-[#8B6914]" />

                <h2 className="text-2xl font-bold tracking-wide mb-8 flex items-center gap-3 text-[#F5ECD7]">
                  <div className="p-2.5 bg-[#B8860B]/20 rounded-xl border border-[#B8860B]/30">
                    <svg className="w-6 h-6 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                  </div>
                  Resize Configuration
                </h2>

                <div className="space-y-8">
                  <div className="flex bg-[#1A1410]/50 p-1.5 rounded-2xl border border-[#3D2B1F]">
                    <button onClick={() => setActiveTab('dimensions')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'dimensions' ? 'bg-[#3D2B1F] border border-[#3D2B1F] shadow-lg text-[#F5ECD7]' : 'text-[#A89070] hover:text-[#F5ECD7] hover:bg-[#2C1F15]'}`}>By Dimensions</button>
                    <button onClick={() => setActiveTab('percentage')} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${activeTab === 'percentage' ? 'bg-[#3D2B1F] border border-[#3D2B1F] shadow-lg text-[#F5ECD7]' : 'text-[#A89070] hover:text-[#F5ECD7] hover:bg-[#2C1F15]'}`}>By Percentage</button>
                  </div>

                  <div className="pt-2 min-h-[100px] flex items-end">
                    {activeTab === 'dimensions' ? (
                      <div className="w-full flex flex-col md:flex-row items-center gap-6">
                        <div className="w-full md:flex-1 space-y-3">
                          <label className="text-sm font-bold text-[#C4AA87]">Width (px)</label>
                          <input type="number" className="w-full bg-[#1A1410]/50 border border-[#3D2B1F] rounded-xl px-5 py-4 outline-none focus:ring-2 focus:ring-[#B8860B]/50 focus:border-[#B8860B] transition-all text-[#F5ECD7] font-medium text-lg placeholder:text-[#6B573F]" placeholder="1920" value={targetWidth} onChange={(e) => handleWidthChange(e.target.value)} />
                        </div>
                        <div className="pt-2 md:pt-8 flex flex-col items-center justify-center">
                          <button onClick={() => setKeepAspectRatio(!keepAspectRatio)} className={`p-3.5 rounded-xl transition-all duration-300 border ${keepAspectRatio ? 'text-[#D4A346] bg-[#B8860B]/20 border-[#B8860B]/30 shadow-[0_0_15px_rgba(184,134,11,0.2)]' : 'text-[#8C7558] bg-[#2C1F15]/50 border-[#2C1F15] hover:bg-[#3D2B1F]'}`} title="Lock Aspect Ratio">
                            {keepAspectRatio ? (
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            ) : (
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
                            )}
                          </button>
                        </div>
                        <div className="w-full md:flex-1 space-y-3">
                          <label className="text-sm font-bold text-[#C4AA87]">Height (px)</label>
                          <input type="number" className="w-full bg-[#1A1410]/50 border border-[#3D2B1F] rounded-xl px-5 py-4 outline-none focus:ring-2 focus:ring-[#B8860B]/50 focus:border-[#B8860B] transition-all text-[#F5ECD7] font-medium text-lg placeholder:text-[#6B573F]" placeholder="1080" value={targetHeight} onChange={(e) => handleHeightChange(e.target.value)} />
                        </div>
                      </div>
                    ) : (
                      <div className="w-full space-y-3">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-bold text-[#C4AA87]">Scale (%)</label>
                          <span className="text-sm font-medium text-[#D4A346]">{scalePercent}%</span>
                        </div>
                        <div className="flex gap-4 items-center">
                          <input type="range" min="10" max="200" value={scalePercent} onChange={(e) => handleScaleChange(e.target.value)} className="flex-1 h-2 bg-[#2C1F15] rounded-lg appearance-none cursor-pointer accent-[#B8860B]" />
                          <div className="relative w-24 shrink-0">
                            <input type="number" className="w-full bg-[#1A1410]/50 border border-[#3D2B1F] rounded-xl px-3 py-3 outline-none focus:ring-2 focus:ring-[#B8860B]/50 focus:border-[#B8860B] transition-all text-[#F5ECD7] font-medium text-center" value={scalePercent} onChange={(e) => handleScaleChange(e.target.value)} min="10" max="200" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C7558] font-bold">%</span>
                          </div>
                        </div>
                        <p className="text-xs text-[#A89070] text-center pt-2">
                          Final Size: ~{Math.round(originalStats.width * (scalePercent / 100))} × {Math.round(originalStats.height * (scalePercent / 100))} px
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-[#3D2B1F]">
                    <div className="space-y-3">
                      <label className="text-sm font-bold text-[#C4AA87]">Output Format</label>
                      <div className="relative group">
                        <select className="w-full appearance-none bg-[#1A1410]/50 border border-[#3D2B1F] rounded-xl px-5 py-4 outline-none focus:ring-2 focus:ring-[#B8860B]/50 focus:border-[#B8860B] transition-all text-[#F5ECD7] font-medium cursor-pointer" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                          <option value="original">Keep Original</option>
                          <option value="jpeg">JPEG image (.jpg)</option>
                          <option value="png">PNG image (.png)</option>
                          <option value="webp">WebP format (.webp)</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-5 pointer-events-none text-[#A89070] group-hover:text-[#F5ECD7] transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center self-end h-[56px]">
                      {activeTab === 'dimensions' && (
                        <label className="flex items-center gap-4 cursor-pointer group">
                          <div className="relative flex items-center justify-center">
                            <input type="checkbox" className="peer sr-only" checked={keepAspectRatio} onChange={() => setKeepAspectRatio(!keepAspectRatio)} />
                            <div className="w-6 h-6 rounded-md border-2 border-slate-500 peer-checked:bg-[#B8860B] peer-checked:border-[#B8860B] transition-colors flex items-center justify-center">
                              <svg className="w-4 h-4 text-[#F5ECD7] opacity-0 peer-checked:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-[#A89070] group-hover:text-[#F5ECD7] transition-colors">Maintain Aspect Ratio</span>
                        </label>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleResize}
                    disabled={isProcessing}
                    className={`w-full py-5 text-[#F5ECD7] font-bold text-base md:text-xl whitespace-nowrap rounded-2xl transition-all border border-[#3D2B1F] flex justify-center items-center gap-3 mt-8 ${isProcessing ? 'bg-[#2C1F15] cursor-not-allowed text-[#A89070]' : 'bg-gradient-to-r from-[#B8860B] to-[#8B6914] hover:from-[#B8860B] hover:to-[#8B6914] active:scale-[0.98] shadow-[0_0_30px_rgba(184,134,11,0.3)] hover:shadow-[0_0_50px_rgba(184,134,11,0.5)]'}`}
                  >
                    {isProcessing ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 md:h-6 md:w-6 text-[#F5ECD7]" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Download Resized Image
                      </>
                    )}
                  </button>
                  {downloadError && (
                    <p className="text-red-400 text-sm text-center mt-3 font-medium">{downloadError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 4. Footer & Bottom Elements Section */}
        <section className="relative z-10 w-full min-h-[50vh] snap-end flex flex-col justify-end">
          <div className="w-full max-w-4xl mx-auto px-4 mb-20 scroll-animate opacity-0 translate-y-12">
            <div id="ad-banner-bottom" className="w-full h-[90px] bg-transparent border border-[#2C1F15] flex items-start justify-end p-2 relative">
              <span className="text-[10px] text-[#8C7558]/50 uppercase tracking-widest font-medium">Advertisement</span>
            </div>
          </div>

          <footer className="w-full border-t border-[#2C1F15] bg-[#0D0A08]/80 backdrop-blur-2xl py-12">
            <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-[#B8860B]/20 rounded-lg">
                  <svg className="w-4 h-4 text-[#D4A346]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[#8C7558]">© {new Date().getFullYear()} Resizo. Redefining Image Processing.</p>
              </div>
              <div className="flex gap-8">
                <a href="#" className="text-sm font-medium text-[#8C7558] hover:text-[#F5ECD7] transition-colors">Privacy</a>
                <a href="#" className="text-sm font-medium text-[#8C7558] hover:text-[#F5ECD7] transition-colors">Terms</a>
                <a href="#" className="text-sm font-medium text-[#8C7558] hover:text-[#F5ECD7] transition-colors">Contact</a>
              </div>
            </div>
          </footer>
        </section>

      </main>

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={(u) => {
            setUser(u);
            setShowAuthModal(false);
          }}
        />
      )}
    </div>
  );
}