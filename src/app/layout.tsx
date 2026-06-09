import type { Metadata, Viewport } from "next";
// Only the weights actually used: 300 carries the zh hero-serif styles and
// 400 is body text. Nothing pairs the Chinese face with bold, so 700 stays
// out — each weight is a large set of CJK woff2 subsets.
import "@fontsource/lxgw-wenkai-tc/300.css";
import "@fontsource/lxgw-wenkai-tc/400.css";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/murmur/bottom-nav";
import { SideNavWithModal as SideNav } from "@/components/murmur/side-nav";
import { AudioUnlock } from "@/components/murmur/audio-unlock";
import { I18nHydrator } from "@/lib/i18n";
import { cn } from "@/utils/utils";
import { AuthProvider } from "@/components/auth/auth-provider";

const SITE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

const instrumentalSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: {
    default: "MURMUR",
    template: "%s | MURMUR",
  },
  description:
    "把脑海里的哼唱，变成一张可以收藏和分享的音乐卡片 · Turn the hum in your head into a music card you can collect and share.",
  keywords: ["音乐创作", "哼唱", "AI音乐", "旋律", "music creation", "humming", "melody"],
  authors: [{ name: "P to Q" }],
  creator: "P to Q",
  publisher: "P to Q",
  applicationName: "MURMUR",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.png", sizes: "120x120", type: "image/png" },
    ],
    apple: [
      { url: "/brand/murmur-app-icon-180-rounded.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    siteName: "MURMUR",
    title: "MURMUR",
    description: "哼一句脑海里的旋律，MURMUR 帮它长成一首小歌。",
    url: "/",
    locale: "zh_CN",
    images: [
      {
        url: "/brand/murmur-app-icon-1024-rounded.png",
        width: 1024,
        height: 1024,
        alt: "MURMUR",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "MURMUR",
    description: "哼一句脑海里的旋律，MURMUR 帮它长成一首小歌。",
    images: ["/brand/murmur-app-icon-512-rounded.png"],
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
  },
  alternates: {
    canonical: "/",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F1EB",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        GeistSans.variable,
        instrumentalSerif.variable,
      )}
    >
      <body
        suppressHydrationWarning
        className="min-h-svh flex flex-col bg-[#F5F1EB]"
      >
        <AuthProvider>
          <I18nHydrator />
          {/* Desktop sidebar (md+) — mobile hides via internal media query */}
          <SideNav />
          {/* Main content area:
              - mobile  → reserves bottom for nav (with safe-area)
              - desktop → reserves left 232px for sidebar */}
          <main
            className="flex-1"
            style={{
              paddingLeft: "var(--side-nav-w)",
              paddingBottom: "var(--main-pb)",
              transition: "padding-left 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {children}
          </main>
          {/* Mobile bottom nav */}
          <BottomNav />
          <AudioUnlock />
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
