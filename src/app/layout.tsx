import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist, Instrument_Serif, LXGW_WenKai_TC } from "next/font/google";
import { EazoProvider } from "@eazo/sdk/react";
import { cn } from "@/utils/utils";
import { Toaster } from "@/components/ui/sonner";
import { UserSyncEffect } from "@/components/user-profile/user-sync-effect";
import { BottomNav } from "@/components/murmur/bottom-nav";
import { SideNav } from "@/components/murmur/side-nav";
import { AudioUnlock } from "@/components/murmur/audio-unlock";
import { I18nHydrator } from "@/lib/i18n";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Instrument Serif — the closest free font to MyMind's editorial high-
// contrast serif (Editorial New). Single weight (400) + italic; we use
// size + tracking rather than weight to express hierarchy.
const serif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});
// LXGW WenKai TC — 霞鹜文楷，书卷楷书风格，与 Instrument Serif 的手写感匹配。
// TC covers both simplified and traditional Chinese glyphs.
// preload:false — CJK fonts are large, let browser fetch on demand via unicode-range.
const wenkai = LXGW_WenKai_TC({
  weight: ["300", "400", "700"],
  variable: "--font-chinese",
  preload: false,
  display: "swap",
});

const SITE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: "MURMUR",
  description:
    "把脑海里的哼唱，变成一张可以收藏和分享的音乐卡片 · Turn the hum in your head into a music card you can collect and share.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    siteName: "MURMUR",
    title: "MURMUR",
    description: "哼一句脑海里的旋律，MURMUR 帮它长成一首小歌。",
    url: "/",
    locale: "zh_CN",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F3EA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      className={cn(
        "h-full antialiased font-sans",
        geist.variable,
        serif.variable,
        wenkai.variable
      )}
    >
      <body className="min-h-svh flex flex-col bg-[#F7F3EA]">
        <EazoProvider>
          <I18nHydrator />
          <UserSyncEffect />
          {/* Desktop sidebar (md+) — mobile hides via internal media query */}
          <SideNav />
          {/* Main content area:
              - mobile  → reserves bottom for nav (with safe-area)
              - desktop → reserves left 232px for sidebar */}
          <main
            className="flex-1 md:pl-[232px]"
            style={{
              paddingBottom: "var(--main-pb)",
            }}
          >
            {children}
          </main>
          {/* Mobile bottom nav */}
          <BottomNav />
          <AudioUnlock />
          <Toaster />
        </EazoProvider>
      </body>
    </html>
  );
}
