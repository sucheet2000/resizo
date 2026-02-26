import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Resizo - Free Online Image Resizer | Resize Images Instantly",
  description: "Resize images online for free. No uploads, no registration. Resize JPEG, PNG and WebP images by dimensions or percentage directly in your browser. Fast, private and secure.",
  keywords: ["resize image online free", "image resizer", "compress image", "resize jpeg", "resize png", "webp converter", "image resize tool"],
  authors: [{ name: "Resizo" }],
  creator: "Resizo",
  publisher: "Resizo",
  metadataBase: new URL("https://resizo-woad.vercel.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Resizo - Free Online Image Resizer | Resize Images Instantly",
    description: "Resize images online for free. No uploads, no registration. Resize JPEG, PNG and WebP images by dimensions or percentage directly in your browser. Fast, private and secure.",
    url: "https://resizo-woad.vercel.app",
    siteName: "Resizo",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Resizo - Premium Browser-Based Image Resizing",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Resizo - Free Online Image Resizer | Resize Images Instantly",
    description: "Resize images online for free. No uploads, no registration. Resize JPEG, PNG and WebP images by dimensions or percentage directly in your browser. Fast, private and secure.",
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
    verification: {
    google: "Gy2F1jfXiai95N6oLX8XiAcQ_EdbQzU_3vGJtW3bbTs",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
