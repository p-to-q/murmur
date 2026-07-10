// Stainer is the recognition orchestration layer.
// The naming follows the product doc: Stainer (recognition facade) →
// adapters (Basic Pitch TS, Python worker, future VibeDrive, or fixture).

export interface MelodyNote {
  pitch: number; // MIDI pitch (0–127)
  start: number; // seconds
  duration: number; // seconds
  velocity: number; // 0–127
  confidence?: number; // 0–1 from model
}

export interface CleanMelody {
  notes: MelodyNote[];
  key: string; // "C", "D#", etc.
  scale: "major" | "minor";
  bpm: number;
  contour: "rising" | "falling" | "wave" | "flat";
  noteDensity: number; // 0–1
}

export interface TranscriptionInput {
  audioBlob: Blob; // WAV/WebM/etc.
  maxDuration?: number; // seconds
}

export interface TranscriptionResult {
  success: boolean;
  cleanMelody?: CleanMelody;
  error?: string;
}

export interface TranscriptionProvider {
  name: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

// --- Stainer public API ---

let activeProvider: TranscriptionProvider | null = null;

export function setProvider(provider: TranscriptionProvider) {
  activeProvider = provider;
}

export async function transcribeHum(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  if (!activeProvider) {
    return {
      success: false,
      error: "No transcription provider set. Call setProvider() first.",
    };
  }
  return activeProvider.transcribe(input);
}

// --- Melody polish helpers (shared across all providers) ---

export function estimateKey(notes: MelodyNote[]): { key: string; scale: "major" | "minor" } {
  if (notes.length === 0) return { key: "C", scale: "major" };

  // Count pitch classes (mod 12)
  const pcCounts: Record<number, number> = {};
  notes.forEach((n) => {
    const pc = n.pitch % 12;
    pcCounts[pc] = (pcCounts[pc] || 0) + (n.duration * n.velocity);
  });

  // Simple heuristic: find root with highest weighted count
  const pcList = Object.keys(pcCounts)
    .map((k) => [parseInt(k), pcCounts[parseInt(k)] ?? 0] as [number, number])
    .sort((a, b) => b[1] - a[1]);

  const root = pcList[0]?.[0] ?? 0;
  const pitchClasses = new Set(Object.keys(pcCounts).map((k) => parseInt(k)));
  const minorIntervals = [0, 2, 3, 5, 7, 8, 10]; // natural minor
  const majorIntervals = [0, 2, 4, 5, 7, 9, 11];

  const minorMatch = minorIntervals.filter((i) =>
    pitchClasses.has((root + i) % 12)
  ).length;
  const majorMatch = majorIntervals.filter((i) =>
    pitchClasses.has((root + i) % 12)
  ).length;

  const scale = minorMatch > majorMatch ? "minor" : "major";
  const keyNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const key = keyNames[root] ?? "C";
  return { key, scale };
}

export function estimateBPM(notes: MelodyNote[]): number {
  if (notes.length < 2) return 80;

  // Compute onset intervals
  const intervals: number[] = [];
  for (let i = 1; i < notes.length; i++) {
    intervals.push((notes[i]?.start ?? 0) - (notes[i - 1]?.start ?? 0));
  }
  if (intervals.length === 0) return 80;

  // Find median interval
  const sorted = intervals.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0.5;
  const bpm = 60 / mid;

  // Clamp to reasonable range
  return Math.max(60, Math.min(140, Math.round(bpm / 5) * 5));
}

export function estimateContour(notes: MelodyNote[]): "rising" | "falling" | "wave" | "flat" {
  if (notes.length < 3) return "flat";

  let ups = 0;
  let downs = 0;
  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1]?.pitch ?? 0;
    const curr = notes[i]?.pitch ?? 0;
    if (curr > prev) ups++;
    if (curr < prev) downs++;
  }
  if (ups > downs * 1.5) return "rising";
  if (downs > ups * 1.5) return "falling";
  if (Math.abs(ups - downs) < 3) return "flat";
  return "wave";
}

export function computeNoteDensity(notes: MelodyNote[], totalDuration: number): number {
  if (totalDuration === 0) return 0;
  const totalNoteDuration = notes.reduce((sum, n) => sum + n.duration, 0);
  return Math.min(1, totalNoteDuration / totalDuration);
}
