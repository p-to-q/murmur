import { create } from "zustand";
import type { VibeVersion } from "@/modules/shared/types";

export type RecordingState = "idle" | "recording" | "processing" | "done" | "error";

interface MurmurStore {
  // Recording flow
  recordingState: RecordingState;
  setRecordingState: (s: RecordingState) => void;
  processingMessage: string;
  setProcessingMessage: (m: string) => void;

  // Generated versions
  vibeVersions: VibeVersion[];
  setVibeVersions: (v: VibeVersion[]) => void;

  // The trimmed hum recording for this flow — the Magenta engine blends its
  // style embedding into each generated clip so the hum keeps mattering.
  humStyleBlob: Blob | null;
  setHumStyleBlob: (b: Blob | null) => void;

  // Selected version for studio editing
  currentVersion: VibeVersion | null;
  setCurrentVersion: (v: VibeVersion | null) => void;
  currentDraftId: string | null;
  setCurrentDraftId: (id: string | null) => void;
  currentFlowId: string | null;
  setCurrentFlowId: (id: string | null) => void;

  // Playback state — which version/song is currently playing audio
  isPlaying: boolean;
  playingSongId: string | null;         // gallery song id
  auditioningVersionId: string | null;  // version card id being previewed
  setPlaying: (id: string | null) => void;
  setAuditioning: (versionId: string | null) => void;

  // Radio — which station is streaming (or null)
  radioStationId: string | null;
  setRadioStationId: (id: string | null) => void;

  // Reset the recording flow (keeps gallery + radio)
  resetFlow: () => void;
}

export const useMurmurStore = create<MurmurStore>((set) => ({
  recordingState: "idle",
  setRecordingState: (s) => set({ recordingState: s }),
  processingMessage: "",
  setProcessingMessage: (m) => set({ processingMessage: m }),

  vibeVersions: [],
  setVibeVersions: (v) => set({ vibeVersions: v }),

  humStyleBlob: null,
  setHumStyleBlob: (b) => set({ humStyleBlob: b }),

  currentVersion: null,
  setCurrentVersion: (v) => set({ currentVersion: v }),
  currentDraftId: null,
  setCurrentDraftId: (id) => set({ currentDraftId: id }),
  currentFlowId: null,
  setCurrentFlowId: (id) => set({ currentFlowId: id }),

  isPlaying: false,
  playingSongId: null,
  auditioningVersionId: null,
  setPlaying: (id) => set({ isPlaying: !!id, playingSongId: id, auditioningVersionId: null }),
  setAuditioning: (versionId) =>
    set({ auditioningVersionId: versionId, isPlaying: false, playingSongId: null }),

  radioStationId: null,
  setRadioStationId: (id) => set({ radioStationId: id }),

  resetFlow: () =>
    set({
      recordingState: "idle",
      vibeVersions: [],
      humStyleBlob: null,
      currentVersion: null,
      currentDraftId: null,
      currentFlowId: null,
      processingMessage: "",
      auditioningVersionId: null,
      isPlaying: false,
      playingSongId: null,
    }),
}));
