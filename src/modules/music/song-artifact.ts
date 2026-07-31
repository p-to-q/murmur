import type { CleanMelody, MelodyNote, SongProvenance } from "@/modules/shared/types";

/**
 * Artifact/schema version for saved songs (#297).
 *
 * A saved song bundles a playback artifact (mp3Url / legacy mp3DataUrl), an
 * editable source (melody + arrangementState + visualConfig), lineage, and
 * provenance. `artifactVersion` versions that whole bundle so read paths can
 * branch without guessing:
 *   - v1: legacy rows — base64 playback, no persisted `melody`; melody is
 *     reconstructed from arrangementState pitch sequences (today's behavior).
 *   - v2: #297 rows — object-storage playback, canonical `melody` + provenance
 *     persisted; high-fidelity replay is possible.
 */
export const SONG_ARTIFACT_VERSION = 2;

const MELODY_SCALES = new Set<CleanMelody["scale"]>([
  "major",
  "minor",
  "pentatonic",
  "dorian",
  "phrygian",
]);
const MELODY_CONTOURS = new Set<CleanMelody["contour"]>([
  "rising",
  "falling",
  "wave",
  "flat",
]);
const PROVENANCE_SOURCE_TYPES = new Set(["hum", "demo", "library"]);
// Bound on persisted note count — a canonical melody far larger than this is
// almost certainly corrupt, and we never want an unbounded jsonb into playback.
const MAX_MELODY_NOTES = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateMelodyNote(value: unknown): MelodyNote | null {
  if (!isRecord(value)) return null;
  const { pitch, start, duration, velocity, confidence } = value;
  if (
    !isFiniteNumber(pitch) ||
    !isFiniteNumber(start) ||
    !isFiniteNumber(duration) ||
    !isFiniteNumber(velocity) ||
    !isFiniteNumber(confidence)
  ) {
    return null;
  }
  return { pitch, start, duration, velocity, confidence };
}

/**
 * Runtime validator for a persisted CleanMelody. Returns a cleaned melody or
 * null; never throws. Malformed nested notes are dropped so a partially
 * corrupt melody degrades instead of crashing the reader/editor (shared with
 * the draft parser, #315).
 */
export function validateCleanMelody(value: unknown): CleanMelody | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.notes)) return null;
  if (value.notes.length > MAX_MELODY_NOTES) return null;
  const notes: MelodyNote[] = [];
  for (const raw of value.notes) {
    const note = validateMelodyNote(raw);
    if (note) notes.push(note);
  }
  if (typeof value.key !== "string") return null;
  if (!MELODY_SCALES.has(value.scale as CleanMelody["scale"])) return null;
  if (!isFiniteNumber(value.bpm)) return null;
  if (!isFiniteNumber(value.duration)) return null;
  if (!MELODY_CONTOURS.has(value.contour as CleanMelody["contour"])) return null;
  return {
    notes,
    key: value.key,
    scale: value.scale as CleanMelody["scale"],
    bpm: value.bpm,
    duration: value.duration,
    contour: value.contour as CleanMelody["contour"],
  };
}

/** Runtime validator for persisted provenance. Returns null when absent/garbage. */
export function validateSongProvenance(value: unknown): SongProvenance | null {
  if (!isRecord(value)) return null;
  const out: SongProvenance = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 && v.length <= 256 ? v : undefined;
  out.flow = str(value.flow);
  out.draftId = str(value.draftId);
  out.recordingOperationId = str(value.recordingOperationId);
  out.generationBatchId = str(value.generationBatchId);
  out.generationClipId = str(value.generationClipId);
  if (typeof value.generationAudioSha256 === "string"
      && /^[0-9a-f]{64}$/i.test(value.generationAudioSha256)) {
    out.generationAudioSha256 = value.generationAudioSha256.toLowerCase();
  }
  if (isFiniteNumber(value.generationBatchIndex)) {
    out.generationBatchIndex = value.generationBatchIndex;
  }
  if (PROVENANCE_SOURCE_TYPES.has(value.sourceType as string)) {
    out.sourceType = value.sourceType as SongProvenance["sourceType"];
  }
  if (value.captureQuality === "reduced") out.captureQuality = "reduced";
  // Drop an all-empty object so callers can treat "no provenance" as null.
  return Object.values(out).some((v) => v !== undefined) ? out : null;
}

