import type { Metadata } from "next";
import { Suspense } from "react";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { MeScreen } from "@/components/screens/MeScreen";

export const metadata: Metadata = {
  title: "Me",
  description: "Your profile, settings, and account management.",
  openGraph: {
    title: "Me",
    description: "Your profile, settings, and account management.",
    url: "/me",
    images: [{ url: "/og?title=Me&subtitle=Profile+and+settings", width: 1200, height: 630 }],
  },
  twitter: {
    title: "Me",
    description: "Your profile, settings, and account management.",
    images: ["/og?title=Me&subtitle=Profile+and+settings"],
  },
  alternates: {
    canonical: "/me",
  },
};

export default function MePage() {
  return (
    <Suspense fallback={<GlobalLoadingIndicator />}>
      <MeScreen />
    </Suspense>
  );
}
