import type {
  CleanMelody,
  MelodyIntentProfile,
  MelodySelectionKind,
  MelodyNote,
  TonalCandidate,
  TranscriptionContour,
  TranscriptionDiagnostics,
  TranscriptionResult,
  TranscriptionMelodies,
} from "@/modules/shared/types";
import { detectBpm, detectPhrases } from "@/lib/music/rhythm-engine";
import {
  estimateKey,
  polishMelody,
  openingAnchorWeight,
  closingAnchorWeight,
  shouldPreserveExpressiveNonScaleTone,
} from "./melody-polisher";

const KEY_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;
const DORIAN_INTERVALS = [0, 2, 3, 5, 7, 9, 10] as const;
const PHRYGIAN_INTERVALS = [0, 1, 3, 5, 7, 8, 10] as const;
const PENTATONIC_MAJOR_INTERVALS = [0, 2, 4, 7, 9] as const;
const PENTATONIC_MINOR_INTERVALS = [0, 3, 5, 7, 10] as const;

export function buildTranscriptionMelodies(
  rawNotes: MelodyNote[],
  correctedMelody?: CleanMelody,
  options: {
    diagnostics?: Partial<TranscriptionDiagnostics>;
    contour?: TranscriptionContour;
    melodyIntent?: MelodyIntentProfile;
  } = {},
): TranscriptionMelodies {
  const intent = buildIntentMelody(rawNotes);
  const anchoredCorrected = anchorCorrectedDraftToIntent(
    correctedMelody ?? polishMelody(rawNotes),
    intent,
  );
  const corrected = applyPhraseFamilyRepair(anchoredCorrected, intent);
  const melodyIntent =
    options.melodyIntent ??
    buildMelodyIntentProfile(rawNotes, corrected, {
      diagnostics: options.diagnostics,
      contour: options.contour,
    });
  const musical = buildMusicalMelodyWithRepair(
    corrected,
    options.diagnostics,
    options.contour,
    melodyIntent,
  );

  return {
    intent,
    corrected: alignMelodyToOwnTonalCenter(corrected),
    musical: alignMelodyToOwnTonalCenter(musical),
  };
}

export function buildMelodyIntentProfile(
  rawNotes: MelodyNote[],
  correctedMelody?: CleanMelody,
  options: {
    diagnostics?: Partial<TranscriptionDiagnostics>;
    contour?: TranscriptionContour;
  } = {},
): MelodyIntentProfile {
  const skeleton = buildIntentMelody(rawNotes);
  const corrected = anchorCorrectedDraftToIntent(
    correctedMelody ?? polishMelody(rawNotes),
    skeleton,
  );
  const tonalCandidates = rankTonalCandidates(skeleton.notes, corrected);
  const lockedTonalCandidate = chooseLockedTonalCandidate(
    tonalCandidates,
    corrected,
  );
  const stableAnchorPitches = collectStableAnchorPitches(skeleton.notes);
  const phraseEndingPitches = collectPhraseEndingPitches(skeleton);
  const contourStats = summarizeContour(options.contour);
  const confidence = scoreIntentConfidence(
    skeleton.notes,
    options.diagnostics,
    contourStats,
  );
  const intentMatch = scoreIntentMatch(
    skeleton.notes,
    lockedTonalCandidate,
    confidence,
    contourStats,
  );
  const musicalityBias = scoreMusicalityBias(
    confidence,
    options.diagnostics,
    contourStats,
  );

  return {
    skeleton,
    tonalCandidates,
    lockedTonalCandidate,
    stableAnchorPitches,
    phraseEndingPitches,
    confidence,
    intentMatch,
    musicalityBias,
    intervalPolicy: buildIntervalPolicy(
      lockedTonalCandidate,
      stableAnchorPitches,
      phraseEndingPitches,
      intentMatch,
    ),
    rhythmPolicy: buildRhythmPolicy(
      skeleton,
      confidence,
      musicalityBias,
    ),
    correctionPolicy: buildCorrectionPolicy(
      lockedTonalCandidate,
      confidence,
      musicalityBias,
      options.diagnostics,
      contourStats,
    ),
  };
}

function buildIntervalPolicy(
  locked: TonalCandidate,
  stableAnchorPitches: number[],
  phraseEndingPitches: number[],
  intentMatch: number,
): MelodyIntentProfile["intervalPolicy"] {
  const root = KEY_NAMES.indexOf(locked.key as (typeof KEY_NAMES)[number]);
  const cadencePitchClasses = root >= 0 ? getCadenceTargets(root, locked.scale) : [];
  const anchorPitchClasses =
    stableAnchorPitches.length > 0
      ? Array.from(new Set(stableAnchorPitches.map((pitch) => mod12(pitch))))
      : cadencePitchClasses;
  const endingLeapSignal = phraseEndingPitches.length >= 2
    ? Math.abs(phraseEndingPitches.at(-1)! - phraseEndingPitches[0]!)
    : 0;
  const preferredMotion =
    intentMatch >= 0.74 || endingLeapSignal >= 7
      ? "leap-friendly"
      : intentMatch >= 0.56
        ? "balanced"
        : "stepwise";

  return {
    preferredMotion,
    maxUnpreparedLeap: preferredMotion === "leap-friendly" ? 9 : preferredMotion === "balanced" ? 7 : 5,
    preserveLeapThreshold: preferredMotion === "leap-friendly" ? 8 : 6,
    anchorPitchClasses,
    cadencePitchClasses,
  };
}

function buildRhythmPolicy(
  skeleton: CleanMelody,
  confidence: number,
  musicalityBias: number,
): MelodyIntentProfile["rhythmPolicy"] {
  const beatSeconds = 60 / skeleton.bpm;
  const quantizeStrength = clamp(0.26 + musicalityBias * 0.46 + (1 - confidence) * 0.18, 0.2, 0.78);
  const phraseBreakSeconds = beatSeconds * (musicalityBias >= 0.55 ? 1.2 : 0.92);
  const microPauseSeconds = beatSeconds * (musicalityBias >= 0.55 ? 0.18 : 0.12);
  return {
    beatSeconds,
    gridSeconds: beatSeconds / 4,
    minNoteSeconds: Math.max(0.06, beatSeconds * (musicalityBias >= 0.55 ? 0.22 : 0.16)),
    phraseEndHoldSeconds: beatSeconds * (musicalityBias >= 0.55 ? 0.64 : 0.5),
    quantizeStrength,
    phraseBreakSeconds,
    microPauseSeconds,
    sentenceSeparationSeconds: phraseBreakSeconds + microPauseSeconds,
  };
}

export function chooseGenerationMelodyKind(input: {
  melodies: TranscriptionMelodies;
  melodyIntent?: MelodyIntentProfile;
  diagnostics?: Partial<TranscriptionDiagnostics>;
  contour?: TranscriptionContour;
  repairBias?: number;
}): MelodySelectionKind {
  const { melodies, melodyIntent, diagnostics, contour } = input;
  const corrected = melodies.corrected;
  const contourStats = summarizeContour(contour);

  const noteCount = corrected.notes.length;
  const shortNoteCount = corrected.notes.filter((note) => note.duration <= 0.18).length;
  const shortNoteRatio = noteCount > 0 ? shortNoteCount / noteCount : 0;
  const avgConfidence =
    noteCount > 0
      ? corrected.notes.reduce((sum, note) => sum + note.confidence, 0) / noteCount
      : 1;

  const poorVoicing =
    typeof diagnostics?.voicedRatio === "number" && diagnostics.voicedRatio < 0.66;
  const poorSnr = typeof diagnostics?.snr === "number" && diagnostics.snr < 10;
  const veryPoorVoicing =
    typeof diagnostics?.voicedRatio === "number" && diagnostics.voicedRatio < 0.52;
  const veryPoorSnr = typeof diagnostics?.snr === "number" && diagnostics.snr < 7.5;
  const weakAcceptance =
    (typeof diagnostics?.acceptanceScore === "number" && diagnostics.acceptanceScore < 0.58) ||
    (typeof diagnostics?.musicFeelScore === "number" && diagnostics.musicFeelScore < 0.58) ||
    (typeof diagnostics?.excessiveHoldRatio === "number" && diagnostics.excessiveHoldRatio >= 0.34) ||
    (typeof diagnostics?.interiorHoldRatio === "number" && diagnostics.interiorHoldRatio >= 0.18) ||
    (typeof diagnostics?.onsetFragmentation === "number" && diagnostics.onsetFragmentation >= 0.52) ||
    (typeof diagnostics?.firstOnsetLag === "number" && diagnostics.firstOnsetLag >= 0.18);
  const veryWeakAcceptance =
    (typeof diagnostics?.acceptanceScore === "number" && diagnostics.acceptanceScore < 0.48) ||
    (typeof diagnostics?.musicFeelScore === "number" && diagnostics.musicFeelScore < 0.48) ||
    (typeof diagnostics?.excessiveHoldRatio === "number" && diagnostics.excessiveHoldRatio >= 0.42) ||
    (typeof diagnostics?.interiorHoldRatio === "number" && diagnostics.interiorHoldRatio >= 0.28) ||
    (typeof diagnostics?.onsetFragmentation === "number" && diagnostics.onsetFragmentation >= 0.62) ||
    (typeof diagnostics?.firstOnsetLag === "number" && diagnostics.firstOnsetLag >= 0.28);
  const fragmentedTiming = noteCount >= 6 && shortNoteRatio >= 0.42;
  const severeFragmentedTiming = noteCount >= 6 && shortNoteRatio >= 0.58;
  const weakConfidence =
    (noteCount >= 5 && avgConfidence < 0.72) ||
    contourStats.voicedConfidence < 0.72 ||
    contourStats.lowConfidenceVoicedRatio >= 0.34;
  const veryWeakConfidence =
    (noteCount >= 5 && avgConfidence < 0.62) ||
    contourStats.voicedConfidence < 0.62 ||
    contourStats.lowConfidenceVoicedRatio >= 0.48;
  const contourLooksShaky =
    contourStats.voicedFrameCount >= 12 &&
    (contourStats.unstableVoicedJumpRatio >= 0.24 ||
      contourStats.voicedGapRatio >= 0.18);
  const contourLooksVeryShaky =
    contourStats.voicedFrameCount >= 12 &&
    (contourStats.unstableVoicedJumpRatio >= 0.34 ||
      contourStats.voicedGapRatio >= 0.28);
  const weakIntent =
    typeof melodyIntent?.confidence === "number" && melodyIntent.confidence < 0.5;
  const veryWeakIntent =
    typeof melodyIntent?.confidence === "number" && melodyIntent.confidence < 0.38;
  const tonalCandidates = melodyIntent?.tonalCandidates ?? [];
  const unclearTonality =
    tonalCandidates.length >= 2 &&
    tonalCandidates[0]!.confidence - tonalCandidates[1]!.confidence < 0.08 &&
    noteCount >= 4;
  const strongRescueSignal =
    veryPoorVoicing ||
    veryPoorSnr ||
    veryWeakAcceptance ||
    severeFragmentedTiming ||
    veryWeakConfidence ||
    contourLooksVeryShaky ||
    veryWeakIntent;
  const moderateSignalCount = [
    poorVoicing,
    poorSnr,
    weakAcceptance,
    fragmentedTiming,
    weakConfidence,
    contourLooksShaky,
    weakIntent,
    unclearTonality,
  ].filter(Boolean).length;
  const softMusicalCandidateSignal =
    weakAcceptanceFromDiagnostics(diagnostics) ||
    fragmentedTiming ||
    weakConfidence ||
    contourLooksShaky ||
    (input.repairBias ?? 0) >= 0.45;

  if (
    !strongRescueSignal &&
    shouldSelectIntentDirectly({
      melodies,
      melodyIntent,
      diagnostics,
      contour,
      repairBias: input.repairBias,
    })
  ) {
    return "intent";
  }

  if (strongRescueSignal || moderateSignalCount >= 2 || softMusicalCandidateSignal) {
    return shouldAutoSelectMusical({
      corrected,
      musical: melodies.musical,
      melodyIntent,
      diagnostics,
      contour,
      repairBias: input.repairBias,
    })
      ? "musical"
      : "corrected";
  }

  if (shouldAutoSelectMusical({
    corrected,
    musical: melodies.musical,
    melodyIntent,
    diagnostics,
    contour,
    repairBias: input.repairBias,
    requireUserBias: true,
  })) {
    return "musical";
  }

  return "corrected";
}

function shouldSelectIntentDirectly(input: {
  melodies: TranscriptionMelodies;
  melodyIntent?: MelodyIntentProfile;
  diagnostics?: Partial<TranscriptionDiagnostics>;
  contour?: TranscriptionContour;
  repairBias?: number;
}): boolean {
  const bias = clampRepairBias(input.repairBias ?? 0);
  if (bias >= 0.55) return false;

  const intent = input.melodies.intent;
  if (intent.notes.length < 3) return false;

  const diagnostics = input.diagnostics;
  const contourStats = summarizeContour(input.contour);
  const avgConfidence = averageNoteConfidence(intent.notes);
  const shortRatio = shortNoteRatio(intent.notes);
  const quality = input.melodyIntent;
  const tonalCandidates = quality?.tonalCandidates;
  const tonalGap = tonalCandidateGap(tonalCandidates);

  const audioStable =
    (typeof diagnostics?.voicedRatio !== "number" || diagnostics.voicedRatio >= 0.74) &&
    (typeof diagnostics?.snr !== "number" || diagnostics.snr >= 12) &&
    contourStats.voicedConfidence >= 0.76 &&
    contourStats.lowConfidenceVoicedRatio <= 0.24 &&
    contourStats.unstableVoicedJumpRatio <= 0.18 &&
    contourStats.voicedGapRatio <= 0.16;
  const workerAccepted =
    (typeof diagnostics?.acceptanceScore !== "number" || diagnostics.acceptanceScore >= 0.68) &&
    (typeof diagnostics?.musicFeelScore !== "number" || diagnostics.musicFeelScore >= 0.64) &&
    (typeof diagnostics?.firstOnsetLag !== "number" || diagnostics.firstOnsetLag <= 0.12) &&
    (typeof diagnostics?.onsetFragmentation !== "number" || diagnostics.onsetFragmentation <= 0.34) &&
    (typeof diagnostics?.interiorHoldRatio !== "number" || diagnostics.interiorHoldRatio <= 0.14);
  const intentStrong =
    avgConfidence >= 0.78 &&
    shortRatio <= 0.32 &&
    (quality?.confidence ?? 0) >= 0.72 &&
    (quality?.intentMatch ?? 0) >= 0.7 &&
    (quality?.musicalityBias ?? 1) <= 0.38;
  const metadataStable =
    tonalGap >= 0.02 &&
    !hasCloseModeConflict(tonalCandidates) &&
    Boolean(quality?.lockedTonalCandidate) &&
    (quality?.lockedTonalCandidate.confidence ?? 0) >= 0.64;

  return audioStable && workerAccepted && intentStrong && metadataStable;
}

function averageNoteConfidence(notes: MelodyNote[]): number {
  if (notes.length === 0) return 0;
  return notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length;
}

function shortNoteRatio(notes: MelodyNote[]): number {
  if (notes.length === 0) return 0;
  return notes.filter((note) => note.duration <= 0.18).length / notes.length;
}

function tonalCandidateGap(candidates?: TonalCandidate[]): number {
  if (!candidates || candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0]!.confidence;
  return candidates[0]!.confidence - candidates[1]!.confidence;
}

function hasCloseModeConflict(candidates?: TonalCandidate[]): boolean {
  if (!candidates || candidates.length < 2) return false;
  const top = candidates[0]!;
  return candidates
    .slice(1, 4)
    .some(
      (candidate) =>
        candidate.key === top.key &&
        candidate.family !== top.family &&
        top.confidence - candidate.confidence < 0.055,
    );
}

