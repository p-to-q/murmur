"use client";

import { useState } from "react";
import { useTranslator } from "@/lib/i18n";

type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

type QuickGroup = {
  id: string;
  title: string;
  actions: QuickAction[];
};

const QUICK_GROUPS: QuickGroup[] = [
  {
    id: "balance",
    title: "Balance",
    actions: [
      { id: "fewer-drums", label: "Fewer drums", prompt: "less drums" },
      { id: "more-bass", label: "More bass", prompt: "more bass" },
      { id: "less-strings", label: "Less strings", prompt: "less strings" },
    ],
  },
  {
    id: "color",
    title: "Color",
    actions: [
      { id: "warmer", label: "Warmer", prompt: "warmer" },
      { id: "brighter", label: "Brighter", prompt: "brighter" },
      { id: "darker", label: "Darker", prompt: "darker" },
    ],
  },
  {
    id: "motion",
    title: "Motion",
    actions: [
      { id: "more-rhythm", label: "More rhythm", prompt: "more rhythm" },
      { id: "faster", label: "Faster", prompt: "faster" },
      { id: "slower", label: "Slower", prompt: "slower" },
    ],
  },
];

export interface AurisPanelProps {
  busy: boolean;
  onApply: (prompt: string) => Promise<void> | void;
}

export function AurisPanel({ busy, onApply }: AurisPanelProps) {
  const t = useTranslator();
  const [prompt, setPrompt] = useState("");

  const submit = async (valueOverride?: string) => {
    const value = (valueOverride ?? prompt).trim();
    if (!value || busy) return;
    setPrompt("");
    await onApply(value);
  };

  return (
    <section className="rounded-[28px] border border-[#E9E1D4] bg-[radial-gradient(circle_at_85%_14%,rgba(255,153,100,0.16),transparent_0_24%),linear-gradient(180deg,rgba(255,254,251,0.98),rgba(249,244,236,0.98))] p-5 shadow-[0_16px_42px_rgba(26,26,26,0.05)] md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2 text-[#FF8A5C]">AURIS</p>
          <h3 className="font-serif text-[24px] leading-[1.02] text-[#1A1A1A] md:text-[30px]">
            {t("studio.auris.title")}
          </h3>
        </div>
        <div className="rounded-full border border-[#E7DDCE] bg-white/65 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[#8C8780]">
          {t("studio.auris.badge")}
        </div>
      </div>

      <p className="mt-3 max-w-[42rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
        {t("studio.auris.sub")}
      </p>

      <div className="mt-5 flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void submit();
            }
          }}
          placeholder={t("studio.prompt.placeholder")}
          className="min-w-0 flex-1 rounded-[22px] border border-[#E6DDCF] bg-white/80 px-4 py-3 text-sm text-[#1A1A1A] outline-none transition-colors placeholder:text-[#9B9488] focus:border-[#FF8A5C]"
        />
        <button
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className="min-w-[84px] rounded-[22px] bg-[#1A1A1A] px-4 py-3 text-sm font-medium text-white transition-opacity disabled:opacity-45"
        >
          {busy ? "…" : t("studio.prompt.cta")}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {QUICK_GROUPS.map((group) => (
          <div
            key={group.id}
            className="rounded-[22px] border border-[#E7DECF] bg-white/62 p-3"
          >
            <p className="text-[10px] uppercase tracking-[0.22em] text-[#B1A89A]">
              {group.title}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {group.actions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => void submit(action.prompt)}
                  disabled={busy}
                  className="rounded-full border border-[#E8DECF] bg-[#F8F3EB] px-3 py-1.5 text-[12px] text-[#574F46] transition-colors hover:border-[#FF8A5C] hover:text-[#1A1A1A] disabled:opacity-45"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
