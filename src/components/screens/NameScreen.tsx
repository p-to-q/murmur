"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { memory } from "@eazo/sdk";

import { useMurmurStore } from "@/lib/store/murmur-store";
import { useTranslator } from "@/lib/i18n";
import { synth } from "@/lib/music/simple-synth";
import { renderAudio } from "@/modules/export/render-mp3";
import type { SongCard } from "@/modules/shared/types";

export function NameScreen() {
  const router = useRouter();
  const t = useTranslator();
  const currentVersion = useMurmurStore((s) => s.currentVersion);
  const addSong = useMurmurStore((s) => s.addSong);

  const [title, setTitle] = useState(currentVersion?.title ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [savingHint, setSavingHint] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Stop any playback the studio left running before the user lands here.
    synth.stop();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (!currentVersion) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center bg-[#F5F1EB] px-6 text-center">
        <p className="mb-4 text-base text-[#8C8780]">{t("studio.empty")}</p>
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[#FF5924] underline underline-offset-4"
        >
          {t("studio.empty.cta")}
        </button>
      </div>
    );
  }

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast(t("name.required"));
      inputRef.current?.focus();
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    setSavingHint(t("studio.rendering"));

    const id = crypto.randomUUID();
    let mp3DataUrl: string | undefined;

    const versionWithName = { ...currentVersion, title: trimmed };

    try {
      const rendered = await renderAudio(versionWithName);
      if (rendered) mp3DataUrl = rendered.dataUrl;
    } catch (error) {
      console.warn("[Name] render failed, saving without audio:", error);
    }

    try {
      const response = await fetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          userId: "guest",
          title: trimmed,
          vibe: versionWithName.vibe,
          vibeEn: trimmed,
          bpm: versionWithName.melody.bpm,
          keySignature: versionWithName.melody.key.split(" ")[0] ?? "C",
          scaleType: versionWithName.melody.scale,
          duration: Math.round(versionWithName.melody.duration),
          mp3DataUrl,
          visualConfig: versionWithName.visualConfig,
          arrangementState: versionWithName.arrangementState,
          tags: versionWithName.tags,
        }),
      });
      if (!response.ok) throw new Error(`Save HTTP ${response.status}`);

      // Optimistically push into the local gallery list so the new song shows up
      // immediately if the user navigates straight to /gallery.
      const optimisticCard: SongCard = {
        id,
        title: trimmed,
        mp3Url: mp3DataUrl,
        visualConfig: versionWithName.visualConfig,
        vibe: versionWithName.vibe,
        duration: Math.round(versionWithName.melody.duration),
        arrangementState: versionWithName.arrangementState,
        createdAt: new Date().toISOString(),
      };
      addSong(optimisticCard);

      memory
        .reportAction({
          content: `Saved "${trimmed}" (audio: ${mp3DataUrl ? "yes" : "no"})`,
          event_type: "create",
          page: "studio.name",
          metadata: {
            type: "save_song",
            song_id: id,
            has_audio: !!mp3DataUrl,
          },
        })
        .catch(() => {});

      toast.success(t("studio.save_ok"));
      router.push(`/song/${id}`);
    } catch (error) {
      console.error("[Name] save failed:", error);
      toast.error(t("studio.save_err"));
    } finally {
      setIsSaving(false);
      setSavingHint("");
    }
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute rounded-full"
          style={{
            width: "min(56vw, 560px)",
            height: "min(56vw, 560px)",
            right: "-12%",
            top: "-8%",
            background:
              "radial-gradient(circle at center, rgba(255,153,100,0.18) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: "min(40vw, 420px)",
            height: "min(40vw, 420px)",
            left: "-8%",
            bottom: "10%",
            background:
              "radial-gradient(circle at center, rgba(201,182,228,0.18) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-svh flex-col">
        <div
          className="flex items-center justify-between px-5 pb-4 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.back()}
            aria-label={t("name.cancel")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {currentVersion.vibe} · {currentVersion.melody.bpm} BPM
          </p>
          <div className="h-9 w-9" />
        </div>

        <div className="flex flex-1 flex-col justify-center px-6 pb-32 md:px-8">
          <div className="mx-auto w-full max-w-[520px]">
            <p className="eyebrow mb-4 text-[#FF8A5C]">{t("name.eyebrow")}</p>
            <h1 className="font-serif text-[#1A1A1A] text-[42px] leading-[1.02] tracking-[-0.01em] md:text-[56px]">
              {t("name.title")}
            </h1>
            <p className="mt-4 text-[14px] leading-[1.55] text-[#6F6A63]">
              {t("name.sub")}
            </p>

            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
              placeholder={t("name.placeholder")}
              maxLength={80}
              className="mt-8 w-full border-0 border-b-2 border-[#D2C9B6] bg-transparent pb-3 font-serif-italic text-[34px] leading-[1.1] text-[#1A1A1A] outline-none transition-colors placeholder:text-[#BFB6A8] focus:border-[#FF5924] md:text-[44px]"
            />
            <p className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1]">
              {title.length}/80
            </p>
          </div>
        </div>

        <div
          className="fixed left-0 right-0 px-5 pt-3 pb-5 md:left-[232px] md:px-8"
          style={{ bottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="mx-auto max-w-[520px]">
            {savingHint ? (
              <p className="mb-2 text-center text-xs text-[#8C8780]">
                {savingHint}
              </p>
            ) : null}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => void handleSave()}
              disabled={isSaving || !title.trim()}
              className="h-14 w-full rounded-[22px] bg-[#1A1A1A] text-base font-medium text-white transition-opacity disabled:opacity-45"
            >
              {isSaving ? t("studio.saving") : t("name.save")}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
