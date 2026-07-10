import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

const SongDetailScreen = dynamic(
  () =>
    import("@/components/screens/SongDetailScreen").then(
      (m) => m.SongDetailScreen,
    ),
  { loading: () => <GlobalLoadingIndicator /> },
);

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const displayId = id.startsWith("demo-") ? "Demo Song" : `Song ${id.slice(0, 8)}`;
  return {
    title: displayId,
    description: "Listen, refine, and share your Murmur song.",
    openGraph: {
      title: displayId,
      description: "Listen, refine, and share your Murmur song.",
    },
    twitter: {
      card: "summary_large_image",
      title: displayId,
      description: "Listen, refine, and share your Murmur song.",
    },
  };
}

export default async function SongDetailPage({ params }: Props) {
  const { id } = await params;
  return <SongDetailScreen songId={id} />;
}
