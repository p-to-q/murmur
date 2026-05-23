"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Download, FileImage, Share2, Music, Film } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@eazo/sdk";

import { useTranslator } from "@/lib/i18n";
import { buildShareHtml, downloadHtml } from "@/modules/export/render-share-html";
import { renderPoster, downloadBlob } from "@/modules/export/render-poster";
import { exportSongAsWebM } from "@/modules/export/export-webm";
import type { SongCard } from "@/modules/shared/types";

type Song = SongCard & {
  mp3DataUrl?: string | null;
  bpm?: number;
  keySignature?: string;
};

export function ShareActions({ song }: { song: Song }) {
  const t = useTranslator();
  const [busy, setBusy] = useState<"audio" | "html" | "card" | "video" | null>(null);

  const gradient =
    (song.visualConfig as { posterBg?: string }).posterBg ??
    song.visualConfig.gradient ??
    "linear-gradient(135deg, #FF8A5C, #FF5924)";
  const slug = song.title.replace(/\s+/g, "-").toLowerCase() || "murmur";
  const bpm = song.bpm ?? 80;
  const keySig = song.keySignature ?? "C";
  const audioUrl = song.mp3DataUrl ?? undefined;

  const audioMime = audioUrl?.startsWith("data:audio/wav") ? "audio/wav" : "audio/mpeg";
  const audioExt = audioMime === "audio/wav" ? "wav" : "mp3";

  const downloadAudio = () => {
    if (!audioUrl) {
      toast(t("song.share.no_audio"));
      return;
    }
    setBusy("audio");
    try {
      const a = document.createElement("a");
      a.href = audioUrl;
      a.download = `${slug}.${audioExt}`;
      a.click();
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Downloaded audio for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_audio", song_id: song.id, mime: audioMime },
        })
        .catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const downloadSharePage = () => {
    setBusy("html");
    try {
      const html = buildShareHtml({
        title: song.title,
        vibe: song.vibe,
        bpm,
        keySig,
        duration: song.duration,
        gradient,
        preset: song.visualConfig.preset,
        audioDataUrl: audioUrl,
      });
      downloadHtml(`${slug}.html`, html);
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Downloaded share page for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_html", song_id: song.id, has_audio: !!audioUrl },
        })
        .catch(() => {});
    } catch (e) {
      console.error(e);
      toast.error(t("song.export.err"));
    } finally {
      setBusy(null);
    }
  };

  const downloadCard = async () => {
    setBusy("card");
    try {
      const blob = await renderPoster({
        title: song.title,
        vibe: song.vibe,
        bpm,
        keySig,
        gradient,
        durationSec: song.duration,
      });
      if (!blob) throw new Error("poster blob null");
      downloadBlob(`${slug}.png`, blob);
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Downloaded share card for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_card", song_id: song.id },
        })
        .catch(() => {});
    } catch (e) {
      console.error(e);
      toast.error(t("song.export.err"));
    } finally {
      setBusy(null);
    }
  };

  const downloadVideo = async () => {
    if (!audioUrl) {
      toast(t("song.share.no_audio"));
      return;
    }

    setBusy("video");
    try {
      await exportSongAsWebM(song);
      toast.success(t("song.export.ok"));
      memory
        .reportAction({
          content: `Downloaded video for "${song.title}"`,
          event_type: "update",
          page: "song-detail",
          metadata: { type: "download_video", song_id: song.id },
        })
        .catch(() => {});
    } catch (e) {
      console.error(e);
      toast.error(t("song.export.err"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <ActionButton
        icon={<Music className="w-4 h-4" />}
        label={t("song.share.download_audio")}
        loading={busy === "audio"}
        onClick={downloadAudio}
      />
      <ActionButton
        icon={<Share2 className="w-4 h-4" />}
        label={t("song.share.download_page")}
        loading={busy === "html"}
        onClick={downloadSharePage}
      />
      <ActionButton
        icon={<FileImage className="w-4 h-4" />}
        label={t("song.share.download_card")}
        loading={busy === "card"}
        onClick={downloadCard}
      />
      <ActionButton
        icon={<Film className="w-4 h-4" />}
        label={t("song.share.download_video")}
        loading={busy === "video"}
        onClick={downloadVideo}
      />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      disabled={loading}
      className="flex flex-col items-center justify-center gap-1.5 h-[68px] rounded-2xl bg-[#FFFEFB] border border-[#E5DDD0] text-[#1A1A1A] text-[11px] font-medium disabled:opacity-50 hover:border-[#FF5924] transition-colors"
    >
      {loading ? (
        <div className="w-4 h-4 rounded-full border-2 border-[#1A1A1A] border-t-transparent animate-spin" />
      ) : (
        <span className="text-[#8C8780]">{icon}</span>
      )}
      <span className="leading-tight text-center px-1">{label}</span>
      {!loading ? <Download className="w-3 h-3 text-[#8C8780]" /> : null}
    </motion.button>
  );
}