function shouldAutoSelectMusical(input: {
  corrected: CleanMelody;
  musical: CleanMelody;
  melodyIntent?: MelodyIntentProfile;
  diagnostics?: Partial<TranscriptionDiagnostics>;
  contour?: TranscriptionContour;
  repairBias?: number;
  requireUserBias?: boolean;
}): boolean {
  const bias = clampRepairBias(input.repairBias ?? 0);
  if (input.requireUserBias && bias < 0.45) return false;

  const notes = input.corrected.notes;
  const noteCount = notes.length;
  const avgConfidence =
    noteCount > 0
      ? notes.reduce((sum, note) => sum + note.confidence, 0) / noteCount
      : 1;
  const shortNoteRatio =
    noteCount > 0
      ? notes.filter((note) => note.duration <= 0.18).length / noteCount
      : 0;
  const contourStats = summarizeContour(input.contour);
  const diagnostics = input.diagnostics;

  const audioTooPoor =
    (typeof diagnostics?.voicedRatio === "number" && diagnostics.voicedRatio < 0.42) ||
    (typeof diagnostics?.snr === "number" && diagnostics.snr < 6.2);
  if (audioTooPoor) return false;

  const audioNotGreat =
    (typeof diagnostics?.voicedRatio === "number" && diagnostics.voicedRatio < 0.7) ||
    (typeof diagnostics?.snr === "number" && diagnostics.snr < 12);
  const acceptanceBad =
    (typeof diagnostics?.acceptanceScore === "number" && diagnostics.acceptanceScore < 0.5) ||
    (typeof diagnostics?.musicFeelScore === "number" && diagnostics.musicFeelScore < 0.5);
  const timingBad =
    shortNoteRatio >= 0.42 ||
    (typeof diagnostics?.onsetFragmentation === "number" && diagnostics.onsetFragmentation >= 0.52) ||
    (typeof diagnostics?.firstOnsetLag === "number" && diagnostics.firstOnsetLag >= 0.18) ||
    (typeof diagnostics?.interiorHoldRatio === "number" && diagnostics.interiorHoldRatio >= 0.2) ||
    (typeof diagnostics?.excessiveHoldRatio === "number" && diagnostics.excessiveHoldRatio >= 0.34);
  const shapeUncomfortable =
    avgConfidence < 0.72 ||
    contourStats.voicedConfidence < 0.72 ||
    contourStats.lowConfidenceVoicedRatio >= 0.34 ||
    contourStats.unstableVoicedJumpRatio >= 0.24;
  const intentBad =
    (typeof input.melodyIntent?.confidence === "number" && input.melodyIntent.confidence < 0.5) ||
    (typeof input.melodyIntent?.intentMatch === "number" && input.melodyIntent.intentMatch < 0.5) ||
    (typeof input.melodyIntent?.musicalityBias === "number" && input.melodyIntent.musicalityBias >= 0.68);
  const weakAcceptanceSignal = weakAcceptanceFromDiagnostics(diagnostics);

  const failedRecoverableGates = [
    audioNotGreat,
    acceptanceBad || weakAcceptanceSignal,
    timingBad,
    shapeUncomfortable,
    intentBad,
  ].filter(Boolean).length;
  const requiredGateCount = bias >= 0.65 ? 2 : 3;
  const correctedQuality = scoreMelodyAcceptance(input.corrected);
  const musicalQuality = scoreMelodyAcceptance(input.musical);
  const identity = scoreMelodyIdentitySimilarity(
    input.corrected,
    input.musical,
    input.melodyIntent,
  );
  const identityThreshold = bias >= 0.55 ? 0.56 : 0.62;
  const keepsHumIdentity =
    identity.score >= identityThreshold &&
    identity.contourScore >= 0.46 &&
    identity.rhythmScore >= 0.42;
  if (!keepsHumIdentity) return false;

  const improvement = scoreMusicalImprovement(input.corrected, input.musical);
  const musicFeelDoesNotRegress =
    musicalQuality.musicFeelScore >= correctedQuality.musicFeelScore - 0.015;
  const correctedIsOrdinary =
    correctedQuality.score < 0.68 ||
    correctedQuality.musicFeelScore < 0.66 ||
    weakAcceptanceSignal ||
    timingBad ||
    shapeUncomfortable;
  const musicalImprovesCandidate =
    musicalQuality.score >= correctedQuality.score + 0.015 ||
    musicalQuality.musicFeelScore >= correctedQuality.musicFeelScore + 0.025 ||
    musicalQuality.excessiveHoldRatio <= correctedQuality.excessiveHoldRatio - 0.08 ||
    musicalQuality.onsetFragmentation <= correctedQuality.onsetFragmentation - 0.12 ||
    improvement.score >= 0.045;
  const musicalDoesNotRegress =
    musicalQuality.score >= correctedQuality.score - 0.04 &&
    musicalQuality.musicFeelScore >= correctedQuality.musicFeelScore - 0.05 &&
    musicalQuality.excessiveHoldRatio <= correctedQuality.excessiveHoldRatio + 0.08 &&
    musicalQuality.onsetFragmentation <= correctedQuality.onsetFragmentation + 0.16;
  const musicalClearlyBetter =
    correctedIsOrdinary &&
    failedRecoverableGates >= (bias >= 0.45 || improvement.score >= 0.055 ? 1 : 2) &&
    improvement.score >= (bias >= 0.55 ? 0.04 : 0.055) &&
    musicFeelDoesNotRegress;

  if (musicalClearlyBetter) return true;

  return (
    acceptanceBad &&
    timingBad &&
    failedRecoverableGates >= requiredGateCount &&
    (musicalImprovesCandidate || musicalDoesNotRegress)
  );
}

function weakAcceptanceFromDiagnostics(
  diagnostics?: Partial<TranscriptionDiagnostics>,
): boolean {
  return (
    (typeof diagnostics?.acceptanceScore === "number" && diagnostics.acceptanceScore < 0.62) ||
    (typeof diagnostics?.musicFeelScore === "number" && diagnostics.musicFeelScore < 0.62) ||
    (typeof diagnostics?.excessiveHoldRatio === "number" && diagnostics.excessiveHoldRatio >= 0.3) ||
    (typeof diagnostics?.interiorHoldRatio === "number" && diagnostics.interiorHoldRatio >= 0.16) ||
    (typeof diagnostics?.onsetFragmentation === "number" && diagnostics.onsetFragmentation >= 0.46) ||
    (typeof diagnostics?.firstOnsetLag === "number" && diagnostics.firstOnsetLag >= 0.16)
  );
}

export function selectGenerationMelody(
  result: Pick<TranscriptionResult, "melodies" | "diagnostics" | "contour" | "melodyIntent">,
  options: { repairBias?: number } = {},
): { kind: MelodySelectionKind; melody: CleanMelody } {
  const baseKind = chooseGenerationMelodyKind({
    ...result,
    repairBias: options.repairBias ?? 0,
  });
  const kind = applyRepairBiasToMelodyKind(baseKind, result, options.repairBias ?? 0);
  return {
    kind,
    melody: result.melodies[kind],
  };
}

export function applyRepairBiasToMelodyKind(
  baseKind: MelodySelectionKind,
  result: Pick<TranscriptionResult, "melodies" | "diagnostics" | "contour">,
  repairBias: number,
): MelodySelectionKind {
  const bias = clampRepairBias(repairBias);

  if (bias <= -0.45) {
    const corrected = result.melodies.corrected;
    const noteCount = corrected.notes.length;
    const avgConfidence =
      noteCount > 0
        ? corrected.notes.reduce((sum, note) => sum + note.confidence, 0) / noteCount
        : 1;
    const contourStats = summarizeContour(result.contour);
    const poorVoicing =
      typeof result.diagnostics?.voicedRatio === "number" && result.diagnostics.voicedRatio < 0.66;
    const poorSnr = typeof result.diagnostics?.snr === "number" && result.diagnostics.snr < 10;
    const unstableTake =
      poorVoicing ||
      poorSnr ||
      avgConfidence < 0.7 ||
      contourStats.voicedConfidence < 0.7 ||
      contourStats.lowConfidenceVoicedRatio >= 0.38 ||
      contourStats.unstableVoicedJumpRatio >= 0.26;

    if (unstableTake && baseKind === "musical") {
      return "corrected";
    }

    return "intent";
  }

  return baseKind;
}

function buildIntentMelody(rawNotes: MelodyNote[]): CleanMelody {
  const notes = mergeAdjacentLightly(
    rawNotes
      .map(normalizeNote)
      .filter((note) => note.confidence >= 0.3)
      .filter((note) => note.duration >= 0.05)
      .sort((a, b) => a.start - b.start),
  );

  if (notes.length === 0) return emptyMelody();

  const bpm = detectBpm(notes);
  const { key, scale } = estimateKey(notes);

  return {
    notes,
    key,
    scale,
    bpm,
    duration: melodyDuration(notes),
    contour: estimateContour(notes),
  };
}

function anchorCorrectedDraftToIntent(
  draft: CleanMelody,
  intent: CleanMelody,
): CleanMelody {
  if (draft.notes.length === 0 || intent.notes.length === 0) return draft;

  const beat = 60 / draft.bpm;
  if (draftAlreadyTracksIntent(draft, intent, beat)) return draft;

  const root = KEY_NAMES.indexOf(draft.key as (typeof KEY_NAMES)[number]);
  if (root < 0) return draft;

  const scalePcs = getScalePitchClasses(root, draft.scale);
  const cadencePcs = getCadenceTargets(root, draft.scale);
  const anchored = preserveIntentTrace(
    draft.notes,
    intent,
    scalePcs,
    cadencePcs,
    beat,
    undefined,
    { cadenceEndings: false },
  );

  return {
    ...draft,
    notes: anchored,
    duration: melodyDuration(anchored),
    contour: estimateContour(anchored),
  };
}

function draftAlreadyTracksIntent(
  draft: CleanMelody,
  intent: CleanMelody,
  beat: number,
): boolean {
  const anchors = collectIntentTraceAnchors(intent, intent, beat);
  if (anchors.length === 0) return true;

  let closeAnchors = 0;
  for (const anchor of anchors) {
    const match = findNearestIntentTraceNote(
      draft.notes,
      anchor,
      beat,
      new Set<number>(),
    );
    if (match === null) continue;

    const note = draft.notes[match]!;
    const closePitch = Math.abs(note.pitch - anchor.pitch) <= 1;
    const closeStart = Math.abs(note.start - anchor.start) <= beat * 0.18;
    const closeDuration =
      Math.abs(note.duration - anchor.duration) <= Math.max(beat * 0.35, anchor.duration * 0.5);
    if (closePitch && closeStart && closeDuration) {
      closeAnchors += 1;
    }
  }

  return closeAnchors / anchors.length >= 0.72;
}

type PhraseSpan = {
  phraseIndex: number;
  noteIndices: number[];
  notes: MelodyNote[];
  start: number;
  end: number;
  duration: number;
  quality: number;
};

function applyPhraseFamilyRepair(
  corrected: CleanMelody,
  intent: CleanMelody,
): CleanMelody {
  if (corrected.notes.length < 6 || intent.notes.length < 6) return corrected;

  const correctedSpans = buildIndexedPhraseSpans(corrected.notes, corrected.bpm);
  const intentSpans = buildIndexedPhraseSpans(intent.notes, intent.bpm);
  const phraseCount = Math.min(correctedSpans.length, intentSpans.length);
  if (phraseCount < 2) return corrected;

  const root = KEY_NAMES.indexOf(corrected.key as (typeof KEY_NAMES)[number]);
  if (root < 0) return corrected;

  const scalePcs = getScalePitchClasses(root, corrected.scale);
  const beat = 60 / corrected.bpm;
  const matches = findPhraseFamilyRepairMatches(
    intentSpans.slice(0, phraseCount),
    correctedSpans.slice(0, phraseCount),
  );
  if (matches.length === 0) return corrected;

  let repaired = corrected.notes.map((note) => ({ ...note }));
  const claimedWeakPhrases = new Set<number>();

  for (const match of matches) {
    if (claimedWeakPhrases.has(match.weakPhraseIndex)) continue;
    const weak = correctedSpans[match.weakPhraseIndex];
    const strong = correctedSpans[match.strongPhraseIndex];
    if (!weak || !strong) continue;
    repaired = repairWeakPhraseFromFamilyTemplate(
      repaired,
      weak,
      strong,
      scalePcs,
      beat,
      match.strength,
    );
    claimedWeakPhrases.add(match.weakPhraseIndex);
  }

  const finalNotes = preventTraceOverlaps(repaired, beat);

  return {
    ...corrected,
    notes: finalNotes,
    duration: melodyDuration(finalNotes),
    contour: estimateContour(finalNotes),
  };
}

function buildIndexedPhraseSpans(notes: MelodyNote[], bpm: number): PhraseSpan[] {
  if (notes.length === 0) return [];

  const beat = 60 / bpm;
  const sorted = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.start - b.note.start);
  const spans: PhraseSpan[] = [];
  let current: Array<{ note: MelodyNote; index: number }> = [sorted[0]!];

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!.note;
    const currentItem = sorted[index]!;
    const gap = currentItem.note.start - (previous.start + previous.duration);
    const stepDown =
      currentItem.note.pitch < previous.pitch - 2 && previous.duration > beat * 0.6;
    if (gap >= beat * 0.9 || stepDown) {
      spans.push(makeIndexedPhraseSpan(spans.length, current));
      current = [currentItem];
      continue;
    }
    current.push(currentItem);
  }

  if (current.length > 0) {
    spans.push(makeIndexedPhraseSpan(spans.length, current));
  }
  return spans;
}

function makeIndexedPhraseSpan(
  phraseIndex: number,
  items: Array<{ note: MelodyNote; index: number }>,
): PhraseSpan {
  const sorted = [...items].sort((a, b) => a.note.start - b.note.start);
  const notes = sorted.map((item) => item.note);
  const first = notes[0]!;
  const last = notes.at(-1)!;
  const start = first.start;
  const end = last.start + last.duration;

  return {
    phraseIndex,
    noteIndices: sorted.map((item) => item.index),
    notes,
    start,
    end,
    duration: Math.max(0.001, end - start),
    quality: scorePhraseRepairQuality(notes),
  };
}

function findPhraseFamilyRepairMatches(
  intentSpans: PhraseSpan[],
  correctedSpans: PhraseSpan[],
): Array<{
  weakPhraseIndex: number;
  strongPhraseIndex: number;
  similarity: number;
  strength: number;
}> {
  const matches: Array<{
    weakPhraseIndex: number;
    strongPhraseIndex: number;
    similarity: number;
    strength: number;
  }> = [];

  for (let left = 0; left < intentSpans.length - 1; left++) {
    for (let right = left + 1; right < intentSpans.length; right++) {
      const leftIntent = intentSpans[left]!;
      const rightIntent = intentSpans[right]!;
      if (leftIntent.notes.length < 3 || rightIntent.notes.length < 3) continue;

      const similarity = scorePhraseFamilySimilarity(leftIntent, rightIntent);
      if (similarity < 0.76) continue;

      const leftCorrected = correctedSpans[left];
      const rightCorrected = correctedSpans[right];
      if (!leftCorrected || !rightCorrected) continue;

      const leftQuality = leftCorrected.quality;
      const rightQuality = rightCorrected.quality;
      const qualityGap = Math.abs(leftQuality - rightQuality);
      const weakEnough = Math.min(leftQuality, rightQuality) < 0.78 || qualityGap >= 0.11;
      const strongEnough = Math.max(leftQuality, rightQuality) >= 0.72;
      if (!weakEnough || !strongEnough || qualityGap < 0.055) continue;

      const weakPhraseIndex = leftQuality <= rightQuality ? left : right;
      const strongPhraseIndex = weakPhraseIndex === left ? right : left;
      const strength = clamp(
        0.22 + (similarity - 0.76) * 0.72 + qualityGap * 0.58,
        0.22,
        0.56,
      );

      matches.push({
        weakPhraseIndex,
        strongPhraseIndex,
        similarity,
        strength,
      });
    }
  }

  return matches.sort((a, b) => {
    const leftScore = a.similarity + a.strength * 0.4;
    const rightScore = b.similarity + b.strength * 0.4;
    return rightScore - leftScore;
  });
}

function scorePhraseFamilySimilarity(left: PhraseSpan, right: PhraseSpan): number {
  const lengthScore =
    1 -
    clamp(
      Math.abs(left.notes.length - right.notes.length) /
        Math.max(left.notes.length, right.notes.length),
      0,
      1,
    );
  const contourScore = compareNumericSeries(
    relativePitchSeries(left.notes),
    relativePitchSeries(right.notes),
    7,
    { octaveEquivalent: true },
  );
  const intervalScore = compareNumericSeries(
    intervalSeries(left.notes),
    intervalSeries(right.notes),
    5,
    { octaveEquivalent: true },
  );
  const rhythmScore =
    compareNumericSeries(relativeCenterSeries(left), relativeCenterSeries(right), 0.24) *
      0.58 +
    compareNumericSeries(relativeDurationSeries(left), relativeDurationSeries(right), 0.24) *
      0.42;
  const openingScore = compareNumericSeries(
    intervalSeries(left.notes).slice(0, 2),
    intervalSeries(right.notes).slice(0, 2),
    5,
    { octaveEquivalent: true },
  );
  const cadenceScore = 1 - clamp(
    octaveAwareDistance(
      (left.notes.at(-1)?.pitch ?? left.notes[0]!.pitch) - left.notes[0]!.pitch,
      (right.notes.at(-1)?.pitch ?? right.notes[0]!.pitch) - right.notes[0]!.pitch,
    ) / 8,
    0,
    1,
  );

  return clamp(
    contourScore * 0.3 +
      intervalScore * 0.22 +
      rhythmScore * 0.2 +
      lengthScore * 0.12 +
      openingScore * 0.09 +
      cadenceScore * 0.07,
    0,
    1,
  );
}

