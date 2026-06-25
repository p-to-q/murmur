"use client";

import { useEffect, useRef } from "react";

import { regenerateVersionAudio } from "@/modules/magenta/generate-magenta-versions";
import type { VibeVersion } from "@/modules/shared/types";

export function useRestoredVersionAudio(
  version: VibeVersion | null,
  restoredDraftAt: number | null,
) {
  const restoredRegenerationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!restoredDraftAt || restoredRegenerationRef.current === restoredDraftAt) {
      return;
    }
    if (version?.generation?.status !== "pending" || version.generation.audioUrl) {
      return;
    }
    restoredRegenerationRef.current = restoredDraftAt;
    regenerateVersionAudio(version);
  }, [restoredDraftAt, version]);
}
