import Link from "next/link";

export const metadata = {
    title: "About Resizo - Free Image Resizer & Converter",
    description: "Learn how Resizo works as an online free image resizer and a private jpeg png webp converter with 100% data security.",
};

export default function About() {
    return (
        <div className="bg-slate-950 text-slate-50 selection:bg-blue-500/30 font-sans min-h-screen flex flex-col pt-20">

            {/* Header - Fixed */}
            <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-slate-950/50 backdrop-blur-2xl transition-all duration-500">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-3 group cursor-pointer">
                        <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.5)] group-hover:shadow-[0_0_30px_rgba(59,130,246,0.8)] transition-all duration-500">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </div>
                        <span className="text-2xl font-bold tracking-tight text-white">
                            Resizo
                        </span>
                    </Link>
                    <nav className="hidden md:flex gap-8">
                        <Link href="/" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Home</Link>
                        <Link href="/#features-section" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">Features</Link>
                        <Link href="/about" className="text-sm font-medium text-white transition-colors">About</Link>
                    </nav>
                </div>
            </header>

            {/* Background Effects */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/20 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/20 blur-[120px]" />
            </div>

            <main className="flex-grow w-full relative z-10 px-4 py-16 md:py-24 max-w-4xl mx-auto">

                {/* Header Section */}
                <div className="text-center mb-16">
                    <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 mb-8">
                        About Resizo - The Free Online Image Resizer
                    </h1>
                    <p className="text-lg md:text-xl text-slate-300 leading-relaxed text-left glass-panel p-8 rounded-3xl">
                        Resizo is a modern, high-performance web utility built for professionals and everyday users alike who need to quickly resize image online. Unlike traditional platforms that require you to upload your files to a remote server, Resizo handles all image processing and format conversion directly within your browser. This architectural choice means 100% privacy, faster processing times without upload bottlenecks, and a smoother user experience. Whether you need to compress a massive photograph or simply want a fast jpeg png webp converter, Resizo operates instantly without requiring an account or subscription fees.
                    </p>
                </div>

                {/* How to Resize Section */}
                <div className="mb-16">
                    <h2 className="text-3xl font-bold mb-8 text-white">How to Resize an Image Online</h2>
                    <div className="glass-panel p-8 rounded-3xl space-y-6">
                        <div className="flex gap-4 items-start">
                            <div className="w-10 h-10 shrink-0 bg-blue-500/20 border border-blue-500/30 rounded-full flex items-center justify-center font-bold text-blue-400">1</div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-100 mb-2">Select Your File</h3>
                                <p className="text-slate-400 leading-relaxed">Drag and drop your high-resolution image into the workspace, or click the upload zone to browse files from your device.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start">
                            <div className="w-10 h-10 shrink-0 bg-blue-500/20 border border-blue-500/30 rounded-full flex items-center justify-center font-bold text-blue-400">2</div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-100 mb-2">Configure Dimensions</h3>
                                <p className="text-slate-400 leading-relaxed">Choose whether to resize by exact pixel dimensions or by a percentage scale. Toggle the aspect ratio lock to prevent your image from distorting.</p>
                            </div>
                        </div>
                        <div className="flex gap-4 items-start">
                            <div className="w-10 h-10 shrink-0 bg-blue-500/20 border border-blue-500/30 rounded-full flex items-center justify-center font-bold text-blue-400">3</div>
                            <div>
                                <h3 className="text-xl font-bold text-slate-100 mb-2">Select Format and Download</h3>
                                <p className="text-slate-400 leading-relaxed">Pick a target output format (JPEG, PNG, or WebP) perfectly tailored for your needs, then click process to instantly download the modified file onto your device.</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Supported Formats Section */}
                <div className="mb-16">
                    <h2 className="text-3xl font-bold mb-8 text-white">Supported Formats</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="glass-panel p-8 rounded-3xl">
                            <h3 className="text-2xl font-bold text-blue-400 mb-4">JPEG</h3>
                            <p className="text-slate-400 leading-relaxed">The standard format for photographs and complex images. JPEG offers excellent compression, reducing file size significantly while maintaining reasonable quality. Best suited for web delivery, social media sharing, and standard digital archives where an opaque background is required.</p>
                        </div>
                        <div className="glass-panel p-8 rounded-3xl">
                            <h3 className="text-2xl font-bold text-purple-400 mb-4">PNG</h3>
                            <p className="text-slate-400 leading-relaxed">A lossless format that perfectly preserves image quality and fully supports transparency. PNG is the optimal choice for logos, graphics with sharp edges, text-heavy images, and transparent overlays where preserving crisp details is more important than achieving the smallest file size.</p>
                        </div>
                        <div className="glass-panel p-8 rounded-3xl">
                            <h3 className="text-2xl font-bold text-indigo-400 mb-4">WebP</h3>
                            <p className="text-slate-400 leading-relaxed">A modern, next-generation image format developed by Google that provides superior lossless and lossy compression. WebP files are significantly smaller than equivalent JPEGs or PNGs while handling both transparency and high visual fidelity, making them perfect for modern web optimization.</p>
                        </div>
                    </div>
                </div>

                {/* Why Your Images Never Leave Your Device */}
                <div className="mb-16">
                    <h2 className="text-3xl font-bold mb-8 text-white">Why Your Images Never Leave Your Device</h2>
                    <div className="glass-panel p-8 rounded-3xl">
                        <p className="text-slate-300 leading-relaxed">
                            Traditional image resizing tools require you to upload your personal photos to a remote corporate server, wait in a queue for a backend processor to run, and then download the returned file. This exposes your potentially sensitive files to data breaches, server logs, and potential misuse by third-party processors.
                        </p>
                        <p className="text-slate-300 leading-relaxed mt-4">
                            Resizo completely eliminates this risk by utilizing Web APIs standard to your browser. When you select an image, it is drawn onto an invisible digital drawing board known as an HTML Canvas. All pixel scaling, aspect ratio math, and format re-encoding happens using your own computer or mobile phone processor. Because no image data is ever transmitted across the internet, your files remain strictly localized, ensuring total data privacy.
                        </p>
                    </div>
                </div>

                {/* CTA */}
                <div className="flex justify-center mb-16">
                    <Link href="/" className="group relative inline-flex items-center justify-center px-10 py-5 font-bold text-white transition-all duration-300 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full hover:scale-105 shadow-[0_0_40px_rgba(79,70,229,0.4)] hover:shadow-[0_0_60px_rgba(79,70,229,0.6)]">
                        <span className="mr-2 text-xl">Resize an Image Now</span>
                        <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </Link>
                </div>
            </main>

            {/* Footer */}
            <footer className="w-full border-t border-white/5 bg-slate-950/80 backdrop-blur-2xl py-12 mt-auto relative z-10">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-blue-500/20 rounded-lg">
                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </div>
                        <p className="text-sm font-medium text-slate-500">
                            © {new Date().getFullYear()} Resizo. Redefining Image Processing.
                        </p>
                    </div>
                    <div className="flex gap-8">
                        <a href="#" className="text-sm font-medium text-slate-500 hover:text-white transition-colors">Privacy</a>
                        <a href="#" className="text-sm font-medium text-slate-500 hover:text-white transition-colors">Terms</a>
                        <a href="#" className="text-sm font-medium text-slate-500 hover:text-white transition-colors">Contact</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
