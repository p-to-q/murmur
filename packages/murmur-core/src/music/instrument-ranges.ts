/**
 * Instrument MIDI ranges.
 *
 * Each entry declares the playable MIDI range for one Murmur instrument.
 * The audio pipeline's clampPitchToInstrument(melody, instrumentId)
 * transposes notes by full octaves until every note is inside the range.
 *
 * This is the literal answer to the v2 brief:
 *   "限制在特定的乐器范围内"
 *
 * Authoritative reference: docs/audio-pipeline-redesign.md §4.6.
 *
 * Range source: standard concert-pitch playable ranges; conservative
 * floors / ceilings to keep arrangements musically usable on the Murmur
 * synth engines, not pure instrument theory bounds.
 *
 * Adding an instrument: append here, register in
 * apps/web/src/lib/music/simple-synth.ts (the runtime voice), and add a
 * fixture for the golden master test (docs/testing-strategy.md §6).
 */

/**
 * Stable instrument ids — match `ensemble.melody.instrument` strings used
 * by apps/web/src/modules/strummer/generate-versions.ts.
 *
 * Keep in sync with EditToken instrument-swap targets in
 * apps/web/src/modules/strummer/apply-edit.ts (melody_piano, etc.).
 */
export type InstrumentId =
  | "piano"
  | "bell"
  | "electric_piano"
  | "acoustic_guitar"
  | "marimba"
  | "synth_lead"
  | "arp_synth"
  | "cello_pad"
  | "upright_bass"
  | "soft_bass"
  | "synth_bass"
  | "sub_bass";

export interface InstrumentRange {
  /** Lowest playable MIDI pitch (inclusive). C-1 = 0; A4 = 69. */
  lowMidi: number;
  /** Highest playable MIDI pitch (inclusive). */
  highMidi: number;
  /**
   * Whether this instrument is a valid **melody** carrier. Bass-class
   * instruments are excluded; the clamp helper rejects them as melody
   * targets.
   */
  canCarryMelody: boolean;
  /** Friendly label for diagnostics. */
  label: string;
}

export const INSTRUMENT_RANGES: Readonly<Record<InstrumentId, InstrumentRange>> = Object.freeze({
  piano:           { lowMidi: 21, highMidi: 108, canCarryMelody: true,  label: "Piano" },
  bell:            { lowMidi: 67, highMidi: 96,  canCarryMelody: true,  label: "Bell" },
  electric_piano:  { lowMidi: 36, highMidi: 96,  canCarryMelody: true,  label: "Electric Piano" },
  acoustic_guitar: { lowMidi: 40, highMidi: 76,  canCarryMelody: true,  label: "Acoustic Guitar" },
  marimba:         { lowMidi: 45, highMidi: 84,  canCarryMelody: true,  label: "Marimba" },
  synth_lead:      { lowMidi: 48, highMidi: 96,  canCarryMelody: true,  label: "Synth Lead" },
  arp_synth:       { lowMidi: 48, highMidi: 96,  canCarryMelody: true,  label: "Arp Synth" },
  cello_pad:       { lowMidi: 36, highMidi: 72,  canCarryMelody: true,  label: "Cello Pad" },
  upright_bass:    { lowMidi: 28, highMidi: 55,  canCarryMelody: false, label: "Upright Bass" },
  soft_bass:       { lowMidi: 28, highMidi: 55,  canCarryMelody: false, label: "Soft Bass" },
  synth_bass:      { lowMidi: 24, highMidi: 55,  canCarryMelody: false, label: "Synth Bass" },
  sub_bass:        { lowMidi: 24, highMidi: 48,  canCarryMelody: false, label: "Sub Bass" },
});

/**
 * Minimal melody-note shape this helper consumes. The full MelodyNote
 * type lives in shared-types/ once the carve-out lands; this is the
 * forward-compatible subset.
 */
export interface PitchedNote {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
  confidence: number;
}

/**
 * Transpose every note up or down by full octaves until every note is
 * inside the instrument's range. Preserves contour shape and relative
 * pitch.
 *
 * Strategy: compute the median pitch, find the smallest k such that
 * median + 12k is inside the range, apply that shift to all notes,
 * then clip any stragglers individually if the spread still leaves
 * outliers (rare for typical hums of 6–24 notes).
 *
 * Throws if the instrument is not a melody carrier — bass-class
 * instruments should not be the melody target.
 */
export function clampPitchToInstrument(
  notes: PitchedNote[],
  instrumentId: InstrumentId,
): PitchedNote[] {
  const range = INSTRUMENT_RANGES[instrumentId];
  if (!range) {
    throw new Error(`Unknown instrument id: ${instrumentId}`);
  }
  if (!range.canCarryMelody) {
    throw new Error(`Instrument ${instrumentId} is not a melody carrier`);
  }
  if (range.highMidi - range.lowMidi < 12) {
    throw new Error(
      `Instrument ${instrumentId} range must span at least one octave`,
    );
  }
  if (notes.length === 0) return notes;

  const median = medianPitch(notes);
  const target = (range.lowMidi + range.highMidi) / 2;
  // Shift in whole octaves toward the target.
  const octaveShift = Math.round((target - median) / 12);

  const shifted = notes.map((note) => ({
    ...note,
    pitch: note.pitch + octaveShift * 12,
  }));

  // Catch stragglers — wrap individually by full octaves.
  return shifted.map((note) => {
    let pitch = note.pitch;
    while (pitch < range.lowMidi) pitch += 12;
    while (pitch > range.highMidi) pitch -= 12;
    return { ...note, pitch };
  });
}

function medianPitch(notes: PitchedNote[]): number {
  const sorted = [...notes].map((n) => n.pitch).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 60;
  return ((sorted[mid - 1] ?? 60) + (sorted[mid] ?? 60)) / 2;
}