function scorePhraseRepairQuality(notes: MelodyNote[]): number {
  if (notes.length === 0) return 0;
  const avgConfidence =
    notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length;
  const durations = notes.map((note) => note.duration);
  const medianDuration = Math.max(0.001, median(durations));
  const durationDeviation =
    durations.reduce(
      (sum, duration) => sum + Math.abs(duration - medianDuration) / medianDuration,
      0,
    ) / durations.length;
  const rhythmScore = 1 - clamp(durationDeviation / 1.2, 0, 1);
  const awkwardRatio =
    notes.length > 1 ? countAwkwardIntervals(notes) / (notes.length - 1) : 0;
  const structuralScore = clamp(notes.length / 4, 0, 1);

  return clamp(
    avgConfidence * 0.62 +
      rhythmScore * 0.18 +
      (1 - awkwardRatio) * 0.14 +
      structuralScore * 0.06,
    0,
    1,
  );
}

function repairWeakPhraseFromFamilyTemplate(
  notes: MelodyNote[],
  weak: PhraseSpan,
  strong: PhraseSpan,
  scalePcs: Set<number>,
  beat: number,
  strength: number,
): MelodyNote[] {
  const repaired = notes.map((note) => ({ ...note }));
  const weakFirst = weak.notes[0];
  const strongFirst = strong.notes[0];
  if (!weakFirst || !strongFirst) return repaired;

  for (let position = 0; position < weak.noteIndices.length; position++) {
    const noteIndex = weak.noteIndices[position]!;
    const note = repaired[noteIndex];
    if (!note) continue;

    const template = phraseTemplateNoteAt(
      strong,
      phraseNoteProgress(weak.notes[position] ?? note, weak),
      position,
    );
    if (!template) continue;

    const isEdge = position === 0 || position === weak.noteIndices.length - 1;
    const lowConfidence = note.confidence < 0.78;
    const relativeTargetPitch = template.pitch - strongFirst.pitch;
    const targetPitch = nearestScalePitch(weakFirst.pitch + relativeTargetPitch, scalePcs);
    const pitchDistance = Math.abs(targetPitch - note.pitch);
    const shouldPitchRepair =
      !isEdge
        ? lowConfidence || pitchDistance >= 2
        : lowConfidence && pitchDistance <= 2;

    if (shouldPitchRepair && pitchDistance <= (isEdge ? 2 : 6)) {
      const pitchStrength = clamp(
        strength + (lowConfidence ? 0.16 : 0) + (pitchDistance >= 3 ? 0.08 : 0),
        0.18,
        isEdge ? 0.38 : 0.68,
      );
      const blendedPitch = nearestScalePitch(
        Math.round(note.pitch + (targetPitch - note.pitch) * pitchStrength),
        scalePcs,
      );
      if (Math.abs(blendedPitch - note.pitch) <= (isEdge ? 2 : 5)) {
        note.pitch = blendedPitch;
        note.confidence = clamp(Math.max(note.confidence, 0.82), 0, 1);
      }
    }

    const relativeStart = (template.start - strong.start) / strong.duration;
    const relativeDuration = template.duration / strong.duration;
    const targetStart = weak.start + relativeStart * weak.duration;
    const targetDuration = clamp(
      relativeDuration * weak.duration,
      Math.max(0.05, beat * 0.16),
      Math.max(0.06, weak.duration),
    );
    const timingOff =
      Math.abs(targetStart - note.start) >= beat * 0.16 ||
      Math.abs(targetDuration - note.duration) >= beat * 0.18;

    if ((lowConfidence || timingOff) && !isEdge) {
      const timingStrength = clamp(strength * 0.5 + (lowConfidence ? 0.08 : 0), 0.12, 0.34);
      note.start = roundTo(
        Math.max(0, note.start + (targetStart - note.start) * timingStrength),
        3,
      );
      note.duration = roundTo(
        Math.max(
          0.05,
          note.duration + (targetDuration - note.duration) * timingStrength,
        ),
        3,
      );
    }
  }

  return preventTraceOverlaps(repaired, beat);
}

function phraseTemplateNoteAt(
  phrase: PhraseSpan,
  progress: number,
  ordinal: number,
): MelodyNote | null {
  if (phrase.notes.length === 0) return null;
  if (phrase.notes.length > ordinal) return phrase.notes[ordinal]!;

  let best = phrase.notes[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const note of phrase.notes) {
    const distance = Math.abs(phraseNoteProgress(note, phrase) - progress);
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  return best;
}

function phraseNoteProgress(note: MelodyNote, phrase: PhraseSpan): number {
  const center = note.start + note.duration * 0.5;
  return clamp((center - phrase.start) / phrase.duration, 0, 1);
}

function relativePitchSeries(notes: MelodyNote[]): number[] {
  const first = notes[0];
  if (!first) return [];
  return notes.map((note) => note.pitch - first.pitch);
}

function intervalSeries(notes: MelodyNote[]): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < notes.length; index++) {
    intervals.push(notes[index]!.pitch - notes[index - 1]!.pitch);
  }
  return intervals;
}

function relativeCenterSeries(phrase: PhraseSpan): number[] {
  return phrase.notes.map((note) => phraseNoteProgress(note, phrase));
}

function relativeDurationSeries(phrase: PhraseSpan): number[] {
  return phrase.notes.map((note) => note.duration / phrase.duration);
}

function compareNumericSeries(
  left: number[],
  right: number[],
  tolerance: number,
  options: { octaveEquivalent?: boolean } = {},
): number {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 1 : 0;
  const count = Math.max(2, Math.min(8, Math.max(left.length, right.length)));
  const leftResampled = resampleSeries(left, count);
  const rightResampled = resampleSeries(right, count);
  let normalizedDistance = 0;

  for (let index = 0; index < count; index++) {
    const distance = options.octaveEquivalent
      ? octaveAwareDistance(leftResampled[index]!, rightResampled[index]!)
      : Math.abs(leftResampled[index]! - rightResampled[index]!);
    normalizedDistance += clamp(distance / tolerance, 0, 1);
  }

  return 1 - normalizedDistance / count;
}

function resampleSeries(values: number[], count: number): number[] {
  if (values.length === 0) return Array.from({ length: count }, () => 0);
  if (values.length === 1) return Array.from({ length: count }, () => values[0]!);
  return Array.from({ length: count }, (_, index) => {
    const position = (index / Math.max(1, count - 1)) * (values.length - 1);
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(values.length - 1, leftIndex + 1);
    const amount = position - leftIndex;
    return interpolate(values[leftIndex]!, values[rightIndex]!, amount);
  });
}

function octaveAwareDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  const octaveFolded = Math.abs(direct - 12 * Math.round(direct / 12));
  return Math.min(direct, octaveFolded);
}

function rankTonalCandidates(
  notes: MelodyNote[],
  corrected: CleanMelody,
): TonalCandidate[] {
  if (notes.length === 0) {
    return [
      {
        key: corrected.key,
        scale: corrected.scale,
        family: corrected.scale === "major" ? "major" : "minor",
        confidence: 1,
      },
    ];
  }

  const weights = buildPitchClassWeights(notes);
  const candidates: TonalCandidate[] = [];

  for (let root = 0; root < 12; root++) {
    const key = KEY_NAMES[root] ?? "C";
    const majorScore = scoreTonalCandidate(weights, root, MAJOR_INTERVALS);
    const minorScore = scoreTonalCandidate(weights, root, MINOR_INTERVALS);
    candidates.push(
      {
        key,
        scale: "major",
        family: "major",
        confidence: majorScore,
      },
      {
        key,
        scale: "minor",
        family: "minor",
        confidence: minorScore,
      },
      {
        key,
        scale: "dorian",
        family: "minor",
        confidence: scoreTonalCandidate(weights, root, DORIAN_INTERVALS) * 0.97,
      },
      {
        key,
        scale: "phrygian",
        family: "minor",
        confidence: scoreTonalCandidate(weights, root, PHRYGIAN_INTERVALS) * 0.94,
      },
      {
        key,
        scale: "pentatonic",
        family: majorScore >= minorScore ? "major" : "minor",
        confidence:
          Math.max(
            scoreTonalCandidate(weights, root, PENTATONIC_MAJOR_INTERVALS),
            scoreTonalCandidate(weights, root, PENTATONIC_MINOR_INTERVALS),
          ) * 0.92,
      },
    );
  }

  return candidates
    .map((candidate) =>
      candidate.key === corrected.key && candidate.scale === corrected.scale
        ? { ...candidate, confidence: candidate.confidence + 0.08 }
        : candidate,
    )
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((candidate, index, list) => ({
      ...candidate,
      confidence: normalizeTonalConfidence(candidate.confidence, list[0]?.confidence ?? 1),
    }));
}

function chooseLockedTonalCandidate(
  candidates: TonalCandidate[],
  corrected: CleanMelody,
): TonalCandidate {
  const correctedMatch = candidates.find(
    (candidate) =>
      candidate.key === corrected.key && candidate.scale === corrected.scale,
  );
  return correctedMatch ?? candidates[0] ?? {
    key: corrected.key,
    scale: corrected.scale,
    family: corrected.scale === "major" ? "major" : "minor",
    confidence: 1,
  };
}

function buildPitchClassWeights(notes: MelodyNote[]): number[] {
  const weights = new Array(12).fill(0);
  const sorted = [...notes].sort((a, b) => a.start - b.start);

  sorted.forEach((note, index) => {
    const anchorWeight = intentTonalAnchorWeight(sorted, index);
    weights[mod12(note.pitch)] +=
      Math.max(0.05, note.duration) *
      Math.max(0.1, note.velocity) *
      Math.max(0.1, note.confidence) *
      anchorWeight;
  });

  return weights;
}

function intentTonalAnchorWeight(notes: MelodyNote[], index: number): number {
  const note = notes[index];
  if (!note) return 1;
  if (index === 0) return openingAnchorWeight(notes, { stableConfidence: 0.86 });
  if (index === notes.length - 1) return closingAnchorWeight(notes);
  return note.duration >= 0.42 || note.confidence >= 0.82 ? 1.3 : 1;
}

