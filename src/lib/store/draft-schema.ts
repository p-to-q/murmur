import { validateCleanMelody } from "@/modules/music/song-artifact";
import type {
  ArrangementState,
  EditDepth,
  MelodySelectionKind,
  TrackState,
  VersionGeneration,
  VersionGenerationErrorCode,
  VibeVersion,
  VisualConfig,
} from "@/modules/shared/types";
import type { CreationRoute } from "./murmur-store";

/**
 * Versioned runtime parser for persisted Vibe drafts (#315).
 *
 * Before this, the store validated only the outer record/array shape and then
 * cast nested data straight to VibeVersion — so a malformed or older draft
 * (corrupt melody, missing track, bad generation status) could enter the live
 * store and crash the demo path. Here every nested field is validated: a
 * structurally broken version is DROPPED (not restored), soft fields are
 * migrated to safe defaults, and nothing throws.
 */

const CREATION_ROUTES = new Set<CreationRoute>(["/vibe", "/studio", "/studio/name"]);
const SOURCE_TYPES = new Set<VibeVersion["sourceType"]>(["hum", "demo", "library"]);
const MELODY_KINDS = new Set<MelodySelectionKind>(["intent", "corrected", "musical"]);
const EDIT_DEPTHS = new Set<EditDepth>(["fresh", "shaped", "reworked"]);
const GENERATION_STATUSES = new Set(["pending", "ready", "error"]);
const GENERATION_ERROR_CODES = new Set<VersionGenerationErrorCode>([
  "background_canceled",
  "insufficient_notes",
  "rate_limited",
  "billing_unavailable",
  "worker_unconfigured",
  "worker_unavailable",
  "worker_overloaded",
  "server_error",
  "network_error",
]);
const PULSE_SOURCES = new Set<VisualConfig["pulseSource"]>(["drums", "melody", "energy"]);
const ARRANGEMENT_TRACKS = [
  "melody",
  "chords",
  "strings",
  "drums",
  "bass",
  "texture",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function optionalStringOrNull(value: unknown): string | null {
  return nonEmptyString(value) ? value : null;
}

function parseTrackState(value: unknown): TrackState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.enabled !== "boolean" ||
    !isFiniteNumber(value.intensity) ||
    typeof value.originalPattern !== "string" ||
    typeof value.currentPattern !== "string" ||
    typeof value.instrument !== "string"
  ) {
    return null;
  }
  const versionHistory = Array.isArray(value.versionHistory)
    ? value.versionHistory.filter((entry): entry is string => typeof entry === "string")
    : [];
  const track: TrackState = {
    enabled: value.enabled,
    intensity: value.intensity,
    originalPattern: value.originalPattern,
    currentPattern: value.currentPattern,
    instrument: value.instrument,
    versionHistory,
  };
  if (Array.isArray(value.melodyPitchSequence)) {
    track.melodyPitchSequence = value.melodyPitchSequence.filter(isFiniteNumber);
  }
  if (typeof value.chordsTag === "string") track.chordsTag = value.chordsTag;
  if (typeof value.bassPattern === "string") track.bassPattern = value.bassPattern;
  if (typeof value.drumsPattern === "string") track.drumsPattern = value.drumsPattern;
  if (typeof value.texturePreset === "string") track.texturePreset = value.texturePreset;
  return track;
}

function parseArrangementState(value: unknown): ArrangementState | null {
  if (!isRecord(value)) return null;
  const tracks: Partial<Record<(typeof ARRANGEMENT_TRACKS)[number], TrackState>> = {};
  for (const name of ARRANGEMENT_TRACKS) {
    const track = parseTrackState(value[name]);
    if (!track) return null;
    tracks[name] = track;
  }
  return tracks as ArrangementState;
}

function parseVisualConfig(value: unknown): VisualConfig | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.preset) ||
    !nonEmptyString(value.gradient) ||
    !isFiniteNumber(value.particleDensity) ||
    !PULSE_SOURCES.has(value.pulseSource as VisualConfig["pulseSource"])
  ) {
    return null;
  }
  // artwork / visualFacets / posterBg are passed through as-is: they are render
  // hints, not correctness-critical, and default cleanly when absent.
  const config: VisualConfig = {
    preset: value.preset,
    gradient: value.gradient,
    particleDensity: value.particleDensity,
    pulseSource: value.pulseSource as VisualConfig["pulseSource"],
  };
  if (typeof value.posterBg === "string") config.posterBg = value.posterBg;
  if (isRecord(value.artwork)) config.artwork = value.artwork as VisualConfig["artwork"];
  if (isRecord(value.visualFacets)) {
    config.visualFacets = value.visualFacets as VisualConfig["visualFacets"];
  }
  return config;
}

