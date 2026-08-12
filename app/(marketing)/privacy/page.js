import Link from "next/link";

export const metadata = {
    title: "Privacy Policy — Resizo",
    description: "Read Resizo's privacy policy. Your images are processed entirely in your browser and never uploaded to our servers. Learn how we handle account data and advertising.",
};

export default function PrivacyPolicy() {
    return (
        <div className="min-h-screen bg-[#0D0A08] text-[#F5ECD7] selection:bg-[#B8860B]/30 font-sans flex flex-col pt-20">
            {/* Header */}
            <header className="fixed top-0 z-50 w-full border-b border-[#2C1F15] bg-[#0D0A08]/80 backdrop-blur-md transition-all duration-500">
                <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-3 group cursor-pointer focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none rounded">
                        <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-[#B8860B] to-[#8B6914] rounded-xl shadow-[0_0_20px_rgba(184,134,11,0.5)] group-hover:shadow-[0_0_30px_rgba(184,134,11,0.8)] transition-all duration-500">
                            <svg aria-hidden="true" className="w-5 h-5 text-[#F5ECD7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                        </div>
                        <span className="text-2xl font-bold tracking-tight text-[#F5ECD7]">Resizo</span>
                    </Link>
                    <Link href="/" className="text-sm font-medium text-[#C4AA87] hover:text-[#F5ECD7] transition-colors focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none rounded">
                        Back to Home
                    </Link>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-grow w-full relative z-10 px-6 py-16 md:py-24 max-w-3xl mx-auto">
                <div className="mb-12">
                    <h1 className="text-4xl md:text-5xl font-black tracking-wide text-transparent bg-clip-text bg-gradient-to-b from-[#F5ECD7] to-[#A89070] mb-4">
                        Privacy Policy
                    </h1>
                    <p className="text-[#A89070] text-sm font-medium tracking-wide">Last Updated: February 27 2026</p>
                </div>

                <div className="space-y-10 text-[#C4AA87] leading-relaxed">
                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">1. Introduction</h2>
                        <p>
                            Welcome to Resizo. We are committed to protecting your personal information and your right to privacy. This Privacy Policy outlines how we collect, use, and safeguard your data when you use our free image processing web tool.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">2. Data Collection and Usage</h2>
                        <p>
                            Our primary service is providing in-browser image resizing and format conversion.
                            The actual image processing happens entirely on your local device. We do not upload, store, or view the original images you process through our tool.
                        </p>
                        <p>
                            When you choose to create an account and log in using Google OAuth, we collect basic profile information strictly to provide a personalized experience and maintain your user session.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">3. Resize History and Database Storage</h2>
                        <p>
                            If you use our tool while logged into your account, we record your resize history in our database.
                            This includes metadata such as original and resized dimensions, file sizes, and output formats, as well as the original filename.
                            This allows you to view your activity dashboard. The image files themselves are never uploaded or stored on our servers.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">4. Third-Party Services and Advertising</h2>
                        <p>
                            To support the continued development of our free services, we partner with Google AdSense to display advertising on our platform.
                            Google AdSense uses cookies to serve ads based on your prior visits to our website or other websites on the internet.
                            These ad networks may collect non-personally identifiable information about your interactions with our site to provide relevant advertisements.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">5. Data Security</h2>
                        <p>
                            We implement industry-standard security measures to protect the integrity and confidentiality of your account information and resize history metadata. However, no electronic transmission or storage system is entirely secure, and we cannot guarantee absolute security.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">6. Contact Us</h2>
                        <p>
                            If you have any questions or concerns regarding this Privacy Policy or our data practices, please contact our support team.
                        </p>
                    </section>
                </div>
            </main>

            {/* Footer */}
            <footer className="w-full border-t border-[#2C1F15] bg-[#0A0706] py-8 mt-auto">
                <div className="max-w-4xl mx-auto px-6 flex justify-between items-center text-sm text-[#8C7558]">
                    <p>© {new Date().getFullYear()} Resizo. All rights reserved.</p>
                    <div className="flex gap-4">
                        <Link href="/privacy" className="hover:text-[#F5ECD7] transition-colors focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none rounded">Privacy</Link>
                        <Link href="/terms" className="hover:text-[#F5ECD7] transition-colors focus-visible:ring-2 focus-visible:ring-[#B8860B] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0A08] focus-visible:outline-none rounded">Terms</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