function scoreTonalCandidate(
  weights: number[],
  root: number,
  intervals: readonly number[],
): number {
  const scalePcs = new Set(intervals.map((interval) => mod12(root + interval)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  let score = 0;
  for (let pc = 0; pc < 12; pc++) {
    const weight = weights[pc] ?? 0;
    score += scalePcs.has(pc) ? weight : -weight * 0.42;
  }

  return score / total;
}

function normalizeTonalConfidence(score: number, bestScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(bestScore)) return 0;
  const shifted = 0.5 + score * 0.5;
  const relative = bestScore > 0 ? score / bestScore : shifted;
  return clamp((shifted * 0.65) + (relative * 0.35), 0, 1);
}

function collectStableAnchorPitches(notes: MelodyNote[]): number[] {
  return notes
    .filter((note) => note.duration >= 0.32 || note.confidence >= 0.82)
    .sort((a, b) => b.duration * b.confidence - a.duration * a.confidence)
    .slice(0, 6)
    .map((note) => note.pitch);
}

function collectPhraseEndingPitches(melody: CleanMelody): number[] {
  const phrases = detectPhrases(melody.notes, melody.bpm);
  if (phrases.length === 0) {
    const last = melody.notes.at(-1);
    return last ? [last.pitch] : [];
  }
  return phrases
    .map((phrase) => phrase.notes.at(-1)?.pitch)
    .filter((pitch): pitch is number => typeof pitch === "number");
}

function scoreIntentConfidence(
  notes: MelodyNote[],
  diagnostics: Partial<TranscriptionDiagnostics> | undefined,
  contourStats: ReturnType<typeof summarizeContour>,
): number {
  if (notes.length === 0) return 0;
  const avgNoteConfidence =
    notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length;
  const voicedScore =
    typeof diagnostics?.voicedRatio === "number"
      ? clamp(diagnostics.voicedRatio, 0, 1)
      : contourStats.voicedFrameCount > 0
        ? clamp(contourStats.voicedConfidence, 0, 1)
        : 0.78;
  const snrScore =
    typeof diagnostics?.snr === "number"
      ? clamp((diagnostics.snr - 6) / 18, 0, 1)
      : 0.74;
  const stabilityPenalty =
    contourStats.lowConfidenceVoicedRatio * 0.18 +
    contourStats.unstableVoicedJumpRatio * 0.22 +
    contourStats.voicedGapRatio * 0.14;

  return clamp(
    avgNoteConfidence * 0.42 +
      voicedScore * 0.26 +
      snrScore * 0.2 +
      Math.min(1, notes.length / 5) * 0.12 -
      stabilityPenalty,
    0,
    1,
  );
}

function buildCorrectionPolicy(
  locked: TonalCandidate,
  confidence: number,
  musicalityBias: number,
  diagnostics: Partial<TranscriptionDiagnostics> | undefined,
  contourStats: ReturnType<typeof summarizeContour>,
): MelodyIntentProfile["correctionPolicy"] {
  const root = KEY_NAMES.indexOf(locked.key as (typeof KEY_NAMES)[number]);
  const scalePcs =
    root >= 0
      ? Array.from(getScalePitchClasses(root, locked.scale)).sort((a, b) => a - b)
      : [];
  const weakInput =
    confidence < 0.58 ||
    musicalityBias >= 0.58 ||
    (typeof diagnostics?.snr === "number" && diagnostics.snr < 10) ||
    contourStats.lowConfidenceVoicedRatio >= 0.3;

  return {
    allowedPitchClasses: scalePcs,
    correctionStrength: weakInput ? 0.82 : 0.52,
    retuneSpeed: weakInput ? 0.78 : 0.4,
    timingQuantize: weakInput ? 0.6 : 0.3,
    vibratoTolerance: weakInput ? 0.2 : 0.34,
    formantPolicy: "preserve",
  };
}

function scoreIntentMatch(
  notes: MelodyNote[],
  locked: TonalCandidate,
  confidence: number,
  contourStats: ReturnType<typeof summarizeContour>,
): number {
  if (notes.length === 0) return 0;
  const keyRoot = KEY_NAMES.indexOf(locked.key as (typeof KEY_NAMES)[number]);
  const scalePcs = keyRoot >= 0 ? getScalePitchClasses(keyRoot, locked.scale) : null;
  const cadencePcs = keyRoot >= 0 ? getCadenceTargets(keyRoot, locked.scale) : [];
  const totalWeight = notes.reduce((sum, note) => sum + intentNoteWeight(note), 0);
  const scaleFitScore =
    scalePcs && totalWeight > 0
      ? notes.reduce(
          (sum, note) =>
            sum + intentNoteWeight(note) * (scalePcs.has(mod12(note.pitch)) ? 1 : 0),
          0,
        ) / totalWeight
      : 0.58;
  const structuralNotes = notes.filter(
    (note, index) =>
      index === 0 ||
      index === notes.length - 1 ||
      note.duration >= 0.45 ||
      note.confidence >= 0.82,
  );
  const structuralWeight = structuralNotes.reduce(
    (sum, note) => sum + intentNoteWeight(note),
    0,
  );
  const structuralFitScore =
    scalePcs && structuralWeight > 0
      ? structuralNotes.reduce((sum, note) => {
          const pc = mod12(note.pitch);
          if (!scalePcs.has(pc)) return sum;
          const cadenceBonus = cadencePcs.includes(pc) ? 0.12 : 0;
          return sum + intentNoteWeight(note) * Math.min(1, 0.88 + cadenceBonus);
        }, 0) / structuralWeight
      : scaleFitScore;
  const continuityScore =
    1 -
    clamp(
      contourStats.lowConfidenceVoicedRatio * 0.45 +
        contourStats.unstableVoicedJumpRatio * 0.35 +
        contourStats.voicedGapRatio * 0.2,
      0,
      1,
    );

  return clamp(
    confidence * 0.42 +
      scaleFitScore * 0.28 +
      structuralFitScore * 0.14 +
      continuityScore * 0.16,
    0,
    1,
  );
}

function intentNoteWeight(note: MelodyNote): number {
  const structuralWeight = note.duration >= 0.45 || note.confidence >= 0.82 ? 1.25 : 1;
  return (
    Math.max(0.05, note.duration) *
    Math.max(0.1, note.confidence) *
    structuralWeight
  );
}

function scoreMusicalityBias(
  confidence: number,
  diagnostics: Partial<TranscriptionDiagnostics> | undefined,
  contourStats: ReturnType<typeof summarizeContour>,
): number {
  const noisy =
    (typeof diagnostics?.snr === "number" && diagnostics.snr < 12 ? 0.24 : 0) +
    (typeof diagnostics?.voicedRatio === "number" && diagnostics.voicedRatio < 0.8 ? 0.2 : 0) +
    contourStats.lowConfidenceVoicedRatio * 0.2 +
    contourStats.unstableVoicedJumpRatio * 0.2 +
    contourStats.voicedGapRatio * 0.12;
  const clarity = clamp(confidence * 0.6 + (1 - noisy) * 0.4, 0, 1);
  return clamp(1 - clarity, 0, 1);
}

function summarizeContour(contour?: TranscriptionContour): {
  voicedFrameCount: number;
  voicedConfidence: number;
  lowConfidenceVoicedRatio: number;
  unstableVoicedJumpRatio: number;
  voicedGapRatio: number;
} {
  if (!contour || contour.timestamps.length === 0) {
    return {
      voicedFrameCount: 0,
      voicedConfidence: 1,
      lowConfidenceVoicedRatio: 0,
      unstableVoicedJumpRatio: 0,
      voicedGapRatio: 0,
    };
  }

  const frameCount = Math.min(
    contour.timestamps.length,
    contour.pitchHz.length,
    contour.confidence.length,
    contour.voiced.length,
  );
  if (frameCount === 0) {
    return {
      voicedFrameCount: 0,
      voicedConfidence: 1,
      lowConfidenceVoicedRatio: 0,
      unstableVoicedJumpRatio: 0,
      voicedGapRatio: 0,
    };
  }

  const voicedIndices: number[] = [];
  let lowConfidenceVoiced = 0;
  let voicedGaps = 0;
  let previousVoicedIndex: number | null = null;

  for (let index = 0; index < frameCount; index++) {
    if (!contour.voiced[index]) continue;
    voicedIndices.push(index);
    if ((contour.confidence[index] ?? 0) < 0.68) {
      lowConfidenceVoiced += 1;
    }
    if (previousVoicedIndex !== null && index - previousVoicedIndex > 1) {
      voicedGaps += 1;
    }
    previousVoicedIndex = index;
  }

  if (voicedIndices.length === 0) {
    return {
      voicedFrameCount: 0,
      voicedConfidence: 0,
      lowConfidenceVoicedRatio: 1,
      unstableVoicedJumpRatio: 0,
      voicedGapRatio: 1,
    };
  }

  const voicedConfidence =
    voicedIndices.reduce((sum, index) => sum + (contour.confidence[index] ?? 0), 0) /
    voicedIndices.length;

  let unstableJumps = 0;
  let jumpPairs = 0;
  for (let i = 1; i < voicedIndices.length; i++) {
    const prevIndex = voicedIndices[i - 1]!;
    const index = voicedIndices[i]!;
    const prevPitch = contour.pitchHz[prevIndex];
    const pitch = contour.pitchHz[index];
    if (prevPitch === null || pitch === null) continue;
    jumpPairs += 1;
    const semitoneDelta = Math.abs(12 * Math.log2(pitch / prevPitch));
    const contiguous = index - prevIndex === 1;
    if (contiguous && semitoneDelta >= 2.75) {
      unstableJumps += 1;
    }
  }

  return {
    voicedFrameCount: voicedIndices.length,
    voicedConfidence,
    lowConfidenceVoicedRatio: lowConfidenceVoiced / voicedIndices.length,
    unstableVoicedJumpRatio: jumpPairs > 0 ? unstableJumps / jumpPairs : 0,
    voicedGapRatio:
      voicedIndices.length > 1 ? voicedGaps / (voicedIndices.length - 1) : 0,
  };
}

function clampRepairBias(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function buildMusicalMelody(
  corrected: CleanMelody,
  melodyIntent?: MelodyIntentProfile,
): CleanMelody {
  if (corrected.notes.length === 0) return corrected;

  const beat = 60 / corrected.bpm;
  const compensated = compensatePitchWeakStableRhythm(
    corrected.notes,
    corrected.key,
    corrected.scale,
    beat,
  );
  const structural = prioritizeStructuralNotes(
    compensated,
    corrected.key,
    corrected.scale,
    beat,
  );
  const compacted = compactOrnamentalBursts(structural, beat);
  const deFragmented = filterSpuriousMusicalFragments(compacted, beat);
  const urgentStabilized = stabilizeUrgentTiming(deFragmented, beat);
  const relocatedBase = relocateWeakBeatNotes(urgentStabilized, beat);
  const phrases = detectPhrases(relocatedBase, corrected.bpm);
  if (phrases.length <= 1) {
    const resolved = strengthenPhraseResolutions(
      relocatedBase,
      corrected.key,
      corrected.scale,
      beat,
    );
    const held = applyCadenceHold(resolved, beat, 0, melodyIntent);
    const songlike = finalizeSonglikeMusicalMelody(
      held,
      corrected,
      0,
      melodyIntent,
    );
    return {
      ...corrected,
      notes: songlike,
      duration: melodyDuration(songlike),
      contour: estimateContour(songlike),
    };
  }

  const notes = relocatedBase.map((note) => ({ ...note }));

  for (let phraseIndex = 0; phraseIndex < phrases.length - 1; phraseIndex++) {
    const currentPhrase = phrases[phraseIndex]!;
    const nextPhrase = phrases[phraseIndex + 1]!;
    const gap = nextPhrase.start - currentPhrase.end;
    const minimumBreath = melodyIntent?.rhythmPolicy.phraseBreakSeconds ?? beat * 0.45;
    const maximumBreath =
      melodyIntent?.rhythmPolicy.sentenceSeparationSeconds ?? beat * 0.9;
    if (gap >= minimumBreath || gap <= beat * 0.08) continue;

    const extraGap = Math.min(maximumBreath, minimumBreath) - gap;
    if (extraGap <= 0) continue;

    const phraseStart = nextPhrase.notes[0]!.start;
    for (const note of notes) {
      if (note.start >= phraseStart) {
        note.start += extraGap;
      }
    }
  }

  const relocated = relocateWeakBeatNotes(notes, beat);
  const resolved = strengthenPhraseResolutions(
    relocated,
    corrected.key,
    corrected.scale,
    beat,
  );
  const held = applyCadenceHold(resolved, beat, 0, melodyIntent);
  const songlike = finalizeSonglikeMusicalMelody(
    held,
    corrected,
    0,
    melodyIntent,
  );
  return {
    ...corrected,
    notes: songlike,
    duration: melodyDuration(songlike),
    contour: estimateContour(songlike),
  };
}

function buildMusicalMelodyWithRepair(
  corrected: CleanMelody,
  diagnostics?: Partial<TranscriptionDiagnostics>,
  contour?: TranscriptionContour,
  melodyIntent?: MelodyIntentProfile,
): CleanMelody {
  const baseMusical = buildMusicalMelody(corrected, melodyIntent);
  const repairSeverity = computeAcceptanceRepairSeverity(
    corrected,
    diagnostics,
    contour,
    baseMusical,
    melodyIntent,
  );

  if (repairSeverity < 0.22) {
    return baseMusical;
  }

  const repaired = buildAcceptanceRepairMelody(corrected, repairSeverity, melodyIntent);
  const baseScore = scoreMelodyAcceptance(baseMusical);
  const repairedScore = scoreMelodyAcceptance(repaired);

  if (
    repairedScore.score >= baseScore.score + 0.035 ||
    repairedScore.musicFeelScore >= baseScore.musicFeelScore + 0.05 ||
    repairedScore.excessiveHoldRatio <= baseScore.excessiveHoldRatio - 0.08 ||
    baseScore.excessiveHoldRatio >= 0.34
  ) {
    return repaired;
  }

  return repairSeverity >= 0.52 ? repaired : baseMusical;
}

function buildAcceptanceRepairMelody(
  corrected: CleanMelody,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): CleanMelody {
  if (corrected.notes.length === 0) return corrected;

  const beat = 60 / corrected.bpm;
  const compensated = compensatePitchWeakStableRhythm(
    corrected.notes,
    corrected.key,
    corrected.scale,
    beat,
  );
  const structural = prioritizeStructuralNotes(
    compensated,
    corrected.key,
    corrected.scale,
    beat,
  );
  const compacted = compactOrnamentalBursts(structural, beat);
  const deFragmented = filterSpuriousMusicalFragments(compacted, beat);
  const urgentStabilized = stabilizeUrgentTiming(deFragmented, beat);
  const disciplined = disciplineInteriorDurations(urgentStabilized, beat, repairSeverity, melodyIntent);
  const skeletonAligned = alignRhythmicSkeleton(disciplined, beat, repairSeverity, melodyIntent);
  const regularized = regularizeTimingContours(skeletonAligned, beat, repairSeverity);
  const relocated = relocateWeakBeatNotes(regularized, beat);
  const resolved = strengthenPhraseResolutions(
    relocated,
    corrected.key,
    corrected.scale,
    beat,
  );
  const held = applyCadenceHold(resolved, beat, repairSeverity, melodyIntent);
  const songlike = finalizeSonglikeMusicalMelody(
    held,
    corrected,
    repairSeverity,
    melodyIntent,
  );

  return {
    ...corrected,
    notes: songlike,
    duration: melodyDuration(songlike),
    contour: estimateContour(songlike),
  };
}

function alignMelodyToOwnTonalCenter(melody: CleanMelody): CleanMelody {
  const root = KEY_NAMES.indexOf(melody.key as (typeof KEY_NAMES)[number]);
  if (melody.notes.length === 0 || root < 0) return melody;

  const scalePcs = getScalePitchClasses(root, melody.scale);
  const cadencePcs = getCadenceTargets(root, melody.scale);
  const notes = melody.notes.map((note, index) => {
    const notePc = mod12(note.pitch);
    if (
      !scalePcs.has(notePc) &&
      shouldPreserveExpressiveNonScaleTone(melody.notes, index, scalePcs, cadencePcs)
    ) {
      return { ...note };
    }
    const snapped = nearestScalePitch(note.pitch, scalePcs);
    const isFinal = index === melody.notes.length - 1;
    const targetPitch =
      isFinal && cadencePcs.length > 0
        ? nearestCadencePitch(snapped, cadencePcs)
        : snapped;
    return {
      ...note,
      pitch: targetPitch,
    };
  });

  return {
    ...melody,
    notes,
    duration: melodyDuration(notes),
    contour: estimateContour(notes),
  };
}

function finalizeSonglikeMusicalMelody(
  notes: MelodyNote[],
  source: CleanMelody,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  if (notes.length < 2) return notes.map((note) => ({ ...note }));

  const beat = 60 / source.bpm;
  const root = KEY_NAMES.indexOf(source.key as (typeof KEY_NAMES)[number]);
  if (root < 0) return notes.map((note) => ({ ...note }));

  const scalePcs = getScalePitchClasses(root, source.scale);
  const cadencePcs =
    melodyIntent?.intervalPolicy.cadencePitchClasses.length
      ? melodyIntent.intervalPolicy.cadencePitchClasses
      : getCadenceTargets(root, source.scale);
  const strength = clamp(
    0.28 +
      (melodyIntent?.musicalityBias ?? 0.34) * 0.42 +
      repairSeverity * 0.32,
    0.28,
    0.86,
  );
  if (shouldUseSoothingRewrite(source, repairSeverity, melodyIntent)) {
    const rewritten = buildSoothingMusicalRewrite(source, scalePcs, cadencePcs, beat, melodyIntent);
    return preserveIntentTrace(rewritten, source, scalePcs, cadencePcs, beat, melodyIntent);
  }

  const pitched = snapSonglikePitches(
    notes,
    scalePcs,
    cadencePcs,
    beat,
    strength,
    melodyIntent,
  );
  const smoothed = smoothAwkwardMusicalLeaps(
    pitched,
    scalePcs,
    cadencePcs,
    strength,
    melodyIntent,
  );
  const shaped = shapeSonglikePhraseArcs(
    smoothed,
    scalePcs,
    cadencePcs,
    beat,
    strength,
    melodyIntent,
  );
  const timed = regularizeSonglikeTiming(
    shaped,
    source,
    beat,
    strength,
    repairSeverity,
    melodyIntent,
  );
  const traced = preserveIntentTrace(timed, source, scalePcs, cadencePcs, beat, melodyIntent);
  return extendFinalNoteToMinimumDuration(traced, source.duration);
}

function shouldUseSoothingRewrite(
  source: CleanMelody,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): boolean {
  if (source.notes.length < 4) return false;

  const durations = source.notes.map((note) => note.duration);
  const medianDuration = Math.max(1e-6, median(durations));
  const shortRatio =
    source.notes.filter((note) => note.duration <= Math.max(0.16, medianDuration * 0.58)).length /
    source.notes.length;
  const avgConfidence =
    source.notes.reduce((sum, note) => sum + note.confidence, 0) / source.notes.length;
  const awkwardLeapCount = countAwkwardIntervals(source.notes);
  const weakIntent = (melodyIntent?.confidence ?? 1) < 0.36;
  const highMusicalityNeed = (melodyIntent?.musicalityBias ?? 0) >= 0.68;

  return (
    (weakIntent && highMusicalityNeed) ||
    (highMusicalityNeed && repairSeverity >= 0.42) ||
    (highMusicalityNeed && (shortRatio >= 0.36 || awkwardLeapCount >= 1 || avgConfidence < 0.72)) ||
    (repairSeverity >= 0.68 && (shortRatio >= 0.42 || awkwardLeapCount >= 2)) ||
    (avgConfidence < 0.58 && awkwardLeapCount >= 2 && source.notes.length >= 5)
  );
}

function buildSoothingMusicalRewrite(
  source: CleanMelody,
  scalePcs: Set<number>,
  cadencePcs: number[],
  beat: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  const sourceNotes = source.notes;
  if (sourceNotes.length === 0) return [];

  const totalDuration = Math.max(
    source.duration,
    sourceNotes.at(-1)!.start + sourceNotes.at(-1)!.duration,
    beat * 2.2,
  );
  const desiredCount = Math.round(clamp(
    Math.round(totalDuration / Math.max(beat * 0.52, 0.26)),
    4,
    Math.min(8, Math.max(5, sourceNotes.length + 1)),
  ));
  const count = Math.max(4, desiredCount);
  const firstPitch = nearestScalePitch(sourceNotes[0]!.pitch, scalePcs);
  const sourceHigh = Math.max(...sourceNotes.map((note) => note.pitch));
  const sourceLow = Math.min(...sourceNotes.map((note) => note.pitch));
  const contour = source.contour;
  const lastSourcePitch = sourceNotes.at(-1)!.pitch;
  const cadencePitch = nearestCadencePitch(lastSourcePitch, cadencePcs);
  const arcHeight = clamp(sourceHigh - sourceLow, 3, 7);
  const apexPitch =
    contour === "falling"
      ? nearestScalePitch(firstPitch - Math.min(5, arcHeight), scalePcs)
      : nearestScalePitch(firstPitch + arcHeight, scalePcs);
  const phraseEndPitch =
    Math.abs(cadencePitch - lastSourcePitch) <= 5
      ? cadencePitch
      : nearestCadencePitch(firstPitch, cadencePcs);
  const signaturePc = chooseSignaturePitchClass(sourceNotes, melodyIntent);
  const apexPosition =
    contour === "falling"
      ? 0.28
      : contour === "rising"
        ? 0.72
        : 0.58;
  const motifIntervals = deriveSonglikeMotifIntervals(sourceNotes, contour);
  const notes: MelodyNote[] = [];

  for (let index = 0; index < count; index++) {
    const progress = count === 1 ? 1 : index / (count - 1);
    const sourceShadow = sourceNoteAtProgress(sourceNotes, progress);
    const arcTarget =
      progress <= apexPosition
        ? interpolate(firstPitch, apexPitch, progress / Math.max(apexPosition, 0.001))
        : interpolate(apexPitch, phraseEndPitch, (progress - apexPosition) / Math.max(1 - apexPosition, 0.001));
    const shadowPitch = nearestScalePitch(sourceShadow.pitch, scalePcs);
    const previousPitch = notes.at(-1)?.pitch ?? firstPitch;
    const motifTarget = nearestScalePitch(
      previousPitch + motifIntervals[(index - 1) % motifIntervals.length]!,
      scalePcs,
    );
    const isLast = index === count - 1;
    const isApex = Math.abs(progress - apexPosition) <= 1 / Math.max(2, count - 1);
    const edge = index === 0 || isLast;
    const shadowWeight = edge ? 0.64 : sourceShadow.confidence >= 0.78 ? 0.34 : 0.24;
    const motifWeight = edge ? 0 : 0.22;
    let pitch = edge
      ? index === 0
        ? firstPitch
        : phraseEndPitch
      : nearestScalePitch(
          Math.round(
            arcTarget * (1 - shadowWeight - motifWeight) +
              shadowPitch * shadowWeight +
              motifTarget * motifWeight,
          ),
          scalePcs,
        );

    if (!edge && signaturePc !== null && (index === 1 || (count >= 6 && index === count - 3))) {
      const signaturePitch = nearestPitchForClass(pitch, signaturePc);
      if (Math.abs(signaturePitch - pitch) <= 4) {
        pitch = signaturePitch;
      }
    }

    const start = computeSignatureStart(sourceNotes, index, count, totalDuration, beat);
    const duration = computeSignatureDuration(
      sourceShadow,
      index,
      count,
      beat,
      totalDuration,
      start,
      isApex,
    );

    notes.push({
      pitch,
      start: roundTo(start, 3),
      duration: roundTo(duration, 3),
      velocity: clamp(0.7 + (isApex ? 0.07 : 0), 0.05, 1),
      confidence: 0.86,
    });
  }

  const ordered = enforceReadableMelodySpacing(notes, beat);
  const arced = enforceSignaturePhraseArc(
    ordered,
    scalePcs,
    cadencePcs,
    apexPosition,
    contour,
  );
  const smoothed = smoothAwkwardMusicalLeaps(
    arced,
    scalePcs,
    cadencePcs,
    0.78,
    melodyIntent,
  );
  const shaped = shapeSonglikePhraseArcs(
    smoothed,
    scalePcs,
    cadencePcs,
    beat,
    0.78,
    melodyIntent,
  );
  const final = shaped.at(-1);
  if (final) {
    final.pitch = nearestCadencePitch(final.pitch, cadencePcs);
    final.duration = Math.max(final.duration, beat * 1.05);
  }
  return extendFinalNoteToMinimumDuration(shaped, totalDuration);
}

function sourceNoteAtProgress(notes: MelodyNote[], progress: number): MelodyNote {
  if (notes.length === 1) return notes[0]!;

  const duration = Math.max(melodyDuration(notes), 1e-6);
  const target = progress * duration;
  return notes.reduce((best, note) => {
    const bestCenter = best.start + best.duration * 0.5;
    const noteCenter = note.start + note.duration * 0.5;
    return Math.abs(noteCenter - target) < Math.abs(bestCenter - target) ? note : best;
  }, notes[0]!);
}

function computeSignatureStart(
  sourceNotes: MelodyNote[],
  index: number,
  count: number,
  totalDuration: number,
  beat: number,
): number {
  if (index === 0) return Math.min(sourceNotes[0]!.start, beat * 0.08);

  const progress = count === 1 ? 1 : index / (count - 1);
  const evenStart = progress * totalDuration;
  const shadow = sourceNoteAtProgress(sourceNotes, progress);
  const shadowStart = clamp(shadow.start, 0, totalDuration);
  const blend = index === count - 1 ? 0.24 : 0.36;
  return Math.max(0, evenStart * (1 - blend) + shadowStart * blend);
}

function computeSignatureDuration(
  sourceShadow: MelodyNote,
  index: number,
  count: number,
  beat: number,
  totalDuration: number,
  start: number,
  isApex: boolean,
): number {
  const isLast = index === count - 1;
  const phraseCell = totalDuration / Math.max(count, 1);
  const sourceDuration = clamp(sourceShadow.duration, beat * 0.28, beat * 1.3);
  const target = isLast
    ? Math.max(beat * 0.95, phraseCell * 0.95)
    : isApex
      ? Math.max(beat * 0.66, phraseCell * 0.82)
      : Math.max(beat * 0.42, phraseCell * 0.68);
  const blended = target * 0.7 + sourceDuration * 0.3;
  const remaining = Math.max(beat * 0.35, totalDuration - start);
  return clamp(blended, beat * 0.28, remaining);
}

function enforceReadableMelodySpacing(notes: MelodyNote[], beat: number): MelodyNote[] {
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start);
  const minGap = Math.max(0.012, beat * 0.025);
  const minDuration = Math.max(0.08, beat * 0.2);

  for (let index = 0; index < sorted.length - 1; index++) {
    const note = sorted[index]!;
    const next = sorted[index + 1]!;
    if (next.start <= note.start + minDuration + minGap) {
      next.start = roundTo(note.start + minDuration + minGap, 3);
    }
    const maxDuration = next.start - note.start - minGap;
    note.duration = roundTo(clamp(note.duration, minDuration, Math.max(minDuration, maxDuration)), 3);
  }

  const final = sorted.at(-1);
  if (final) {
    final.duration = roundTo(Math.max(final.duration, beat * 0.62), 3);
  }

  return sorted;
}

function enforceSignaturePhraseArc(
  notes: MelodyNote[],
  scalePcs: Set<number>,
  cadencePcs: number[],
  apexPosition: number,
  contour: CleanMelody["contour"],
): MelodyNote[] {
  if (notes.length < 4) return notes.map((note) => ({ ...note }));

  const arced = notes.map((note) => ({ ...note }));
  const apexIndex = clamp(Math.round((arced.length - 1) * apexPosition), 1, arced.length - 2);

  for (let index = 1; index < arced.length - 1; index++) {
    const prev = arced[index - 1]!;
    const note = arced[index]!;
    const towardApex = index <= apexIndex;
    const desiredDirection =
      contour === "falling"
        ? towardApex
          ? -1
          : 1
        : towardApex
          ? 1
          : -1;
    const step = note.pitch - prev.pitch;
    const wrongDirection = step !== 0 && Math.sign(step) !== desiredDirection;
    const tooLarge = Math.abs(step) > 5;

    if (!wrongDirection && !tooLarge) continue;

    const target = prev.pitch + desiredDirection * (towardApex ? 2 : 1);
    const candidate = nearestScalePitch(target, scalePcs);
    if (Math.abs(candidate - note.pitch) <= 5) {
      note.pitch = candidate;
    }
  }

  const final = arced.at(-1);
  if (final && cadencePcs.length > 0) {
    final.pitch = nearestCadencePitch(final.pitch, cadencePcs);
  }

  return arced;
}

function chooseSignaturePitchClass(
  sourceNotes: MelodyNote[],
  melodyIntent?: MelodyIntentProfile,
): number | null {
  const weights = new Map<number, number>();
  for (const note of sourceNotes) {
    const pc = mod12(note.pitch);
    weights.set(pc, (weights.get(pc) ?? 0) + note.duration * Math.max(0.2, note.confidence));
  }
  for (const pc of melodyIntent?.intervalPolicy.anchorPitchClasses ?? []) {
    weights.set(pc, (weights.get(pc) ?? 0) + 0.6);
  }

  let bestPc: number | null = null;
  let bestWeight = 0;
  for (const [pc, weight] of weights) {
    if (weight > bestWeight) {
      bestPc = pc;
      bestWeight = weight;
    }
  }

  return bestWeight >= 0.42 ? bestPc : null;
}

function deriveSonglikeMotifIntervals(
  sourceNotes: MelodyNote[],
  contour: CleanMelody["contour"],
): number[] {
  const intervals: number[] = [];
  for (let index = 1; index < sourceNotes.length && intervals.length < 3; index++) {
    const raw = sourceNotes[index]!.pitch - sourceNotes[index - 1]!.pitch;
    if (raw === 0) {
      intervals.push(0);
      continue;
    }
    intervals.push(Math.sign(raw) * clamp(Math.round(Math.abs(raw) * 0.45), 1, 3));
  }

  if (intervals.length > 0) return intervals;
  if (contour === "falling") return [-2, -1, 2];
  if (contour === "rising") return [2, 1, -1];
  return [2, -1, 1];
}

function preserveIntentTrace(
  notes: MelodyNote[],
  source: CleanMelody,
  scalePcs: Set<number>,
  cadencePcs: number[],
  beat: number,
  melodyIntent?: MelodyIntentProfile,
  options: { cadenceEndings?: boolean } = {},
): MelodyNote[] {
  if (notes.length === 0 || source.notes.length === 0) return notes.map((note) => ({ ...note }));

  const skeleton = melodyIntent?.skeleton.notes.length
    ? melodyIntent.skeleton
    : source;
  const anchors = collectIntentTraceAnchors(skeleton, source, beat, melodyIntent);
  if (anchors.length === 0) return notes.map((note) => ({ ...note }));

  const traced = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start);
  const claimed = new Set<number>();
  const timingStrength = clamp(
    0.34 + (melodyIntent?.intentMatch ?? 0.62) * 0.22 - (melodyIntent?.musicalityBias ?? 0.34) * 0.08,
    0.22,
    0.54,
  );

  for (const anchor of anchors) {
    const match = findNearestIntentTraceNote(traced, anchor, beat, claimed);
    if (match === null) continue;

    const note = traced[match]!;
    claimed.add(match);

    const pitchTarget = pitchTargetForIntentAnchor(
      note.pitch,
      anchor,
      scalePcs,
      cadencePcs,
      options,
    );
    if (Math.abs(pitchTarget - note.pitch) <= anchor.maxPitchMove) {
      note.pitch = pitchTarget;
    }

    const startDelta = anchor.start - note.start;
    if (Math.abs(startDelta) <= anchor.maxStartMove) {
      note.start = roundTo(Math.max(0, note.start + startDelta * timingStrength), 3);
    }

    const durationBlend = anchor.kind === "ending" ? 0.5 : 0.32;
    const targetDuration =
      anchor.kind === "ending"
        ? Math.max(note.duration, Math.min(anchor.duration, beat * 1.45))
        : anchor.duration;
    note.duration = roundTo(
      clamp(
        note.duration + (targetDuration - note.duration) * durationBlend,
        Math.max(0.05, beat * 0.18),
        anchor.kind === "ending" ? Math.max(note.duration, beat * 1.45) : Math.max(note.duration, beat * 1.1),
      ),
      3,
    );
    note.velocity = clamp(Math.max(note.velocity, anchor.velocity * 0.94), 0.05, 1);
    note.confidence = clamp(Math.max(note.confidence, anchor.confidence * 0.92, 0.82), 0, 1);
  }

  return preventTraceOverlaps(traced, beat);
}