export type SongPlaybackSource = "object" | "legacy_data_url" | "none";

export interface NormalizedSongArtifact {
  artifactVersion: number;
  melody: CleanMelody | null;
  provenance: SongProvenance | null;
  playbackUrl: string | null;
  playbackSource: SongPlaybackSource;
}

type SongArtifactRow = {
  artifactVersion?: number | null;
  melody?: unknown;
  provenance?: unknown;
  mp3Url?: string | null;
  mp3DataUrl?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Compatibility reader for a saved-song row of any artifact version (#297).
 * Legacy rows (no artifactVersion / melody) read as v1 with playback from the
 * base64 fallback; v2 rows expose the canonical melody + object playback. Never
 * throws — malformed melody/provenance degrade to null.
 */
export function readSongArtifact(row: SongArtifactRow): NormalizedSongArtifact {
  const objectUrl = nonEmpty(row.mp3Url);
  const legacyUrl = nonEmpty(row.mp3DataUrl);
  return {
    artifactVersion: isFiniteNumber(row.artifactVersion) ? row.artifactVersion : 1,
    melody: validateCleanMelody(row.melody),
    provenance: validateSongProvenance(row.provenance),
    playbackUrl: objectUrl ?? legacyUrl,
    playbackSource: objectUrl ? "object" : legacyUrl ? "legacy_data_url" : "none",
  };
}

/**
 * A saved song is an incomplete/draft artifact when it has no playable audio
 * (#291): render failed at save time, so it can be reopened but not shared or
 * downloaded. Gallery + song detail surface this state.
 */
export function isIncompleteSongArtifact(row: SongArtifactRow): boolean {
  return readSongArtifact(row).playbackSource === "none";
}

// ── Save fingerprint ──────────────────────────────────────────────────────
//
// A stable content hash of the canonical persisted payload. It lets the save
// route tell an exact replay (same id, same content → idempotent 200) apart
// from a same-id/different-payload conflict (409). Not security-sensitive, so a
// well-distributed non-cryptographic hash (cyrb53) is enough and keeps this
// module sync + client-safe.

type FingerprintInput = {
  title?: string;
  vibe?: string;
  vibeEn?: string;
  bpm?: number;
  keySignature?: string;
  scaleType?: string;
  duration?: number;
  sourceMelodyKind?: string;
  editCount?: number;
  editDepth?: string;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth?: number;
  tags?: string[];
  visualConfig?: unknown;
  arrangementState?: unknown;
  melody?: unknown;
  provenance?: unknown;
  mp3Url?: string | null;
  mp3StorageKey?: string | null;
  mp3DataUrl?: string | null;
  audioDigest?: string | null;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function cyrb53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, "0");
  const lo = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${hi}${lo}`;
}

/**
 * Compact, stable fingerprint of the canonical persisted fields. Audio is
 * reduced to its byte digest when available, then its durable identity for
 * legacy callers. A legacy data URL is hashed by content rather than length.
 */
export function computeSaveFingerprint(input: FingerprintInput): string {
  const audioIdentity =
    nonEmpty(input.audioDigest) ??
    nonEmpty(input.mp3StorageKey) ??
    nonEmpty(input.mp3Url) ??
    (input.mp3DataUrl ? `data-url:${cyrb53(input.mp3DataUrl)}` : null);

  const canonical = {
    title: input.title ?? "",
    vibe: input.vibe ?? "",
    vibeEn: input.vibeEn ?? "",
    bpm: input.bpm ?? 0,
    keySignature: input.keySignature ?? "",
    scaleType: input.scaleType ?? "",
    duration: input.duration ?? 0,
    sourceMelodyKind: input.sourceMelodyKind ?? "",
    editCount: input.editCount ?? 0,
    editDepth: input.editDepth ?? "",
    parentSongId: input.parentSongId ?? null,
    rootSongId: input.rootSongId ?? null,
    lineageDepth: input.lineageDepth ?? 0,
    tags: input.tags ?? [],
    visualConfig: input.visualConfig ?? null,
    arrangementState: input.arrangementState ?? null,
    melody: input.melody ?? null,
    provenance: input.provenance ?? null,
    audio: audioIdentity,
  };
  return cyrb53(stableStringify(canonical));
}