function parseGeneration(value: unknown): VersionGeneration | null {
  if (!isRecord(value)) return null;
  if (value.engine !== "magenta") return null;
  if (typeof value.prompt !== "string") return null;
  if (!isRecord(value.vibeLabel) || typeof value.vibeLabel.zh !== "string" || typeof value.vibeLabel.en !== "string") {
    return null;
  }
  if (!GENERATION_STATUSES.has(value.status as string)) return null;
  if (!isFiniteNumber(value.durationSec) || !isFiniteNumber(value.batchIndex) || !isFiniteNumber(value.styleMix)) {
    return null;
  }
  const base = {
    engine: "magenta" as const,
    prompt: value.prompt,
    vibeLabel: { zh: value.vibeLabel.zh, en: value.vibeLabel.en },
    durationSec: value.durationSec,
    batchIndex: value.batchIndex,
    styleMix: value.styleMix,
    ...(typeof value.audioUrl === "string" ? { audioUrl: value.audioUrl } : {}),
    ...(isFiniteNumber(value.currentBalance) ? { currentBalance: value.currentBalance } : {}),
    ...(isFiniteNumber(value.cost) ? { cost: value.cost } : {}),
    ...(nonEmptyString(value.operationId) ? { operationId: value.operationId } : {}),
    ...(nonEmptyString(value.batchOperationId) ? { batchOperationId: value.batchOperationId } : {}),
  };

  if (value.status === "error") {
    if (typeof value.error !== "string") return null;
    if (!GENERATION_ERROR_CODES.has(value.errorCode as VersionGenerationErrorCode)) return null;
    return { ...base, status: "error", error: value.error, errorCode: value.errorCode as VersionGenerationErrorCode };
  }
  return { ...base, status: value.status as "pending" | "ready" };
}

/**
 * Parse one persisted version. Returns null (drop it) when a structurally
 * required field is missing or corrupt; migrates soft fields to safe defaults.
 */
export function parseVibeVersion(value: unknown): VibeVersion | null {
  if (!isRecord(value)) return null;
  if (!nonEmptyString(value.id) || !nonEmptyString(value.draftId) || !nonEmptyString(value.originFlowId)) {
    return null;
  }
  const melody = validateCleanMelody(value.melody);
  if (!melody) return null;
  const arrangementState = parseArrangementState(value.arrangementState);
  if (!arrangementState) return null;
  const visualConfig = parseVisualConfig(value.visualConfig);
  if (!visualConfig) return null;

  // A generated version whose generation block is corrupt cannot be trusted
  // (its saveability + audio hinge on it), so drop the whole version.
  let generation: VersionGeneration | undefined;
  if (value.generation !== undefined && value.generation !== null) {
    const parsed = parseGeneration(value.generation);
    if (!parsed) return null;
    generation = parsed;
  }

  const editCount = isFiniteNumber(value.editCount) ? Math.max(0, Math.round(value.editCount)) : 0;
  const version: VibeVersion = {
    id: value.id,
    draftId: value.draftId,
    originFlowId: value.originFlowId,
    parentSongId: optionalStringOrNull(value.parentSongId),
    rootSongId: optionalStringOrNull(value.rootSongId),
    lineageDepth: isFiniteNumber(value.lineageDepth) ? Math.max(0, Math.round(value.lineageDepth)) : 0,
    sourceType: SOURCE_TYPES.has(value.sourceType as VibeVersion["sourceType"])
      ? (value.sourceType as VibeVersion["sourceType"])
      : "hum",
    sourceMelodyKind: MELODY_KINDS.has(value.sourceMelodyKind as MelodySelectionKind)
      ? (value.sourceMelodyKind as MelodySelectionKind)
      : "corrected",
    editCount,
    editDepth: EDIT_DEPTHS.has(value.editDepth as EditDepth) ? (value.editDepth as EditDepth) : "fresh",
    versionSeed: typeof value.versionSeed === "string" ? value.versionSeed : "",
    title: typeof value.title === "string" ? value.title : "",
    vibe: typeof value.vibe === "string" ? value.vibe : "",
    tags: Array.isArray(value.tags) ? value.tags.filter((t): t is string => typeof t === "string") : [],
    melody,
    strummerCode: typeof value.strummerCode === "string" ? value.strummerCode : "",
    arrangementState,
    visualConfig,
    ...(generation ? { generation } : {}),
    ...(value.captureQuality === "reduced" ? { captureQuality: "reduced" as const } : {}),
  };
  return version;
}

export interface ParsedDraftState {
  vibeVersions: VibeVersion[];
  currentVersion: VibeVersion | null;
  currentDraftId: string | null;
  currentFlowId: string | null;
  activeCreationRoute: CreationRoute | null;
  draftUpdatedAt: number | null;
}

/**
 * Validate a persisted draft envelope of the expected version and parse its
 * nested state. Returns null when the envelope is the wrong version/shape or
 * every version was dropped as invalid. Never throws.
 */
export function parsePersistedDraft(
  raw: unknown,
  expectedVersion: number,
): ParsedDraftState | null {
  if (!isRecord(raw) || raw.version !== expectedVersion) return null;
  const state = raw.state;
  if (!isRecord(state)) return null;

  const vibeVersions = Array.isArray(state.vibeVersions)
    ? state.vibeVersions
        .map(parseVibeVersion)
        .filter((version): version is VibeVersion => version !== null)
    : [];
  const currentVersion = state.currentVersion != null ? parseVibeVersion(state.currentVersion) : null;

  if (vibeVersions.length === 0 && !currentVersion) return null;

  const activeCreationRoute = CREATION_ROUTES.has(state.activeCreationRoute as CreationRoute)
    ? (state.activeCreationRoute as CreationRoute)
    : null;

  return {
    vibeVersions,
    currentVersion,
    currentDraftId: optionalStringOrNull(state.currentDraftId),
    currentFlowId: optionalStringOrNull(state.currentFlowId),
    activeCreationRoute,
    draftUpdatedAt: isFiniteNumber(state.draftUpdatedAt) ? state.draftUpdatedAt : null,
  };
}
