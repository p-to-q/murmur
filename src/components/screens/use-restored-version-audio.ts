"use client";

import { useEffect, useRef } from "react";

import { recoverVersionAudio } from "@/modules/magenta/generate-magenta-versions";
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
    const generation = version?.generation;
    // Recover the restored clip without re-purchasing it: rehydrate the exact
    // audited clip from durable storage, or resume its existing paid
    // operation (#300). Error clips keep their explicit retry affordance.
    if (!generation || generation.status === "error" || generation.audioUrl) {
      return;
    }
    restoredRegenerationRef.current = restoredDraftAt;
    void recoverVersionAudio(version!);
  }, [restoredDraftAt, version]);
}
