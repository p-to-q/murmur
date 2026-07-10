import dynamic from "next/dynamic";
import type { Metadata } from "next";
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
  const { visibility, title } = await resolveShareMeta(shareCode);
  const shouldIndex = visibility === "public";

  return {
    title: title ? `${title} – Murmur` : "Shared song",
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

interface ShareMeta {
  visibility: string | null;
  title: string | null;
}

async function resolveShareMeta(shareCode: string): Promise<ShareMeta> {
  if (isDemoSongId(shareCode)) {
    const demo = getDemoSong(shareCode);
    return { visibility: demo?.visibility ?? null, title: demo?.title ?? null };
  }

  const normalized = normalizeSongShareCode(shareCode);
  if (!normalized) return { visibility: null, title: null };

  // Metadata is best-effort; the client page still fetches through the public
  // API. Keep this path from turning a DB outage into a broken share page.
  try {
    const { getSongShareMetaByShareCode } = await import("@/lib/db/queries/songs");
    const meta = await getSongShareMetaByShareCode(normalized);
    if (!meta || !meta.hasAudio) return { visibility: null, title: null };
    return { visibility: meta.visibility, title: meta.title };
  } catch (err) {
    console.warn("resolveShareMeta: primary query failed, using fallback", err);
    const { getLocalSongByShareCodeFallback } = await import(
      "@/lib/db/queries/local-song-fallback"
    );
    const fallbackSong = getLocalSongByShareCodeFallback(normalized);
    if (fallbackSong && hasSongShareAudio(fallbackSong)) {
      return { visibility: fallbackSong.visibility, title: fallbackSong.title ?? null };
    }
    return { visibility: null, title: null };
  }
}
