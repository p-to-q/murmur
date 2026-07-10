import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import Script from "next/script";
// Keep the original Traditional Chinese WenKai as the visual lead, with the
// Simplified Chinese face available only as missing-glyph fallback.
import "@fontsource/lxgw-wenkai-tc/300.css";
import "@fontsource/lxgw-wenkai-tc/400.css";
import "./fonts/lxgw-wenkai-gb-screen-300.css";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { BottomNav } from "@/components/murmur/bottom-nav";
import { SideNavWithModal as SideNav } from "@/components/murmur/side-nav";
import { AudioUnlock } from "@/components/murmur/audio-unlock";
import { I18nHydrator, I18nProvider } from "@/lib/i18n";
import {
  LANGUAGE_COOKIE,
  langToHtmlLang,
  resolveInitialLangWithSource,
} from "@/lib/i18n/language";
import { cn } from "@/utils/utils";
import { AuthProvider } from "@/components/auth/auth-provider";
import { FontHydrator } from "@/components/murmur/font-hydrator";
import { MobileTopBar } from "@/components/murmur/mobile-top-bar";
import { ShareReferralTracker } from "@/components/murmur/share-referral-tracker";
import { getSiteUrl } from "@/lib/site-url";
import { SITE_CONFIG } from "@/lib/constants";
import { getSiteSchemaOrgGraph } from "@/lib/schema-org-json-ld";

const SITE_URL = getSiteUrl();

const defaultOgImage = {
  url: "/og",
  width: 1200,
  height: 630,
  alt: SITE_CONFIG.name,
} as const;

const instrumentalSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

const schemaOrgJsonLd = JSON.stringify(getSiteSchemaOrgGraph());

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: {
    default: "MURMUR",
    template: "%s | MURMUR",
  },
  description: SITE_CONFIG.description,
  keywords: ["音乐创作", "哼唱", "AI音乐", "旋律", "music creation", "humming", "melody"],
  authors: [{ name: "P to Q" }],
  creator: "P to Q",
  publisher: "P to Q",
  applicationName: "MURMUR",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.png", sizes: "120x120", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: SITE_CONFIG.name,
    title: SITE_CONFIG.title,
    description: SITE_CONFIG.socialDescription,
    url: "/",
    locale: "zh_CN",
    images: [defaultOgImage],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_CONFIG.title,
    description: SITE_CONFIG.socialDescription,
    images: ["/og"],
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
    languages: {
      "zh-Hans": "/",
      "en": "/",
      "x-default": "/",
    },
  },
  other: {
    "humans": "/humans.txt",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F1EB",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const initialLangResolution = resolveInitialLangWithSource({
    storedLang: cookieStore.get(LANGUAGE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  const initialLang = initialLangResolution.lang;

  return (
    <html
      lang={langToHtmlLang(initialLang)}
      data-lang={initialLang}
      data-lang-source={initialLangResolution.source}
      data-fonts="loading"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        GeistSans.variable,
        instrumentalSerif.variable,
      )}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: schemaOrgJsonLd }}
        />
      </head>
      <body
        suppressHydrationWarning
        className="min-h-svh flex flex-col bg-[#F5F1EB]"
      >
        <Script id="strip-extension-hydration-attrs" strategy="beforeInteractive">
          {`document.querySelectorAll('[data-sg-checked]').forEach(function (element) { element.removeAttribute('data-sg-checked'); });`}
        </Script>
        <I18nProvider initialLang={initialLang}>
          <AuthProvider>
            <I18nHydrator />
            <FontHydrator />
            <ShareReferralTracker />
            {/* Desktop sidebar (md+) — mobile hides via internal media query */}
            <SideNav />
            {/* Mobile top bar — logo + language toggle */}
            <MobileTopBar />
            {/* Main content area:
                - mobile  → reserves bottom for nav (with safe-area)
                - desktop → reserves left 232px for sidebar */}
            <main
              className="flex-1"
              style={{
                paddingTop: "var(--mobile-top-bar-h)",
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
        </I18nProvider>
      </body>
    </html>
  );
}
