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

export type TonalCandidate = {
  key: string;
  scale: CleanMelody["scale"];
  family: "major" | "minor";
  confidence: number;
};

export type MelodyIntentProfile = {
  skeleton: CleanMelody;
  tonalCandidates: TonalCandidate[];
  lockedTonalCandidate: TonalCandidate;
  stableAnchorPitches: number[];
  phraseEndingPitches: number[];
  confidence: number;
  intentMatch: number;
  musicalityBias: number;
  intervalPolicy: {
    preferredMotion: "stepwise" | "balanced" | "leap-friendly";
    maxUnpreparedLeap: number;
    preserveLeapThreshold: number;
    anchorPitchClasses: number[];
    cadencePitchClasses: number[];
  };
  rhythmPolicy: {
    beatSeconds: number;
    gridSeconds: number;
    minNoteSeconds: number;
    phraseEndHoldSeconds: number;
    quantizeStrength: number;
    phraseBreakSeconds: number;
    microPauseSeconds: number;
    sentenceSeparationSeconds: number;
  };
  correctionPolicy: {
    allowedPitchClasses: number[];
    pitchClassWeights?: number[];
    cadencePitchClassWeights?: number[];
    correctionStrength: number;
    retuneSpeed: number;
    timingQuantize: number;
    vibratoTolerance: number;
    formantPolicy: "preserve" | "ignore";
  };
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

export const VISUAL_ARTWORK_BUCKETS = [
  "luminist_air",
  "sublime_terrain",
  "tidal_mineral",
  "pastoral_memory",
  "nocturne_metro",
  "printed_signal",
  "stage_heat",
  "interior_reverie",
  "hypermodern_void",
] as const;

export type VisualArtworkBucket = (typeof VISUAL_ARTWORK_BUCKETS)[number];

export const VISUAL_ARTWORK_SOURCES = ["aic", "met", "cma", "commons", "manual"] as const;

export type VisualArtworkSource = (typeof VISUAL_ARTWORK_SOURCES)[number];

export type VisualArtworkCrop = {
  x: number;
  y: number;
  scale: number;
};

export type VisualArtwork = {
  id: string;
  bucket: VisualArtworkBucket;
  title: string;
  artist: string;
  year: string;
  source: VisualArtworkSource;
  sourceUrl: string;
  imagePath: string;
  backgroundImagePath?: string;
  license: "CC0" | "Public Domain";
  crop: VisualArtworkCrop;
  palette?: string[];
  renderTreatment?: {
    intent?: string;
    cropFormat?: string;
    recommendedOverlay?: number;
    contrast?: string;
    grain?: string;
  };
};

export type VisualFacets = {
  genre?: string;
  mood?: string;
  instrument?: string;
  scene?: string;
  energy?: number;
  bucket?: VisualArtworkBucket;
};

export type VisualConfig = {
  preset: string;       // e.g. "warm_particles", "soft_gradient"
  gradient: string;     // CSS gradient string
  particleDensity: number; // 0.0–1.0
  pulseSource: "drums" | "melody" | "energy";
  posterBg?: string;
  artwork?: VisualArtwork;
  visualFacets?: VisualFacets;
};

export type VersionGenerationStatus = "pending" | "ready" | "error";
export type VersionGenerationErrorCode =
  | "background_canceled"
  | "insufficient_notes"
  | "rate_limited"
  | "billing_unavailable"
  | "worker_unconfigured"
  | "worker_unavailable"
  | "worker_overloaded"
  | "server_error"
  | "network_error";

type VersionGenerationBase = {
  engine: "magenta";
  prompt: string;
  vibeLabel: { zh: string; en: string };
  audioUrl?: string;
  durationSec: number;
  batchIndex: number;
  styleMix: number;
  currentBalance?: number;
  cost?: number;
  /**
   * Stable per-clip operation identity for durable recovery + spend
   * idempotency (#300). Persists across reload in the draft; the paid unit is
   * this id, so resuming the same clip never double-charges. Optional for
   * legacy drafts minted before #300.
   */
  operationId?: string;
  /** Stable per-batch (fan-out) operation identity; shared by sibling clips. */
  batchOperationId?: string;
};

export type VersionGeneration = VersionGenerationBase & (
  | { status: "pending" | "ready"; error?: undefined; errorCode?: undefined }
  | { status: "error"; error: string; errorCode: VersionGenerationErrorCode }
);

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
  generation?: VersionGeneration;
  /**
   * Fidelity of the transcription that seeded this version. "reduced" means the
   * client-side pitch fallback (browser pYIN) produced the melody because the
   * audio worker was unreachable — the UI surfaces a subtle, non-blocking
   * reduced-detail hint. Absent (undefined) for normal server-side captures
   * (issue #211).
   */
  captureQuality?: "reduced";
};

/**
 * Creation provenance persisted alongside a saved song (#297). Records where
 * the artifact came from so lineage, recovery, and audits can reconstruct the
 * exact flow/recording/generation that produced it. Every field is optional so
 * legacy rows (which have none) and partial captures stay valid.
 */
export type SongProvenance = {
  /** originFlowId of the creation flow. */
  flow?: string;
  /** Draft id — the client's stable identity for this recording session. */
  draftId?: string;
  /** Recording/transcription operation, when the client retains one. */
  recordingOperationId?: string;
  /** Stable generation batch operation id (see generation identity, #300). */
  generationBatchId?: string;
  /** Stable generation clip/slot operation id — the audited clip (#300). */
  generationClipId?: string;
  /** Which batch this clip belonged to (0 for the first fan-out). */
  generationBatchIndex?: number;
  sourceType?: "hum" | "demo" | "library";
  /** "reduced" when the seed melody came from the client-side pitch fallback. */
  captureQuality?: "reduced";
};

export type SongCard = {
  id: string;
  title: string;
  mp3Url?: string;
  /** False for an incomplete/draft song whose audio never rendered (#291). */
  hasAudio?: boolean;
  visibility?: "private" | "unlisted" | "public";
  shareCode?: string | null;
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

export type TranscriptionProvider =
  | "rmvpe"
  | "swiftf0"
  | "pyin"
  | "client_pyin"
  | "yin"
  | "parselmouth"
  | "fixture";

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
  decodeMs?: number;
  trimMs?: number;
  denoiseMs?: number;
  denoiseProvider?: "off" | "deepfilternet";
  denoiseModel?: string | null;
  providerPitchMs?: number;
  pitchMs?: number;
  polishMs?: number;
  totalMs?: number;
  rmvpeFrames?: number;
  rmvpeVoicedFrames?: number;
  rmvpeHopMs?: number;
  rmvpeConfidenceThreshold?: number;
  rmvpeDevice?: string;
  rmvpeModel?: string;
  rmvpeExecutionProvider?: string | null;
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
  noteDensity?: number | null;
  hypothesisCandidates?: string;
  alternateReviewMode?: string;
  alternateReviewHypotheses?: string;
  detailPreservingRerank?: string;
  ensembleScore?: number | null;
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
  melodyIntent?: MelodyIntentProfile;
  melodies: TranscriptionMelodies;
  selectedMelodyKind: MelodySelectionKind;
  cleanMelody: CleanMelody;
  warnings: string[];
  diagnostics?: TranscriptionDiagnostics;
};
