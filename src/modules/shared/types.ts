export type MelodyNote = {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  confidence: number;
};

export type CleanMelody = {
  notes: MelodyNote[];
  key: string;
  scale: "major" | "minor" | "pentatonic" | "dorian" | "phrygian";
  bpm: number;
  duration: number;
  contour: "rising" | "falling" | "wave" | "flat";
};

export type TrackState = {
  enabled: boolean;
  intensity: number;
  originalPattern: string;  // NEVER deleted
  /**
   * @deprecated since v2; use the typed fields below. Removed v3.
   *
   * Legacy compatibility string. Historically this represented melody
   * pitches, generated chord tags, bass/drum pattern names, and texture tags.
   */
  currentPattern: string;   // may differ after edits
  instrument: string;
  versionHistory: string[]; // previous currentPattern values
  melodyPitchSequence?: number[];
  chordsTag?: string;
  bassPattern?: string;
  drumsPattern?: string;
  texturePreset?: string;
};

export type ArrangementState = {
  melody: TrackState;
  chords: TrackState;
  strings: TrackState;
  drums: TrackState;
  bass: TrackState;
  texture: TrackState;
};

export type VisualConfig = {
  preset: string;       // e.g. "warm_particles", "soft_gradient"
  gradient: string;     // CSS gradient string
  particleDensity: number; // 0.0–1.0
  pulseSource: "drums" | "melody" | "energy";
};

export type VibeVersion = {
  id: string;
  title: string;
  vibe: string;
  tags: string[];
  melody: CleanMelody;
  strummerCode: string;
  arrangementState: ArrangementState;
  visualConfig: VisualConfig;
  previewAudioUrl?: string;
};

export type SongCard = {
  id: string;
  title: string;
  mp3Url?: string;
  visualHtmlUrl?: string;
  posterImageUrl?: string;
  visualConfig: VisualConfig;
  vibe: string;
  duration: number;
  arrangementState: ArrangementState;
  createdAt: string;
};

export type TranscriptionInput = {
  audioBlob?: Blob;
  audioUrl?: string;
  providerHint?: string;
  targetInstrument?: string;
};

export type TranscriptionProvider = "swiftf0" | "pyin" | "fixture";

export type TranscriptionDiagnostics = {
  duration: number;
  snr: number | null;
  voicedRatio: number | null;
  frameCount?: number;
  denoiseMs?: number;
  denoiseProvider?: "off" | "deepfilternet";
  denoiseModel?: string | null;
  pitchMs?: number;
  polishMs?: number;
  workerMs?: number;
  targetInstrument?: string;
  rangeClampApplied?: boolean;
};

export type TranscriptionResult = {
  provider: TranscriptionProvider;
  rawNotes: MelodyNote[];
  cleanMelody: CleanMelody;
  warnings: string[];
  diagnostics?: TranscriptionDiagnostics;
};
