import type {
  CleanMelody,
  MelodySelectionKind,
  MelodyNote,
  TranscriptionContour,
  TranscriptionDiagnostics,
  TranscriptionResult,
  TranscriptionMelodies,
} from "@/modules/shared/types";
import { detectBpm, detectPhrases } from "@/lib/music/rhythm-engine";
import { estimateKey, polishMelody } from "./melody-polisher";

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

export function buildTranscriptionMelodies(
  rawNotes: MelodyNote[],
  correctedMelody?: CleanMelody,
  options: {
    diagnostics?: Partial<TranscriptionDiagnostics>;
    contour?: TranscriptionContour;
  } = {},
): TranscriptionMelodies {
  const intent = buildIntentMelody(rawNotes);
  const corrected = correctedMelody ?? polishMelody(rawNotes);
  const musical = buildMusicalMelodyWithRepair(
    corrected,
    options.diagnostics,
    options.contour,
  );

  return {
    intent,
    corrected,
    musical,
  };
}

export function chooseGenerationMelodyKind(input: {
  melodies: TranscriptionMelodies;
  diagnostics?: Partial<TranscriptionDiagnostics>;
  contour?: TranscriptionContour;
}): MelodySelectionKind {
  const { melodies, diagnostics, contour } = input;
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
  const weakAcceptance =
    (typeof diagnostics?.acceptanceScore === "number" && diagnostics.acceptanceScore < 0.58) ||
    (typeof diagnostics?.musicFeelScore === "number" && diagnostics.musicFeelScore < 0.58) ||
    (typeof diagnostics?.excessiveHoldRatio === "number" && diagnostics.excessiveHoldRatio >= 0.34) ||
    (typeof diagnostics?.interiorHoldRatio === "number" && diagnostics.interiorHoldRatio >= 0.18) ||
    (typeof diagnostics?.onsetFragmentation === "number" && diagnostics.onsetFragmentation >= 0.52) ||
    (typeof diagnostics?.firstOnsetLag === "number" && diagnostics.firstOnsetLag >= 0.18);
  const fragmentedTiming = noteCount >= 6 && shortNoteRatio >= 0.42;
  const weakConfidence =
    (noteCount >= 5 && avgConfidence < 0.72) ||
    contourStats.voicedConfidence < 0.72 ||
    contourStats.lowConfidenceVoicedRatio >= 0.34;
  const contourLooksShaky =
    contourStats.voicedFrameCount >= 12 &&
    (contourStats.unstableVoicedJumpRatio >= 0.24 ||
      contourStats.voicedGapRatio >= 0.18);

  if (
    poorVoicing ||
    poorSnr ||
    weakAcceptance ||
    fragmentedTiming ||
    weakConfidence ||
    contourLooksShaky
  ) {
    return "musical";
  }

  return "corrected";
}

