"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type RepairBias = number;

type PreferencesStore = {
  repairBias: RepairBias;
  developerMode: boolean;
  setRepairBias: (value: RepairBias) => void;
  setDeveloperMode: (enabled: boolean) => void;
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
      setRepairBias: (value) => set({ repairBias: clampRepairBias(value) }),
      setDeveloperMode: (enabled) => set({ developerMode: enabled }),
    }),
    {
      name: "murmur-preferences",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
