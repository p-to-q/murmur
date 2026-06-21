"use client";

import { useState } from "react";
import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
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
  promptPlaceholder?: string;
  className?: string;
  /** "dark" = glass mode for immersive gradient backgrounds */
  variant?: "default" | "dark";
  /** Hide the quick-action chips (default true) */
  showQuickActions?: boolean;
}

export function AurisPanel({
  busy,
  onApply,
  promptPlaceholder,
  className = "",
  variant = "default",
  showQuickActions = true,
}: AurisPanelProps) {
  const t = useTranslator();
  const [prompt, setPrompt] = useState("");

  const submit = async (valueOverride?: string) => {
    const value = (valueOverride ?? prompt).trim();
    if (!value || busy) return;
    setPrompt("");
    await onApply(value);
  };

  const dark = variant === "dark";

  return (
    <div className={className}>
      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder={promptPlaceholder ?? t("studio.prompt.placeholder")}
          className={
            dark
              ? "min-w-0 flex-1 rounded-full border border-white/20 bg-white/8 px-4 py-2.5 text-[13px] text-white outline-none transition-colors placeholder:text-white/45 focus:border-white/40 focus:bg-white/12"
              : "min-w-0 flex-1 rounded-full border border-[#E5DDD0] bg-white/80 px-4 py-2.5 text-[13px] text-[#1A1A1A] outline-none transition-colors placeholder:text-[#B6B0A4] focus:border-[#FF5924]"
          }
        />
        <button
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className={
            dark
              ? "inline-flex min-w-[60px] items-center justify-center rounded-full bg-white/18 px-4 py-2.5 text-[13px] font-medium text-white transition-opacity hover:bg-white/25 disabled:opacity-35"
              : "inline-flex min-w-[60px] items-center justify-center rounded-full bg-[#1A1A1A] px-4 py-2.5 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
          }
        >
          {busy ? (
            <MurmurLoadingNote size="sm" tone={dark ? "light" : "default"} />
          ) : (
            t("studio.prompt.cta")
          )}
        </button>
      </div>

      {/* Quick chips */}
      {showQuickActions && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_GROUPS.flatMap((group) =>
            group.actions.map((action) => (
              <button
                key={action.id}
                onClick={() => void submit(action.prompt)}
                disabled={busy}
                className={
                  dark
                    ? "rounded-full border border-white/20 bg-white/6 px-3 py-1 text-[11px] text-white/75 transition-colors hover:bg-white/14 hover:text-white disabled:opacity-35"
                    : "rounded-full border border-[#E5DDD0] bg-white/60 px-3 py-1 text-[11px] text-[#6F6A63] transition-colors hover:border-[#FF5924] hover:text-[#1A1A1A] disabled:opacity-40"
                }
              >
                {action.label}
              </button>
            )),
          )}
        </div>
      )}
    </div>
  );
}
