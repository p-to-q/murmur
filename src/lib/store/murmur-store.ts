import { create } from "zustand";
import type { VibeVersion, SongCard } from "@/modules/shared/types";

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

  // Selected version for studio editing
  currentVersion: VibeVersion | null;
  setCurrentVersion: (v: VibeVersion | null) => void;

  // Gallery songs (loaded from DB)
  songs: SongCard[];
  setSongs: (s: SongCard[]) => void;
  addSong: (s: SongCard) => void;
  removeSong: (id: string) => void;

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

  currentVersion: null,
  setCurrentVersion: (v) => set({ currentVersion: v }),

  songs: [],
  setSongs: (s) => set({ songs: s }),
  addSong: (s) => set((state) => ({ songs: [s, ...state.songs] })),
  removeSong: (id) =>
    set((state) => ({ songs: state.songs.filter((s) => s.id !== id) })),

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
      currentVersion: null,
      processingMessage: "",
      auditioningVersionId: null,
      isPlaying: false,
      playingSongId: null,
    }),
}));