type IntentTraceAnchor = {
  kind: "edge" | "ending" | "strong" | "repeat" | "hold";
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  confidence: number;
  weight: number;
  maxPitchMove: number;
  maxStartMove: number;
};

function collectIntentTraceAnchors(
  skeleton: CleanMelody,
  source: CleanMelody,
  beat: number,
  melodyIntent?: MelodyIntentProfile,
): IntentTraceAnchor[] {
  const notes = skeleton.notes.length ? skeleton.notes : source.notes;
  if (notes.length === 0) return [];

  const repeatedPcs = buildRepeatedPitchClasses(notes);
  const phraseEndingStarts = new Set(
    detectPhrases(notes, skeleton.bpm || source.bpm)
      .map((phrase) => phrase.notes.at(-1)?.start)
      .filter((start): start is number => typeof start === "number")
      .map((start) => roundTo(start, 3)),
  );
  const anchorPcs = new Set(melodyIntent?.intervalPolicy.anchorPitchClasses ?? []);

  return notes
    .map((note, index): IntentTraceAnchor | null => {
      const pc = mod12(note.pitch);
      const edge = index === 0 || index === notes.length - 1;
      const phraseEnding = phraseEndingStarts.has(roundTo(note.start, 3));
      const strongBeat = distanceToNearestGrid(note.start, beat / 2) <= beat * 0.1;
      const longHold = note.duration >= beat * 0.62;
      const repeated = repeatedPcs.has(pc);
      const intentAnchor = anchorPcs.has(pc);
      const highConfidence = note.confidence >= 0.82;

      if (
        !edge &&
        !phraseEnding &&
        !strongBeat &&
        !longHold &&
        !repeated &&
        !intentAnchor &&
        !highConfidence
      ) {
        return null;
      }

      const kind =
        phraseEnding ? "ending" :
        edge ? "edge" :
        repeated ? "repeat" :
        longHold ? "hold" :
        "strong";
      const weight =
        (edge ? 2.2 : 0) +
        (phraseEnding ? 1.8 : 0) +
        (repeated ? 1.2 : 0) +
        (strongBeat ? 0.9 : 0) +
        (longHold ? 0.8 : 0) +
        (intentAnchor ? 0.8 : 0) +
        note.confidence;

      return {
        kind,
        pitch: note.pitch,
        start: note.start,
        duration: note.duration,
        velocity: note.velocity,
        confidence: note.confidence,
        weight,
        maxPitchMove: edge || phraseEnding ? 5 : repeated || intentAnchor ? 3 : 2,
        maxStartMove: edge ? beat * 0.45 : phraseEnding ? beat * 0.5 : beat * 0.32,
      };
    })
    .filter((anchor): anchor is IntentTraceAnchor => anchor !== null)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.min(notes.length, Math.max(4, Math.ceil(notes.length * 0.55))));
}

