import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";

const PublicSongScreen = dynamic(
  () =>
    import("@/components/screens/PublicSongScreen").then(
      (m) => m.PublicSongScreen,
    ),
  { loading: () => <GlobalLoadingIndicator /> },
);

interface Props {
  params: Promise<{ shareCode: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { shareCode } = await params;
  return {
    title: "Shared song",
    description: "Listen to a song made from a hum in Murmur.",
    alternates: {
      canonical: `/s/${shareCode}`,
    },
  };
}

export default async function PublicSongPage({ params }: Props) {
  const { shareCode } = await params;
  return <PublicSongScreen shareCode={shareCode} />;
}