export function selectGenerationMelody(
  result: Pick<TranscriptionResult, "melodies" | "diagnostics" | "contour">,
  options: { repairBias?: number } = {},
): { kind: MelodySelectionKind; melody: CleanMelody } {
  const baseKind = chooseGenerationMelodyKind(result);
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
  if (bias >= 0.35) {
    return "musical";
  }

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

function buildMusicalMelody(corrected: CleanMelody): CleanMelody {
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
  const urgentStabilized = stabilizeUrgentTiming(compacted, beat);
  const relocatedBase = relocateWeakBeatNotes(urgentStabilized, beat);
  const phrases = detectPhrases(relocatedBase, corrected.bpm);
  if (phrases.length <= 1) {
    const resolved = strengthenPhraseResolutions(
      relocatedBase,
      corrected.key,
      corrected.scale,
      beat,
    );
    const held = applyCadenceHold(resolved, beat);
    return {
      ...corrected,
      notes: held,
      duration: melodyDuration(held),
      contour: estimateContour(held),
    };
  }

  const notes = relocatedBase.map((note) => ({ ...note }));

  for (let phraseIndex = 0; phraseIndex < phrases.length - 1; phraseIndex++) {
    const currentPhrase = phrases[phraseIndex]!;
    const nextPhrase = phrases[phraseIndex + 1]!;
    const gap = nextPhrase.start - currentPhrase.end;
    const minimumBreath = beat * 0.45;
    const maximumBreath = beat * 0.9;
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
  const held = applyCadenceHold(resolved, beat);
  return {
    ...corrected,
    notes: held,
    duration: melodyDuration(held),
    contour: estimateContour(held),
  };
}

function buildMusicalMelodyWithRepair(
  corrected: CleanMelody,
  diagnostics?: Partial<TranscriptionDiagnostics>,
  contour?: TranscriptionContour,
): CleanMelody {
  const baseMusical = buildMusicalMelody(corrected);
  const repairSeverity = computeAcceptanceRepairSeverity(
    corrected,
    diagnostics,
    contour,
    baseMusical,
  );

  if (repairSeverity < 0.22) {
    return baseMusical;
  }

  const repaired = buildAcceptanceRepairMelody(corrected, repairSeverity);
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
  const urgentStabilized = stabilizeUrgentTiming(compacted, beat);
  const disciplined = disciplineInteriorDurations(urgentStabilized, beat, repairSeverity);
  const skeletonAligned = alignRhythmicSkeleton(disciplined, beat, repairSeverity);
  const regularized = regularizeTimingContours(skeletonAligned, beat, repairSeverity);
  const relocated = relocateWeakBeatNotes(regularized, beat);
  const resolved = strengthenPhraseResolutions(
    relocated,
    corrected.key,
    corrected.scale,
    beat,
  );
  const held = applyCadenceHold(resolved, beat, repairSeverity);

  return {
    ...corrected,
    notes: held,
    duration: melodyDuration(held),
    contour: estimateContour(held),
  };
}

function alignRhythmicSkeleton(
  notes: MelodyNote[],
  beat: number,
  repairSeverity: number,
): MelodyNote[] {
  if (notes.length < 3) return notes.map((note) => ({ ...note }));

  const gridStep = beat / 2;
  const startTolerance = beat * (0.08 + Math.min(0.06, repairSeverity * 0.06));
  const minGap = beat * (0.06 + Math.min(0.04, repairSeverity * 0.04));
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
      ? Math.max(0.05, next.start - note.start - minGap)
      : Math.max(note.duration, beat * 0.5);
    const palette = [beat * 0.25, beat * 0.5, beat * 0.75, beat];
    const targetDuration = palette.reduce((best, candidate) =>
      Math.abs(candidate - note.duration) < Math.abs(best - note.duration) ? candidate : best,
    );
    const blendedDuration =
      note.duration + (Math.min(targetDuration, available) - note.duration) * (0.3 + repairSeverity * 0.22);
    note.duration = Math.max(0.05, Math.min(blendedDuration, available));
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

    if (
      prev &&
      next &&
      shortBurst &&
      lowConfidence &&
      tinyGapToNext &&
      bridgeBetweenNeighbors
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
): MelodyNote[] {
  if (notes.length === 0) return notes;

  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    const isPhraseEnd =
      !next || next.start - (note.start + note.duration) >= beat * 0.45;
    const holdBonus = beat * (0.18 - Math.min(0.08, repairSeverity * 0.1));
    const subtleHold = Math.min(beat * (0.68 - Math.min(0.12, repairSeverity * 0.14)), note.duration + holdBonus);
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
): MelodyNote[] {
  if (notes.length < 2) return notes;

  const durations = notes.map((note) => note.duration);
  const medianDuration = median(durations);
  const minimumGap = beat * (0.08 + Math.min(0.08, repairSeverity * 0.08));

  return notes.map((note, index) => {
    const next = index < notes.length - 1 ? notes[index + 1] : null;
    if (!next) return { ...note };

    const phraseEnd = next.start - (note.start + note.duration) >= beat * 0.45;
    if (phraseEnd) return { ...note };

    const targetMax = Math.max(beat * 0.66, medianDuration * (1.3 - Math.min(0.18, repairSeverity * 0.16)));
    const available = Math.max(0.05, next.start - note.start - minimumGap);
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
      duration: Math.max(0.05, Math.min(targetMax, available)),
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
