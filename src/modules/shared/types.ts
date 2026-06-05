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

export type TranscriptionMelodies = {
  intent: CleanMelody;
  corrected: CleanMelody;
  musical: CleanMelody;
};

export type MelodySelectionKind = keyof TranscriptionMelodies;
export type EditDepth = "fresh" | "shaped" | "reworked";

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
  draftId: string;
  originFlowId: string;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth: number;
  sourceType: "hum" | "demo" | "library";
  sourceMelodyKind: MelodySelectionKind;
  editCount: number;
  editDepth: EditDepth;
  versionSeed: string;
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
  sourceMelodyKind?: MelodySelectionKind;
  editCount?: number;
  editDepth?: EditDepth;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth?: number;
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
  rmsDbfs?: number | null;
  peakDbfs?: number | null;
  clippingRatio?: number | null;
  acceptanceScore?: number | null;
  musicFeelScore?: number | null;
  rushedRatio?: number | null;
  ambiguousMidRatio?: number | null;
  cadenceRatio?: number | null;
  excessiveHoldRatio?: number | null;
  interiorHoldRatio?: number | null;
  onsetFragmentation?: number | null;
  firstOnsetLag?: number | null;
  urgentCoherence?: number | null;
  frameCount?: number;
  denoiseMs?: number;
  denoiseProvider?: "off" | "deepfilternet";
  denoiseModel?: string | null;
  pitchMs?: number;
  polishMs?: number;
  workerMs?: number;
  targetInstrument?: string;
  rangeClampApplied?: boolean;
  selectedMelodyKind?: MelodySelectionKind;
  noteHypothesis?: string;
  noteProposalProfile?: string;
  noteProposalCandidates?: string;
  proposalGlideRatio?: number | null;
  proposalWobbleRatio?: number | null;
  proposalUrgentRatio?: number | null;
  hypothesisCandidates?: string;
  ensembleCandidates?: string;
  ensembleDecision?: string;
  ensembleSelected?: string;
  repairTriggered?: boolean;
  repairTriggerReason?: string;
  repairCandidates?: string;
  providerRerouted?: boolean;
};

export type TranscriptionContour = {
  timestamps: number[];
  pitchHz: Array<number | null>;
  confidence: number[];
  voiced: boolean[];
  hopSeconds: number;
};

export type TranscriptionResult = {
  provider: TranscriptionProvider;
  rawNotes: MelodyNote[];
  contour?: TranscriptionContour;
  melodies: TranscriptionMelodies;
  selectedMelodyKind: MelodySelectionKind;
  cleanMelody: CleanMelody;
  warnings: string[];
  diagnostics?: TranscriptionDiagnostics;
};
