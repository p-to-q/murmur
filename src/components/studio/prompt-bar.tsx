"use client";
import { useState } from "react";
import { useTranslator } from "@/lib/i18n";

export interface PromptBarProps {
  busy: boolean;
  onApply: (prompt: string) => Promise<void> | void;
}

export function PromptBar({ busy, onApply }: PromptBarProps) {
  const t = useTranslator();
  const [prompt, setPrompt] = useState("");

  const submit = async () => {
    const value = prompt.trim();
    if (!value || busy) return;
    setPrompt("");
    await onApply(value);
  };

  return (
    <div
      className="bg-[#FFFEFB] rounded-2xl p-5"
      style={{ boxShadow: "0 2px 12px rgba(26, 26, 26,0.06)" }}
    >
      <p className="text-[#8C8780] text-xs font-medium tracking-wider uppercase mb-3">
        {t("studio.prompt.title")}
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("studio.prompt.placeholder")}
          className="flex-1 bg-[#F5F1EB] border border-[#E5DDD0] rounded-2xl px-4 py-3 text-sm text-[#1A1A1A] placeholder-[#8C8780] outline-none focus:border-[#FF5924] transition-colors"
        />
        <button
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className="px-4 py-3 rounded-2xl bg-[#FF5924] text-white text-sm font-medium disabled:opacity-40 min-w-[64px]"
        >
          {busy ? "…" : t("studio.prompt.cta")}
        </button>
      </div>
      <div className="flex gap-2 mt-2 flex-wrap">
        {[
          t("scene.warm.label"),
          t("scene.less_drums.label"),
          t("scene.more_bass.label"),
          t("scene.cinematic.label"),
        ].map((s) => (
          <button
            key={s}
            onClick={() => setPrompt(s)}
            className="text-[#8C8780] text-xs bg-[#EFE8DA] rounded-full px-3 py-1 hover:bg-[#E8DDC8] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
