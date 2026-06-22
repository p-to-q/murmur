import dynamic from "next/dynamic";
import type { Metadata } from "next";
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { getSongByShareCode } from "@/lib/db/queries/songs";
import { normalizeSongShareCode } from "@/lib/share/song-share";
import { getDemoSong, isDemoSongId } from "@/presets/demo-songs";

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
  const visibility = await resolveShareVisibility(shareCode);
  const shouldIndex = visibility === "public";

  return {
    title: "Shared song",
    description: "Listen to a song made from a hum in Murmur.",
    robots: {
      index: shouldIndex,
      follow: shouldIndex,
    },
    alternates: {
      canonical: `/s/${shareCode}`,
    },
  };
}

export default async function PublicSongPage({ params }: Props) {
  const { shareCode } = await params;
  return <PublicSongScreen shareCode={shareCode} />;
}

async function resolveShareVisibility(shareCode: string): Promise<string | null> {
  if (isDemoSongId(shareCode)) {
    return getDemoSong(shareCode)?.visibility ?? null;
  }

  const normalized = normalizeSongShareCode(shareCode);
  if (!normalized) return null;

  try {
    return (await getSongByShareCode(normalized))?.visibility ?? null;
  } catch {
    return null;
  }
}
