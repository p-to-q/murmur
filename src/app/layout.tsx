import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/murmur/bottom-nav";
import { SideNav } from "@/components/murmur/side-nav";
import { AudioUnlock } from "@/components/murmur/audio-unlock";
import { I18nHydrator } from "@/lib/i18n";

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
  themeColor: "#F5F1EB",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="h-full antialiased font-sans">
      <body className="min-h-svh flex flex-col bg-[#F5F1EB]">
        <I18nHydrator />
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
      </body>
    </html>
  );
}