function findNearestIntentTraceNote(
  notes: MelodyNote[],
  anchor: IntentTraceAnchor,
  beat: number,
  claimed: Set<number>,
): number | null {
  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const window = anchor.kind === "edge" || anchor.kind === "ending" ? beat * 1.4 : beat * 0.9;

  for (let index = 0; index < notes.length; index++) {
    if (claimed.has(index)) continue;
    const note = notes[index]!;
    const startDistance = Math.abs(note.start - anchor.start);
    if (startDistance > window) continue;

    const pitchDistance = Math.abs(note.pitch - anchor.pitch);
    const score =
      startDistance / Math.max(beat, 0.001) +
      pitchDistance * 0.18 -
      (anchor.kind === "edge" && (index === 0 || index === notes.length - 1) ? 0.35 : 0);

    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function pitchTargetForIntentAnchor(
  currentPitch: number,
  anchor: IntentTraceAnchor,
  scalePcs: Set<number>,
  cadencePcs: number[],
  options: { cadenceEndings?: boolean } = {},
): number {
  const sourcePc = mod12(anchor.pitch);
  if (!scalePcs.has(sourcePc) && anchor.kind !== "ending") {
    return nearestScalePitch(currentPitch, scalePcs);
  }

  const stablePitch =
    scalePcs.has(sourcePc) || anchor.kind === "edge" || anchor.kind === "repeat"
      ? nearestPitchForClass(currentPitch, sourcePc)
      : nearestScalePitch(anchor.pitch, scalePcs);
  if (anchor.kind !== "ending" || cadencePcs.length === 0 || options.cadenceEndings === false) {
    return stablePitch;
  }

  const cadencePitch = nearestCadencePitch(stablePitch, cadencePcs);
  return Math.abs(cadencePitch - stablePitch) <= 2 ? cadencePitch : stablePitch;
}

function preventTraceOverlaps(notes: MelodyNote[], beat: number): MelodyNote[] {
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start);
  const gap = Math.max(0.015, beat * 0.025);
  const minDuration = Math.max(0.05, beat * 0.16);

  for (let index = 0; index < sorted.length - 1; index++) {
    const note = sorted[index]!;
    const next = sorted[index + 1]!;
    const maxDuration = next.start - note.start - gap;
    if (maxDuration >= minDuration && note.duration > maxDuration) {
      note.duration = roundTo(maxDuration, 3);
    }
    if (next.start < note.start + minDuration + gap) {
      next.start = roundTo(note.start + minDuration + gap, 3);
    }
  }

  return sorted;
}

function snapSonglikePitches(
  notes: MelodyNote[],
  scalePcs: Set<number>,
  cadencePcs: number[],
  beat: number,
  strength: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  const anchors = new Set([
    ...cadencePcs,
    ...(melodyIntent?.intervalPolicy.anchorPitchClasses ?? []),
  ]);

  return notes.map((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const phraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.45;
    const strongPosition =
      index === 0 ||
      phraseEnd ||
      note.duration >= beat * 0.58 ||
      distanceToNearestGrid(note.start, beat / 2) <= beat * 0.08;
    const expressivePassingTone =
      prev &&
      next &&
      note.duration <= beat * 0.32 &&
      note.confidence >= 0.56 &&
      Math.sign(note.pitch - prev.pitch) === Math.sign(next.pitch - note.pitch) &&
      Math.abs(note.pitch - prev.pitch) <= 3 &&
      Math.abs(next.pitch - note.pitch) <= 3 &&
      Math.abs(next.pitch - prev.pitch) >= 2;
    if (expressivePassingTone) return { ...note };

    const shouldRewrite =
      strength >= 0.5 ||
      note.confidence < 0.84 ||
      phraseEnd ||
      !scalePcs.has(mod12(note.pitch));
    if (!shouldRewrite) return { ...note };

    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;
    const searchRadius = strength >= 0.68 ? 5 : 3;

    for (let delta = -searchRadius; delta <= searchRadius; delta++) {
      const candidatePitch = note.pitch + delta;
      const candidatePc = mod12(candidatePitch);
      if (!scalePcs.has(candidatePc)) continue;

      const movementCost =
        Math.abs(delta) * (note.confidence >= 0.9 && !phraseEnd ? 1.24 : 0.84);
      const anchorBonus =
        anchors.has(candidatePc)
          ? strongPosition
            ? -0.4
            : -0.14
          : 0.08;
      const cadenceBonus = phraseEnd && cadencePcs.includes(candidatePc) ? -0.46 : 0;
      const localCost =
        prev && next
          ? localContourPenalty(prev.pitch, candidatePitch, next.pitch)
          : prev
            ? awkwardLeapPenalty(candidatePitch - prev.pitch) * 0.7
            : 0;
      const directionCost =
        prev ? contourPenalty(prev.pitch, note.pitch, candidatePitch) * 0.35 : 0;
      const score =
        movementCost +
        anchorBonus +
        cadenceBonus +
        localCost +
        directionCost;

      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    if (bestPitch === note.pitch) return { ...note };
    return {
      ...note,
      pitch: bestPitch,
      confidence: clamp(Math.max(note.confidence, 0.82), 0, 1),
    };
  });
}

function smoothAwkwardMusicalLeaps(
  notes: MelodyNote[],
  scalePcs: Set<number>,
  cadencePcs: number[],
  strength: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  const smoothed = notes.map((note) => ({ ...note }));
  const policy = melodyIntent?.intervalPolicy;
  const maxLeap =
    policy?.preferredMotion === "leap-friendly"
      ? policy.maxUnpreparedLeap
      : Math.min(policy?.maxUnpreparedLeap ?? 7, strength >= 0.58 ? 5 : 7);

  for (let index = 1; index < smoothed.length; index++) {
    const prev = smoothed[index - 1]!;
    const note = smoothed[index]!;
    const next = index < smoothed.length - 1 ? smoothed[index + 1] : null;
    const leap = note.pitch - prev.pitch;
    const awkward =
      Math.abs(leap) > maxLeap ||
      Math.abs(leap) === 6 ||
      (Math.abs(leap) >= 5 && note.confidence < 0.84);
    if (!awkward) continue;

    const preserveExpressiveLeap =
      policy?.preferredMotion === "leap-friendly" &&
      Math.abs(leap) >= policy.preserveLeapThreshold &&
      note.confidence >= 0.88;
    if (preserveExpressiveLeap) continue;

    const direction = leap === 0 ? 0 : Math.sign(leap);
    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let candidatePitch = prev.pitch - maxLeap; candidatePitch <= prev.pitch + maxLeap; candidatePitch++) {
      const candidatePc = mod12(candidatePitch);
      if (!scalePcs.has(candidatePc)) continue;
      if (direction !== 0 && Math.sign(candidatePitch - prev.pitch) !== direction) continue;

      const movementFromOriginal = Math.abs(candidatePitch - note.pitch);
      if (movementFromOriginal > 7) continue;

      const candidateLeap = candidatePitch - prev.pitch;
      const leapCost = awkwardLeapPenalty(candidateLeap);
      const nextCost = next ? awkwardLeapPenalty(next.pitch - candidatePitch) * 0.72 : 0;
      const cadenceBonus =
        !next && cadencePcs.includes(candidatePc)
          ? -0.42
          : cadencePcs.includes(candidatePc)
            ? -0.08
            : 0;
      const score = movementFromOriginal * 0.72 + leapCost + nextCost + cadenceBonus;
      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    if (bestPitch !== note.pitch) {
      note.pitch = bestPitch;
      note.confidence = clamp(Math.max(note.confidence, 0.84), 0, 1);
    }
  }

  return smoothed;
}

function regularizeSonglikeTiming(
  notes: MelodyNote[],
  source: CleanMelody,
  beat: number,
  strength: number,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  const grid = melodyIntent?.rhythmPolicy.gridSeconds ?? beat / 4;
  const minNote = melodyIntent?.rhythmPolicy.minNoteSeconds ?? Math.max(0.08, beat * 0.18);
  const microPause =
    melodyIntent?.rhythmPolicy.microPauseSeconds ??
    beat * (0.08 + repairSeverity * 0.04);
  const phraseBreak =
    melodyIntent?.rhythmPolicy.phraseBreakSeconds ?? beat * 0.86;
  const palette = [
    beat * 0.25,
    beat * 0.5,
    beat * 0.75,
    beat,
    beat * 1.5,
    beat * 2,
  ];
  const sorted = notes
    .map((note) => ({ ...note }))
    .sort((a, b) => a.start - b.start);

  for (let index = 0; index < sorted.length; index++) {
    const note = sorted[index]!;
    const prev = index > 0 ? sorted[index - 1]! : null;
    const sourceNote = source.notes[index];
    const nextOriginal = index < sorted.length - 1 ? source.notes[index + 1] ?? notes[index + 1] : null;
    const originalGap =
      prev ? Math.max(0, note.start - (prev.start + prev.duration)) : 0;
    const phraseStart = Boolean(prev && originalGap >= phraseBreak * 0.72);
    const snappedStart = Math.round(note.start / grid) * grid;
    const sourceBias =
      sourceNote && note.confidence < 0.86
        ? Math.max(beat * 0.015, (1 - note.confidence) * beat * 0.045)
        : beat * 0.01;
    const startRewriteNeeded =
      repairSeverity >= 0.22 ||
      strength >= 0.56 ||
      note.confidence < 0.78 ||
      distanceToNearestGrid(note.start, grid) >= beat * 0.09;
    const preferredStart = startRewriteNeeded
      ? Math.min(
          note.start,
          snappedStart,
          sourceNote ? Math.max(0, sourceNote.start - sourceBias) : note.start,
        )
      : note.start;

    if (prev) {
      const requiredGap = phraseStart
        ? Math.max(microPause * 0.35, beat * 0.015)
        : Math.max(microPause * 0.2, beat * 0.01);
      const minStartAfterPrev = prev.start + prev.duration + requiredGap;
      if (preferredStart < minStartAfterPrev) {
        const maxPrevDuration = preferredStart - prev.start - requiredGap;
        if (maxPrevDuration >= beat * 0.12) {
          prev.duration = Math.min(prev.duration, maxPrevDuration);
          note.start = preferredStart;
        } else {
          note.start = Math.max(preferredStart, minStartAfterPrev);
        }
      } else {
        note.start = preferredStart;
      }
    } else {
      note.start = Math.max(0, preferredStart);
    }

    const targetDuration = palette.reduce((best, candidate) =>
      Math.abs(candidate - note.duration) < Math.abs(best - note.duration) ? candidate : best,
    );
    const durationBlend = clamp(0.28 + strength * 0.36 + repairSeverity * 0.18, 0.28, 0.78);
    const sourceDuration = sourceNote?.duration ?? note.duration;
    const shortNote = Math.min(note.duration, sourceDuration) <= beat * 0.38;
    const durationRewriteNeeded =
      repairSeverity >= 0.22 ||
      strength >= 0.56 ||
      note.confidence < 0.8 ||
      shortNote;
    let nextStartLimit = Number.POSITIVE_INFINITY;
    if (nextOriginal) {
      const nextSnapped = Math.round(nextOriginal.start / grid) * grid;
      nextStartLimit = Math.max(nextOriginal.start, nextSnapped) - microPause;
    }
    const maxGrowth = shortNote ? 1.9 : 1.08;
    const maxDuration = Number.isFinite(nextStartLimit)
      ? Math.max(minNote, Math.min(nextStartLimit - note.start, note.duration * maxGrowth))
      : Math.max(note.duration, note.duration * maxGrowth);
    const blendedDuration =
      note.duration + (targetDuration - note.duration) * durationBlend;
    const minDuration = shortNote
      ? Math.max(minNote, sourceDuration, note.duration)
      : Math.max(minNote, Math.min(note.duration, sourceDuration));
    note.duration = durationRewriteNeeded
      ? clamp(blendedDuration, minDuration, maxDuration)
      : clamp(note.duration, minNote, maxDuration);
  }

  return sorted;
}

function extendFinalNoteToMinimumDuration(
  notes: MelodyNote[],
  minimumDuration: number,
): MelodyNote[] {
  if (notes.length === 0) return [];

  const extended = notes.map((note) => ({ ...note }));
  const final = extended.at(-1);
  if (!final) return extended;

  const currentEnd = final.start + final.duration;
  if (currentEnd >= minimumDuration) return extended;

  final.duration = Math.max(final.duration, minimumDuration - final.start);
  return extended;
}

function shapeSonglikePhraseArcs(
  notes: MelodyNote[],
  scalePcs: Set<number>,
  cadencePcs: number[],
  beat: number,
  strength: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  if (notes.length < 4) return notes.map((note) => ({ ...note }));

  const phraseBreak = melodyIntent?.rhythmPolicy.phraseBreakSeconds ?? beat * 0.86;
  const shaped = notes.map((note) => ({ ...note }));
  const phrases = splitNotePhrases(shaped, phraseBreak);

  for (const phrase of phrases) {
    if (phrase.length < 4) continue;
    const startIndex = phrase[0]!;
    const endIndex = phrase[phrase.length - 1]!;
    const apexIndex = choosePhraseApexIndex(shaped, phrase);

    for (const index of phrase) {
      if (index === startIndex || index === endIndex || index === apexIndex) continue;
      const prev = shaped[index - 1];
      const note = shaped[index];
      const next = shaped[index + 1];
      if (!prev || !note || !next) continue;

      const zigzag =
        Math.sign(note.pitch - prev.pitch) !== Math.sign(next.pitch - note.pitch) &&
        Math.abs(note.pitch - prev.pitch) >= 3 &&
        Math.abs(next.pitch - note.pitch) >= 3;
      const strayPeak =
        note.pitch >= shaped[apexIndex]!.pitch - 1 &&
        Math.abs(index - apexIndex) > 1 &&
        note.confidence < 0.88;
      const shouldShape =
        strength >= 0.48 ||
        note.confidence < 0.82 ||
        zigzag ||
        strayPeak;
      if (!shouldShape) continue;

      const target = strayPeak
        ? Math.max(prev.pitch, next.pitch)
        : Math.round((prev.pitch + next.pitch) / 2);
      const candidatePitch = nearestScalePitch(target, scalePcs);
      const movement = Math.abs(candidatePitch - note.pitch);
      if (movement > 5) continue;

      const keepsDirection =
        localContourPenalty(prev.pitch, candidatePitch, next.pitch) <=
        localContourPenalty(prev.pitch, note.pitch, next.pitch) + 0.05;
      const cadenceSafe = cadencePcs.includes(mod12(note.pitch)) && note.duration >= beat * 0.7;
      if (!keepsDirection || cadenceSafe) continue;

      note.pitch = candidatePitch;
      note.confidence = clamp(Math.max(note.confidence, 0.84), 0, 1);
    }

    const end = shaped[endIndex]!;
    const endPc = mod12(end.pitch);
    if (!cadencePcs.includes(endPc) && strength >= 0.46) {
      let bestPitch = end.pitch;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const cadencePc of cadencePcs) {
        const candidate = nearestPitchForClass(end.pitch, cadencePc);
        const distance = Math.abs(candidate - end.pitch);
        if (distance <= 3 && distance < bestDistance) {
          bestPitch = candidate;
          bestDistance = distance;
        }
      }
      end.pitch = bestPitch;
    }
  }

  return shaped;
}

function splitNotePhrases(notes: MelodyNote[], phraseBreak: number): number[][] {
  const phrases: number[][] = [];
  let current: number[] = [];

  for (let index = 0; index < notes.length; index++) {
    const note = notes[index]!;
    const prev = index > 0 ? notes[index - 1] : null;
    if (prev && note.start - (prev.start + prev.duration) >= phraseBreak * 0.72) {
      if (current.length > 0) phrases.push(current);
      current = [];
    }
    current.push(index);
  }

  if (current.length > 0) phrases.push(current);
  return phrases;
}

function choosePhraseApexIndex(notes: MelodyNote[], phrase: number[]): number {
  const preferredCenter = phrase[0]! + (phrase.length - 1) * 0.62;
  return phrase.reduce((bestIndex, index) => {
    const best = notes[bestIndex]!;
    const note = notes[index]!;
    const bestScore =
      best.pitch * 0.72 +
      best.duration * 2 +
      best.confidence -
      Math.abs(bestIndex - preferredCenter) * 0.18;
    const score =
      note.pitch * 0.72 +
      note.duration * 2 +
      note.confidence -
      Math.abs(index - preferredCenter) * 0.18;
    return score > bestScore ? index : bestIndex;
  }, phrase[0]!);
}

function nearestScalePitch(referencePitch: number, scalePcs: Set<number>): number {
  let bestPitch = referencePitch;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let delta = -6; delta <= 6; delta++) {
    const candidate = referencePitch + delta;
    if (!scalePcs.has(mod12(candidate))) continue;
    const distance = Math.abs(delta);
    if (distance < bestDistance) {
      bestPitch = candidate;
      bestDistance = distance;
    }
  }
  return bestPitch;
}

function alignRhythmicSkeleton(
  notes: MelodyNote[],
  beat: number,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  if (notes.length < 3) return notes.map((note) => ({ ...note }));

  const gridStep = melodyIntent?.rhythmPolicy.gridSeconds ?? beat / 2;
  const quantizeStrength = melodyIntent?.rhythmPolicy.quantizeStrength ?? 0.5;
  const minNote = melodyIntent?.rhythmPolicy.minNoteSeconds ?? 0.05;
  const startTolerance =
    beat * (0.06 + Math.min(0.08, repairSeverity * 0.06 + quantizeStrength * 0.05));
  const minGap =
    melodyIntent?.rhythmPolicy.microPauseSeconds ??
    beat * (0.06 + Math.min(0.04, repairSeverity * 0.04));
  const aligned = notes.map((note) => ({ ...note }));

  for (let index = 1; index < aligned.length; index++) {
    const prev = aligned[index - 1]!;
    const note = aligned[index]!;
    const next = index < aligned.length - 1 ? aligned[index + 1]! : null;
    const phraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.45;
    const unstableTiming =
      note.confidence < 0.84 ||
      note.duration <= beat * 0.32 ||
      note.duration >= beat * 0.92;
    if (phraseEnd || !unstableTiming) continue;

    const targetStart = Math.round(note.start / gridStep) * gridStep;
    if (Math.abs(targetStart - note.start) > startTolerance) continue;

    const minStart = prev.start + Math.max(prev.duration * 0.72, beat * 0.18);
    const maxStart = next
      ? next.start - Math.max(note.duration * 0.85, beat * 0.18)
      : note.start + beat * 0.12;
    const snappedStart = clamp(targetStart, minStart, maxStart);
    if (snappedStart <= prev.start + beat * 0.08) continue;

    note.start = snappedStart;
    const available = next
      ? Math.max(minNote, next.start - note.start - minGap)
      : Math.max(note.duration, beat * 0.5);
    const palette = [
      beat * 0.25,
      beat * 0.5,
      beat * 0.75,
      beat,
      beat * 1.5,
    ];
    const targetDuration = palette.reduce((best, candidate) =>
      Math.abs(candidate - note.duration) < Math.abs(best - note.duration) ? candidate : best,
    );
    const blendedDuration =
      note.duration +
      (Math.min(targetDuration, available) - note.duration) *
        (0.2 + repairSeverity * 0.22 + quantizeStrength * 0.18);
    note.duration = Math.max(minNote, Math.min(blendedDuration, available));
  }

  return aligned.sort((a, b) => a.start - b.start);
}

