"use client";

import { useState } from "react";
import { useTranslator } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n/dict";

type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

type QuickGroup = {
  id: string;
  labelKey: TKey;
  actions: QuickAction[];
};

const QUICK_GROUPS: QuickGroup[] = [
  {
    id: "balance",
    labelKey: "studio.auris.group.balance",
    actions: [
      { id: "fewer-drums", label: "Fewer drums", prompt: "less drums" },
      { id: "more-bass", label: "More bass", prompt: "more bass" },
      { id: "less-strings", label: "Less strings", prompt: "less strings" },
    ],
  },
  {
    id: "color",
    labelKey: "studio.auris.group.color",
    actions: [
      { id: "warmer", label: "Warmer", prompt: "warmer" },
      { id: "brighter", label: "Brighter", prompt: "brighter" },
      { id: "darker", label: "Darker", prompt: "darker" },
    ],
  },
  {
    id: "motion",
    labelKey: "studio.auris.group.motion",
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
    <section className="rounded-[28px] border border-[#E9E1D4] bg-[linear-gradient(180deg,rgba(255,254,251,0.98),rgba(249,244,236,0.98))] p-5 shadow-[0_16px_42px_rgba(26,26,26,0.05)] md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1.5 text-[#FF8A5C]">
            AURIS · {t("studio.auris.badge")}
          </p>
          <h3 className="font-serif text-[22px] leading-[1.05] text-[#1A1A1A] md:text-[26px]">
            {t("studio.auris.title")}
          </h3>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder={t("studio.prompt.placeholder")}
          className="min-w-0 flex-1 rounded-[18px] border border-[#E6DDCF] bg-white/85 px-4 py-2.5 text-[13px] text-[#1A1A1A] outline-none transition-colors placeholder:text-[#9B9488] focus:border-[#FF8A5C]"
        />
        <button
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className="min-w-[68px] rounded-[18px] bg-[#1A1A1A] px-4 py-2.5 text-[13px] font-medium text-white transition-opacity disabled:opacity-45"
        >
          {busy ? "…" : t("studio.prompt.cta")}
        </button>
      </div>

      <p className="mt-4 text-[11px] text-[#8C8780]">{t("studio.auris.sub")}</p>

      <div className="mt-2.5 space-y-2">
        {QUICK_GROUPS.map((group) => (
          <div key={group.id} className="flex items-center gap-2 flex-wrap">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-[0.2em] text-[#B1A89A]">
              {t(group.labelKey)}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {group.actions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => void submit(action.prompt)}
                  disabled={busy}
                  className="rounded-full border border-[#E8DECF] bg-white/70 px-3 py-1 text-[12px] text-[#574F46] transition-colors hover:border-[#FF8A5C] hover:text-[#1A1A1A] disabled:opacity-45"
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
