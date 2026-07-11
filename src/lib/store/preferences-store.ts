"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RepairBias = number;

type PreferencesStore = {
  repairBias: RepairBias;
  developerMode: boolean;
  /**
   * When enabled, VibeScreen auto-plays the first vibe clip as soon as it
   * lands (progressive preview). Default OFF — quiet environments and
   * screen-reader users should not get surprise audio; reduced-motion users
   * are additionally gated at the call site (issue #217).
   */
  autoAudition: boolean;
  setRepairBias: (value: RepairBias) => void;
  setDeveloperMode: (enabled: boolean) => void;
  setAutoAudition: (enabled: boolean) => void;
};

function clampRepairBias(value: number): RepairBias {
  if (Number.isNaN(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      repairBias: 0,
      developerMode: false,
      autoAudition: false,
      setRepairBias: (value) => set({ repairBias: clampRepairBias(value) }),
      setDeveloperMode: (enabled) => set({ developerMode: enabled }),
      setAutoAudition: (enabled) => set({ autoAudition: enabled }),
    }),
    {
      name: "murmur-preferences",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