function compensatePitchWeakStableRhythm(
  notes: MelodyNote[],
  key: string,
  scale: CleanMelody["scale"],
  beat: number,
): MelodyNote[] {
  if (!looksRhythmStableButPitchWeak(notes, beat)) return notes;

  const root = KEY_NAMES.indexOf(key as (typeof KEY_NAMES)[number]);
  if (root < 0) return notes;

  const scalePcs = getScalePitchClasses(root, scale);
  const anchorPcs = getCadenceTargets(root, scale);
  const halfBeat = beat / 2;

  return notes.map((note, index) => {
    const prev = index > 0 ? notes[index - 1] : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const beatOffset = distanceToNearestGrid(note.start, halfBeat);
    const strongBeat = beatOffset <= beat * 0.08;
    const structural = strongBeat || note.duration >= beat * 0.55;
    const lowConfidence = note.confidence < 0.8;
    if (!structural && !lowConfidence) return note;

    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let delta = -2; delta <= 2; delta++) {
      const candidatePitch = note.pitch + delta;
      const candidatePc = mod12(candidatePitch);
      if (!scalePcs.has(candidatePc)) continue;

      const movementPenalty = Math.abs(delta) * (strongBeat ? 0.7 : 1);
      const anchorBonus =
        strongBeat && anchorPcs.includes(candidatePc)
          ? -0.45
          : anchorPcs.includes(candidatePc)
            ? -0.18
            : 0;
      const contourCost =
        prev && next
          ? localContourPenalty(prev.pitch, candidatePitch, next.pitch)
          : 0;
      const score = movementPenalty + contourCost + anchorBonus;

      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    if (bestPitch === note.pitch) return note;
    return {
      ...note,
      pitch: bestPitch,
      confidence: clamp(Math.max(note.confidence, 0.78), 0, 1),
    };
  });
}

function prioritizeStructuralNotes(
  notes: MelodyNote[],
  key: string,
  scale: CleanMelody["scale"],
  beat: number,
): MelodyNote[] {
  if (notes.length < 3) return notes;

  const root = KEY_NAMES.indexOf(key as (typeof KEY_NAMES)[number]);
  if (root < 0) return notes;

  const scalePcs = getScalePitchClasses(root, scale);
  const anchorPcs = getCadenceTargets(root, scale);
  const repeatedPitchClasses = buildRepeatedPitchClasses(notes);
  const halfBeat = beat / 2;

  return notes.map((note, index) => {
    const structural =
      index === 0 ||
      index === notes.length - 1 ||
      note.duration >= beat * 0.75 ||
      distanceToNearestGrid(note.start, halfBeat) <= beat * 0.08 ||
      repeatedPitchClasses.has(mod12(note.pitch));

    if (!structural || note.confidence >= 0.86) return note;

    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let delta = -2; delta <= 2; delta++) {
      const candidatePitch = note.pitch + delta;
      const candidatePc = mod12(candidatePitch);
      if (!scalePcs.has(candidatePc)) continue;

      const movementPenalty = Math.abs(delta);
      const anchorBonus = anchorPcs.includes(candidatePc) ? -0.28 : 0;
      const repetitionBonus = repeatedPitchClasses.has(candidatePc) ? -0.42 : 0;
      const score = movementPenalty + anchorBonus + repetitionBonus;

      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    if (bestPitch === note.pitch) return note;
    return {
      ...note,
      pitch: bestPitch,
      confidence: clamp(Math.max(note.confidence, 0.82), 0, 1),
    };
  });
}

function compactOrnamentalBursts(notes: MelodyNote[], beat: number): MelodyNote[] {
  if (notes.length < 3) return notes;

  const compacted: MelodyNote[] = [];
  let index = 0;

  while (index < notes.length) {
    const current = notes[index]!;
    const prev = compacted.length > 0 ? compacted[compacted.length - 1]! : null;
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const shortBurst = current.duration <= beat * 0.3;
    const lowConfidence = current.confidence < 0.72;
    const tinyGapToNext =
      next && next.start - (current.start + current.duration) <= beat * 0.08;
    const bridgeBetweenNeighbors =
      prev &&
      next &&
      Math.abs(current.pitch - prev.pitch) <= 2 &&
      Math.abs(next.pitch - current.pitch) <= 2;
    const passingMotion =
      prev &&
      next &&
      Math.sign(current.pitch - prev.pitch) === Math.sign(next.pitch - current.pitch) &&
      Math.abs(next.pitch - prev.pitch) >= 2;
    const confidentPassingMotion =
      passingMotion &&
      (current.confidence >= 0.64 ||
        next.confidence >= 0.78 ||
        next.duration >= beat * 0.38);

    if (
      prev &&
      next &&
      shortBurst &&
      lowConfidence &&
      tinyGapToNext &&
      bridgeBetweenNeighbors &&
      !confidentPassingMotion
    ) {
      compacted[compacted.length - 1] = {
        ...prev,
        duration: next.start + next.duration - prev.start,
        pitch: weightedPitch([prev, current, next]),
        velocity: clamp((prev.velocity + current.velocity + next.velocity) / 3, 0.05, 1),
        confidence: clamp(Math.max(prev.confidence, current.confidence, next.confidence), 0, 1),
      };
      index += 2;
      continue;
    }

    compacted.push({ ...current });
    index += 1;
  }

  return compacted;
}

function filterSpuriousMusicalFragments(notes: MelodyNote[], beat: number): MelodyNote[] {
  if (notes.length < 3) return notes.map((note) => ({ ...note }));

  return notes.filter((note, index) => {
    if (index === 0 || index === notes.length - 1) return true;

    const prev = notes[index - 1]!;
    const next = notes[index + 1]!;
    const short = note.duration <= beat * 0.28;
    const weak = note.confidence < 0.74;
    if (!short || !weak) return true;

    const prevGap = note.start - (prev.start + prev.duration);
    const nextGap = next.start - (note.start + note.duration);
    const embedded = prevGap <= beat * 0.1 && nextGap <= beat * 0.12;
    if (!embedded) return true;

    const strongBeat = distanceToNearestGrid(note.start, beat / 2) <= beat * 0.045;
    if (strongBeat && note.confidence >= 0.66) return true;

    const fromPrev = note.pitch - prev.pitch;
    const toNext = next.pitch - note.pitch;
    const passingMotion =
      Math.sign(fromPrev) === Math.sign(toNext) &&
      Math.abs(fromPrev) <= 3 &&
      Math.abs(toNext) <= 3 &&
      Math.abs(next.pitch - prev.pitch) >= 2;
    if (passingMotion && note.confidence >= 0.6) return true;

    const sameAnchor = Math.abs(prev.pitch - next.pitch) <= 1;
    const detourFromAnchor =
      Math.abs(note.pitch - Math.round((prev.pitch + next.pitch) / 2)) >= 2;
    const tinyEcho =
      note.duration <= beat * 0.18 &&
      (Math.abs(note.pitch - prev.pitch) <= 1 || Math.abs(note.pitch - next.pitch) <= 1);

    return !(sameAnchor && detourFromAnchor) && !tinyEcho;
  });
}

function stabilizeUrgentTiming(notes: MelodyNote[], beat: number): MelodyNote[] {
  if (notes.length < 4) return notes;

  const durations = notes.map((note) => note.duration);
  const medianDuration = median(durations);
  const shortRatio =
    notes.filter((note) => note.duration <= beat * 0.42).length / notes.length;
  const urgentLike = medianDuration <= beat * 0.42 && shortRatio >= 0.6;
  if (!urgentLike) return notes;

  const palette = [beat * 0.25, beat * 0.5];
  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const phraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.4;
    if (phraseEnd) return { ...note };

    const nearest = palette.reduce((best, candidate) =>
      Math.abs(candidate - note.duration) < Math.abs(best - note.duration) ? candidate : best,
    );
    const tinyGap = next ? next.start - (note.start + note.duration) <= beat * 0.08 : false;
    const targetDuration = note.duration + (nearest - note.duration) * (tinyGap ? 0.52 : 0.38);
    const maxDuration = next
      ? Math.max(0.05, next.start - note.start - beat * 0.04)
      : note.duration;

    return {
      ...note,
      duration: Math.max(note.duration, Math.min(targetDuration, maxDuration)),
    };
  });
}

function strengthenPhraseResolutions(
  notes: MelodyNote[],
  key: string,
  scale: CleanMelody["scale"],
  beat: number,
): MelodyNote[] {
  if (notes.length === 0) return notes;

  const root = KEY_NAMES.indexOf(key as (typeof KEY_NAMES)[number]);
  if (root < 0) return notes;

  const cadenceTargets = getCadenceTargets(root, scale);
  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const prev = index > 0 ? notes[index - 1] : null;
    const isPhraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.45;
    if (!isPhraseEnd) return note;

    const currentPc = mod12(note.pitch);
    if (cadenceTargets.includes(currentPc)) return note;

    let bestPitch = note.pitch;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const targetPc of cadenceTargets) {
      const candidatePitch = nearestPitchForClass(note.pitch, targetPc);
      const movement = Math.abs(candidatePitch - note.pitch);
      if (movement > 2) continue;

      const directionPenalty =
        prev ? contourPenalty(prev.pitch, note.pitch, candidatePitch) : 0;
      const stabilityPenalty =
        note.duration < beat * 0.35 && movement > 1 ? 0.35 : 0;
      const targetBonus =
        prev && candidatePitch > note.pitch && prev.pitch < note.pitch
          ? -0.2
          : 0;
      const score = movement + directionPenalty + stabilityPenalty + targetBonus;
      if (score < bestScore) {
        bestScore = score;
        bestPitch = candidatePitch;
      }
    }

    if (bestPitch === note.pitch) return note;
    return {
      ...note,
      pitch: bestPitch,
    };
  });
}

function relocateWeakBeatNotes(notes: MelodyNote[], beat: number): MelodyNote[] {
  if (notes.length < 2) return notes;

  const halfBeat = beat / 2;
  const sixteenth = beat / 4;
  const relocated = notes.map((note) => ({ ...note }));

  for (let index = 0; index < relocated.length; index++) {
    const note = relocated[index]!;
    const prev = index > 0 ? relocated[index - 1] : null;
    const next = index < relocated.length - 1 ? relocated[index + 1] : null;
    const weakShortNote =
      note.duration <= beat * 0.32 && note.confidence < 0.75;
    if (!weakShortNote) continue;

    const grid = Math.round(note.start / halfBeat) * halfBeat;
    const offGridBy = Math.abs(note.start - grid);
    if (offGridBy < sixteenth * 0.45 || offGridBy > halfBeat * 0.42) continue;

    const candidateStart = grid;
    const minStart = prev ? prev.start + Math.max(prev.duration * 0.55, sixteenth * 0.6) : 0;
    const maxStart = next
      ? next.start - Math.max(note.duration * 0.9, sixteenth * 0.6)
      : candidateStart;
    const clampedStart = clamp(candidateStart, minStart, maxStart);

    if (Math.abs(clampedStart - note.start) < sixteenth * 0.35) continue;
    note.start = clampedStart;
  }

  return relocated.sort((a, b) => a.start - b.start);
}

function applyCadenceHold(
  notes: MelodyNote[],
  beat: number,
  repairSeverity = 0,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  if (notes.length === 0) return notes;

  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const isPhraseEnd =
      !next ||
      next.start - (note.start + note.duration) >=
        (melodyIntent?.rhythmPolicy.phraseBreakSeconds ?? beat * 0.45);
    const holdBonus = beat * (0.18 - Math.min(0.08, repairSeverity * 0.1));
    const phraseHold = melodyIntent?.rhythmPolicy.phraseEndHoldSeconds ?? beat * 0.68;
    const subtleHold = Math.min(
      phraseHold - Math.min(beat * 0.12, repairSeverity * beat * 0.14),
      note.duration + holdBonus,
    );
    const targetDuration = isPhraseEnd ? subtleHold : note.duration;
    const maxDuration = next
      ? Math.max(note.duration, next.start - note.start)
      : Math.max(note.duration, beat * 0.92);

    if (
      !isPhraseEnd ||
      note.duration >= targetDuration ||
      note.confidence < 0.72
    ) {
      return note;
    }

    return {
      ...note,
      duration: Math.min(maxDuration, targetDuration),
    };
  });
}

function disciplineInteriorDurations(
  notes: MelodyNote[],
  beat: number,
  repairSeverity: number,
  melodyIntent?: MelodyIntentProfile,
): MelodyNote[] {
  if (notes.length < 2) return notes;

  const durations = notes.map((note) => note.duration);
  const medianDuration = median(durations);
  const minimumGap =
    melodyIntent?.rhythmPolicy.microPauseSeconds ??
    beat * (0.08 + Math.min(0.08, repairSeverity * 0.08));
  const minNote = melodyIntent?.rhythmPolicy.minNoteSeconds ?? 0.05;

  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    if (!next) return { ...note };

    const phraseEnd =
      next.start - (note.start + note.duration) >=
      (melodyIntent?.rhythmPolicy.phraseBreakSeconds ?? beat * 0.45);
    if (phraseEnd) return { ...note };

    const targetMax = Math.max(beat * 0.66, medianDuration * (1.3 - Math.min(0.18, repairSeverity * 0.16)));
    const available = Math.max(minNote, next.start - note.start - minimumGap);
    const ambiguousHold = note.duration > targetMax;
    const likelyOverheld =
      note.duration > available ||
      (ambiguousHold && note.confidence < 0.92) ||
      note.duration >= Math.max(beat * 1.05, medianDuration * 1.7);

    if (!likelyOverheld) {
      return { ...note };
    }

    return {
      ...note,
      duration: Math.max(minNote, Math.min(targetMax, available)),
    };
  });
}

function regularizeTimingContours(
  notes: MelodyNote[],
  beat: number,
  repairSeverity: number,
): MelodyNote[] {
  if (notes.length === 0) return notes;

  const timingPalette = [beat * 0.25, beat * 0.5, beat * 0.75, beat, beat * 1.5];
  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const phraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.45;
    if (phraseEnd || note.confidence >= 0.84) {
      return { ...note };
    }

    const nearest = timingPalette.reduce((best, candidate) =>
      Math.abs(candidate - note.duration) < Math.abs(best - note.duration) ? candidate : best,
    );
    const deviation = Math.abs(nearest - note.duration);
    const nudgeThreshold = Math.max(beat * 0.08, note.duration * 0.18);
    if (deviation < nudgeThreshold) {
      return { ...note };
    }

    const blend = 0.22 + Math.min(0.28, repairSeverity * 0.3);
    const targetDuration = note.duration + (nearest - note.duration) * blend;
    const maxDuration = next ? Math.max(0.05, next.start - note.start - beat * 0.08) : note.duration;

    return {
      ...note,
      duration: Math.max(0.05, Math.min(targetDuration, maxDuration)),
    };
  });
}

function mergeAdjacentLightly(notes: MelodyNote[]): MelodyNote[] {
  if (notes.length === 0) return notes;

  const merged: MelodyNote[] = [{ ...notes[0]! }];
  for (let index = 1; index < notes.length; index++) {
    const prev = merged[merged.length - 1]!;
    const curr = notes[index]!;
    const gap = curr.start - (prev.start + prev.duration);

    if (gap <= 0.09 && Math.abs(curr.pitch - prev.pitch) <= 1) {
      const totalWeight =
        prev.duration * prev.confidence + curr.duration * curr.confidence;
      prev.pitch =
        totalWeight > 0
          ? Math.round(
              (prev.pitch * prev.duration * prev.confidence +
                curr.pitch * curr.duration * curr.confidence) / totalWeight,
            )
          : prev.pitch;
      prev.duration = curr.start + curr.duration - prev.start;
      prev.velocity = clamp((prev.velocity + curr.velocity) / 2, 0.05, 1);
      prev.confidence = clamp(Math.max(prev.confidence, curr.confidence), 0, 1);
      continue;
    }

    merged.push({ ...curr });
  }

  return merged;
}

function normalizeNote(note: MelodyNote): MelodyNote {
  return {
    ...note,
    velocity:
      note.velocity > 1
        ? clamp(note.velocity / 127, 0.05, 1)
        : clamp(note.velocity, 0.05, 1),
    confidence: clamp(note.confidence, 0, 1),
    start: Math.max(0, note.start),
    duration: Math.max(0.03, note.duration),
  };
}

function melodyDuration(notes: MelodyNote[]): number {
  return notes.length > 0
    ? Math.max(...notes.map((note) => note.start + note.duration))
    : 0;
}

function estimateContour(notes: MelodyNote[]): CleanMelody["contour"] {
  if (notes.length < 2) return "flat";

  let ups = 0;
  let downs = 0;
  for (let index = 1; index < notes.length; index++) {
    const diff = notes[index]!.pitch - notes[index - 1]!.pitch;
    if (diff > 0) ups++;
    if (diff < 0) downs++;
  }

  const total = ups + downs;
  if (total === 0) return "flat";
  if (total <= 2) {
    if (ups > 0 && downs === 0) return "rising";
    if (downs > 0 && ups === 0) return "falling";
    return "wave";
  }
  if (ups > downs * 1.5) return "rising";
  if (downs > ups * 1.5) return "falling";
  return "wave";
}

