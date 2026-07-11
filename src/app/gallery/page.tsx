import type { Metadata } from "next";
import { GalleryScreen } from "@/components/screens/GalleryScreen";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse and listen to songs you have made from your hums.",
  openGraph: {
    title: "Gallery",
    description: "Browse and listen to songs you have made from your hums.",
    url: "/gallery",
    images: [{ url: "/og?title=Gallery&subtitle=Your+saved+songs", width: 1200, height: 630 }],
  },
  twitter: {
    title: "Gallery",
    description: "Browse and listen to songs you have made from your hums.",
    images: ["/og?title=Gallery&subtitle=Your+saved+songs"],
  },
  alternates: {
    canonical: "/gallery",
  },
};

export default function GalleryPage() {
  return (
    <>
      {/* SSR route marker — the gallery grid hydrates client-side
          (/api/songs), so the page-contract smoke asserts this shell
          instead of grid copy. Keep in sync with qa-routes gallery-page. */}
      <span hidden>gallery-route</span>
      <GalleryScreen />
    </>
  );
}
