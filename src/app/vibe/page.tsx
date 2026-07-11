import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

export const metadata: Metadata = {
  title: "Vibe",
  description: "Review your transcribed melody, check the vibe, and decide what comes next.",
  openGraph: {
    title: "Vibe",
    description: "Review your transcribed melody, check the vibe, and decide what comes next.",
    url: "/vibe",
    images: [{ url: "/og?title=Vibe&subtitle=Review+your+transcribed+melody", width: 1200, height: 630 }],
  },
  twitter: {
    title: "Vibe",
    description: "Review your transcribed melody, check the vibe, and decide what comes next.",
    images: ["/og?title=Vibe&subtitle=Review+your+transcribed+melody"],
  },
  alternates: {
    canonical: "/vibe",
  },
};

const VibeScreen = dynamic(
  () => import("@/components/screens/VibeScreen").then((m) => m.VibeScreen),
  { loading: () => <GlobalLoadingIndicator /> },
);

/**
 * /vibe — the *discover* moment in the journey.
 *
 * v2 promotes Vibe from an overlay sibling of HumScreen to its own route so
 * hard refresh, share-link, and shell-native navigation (Capacitor, Taro) all
 * work. The signature iris-close transition still plays on mount.
 *
 * Hard-refresh recovery: if there are no vibeVersions in the store, the
 * screen redirects to "/" internally (see VibeScreen useEffect).
 */
export default async function VibePage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const demo = params?.demo === "1";

  return (
    <>
      {demo ? <span hidden>demo-vibe-route</span> : null}
      <VibeScreen initialDemo={demo} />
    </>
  );
}
