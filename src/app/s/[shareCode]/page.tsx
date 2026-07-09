import dynamic from "next/dynamic";
import type { Metadata } from "next";

export const revalidate = 3600; // revalidate every hour
import { GlobalLoadingIndicator } from "@/components/murmur/global-loading-indicator";
import { hasSongShareAudio, normalizeSongShareCode } from "@/lib/share/song-share";
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

  // Metadata is best-effort; the client page still fetches through the public
  // API. Keep this path from turning a DB outage into a broken share page.
  try {
    const { getSongShareMetaByShareCode } = await import("@/lib/db/queries/songs");
    const meta = await getSongShareMetaByShareCode(normalized);
    return meta && meta.hasAudio ? meta.visibility : null;
  } catch {
    const { getLocalSongByShareCodeFallback } = await import(
      "@/lib/db/queries/local-song-fallback"
    );
    const fallbackSong = getLocalSongByShareCodeFallback(normalized);
    if (fallbackSong && hasSongShareAudio(fallbackSong)) {
      return fallbackSong.visibility;
    }
    return null;
  }
}