function computeAcceptanceRepairSeverity(
  corrected: CleanMelody,
  diagnostics?: Partial<TranscriptionDiagnostics>,
  contour?: TranscriptionContour,
  baseMusical?: CleanMelody,
  melodyIntent?: MelodyIntentProfile,
): number {
  const baseScore = scoreMelodyAcceptance(baseMusical ?? corrected);
  const contourStats = summarizeContour(contour);

  let severity = 0;

  if (typeof diagnostics?.acceptanceScore === "number") {
    severity += clamp((0.68 - diagnostics.acceptanceScore) / 0.24, 0, 1) * 0.34;
  } else {
    severity += clamp((0.64 - baseScore.score) / 0.24, 0, 1) * 0.22;
  }

  if (typeof diagnostics?.musicFeelScore === "number") {
    severity += clamp((0.66 - diagnostics.musicFeelScore) / 0.24, 0, 1) * 0.26;
  } else {
    severity += clamp((0.68 - baseScore.musicFeelScore) / 0.26, 0, 1) * 0.16;
  }

  severity += clamp(
    ((diagnostics?.excessiveHoldRatio ?? baseScore.excessiveHoldRatio) - 0.22) / 0.18,
    0,
    1,
  ) * 0.18;
  severity += clamp(
    ((diagnostics?.interiorHoldRatio ?? 0) - 0.12) / 0.18,
    0,
    1,
  ) * 0.12;
  severity += clamp(
    ((diagnostics?.onsetFragmentation ?? baseScore.onsetFragmentation) - 0.4) / 0.24,
    0,
    1,
  ) * 0.12;
  severity += clamp(
    ((diagnostics?.firstOnsetLag ?? 0) - 0.14) / 0.14,
    0,
    1,
  ) * 0.06;

  if (contourStats.voicedFrameCount >= 12) {
    severity += clamp((contourStats.unstableVoicedJumpRatio - 0.18) / 0.18, 0, 1) * 0.04;
  }

  if (melodyIntent) {
    severity += clamp((melodyIntent.musicalityBias - 0.38) / 0.42, 0, 1) * 0.18;
    severity += clamp((melodyIntent.correctionPolicy.timingQuantize - 0.34) / 0.3, 0, 1) * 0.08;
    severity += clamp((melodyIntent.correctionPolicy.correctionStrength - 0.56) / 0.3, 0, 1) * 0.06;
    severity -= clamp((melodyIntent.intentMatch - 0.72) / 0.2, 0, 1) * 0.12;
  }

  return clamp(severity, 0, 1);
}

function scoreMelodyAcceptance(melody: CleanMelody): {
  score: number;
  musicFeelScore: number;
  excessiveHoldRatio: number;
  onsetFragmentation: number;
} {
  const notes = melody.notes;
  if (notes.length === 0) {
    return {
      score: 0,
      musicFeelScore: 0,
      excessiveHoldRatio: 1,
      onsetFragmentation: 1,
    };
  }

  const durations = notes.map((note) => note.duration);
  const medianDuration = Math.max(1e-6, median(durations));
  const rushedRatio =
    notes.filter((note) => note.duration <= Math.max(0.16, medianDuration * 0.52)).length /
    notes.length;
  const ambiguousMidRatio =
    notes.filter(
      (note) =>
        note.duration >= medianDuration * 0.72 && note.duration <= medianDuration * 1.28,
    ).length / notes.length;
  const cadenceRatio = durations[durations.length - 1]! / medianDuration;
  const excessiveHoldRatio =
    notes.filter((note) => note.duration >= Math.max(medianDuration * 1.9, 0.82)).length /
    notes.length;
  const onsetFragmentation =
    notes.length > 1
      ? notes
          .slice(1)
          .filter((note, index) => Math.abs(note.duration - notes[index]!.duration) >= Math.max(0.22, medianDuration * 0.8)).length /
        (notes.length - 1)
      : 0;
  const confidenceMean =
    notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length;

  const musicFeelScore =
    0.34 * Math.max(0, 1 - rushedRatio) +
    0.22 * Math.max(0, 1 - Math.max(0, ambiguousMidRatio - 0.55)) +
    0.24 * Math.min(1, cadenceRatio / 1.6) +
    0.2 * confidenceMean -
    0.08 * excessiveHoldRatio -
    0.08 * onsetFragmentation;

  return {
    score:
      musicFeelScore * 0.68 +
      confidenceMean * 0.18 +
      Math.min(1, notes.length / 6) * 0.14,
    musicFeelScore,
    excessiveHoldRatio,
    onsetFragmentation,
  };
}

function scoreMusicalImprovement(
  corrected: CleanMelody,
  musical: CleanMelody,
): {
  score: number;
  timingGain: number;
  intervalGain: number;
  cadenceGain: number;
  feelGain: number;
} {
  const correctedQuality = scoreMelodyAcceptance(corrected);
  const musicalQuality = scoreMelodyAcceptance(musical);
  const correctedAwkwardRatio =
    corrected.notes.length > 1
      ? countAwkwardIntervals(corrected.notes) / (corrected.notes.length - 1)
      : 0;
  const musicalAwkwardRatio =
    musical.notes.length > 1
      ? countAwkwardIntervals(musical.notes) / (musical.notes.length - 1)
      : 0;
  const timingGain = clamp(
    (correctedQuality.onsetFragmentation - musicalQuality.onsetFragmentation) * 0.6 +
      (correctedQuality.excessiveHoldRatio - musicalQuality.excessiveHoldRatio) * 0.4,
    -1,
    1,
  );
  const intervalGain = clamp(correctedAwkwardRatio - musicalAwkwardRatio, -1, 1);
  const cadenceGain = scoreCadenceStrength(musical) - scoreCadenceStrength(corrected);
  const feelGain = musicalQuality.musicFeelScore - correctedQuality.musicFeelScore;

  return {
    score: clamp(
      feelGain * 0.42 +
        timingGain * 0.26 +
        intervalGain * 0.2 +
        cadenceGain * 0.12,
      -1,
      1,
    ),
    timingGain,
    intervalGain,
    cadenceGain,
    feelGain,
  };
}

function scoreMelodyIdentitySimilarity(
  corrected: CleanMelody,
  musical: CleanMelody,
  melodyIntent?: MelodyIntentProfile,
): {
  score: number;
  contourScore: number;
  rhythmScore: number;
  intervalScore: number;
  structureScore: number;
  rangeScore: number;
} {
  if (corrected.notes.length === 0 || musical.notes.length === 0) {
    return {
      score: 0,
      contourScore: 0,
      rhythmScore: 0,
      intervalScore: 0,
      structureScore: 0,
      rangeScore: 0,
    };
  }

  const source = melodyIntent?.skeleton.notes.length ? melodyIntent.skeleton : corrected;
  const contourScore =
    compareNumericSeries(
      relativePitchSeries(source.notes),
      relativePitchSeries(musical.notes),
      8,
      { octaveEquivalent: true },
    ) * 0.58 +
    compareDirectionSeries(source.notes, musical.notes) * 0.42;
  const sourceRhythm = phraseLikeSpan(source.notes);
  const musicalRhythm = phraseLikeSpan(musical.notes);
  const rhythmScore =
    compareNumericSeries(relativeCenterSeries(sourceRhythm), relativeCenterSeries(musicalRhythm), 0.24) *
      0.56 +
    compareNumericSeries(relativeDurationSeries(sourceRhythm), relativeDurationSeries(musicalRhythm), 0.26) *
      0.44;
  const intervalScore = compareNumericSeries(
    intervalSeries(source.notes),
    intervalSeries(musical.notes),
    6,
    { octaveEquivalent: true },
  );
  const structureScore = scoreStructuralNoteSimilarity(source, musical, melodyIntent);
  const rangeScore = scoreRangeSimilarity(source.notes, musical.notes);

  return {
    score: clamp(
      contourScore * 0.3 +
        rhythmScore * 0.25 +
        intervalScore * 0.18 +
        structureScore * 0.17 +
        rangeScore * 0.1,
      0,
      1,
    ),
    contourScore,
    rhythmScore,
    intervalScore,
    structureScore,
    rangeScore,
  };
}

function scoreCadenceStrength(melody: CleanMelody): number {
  const last = melody.notes.at(-1);
  if (!last) return 0;
  const root = KEY_NAMES.indexOf(melody.key as (typeof KEY_NAMES)[number]);
  if (root < 0) return 0.4;
  const cadencePcs = getCadenceTargets(root, melody.scale);
  const cadenceDistance = Math.min(
    ...cadencePcs.map((pc) => Math.min(mod12(last.pitch - pc), mod12(pc - last.pitch))),
  );
  const pitchScore = 1 - clamp(cadenceDistance / 3, 0, 1);
  const medianDuration = Math.max(0.001, median(melody.notes.map((note) => note.duration)));
  const durationScore = clamp(last.duration / (medianDuration * 1.35), 0, 1);
  return pitchScore * 0.62 + durationScore * 0.38;
}

function compareDirectionSeries(left: MelodyNote[], right: MelodyNote[]): number {
  return compareNumericSeries(directionSeries(left), directionSeries(right), 1);
}

function directionSeries(notes: MelodyNote[]): number[] {
  const directions: number[] = [];
  for (let index = 1; index < notes.length; index++) {
    directions.push(Math.sign(notes[index]!.pitch - notes[index - 1]!.pitch));
  }
  return directions;
}

function phraseLikeSpan(notes: MelodyNote[]): PhraseSpan {
  const sorted = notes.map((note, index) => ({ note, index })).sort((a, b) => a.note.start - b.note.start);
  return makeIndexedPhraseSpan(0, sorted);
}

function scoreStructuralNoteSimilarity(
  source: CleanMelody,
  musical: CleanMelody,
  melodyIntent?: MelodyIntentProfile,
): number {
  const beat = 60 / Math.max(1, source.bpm || musical.bpm || 120);
  const anchors = collectIntentTraceAnchors(
    melodyIntent?.skeleton.notes.length ? melodyIntent.skeleton : source,
    source,
    beat,
    melodyIntent,
  );
  if (anchors.length === 0) return 0.72;

  let totalWeight = 0;
  let matchedWeight = 0;
  const claimed = new Set<number>();
  for (const anchor of anchors) {
    totalWeight += anchor.weight;
    const match = findNearestIntentTraceNote(musical.notes, anchor, beat, claimed);
    if (match === null) continue;
    claimed.add(match);
    const note = musical.notes[match]!;
    const pitchDistance = octaveAwareDistance(note.pitch, anchor.pitch);
    const startDistance = Math.abs(note.start - anchor.start);
    const pitchScore = 1 - clamp(pitchDistance / (anchor.kind === "edge" ? 7 : 5), 0, 1);
    const timingScore = 1 - clamp(startDistance / Math.max(beat * 1.35, 0.001), 0, 1);
    const durationScore =
      1 - clamp(Math.abs(note.duration - anchor.duration) / Math.max(anchor.duration, beat * 0.5), 0, 1);
    matchedWeight += anchor.weight * (pitchScore * 0.45 + timingScore * 0.38 + durationScore * 0.17);
  }

  return totalWeight > 0 ? clamp(matchedWeight / totalWeight, 0, 1) : 0.72;
}

function scoreRangeSimilarity(left: MelodyNote[], right: MelodyNote[]): number {
  const leftRange = pitchRange(left);
  const rightRange = pitchRange(right);
  const rangeScore = 1 - clamp(Math.abs(leftRange.width - rightRange.width) / 12, 0, 1);
  const centerScore = 1 - clamp(Math.abs(leftRange.center - rightRange.center) / 10, 0, 1);
  return rangeScore * 0.55 + centerScore * 0.45;
}

function pitchRange(notes: MelodyNote[]): { center: number; width: number } {
  if (notes.length === 0) return { center: 60, width: 0 };
  const pitches = notes.map((note) => note.pitch);
  const min = Math.min(...pitches);
  const max = Math.max(...pitches);
  return {
    center: (min + max) / 2,
    width: max - min,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function emptyMelody(): CleanMelody {
  return {
    notes: [],
    key: "C",
    scale: "major",
    bpm: 80,
    duration: 0,
    contour: "flat",
  };
}

function getCadenceTargets(
  root: number,
  scale: CleanMelody["scale"],
): number[] {
  if (scale === "minor" || scale === "dorian" || scale === "phrygian") {
    return [mod12(root), mod12(root + 3), mod12(root + 7)];
  }
  return [mod12(root), mod12(root + 4), mod12(root + 7)];
}

function getScalePitchClasses(
  root: number,
  scale: CleanMelody["scale"],
): Set<number> {
  const intervals =
    scale === "minor"
      ? [0, 2, 3, 5, 7, 8, 10]
      : scale === "dorian"
        ? [0, 2, 3, 5, 7, 9, 10]
        : scale === "phrygian"
          ? [0, 1, 3, 5, 7, 8, 10]
          : scale === "pentatonic"
            ? [0, 2, 4, 7, 9]
            : [0, 2, 4, 5, 7, 9, 11];

  return new Set(intervals.map((interval) => mod12(root + interval)));
}

function buildRepeatedPitchClasses(notes: MelodyNote[]): Set<number> {
  const counts = new Map<number, number>();
  for (const note of notes) {
    const pc = mod12(note.pitch);
    counts.set(pc, (counts.get(pc) ?? 0) + 1);
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([pc]) => pc),
  );
}

function nearestPitchForClass(referencePitch: number, targetPitchClass: number): number {
  const targetPc = mod12(targetPitchClass);
  const referenceOctaveBase = referencePitch - mod12(referencePitch);
  let bestPitch = referencePitch;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let octave = -24; octave <= 24; octave += 12) {
    const candidate = referenceOctaveBase + targetPc + octave;
    const distance = Math.abs(candidate - referencePitch);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPitch = candidate;
    }
  }

  return bestPitch;
}

function nearestCadencePitch(referencePitch: number, cadencePcs: number[]): number {
  if (cadencePcs.length === 0) return referencePitch;
  let bestPitch = referencePitch;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cadencePc of cadencePcs) {
    const candidate = nearestPitchForClass(referencePitch, cadencePc);
    const distance = Math.abs(candidate - referencePitch);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPitch = candidate;
    }
  }

  return bestPitch;
}

function contourPenalty(prevPitch: number, currentPitch: number, candidatePitch: number): number {
  const originalStep = currentPitch - prevPitch;
  const candidateStep = candidatePitch - prevPitch;
  if (originalStep === 0) return 0;
  if (Math.sign(originalStep) === Math.sign(candidateStep)) return 0;
  return 0.65;
}

function localContourPenalty(
  prevPitch: number,
  candidatePitch: number,
  nextPitch: number,
): number {
  const prevDiff = candidatePitch - prevPitch;
  const nextDiff = nextPitch - candidatePitch;

  if (Math.abs(prevDiff) >= 9 || Math.abs(nextDiff) >= 9) return 0.8;
  if (Math.sign(prevDiff) !== Math.sign(nextDiff) && Math.abs(prevDiff) > 3 && Math.abs(nextDiff) > 3) {
    return 0.35;
  }
  return 0;
}

function awkwardLeapPenalty(interval: number): number {
  const distance = Math.abs(interval);
  if (distance === 0) return 0;
  if (distance <= 2) return 0.02;
  if (distance <= 4) return 0.14;
  if (distance === 5 || distance === 7) return 0.28;
  if (distance <= 9) return 0.68;
  return 1.2;
}

function countAwkwardIntervals(notes: MelodyNote[]): number {
  let count = 0;
  for (let index = 1; index < notes.length; index++) {
    if (awkwardLeapPenalty(notes[index]!.pitch - notes[index - 1]!.pitch) >= 0.68) {
      count++;
    }
  }
  return count;
}

function looksRhythmStableButPitchWeak(notes: MelodyNote[], beat: number): boolean {
  if (notes.length < 4) return false;

  const halfBeat = beat / 2;
  const avgGridOffset =
    notes.reduce((sum, note) => sum + distanceToNearestGrid(note.start, halfBeat), 0) /
    notes.length;
  const avgConfidence =
    notes.reduce((sum, note) => sum + note.confidence, 0) / notes.length;
  const shortRatio =
    notes.filter((note) => note.duration <= beat * 0.28).length / notes.length;

  return avgGridOffset <= beat * 0.1 && avgConfidence < 0.79 && shortRatio < 0.38;
}

function distanceToNearestGrid(position: number, cell: number): number {
  const snapped = Math.round(position / cell) * cell;
  return Math.abs(position - snapped);
}

function weightedPitch(notes: MelodyNote[]): number {
  const totalWeight = notes.reduce(
    (sum, note) => sum + note.duration * Math.max(0.1, note.confidence),
    0,
  );
  if (totalWeight <= 0) return notes[0]?.pitch ?? 60;

  return Math.round(
    notes.reduce(
      (sum, note) => sum + note.pitch * note.duration * Math.max(0.1, note.confidence),
      0,
    ) / totalWeight,
  );
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp(amount, 0, 1);
}
