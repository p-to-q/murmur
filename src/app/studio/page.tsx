import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

export const metadata: Metadata = {
  title: "Studio",
  description: "Edit and arrange your hummed melody into a finished song.",
  openGraph: {
    title: "Studio",
    description: "Edit and arrange your hummed melody into a finished song.",
    url: "/studio",
    images: [{ url: "/og?title=Studio&subtitle=Edit+and+arrange+your+song", width: 1200, height: 630 }],
  },
  twitter: {
    title: "Studio",
    description: "Edit and arrange your hummed melody into a finished song.",
    images: ["/og?title=Studio&subtitle=Edit+and+arrange+your+song"],
  },
  alternates: {
    canonical: "/studio",
  },
};

const StudioScreen = dynamic(
  () => import("@/components/screens/StudioScreen").then((m) => m.StudioScreen),
  { loading: () => <GlobalLoadingIndicator /> },
);

export default async function StudioPage({
  searchParams,
}: {
  searchParams?: Promise<{ demo?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const demo = params?.demo === "1";

  return (
    <>
      {demo ? <span hidden>demo-studio-route</span> : null}
      <StudioScreen initialDemo={demo} />
    </>
  );
}
