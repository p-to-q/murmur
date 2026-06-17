import type {
  CleanMelody,
  MelodyNote,
  MelodySelectionKind,
  TranscriptionDiagnostics,
  TranscriptionResult,
} from "@/modules/shared/types";

export const MELO_LAB_CONTRACT_VERSION = 2;

export const MELO_LAB_PITCH_PROVIDERS = [
  {
    id: "auto",
    title: "Auto ensemble",
    subtitle: "Murmur worker selection",
    group: "murmur",
    kind: "route",
  },
  {
    id: "swiftf0",
    title: "SwiftF0",
    subtitle: "Murmur fast local F0",
    group: "murmur",
    kind: "detector",
  },
  {
    id: "pyin",
    title: "pYIN",
    subtitle: "Murmur fallback baseline",
    group: "murmur",
    kind: "detector",
  },
  {
    id: "yin",
    title: "YIN",
    subtitle: "external librosa test",
    group: "external",
    kind: "detector",
  },
  {
    id: "parselmouth",
    title: "Praat",
    subtitle: "external speech-F0 test",
    group: "external",
    kind: "detector",
  },
] as const;

export type MeloLabPitchProviderId = (typeof MELO_LAB_PITCH_PROVIDERS)[number]["id"];

export const MELO_LAB_PITCH_PROVIDER_IDS = MELO_LAB_PITCH_PROVIDERS.map(
  (provider) => provider.id,
) as MeloLabPitchProviderId[];

export const MELO_LAB_STAGES = [
  {
    id: "raw",
    title: "Raw",
    intent: "audio worker note JSON",
  },
  {
    id: "intent",
    title: "Intent",
    intent: "keeps the hummed contour",
  },
  {
    id: "corrected",
    title: "Corrected",
    intent: "pitch and timing repair",
  },
  {
    id: "musical",
    title: "Musical",
    intent: "song-like phrase repair",
  },
] as const;

export type MeloLabStageId = "raw" | MelodySelectionKind;

export const MELO_LAB_STAGE_IDS = MELO_LAB_STAGES.map(
  (stage) => stage.id,
) as MeloLabStageId[];

export const MELO_LAB_DEFAULT_PROMPT =
  "simple warm piano and soft pads, clear lead melody, no vocals";

export const MELO_LAB_MAX_RECORDING_MS = 12_000;
export const MELO_LAB_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MELO_LAB_MAX_PROMPT_CHARS = 300;
export const MELO_LAB_MAX_MUSIC_DURATION_SECONDS = 20;

export const MELO_LAB_DIAGNOSTIC_KEYS = [
  "selectedMelodyKind",
  "duration",
  "snr",
  "voicedRatio",
  "rmsDbfs",
  "peakDbfs",
  "clippingRatio",
  "frameCount",
  "decodeMs",
  "trimMs",
  "denoiseMs",
  "denoiseProvider",
  "denoiseModel",
  "providerPitchMs",
  "pitchMs",
  "polishMs",
  "totalMs",
  "workerMs",
  "targetInstrument",
  "rangeClampApplied",
  "acceptanceScore",
  "musicFeelScore",
  "rushedRatio",
  "ambiguousMidRatio",
  "cadenceRatio",
  "excessiveHoldRatio",
  "interiorHoldRatio",
  "onsetFragmentation",
  "noteDensity",
  "firstOnsetLag",
  "urgentCoherence",
  "noteHypothesis",
  "noteProposalProfile",
  "noteProposalCandidates",
  "proposalGlideRatio",
  "proposalWobbleRatio",
  "proposalUrgentRatio",
  "hypothesisCandidates",
  "ensembleScore",
  "ensembleCandidates",
  "ensembleDecision",
  "ensembleSelected",
  "providerRerouted",
  "alternateReviewMode",
  "alternateReviewHypotheses",
  "detailPreservingRerank",
  "repairTriggered",
  "repairTriggerReason",
  "repairCandidates",
] as const satisfies ReadonlyArray<keyof TranscriptionDiagnostics>;

export type MeloLabDiagnosticKey = (typeof MELO_LAB_DIAGNOSTIC_KEYS)[number];

export type MeloLabCompactDiagnostics = Partial<
  Pick<TranscriptionDiagnostics, MeloLabDiagnosticKey>
>;

export function compactMeloLabDiagnostics(
  diagnostics?: TranscriptionDiagnostics | null,
): MeloLabCompactDiagnostics | null {
  if (!diagnostics) return null;
  const compact: Record<string, unknown> = {};
  for (const key of MELO_LAB_DIAGNOSTIC_KEYS) {
    const value = diagnostics[key];
    if (value !== undefined) {
      compact[key] = value;
    }
  }
  return compact as MeloLabCompactDiagnostics;
}

export type MeloLabRawStage = {
  notes: MelodyNote[];
  summary: {
    noteCount: number;
    duration: number;
  };
};

export type MeloLabMelodyStage = {
  melody: CleanMelody;
  summary: Record<string, unknown>;
};

export type MeloLabTranscribeResponse = {
  testOnly: true;
  contractVersion: typeof MELO_LAB_CONTRACT_VERSION;
  workerUrl: string;
  requestId: string;
  pitchProvider: MeloLabPitchProviderId;
  requestedProvider: string;
  result: TranscriptionResult;
  stages: {
    raw: MeloLabRawStage;
    intentProfile: {
      summary: Record<string, unknown> | null;
    };
    intent: MeloLabMelodyStage;
    corrected: MeloLabMelodyStage;
    musical: MeloLabMelodyStage;
  };
};
