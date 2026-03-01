import Link from "next/link";

export const metadata = {
    title: "Terms of Service — Resizo",
    description: "Resizo's terms of service covering acceptable use, account authentication, data handling, advertising, and limitations of liability for our free image resizing tool.",
};

export default function TermsOfService() {
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
                        Terms of Service
                    </h1>
                    <p className="text-[#A89070] text-sm font-medium tracking-wide">Last Updated: February 27 2026</p>
                </div>

                <div className="space-y-10 text-[#C4AA87] leading-relaxed">
                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">1. Acceptance of Terms</h2>
                        <p>
                            By accessing and using Resizo, a free image processing web tool, you agree to comply with and be bound by the following Terms of Service. If you do not agree with any part of these terms, please refrain from using our platform.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">2. Service Description</h2>
                        <p>
                            Resizo provides a suite of image resizing, scaling, and format conversion utilities that run entirely within your browser.
                            The service is provided free of charge to all users, with certain additional features (like history tracking) available to authenticated users.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">3. Account Authentication</h2>
                        <p>
                            You may opt to log into our platform using Google OAuth. By doing so, you consent to our retrieval of your basic profile information in order to securely manage your session.
                            You are responsible for maintaining the confidentiality of your account access credentials and for any activities that occur under your account.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">4. User Data and Usage Tracking</h2>
                        <p>
                            To offer a comprehensive user experience, we store statistical metadata pertaining to your document processing history within our database.
                            This encompasses file metrics such as pre-processing and post-processing dimensions, output type configurations, and original file names.
                            Under no circumstances are the absolute image files transmitted to or preserved on our backend servers. All direct media parsing is strictly executed client-side.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">5. Advertising and Third Parties</h2>
                        <p>
                            Resizo integrates with Google AdSense to display sponsored content and advertisements, enabling us to cover operational costs.
                            Your interaction with these advertisements is subject to the terms and privacy practices of the external ad networks.
                            We are not responsible for the content or functionality of external products promoted through these ad placements.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">6. Limitation of Liability</h2>
                        <p>
                            The application translates and modifies files on a provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without any warranties of any kind.
                            We do not guarantee perfect conversion fidelity under all scenarios. Resizo shall not be held liable for any data loss, workflow interruption, or incidental damages arising from the use or inability to use the service.
                        </p>
                    </section>

                    <section className="space-y-4">
                        <h2 className="text-2xl font-bold text-[#F5ECD7]">7. Modifications to the Terms</h2>
                        <p>
                            We reserve the right to revise or amend these Terms of Service at any given time. Any updates will be reflected on this page alongside a modified date.
                            Continued access to Resizo following such changes constitutes your acknowledgment and consent to the revised terms.
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
