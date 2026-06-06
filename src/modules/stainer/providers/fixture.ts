// Fixture provider — 多段预置旋律，随机抽取，保证每次演示有变化
import type { TranscriptionInput, TranscriptionResult } from "@/modules/shared/types";
import { polishMelody } from "@/modules/music/melody-polisher";
import {
  buildTranscriptionMelodies,
  chooseGenerationMelodyKind,
} from "@/modules/music/humming-engine";

// velocity 全部 0–1 范围（已 /127）
const FIXTURE_MELODIES = [
  // 旋律 A — C 小调，忧郁上升
  [
    { pitch: 60, start: 0.0,  duration: 0.45, velocity: 0.65, confidence: 0.93 },
    { pitch: 63, start: 0.5,  duration: 0.45, velocity: 0.65, confidence: 0.91 },
    { pitch: 65, start: 1.0,  duration: 0.45, velocity: 0.68, confidence: 0.92 },
    { pitch: 67, start: 1.5,  duration: 0.7,  velocity: 0.72, confidence: 0.94 },
    { pitch: 65, start: 2.25, duration: 0.45, velocity: 0.65, confidence: 0.90 },
    { pitch: 63, start: 2.75, duration: 0.45, velocity: 0.62, confidence: 0.89 },
    { pitch: 60, start: 3.25, duration: 1.0,  velocity: 0.68, confidence: 0.95 },
  ],
  // 旋律 B — G 大调，明亮跳跃
  [
    { pitch: 67, start: 0.0,  duration: 0.35, velocity: 0.72, confidence: 0.92 },
    { pitch: 69, start: 0.4,  duration: 0.35, velocity: 0.70, confidence: 0.91 },
    { pitch: 71, start: 0.8,  duration: 0.35, velocity: 0.74, confidence: 0.93 },
    { pitch: 72, start: 1.2,  duration: 0.6,  velocity: 0.78, confidence: 0.95 },
    { pitch: 71, start: 1.85, duration: 0.35, velocity: 0.68, confidence: 0.90 },
    { pitch: 69, start: 2.25, duration: 0.35, velocity: 0.65, confidence: 0.89 },
    { pitch: 67, start: 2.65, duration: 0.9,  velocity: 0.70, confidence: 0.94 },
  ],
  // 旋律 C — A 小调，波浪形
  [
    { pitch: 69, start: 0.0,  duration: 0.5,  velocity: 0.68, confidence: 0.91 },
    { pitch: 67, start: 0.55, duration: 0.4,  velocity: 0.65, confidence: 0.90 },
    { pitch: 65, start: 1.0,  duration: 0.4,  velocity: 0.63, confidence: 0.88 },
    { pitch: 67, start: 1.45, duration: 0.55, velocity: 0.68, confidence: 0.92 },
    { pitch: 69, start: 2.05, duration: 0.4,  velocity: 0.70, confidence: 0.91 },
    { pitch: 72, start: 2.5,  duration: 0.7,  velocity: 0.74, confidence: 0.93 },
    { pitch: 69, start: 3.25, duration: 1.0,  velocity: 0.65, confidence: 0.94 },
  ],
  // 旋律 D — F 大调，慢速抒情
  [
    { pitch: 65, start: 0.0,  duration: 0.7,  velocity: 0.60, confidence: 0.90 },
    { pitch: 67, start: 0.75, duration: 0.6,  velocity: 0.63, confidence: 0.91 },
    { pitch: 69, start: 1.4,  duration: 0.6,  velocity: 0.66, confidence: 0.92 },
    { pitch: 72, start: 2.05, duration: 0.85, velocity: 0.70, confidence: 0.94 },
    { pitch: 69, start: 2.95, duration: 0.55, velocity: 0.63, confidence: 0.90 },
    { pitch: 65, start: 3.55, duration: 1.1,  velocity: 0.60, confidence: 0.93 },
  ],
  // 旋律 E — D 小调，下行感伤
  [
    { pitch: 74, start: 0.0,  duration: 0.45, velocity: 0.70, confidence: 0.92 },
    { pitch: 72, start: 0.5,  duration: 0.45, velocity: 0.67, confidence: 0.90 },
    { pitch: 69, start: 1.0,  duration: 0.45, velocity: 0.65, confidence: 0.91 },
    { pitch: 67, start: 1.5,  duration: 0.65, velocity: 0.68, confidence: 0.93 },
    { pitch: 65, start: 2.2,  duration: 0.45, velocity: 0.63, confidence: 0.89 },
    { pitch: 62, start: 2.7,  duration: 0.45, velocity: 0.60, confidence: 0.88 },
    { pitch: 62, start: 3.2,  duration: 1.0,  velocity: 0.65, confidence: 0.94 },
  ],
];

export function buildFixtureTranscriptionResult(
  index = 0,
): TranscriptionResult {
  const safeIndex = ((index % FIXTURE_MELODIES.length) + FIXTURE_MELODIES.length) % FIXTURE_MELODIES.length;
  const rawNotes = FIXTURE_MELODIES[safeIndex]!;
  const cleanMelody = polishMelody(rawNotes);
  const melodies = buildTranscriptionMelodies(rawNotes, cleanMelody);
  const selectedMelodyKind = chooseGenerationMelodyKind({ melodies });

  return {
    provider: "fixture",
    rawNotes,
    melodies,
    selectedMelodyKind,
    cleanMelody: melodies.corrected,
    warnings: [],
    diagnostics: {
      duration: melodies.corrected.duration,
      snr: null,
      voicedRatio: null,
      selectedMelodyKind,
    },
  };
}

export async function transcribeFixture(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  void input;
  await new Promise((r) => setTimeout(r, 500));

  // 随机选一段旋律，保证演示有变化
  const idx = Math.floor(Math.random() * FIXTURE_MELODIES.length);
  return buildFixtureTranscriptionResult(idx);
}
