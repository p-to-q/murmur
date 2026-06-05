import type { CleanMelody, MelodySelectionKind, SongCard, VibeVersion } from "@/modules/shared/types";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { deriveEditDepth, normalizeEditCount } from "./edit-depth";
import { VIBE_PRESETS, type VibeId } from "@/presets/vibes";
import { buildRemixLineage, normalizeLineageDepth, resolveParentSongId, resolveRootSongId } from "./lineage";

type SavedSong = SongCard & {
  bpm?: number | null;
  keySignature?: string | null;
  sourceMelodyKind?: MelodySelectionKind;
};

export function hydrateSavedSongToVersion(song: SavedSong): VibeVersion {
  const melody = buildMelodyFromSong(song);

  return {
    id: `saved-${song.id}`,
    draftId: song.id,
    originFlowId: `saved-${song.id}`,
    parentSongId: resolveParentSongId(song),
    rootSongId: resolveRootSongId(song),
    lineageDepth: normalizeLineageDepth(song.lineageDepth),
    sourceType: "library",
    sourceMelodyKind: song.sourceMelodyKind ?? "corrected",
    editCount: normalizeEditCount(song.editCount),
    editDepth: song.editDepth ?? deriveEditDepth(normalizeEditCount(song.editCount)),
    versionSeed: `saved-${song.id}`,
    title: song.title,
    vibe: song.vibe,
    tags: [],
    melody,
    strummerCode: "",
    arrangementState: song.arrangementState,
    visualConfig: song.visualConfig,
  };
}

export function buildSavedSongVibeVersions(song: SavedSong): VibeVersion[] {
  const version = hydrateSavedSongToVersion(song);
  const preferredVibeId = resolvePreferredSavedSongVibeId(song);
  const preferredVibeMode =
    version.editDepth === "reworked"
      ? "anchor"
      : version.editDepth === "shaped"
        ? "boost"
        : undefined;
  const remixLineage = buildRemixLineage(song);

  return generateVibeVersions(version.melody, {
    draftId: song.id,
    originFlowId: `saved-${song.id}`,
    parentSongId: remixLineage.parentSongId,
    rootSongId: remixLineage.rootSongId,
    lineageDepth: remixLineage.lineageDepth,
    sourceType: "library",
    sourceMelodyKind: version.sourceMelodyKind,
    preferredVibeId,
    preferredVibeMode,
  });
}

function buildMelodyFromSong(song: SavedSong): CleanMelody {
  const sequence =
    song.arrangementState.melody.melodyPitchSequence?.filter(isMidiPitch) ??
    song.arrangementState.melody.currentPattern
      .split(" ")
      .map(Number)
      .filter(isMidiPitch);

  const bpm = normalizeBpm(song.bpm);
  const beatSeconds = 60 / bpm;
  const noteDuration = Number((beatSeconds * 0.9).toFixed(3));
  const notes = sequence.map((pitch, index) => ({
    pitch,
    start: Number((index * beatSeconds).toFixed(3)),
    duration: noteDuration,
    velocity: 0.66,
    confidence: 0.82,
  }));

  return {
    notes,
    key: normalizeKey(song.keySignature),
    scale: inferScaleFromVibe(song.vibe),
    bpm,
    duration:
      notes.length === 0
        ? 0
        : Number((notes[notes.length - 1]!.start + notes[notes.length - 1]!.duration).toFixed(3)),
    contour: inferContour(sequence),
  };
}

function normalizeBpm(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 40 || value > 220) {
    return 80;
  }
  return Math.round(value);
}

function normalizeKey(value: string | null | undefined): string {
  if (!value || typeof value !== "string") return "C";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "C";
}

function inferScaleFromVibe(vibe: string): CleanMelody["scale"] {
  const lower = vibe.toLowerCase();
  if (/(暖|晴|sun|gold|dawn|light)/.test(lower)) return "major";
  if (/(旅|folk|road|field|wood)/.test(lower)) return "pentatonic";
  return "minor";
}

function inferContour(sequence: number[]): CleanMelody["contour"] {
  if (sequence.length < 2) return "flat";

  let rises = 0;
  let falls = 0;

  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index]! > sequence[index - 1]!) rises += 1;
    if (sequence[index]! < sequence[index - 1]!) falls += 1;
  }

  if (rises > 0 && falls > 0) return "wave";
  if (rises > 0) return "rising";
  if (falls > 0) return "falling";
  return "flat";
}

function isMidiPitch(value: number): boolean {
  return Number.isFinite(value) && value >= 21 && value <= 108;
}

function resolvePreferredSavedSongVibeId(song: SavedSong): VibeId | undefined {
  const candidate =
    song.arrangementState.chords.chordsTag ??
    song.arrangementState.texture.texturePreset;

  if (typeof candidate !== "string") return undefined;
  return VIBE_PRESETS.some((preset) => preset.id === candidate)
    ? (candidate as VibeId)
    : undefined;
}
