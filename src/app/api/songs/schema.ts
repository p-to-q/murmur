import { z } from "zod";
import { VISUAL_ARTWORK_BUCKETS, VISUAL_ARTWORK_SOURCES } from "@/modules/shared/types";

// Shared, bounded field schemas used by BOTH the create and update song routes
// (#311) so the two boundaries can never drift. Collections are bounded by
// count as well as element length; invalid values raise an explicit validation
// error rather than silently falling back.
export const sourceMelodyKindSchema = z.enum(["intent", "corrected", "musical"]);

const TAG_MAX_LENGTH = 100;
const TAG_MAX_COUNT = 32;
export const songTagsSchema = z.array(z.string().max(TAG_MAX_LENGTH)).max(TAG_MAX_COUNT);

const PALETTE_MAX_LENGTH = 64;
const PALETTE_MAX_COUNT = 16;
export const artworkPaletteSchema = z
  .array(z.string().max(PALETTE_MAX_LENGTH))
  .max(PALETTE_MAX_COUNT);

export const trackStateSchema = z.object({
  enabled: z.boolean(),
  intensity: z.number(),
  originalPattern: z.string().max(1000),
  currentPattern: z.string().max(1000),
  instrument: z.string().max(100),
  versionHistory: z.array(z.string().max(1000)),
  melodyPitchSequence: z.array(z.number()).optional(),
  chordsTag: z.string().max(200).optional(),
  bassPattern: z.string().max(1000).optional(),
  drumsPattern: z.string().max(1000).optional(),
  texturePreset: z.string().max(200).optional(),
});

export const arrangementStateSchema = z.object({
  melody: trackStateSchema,
  chords: trackStateSchema,
  strings: trackStateSchema,
  drums: trackStateSchema,
  bass: trackStateSchema,
  texture: trackStateSchema,
});

export const visualArtworkSchema = z.object({
  id: z.string().min(1).max(100),
  bucket: z.enum(VISUAL_ARTWORK_BUCKETS),
  title: z.string().min(1).max(200),
  artist: z.string().min(1).max(100),
  year: z.string().min(1).max(20),
  source: z.enum(VISUAL_ARTWORK_SOURCES),
  sourceUrl: z.string().min(1).max(1000),
  imagePath: z.string().min(1).max(500),
  backgroundImagePath: z.string().min(1).max(500).optional(),
  license: z.enum(["CC0", "Public Domain"]),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number().min(0.1),
  }),
  palette: artworkPaletteSchema.optional(),
  renderTreatment: z.object({
    intent: z.string().max(200).optional(),
    cropFormat: z.string().max(100).optional(),
    recommendedOverlay: z.number().min(0).max(1).optional(),
    contrast: z.string().max(100).optional(),
    grain: z.string().max(100).optional(),
  }).optional(),
});

export const visualFacetsSchema = z.object({
  genre: z.string().max(100).optional(),
  mood: z.string().max(100).optional(),
  instrument: z.string().max(100).optional(),
  scene: z.string().max(200).optional(),
  energy: z.number().min(0).max(1).optional(),
  bucket: z.enum(VISUAL_ARTWORK_BUCKETS).optional(),
});

export const visualConfigSchema = z.object({
  preset: z.string().min(1).max(100),
  gradient: z.string().min(1).max(200),
  particleDensity: z.number().min(0).max(1),
  pulseSource: z.enum(["drums", "melody", "energy"]),
  posterBg: z.string().max(200).optional(),
  artwork: visualArtworkSchema.optional(),
  visualFacets: visualFacetsSchema.optional(),
});

// Canonical editable melody persisted alongside the playback artifact (#297).
// Note count is bounded here (#311) so a corrupt/oversized melody can't land in
// jsonb; readSongArtifact independently re-validates on the way out.
export const melodyNoteSchema = z.object({
  pitch: z.number(),
  start: z.number(),
  duration: z.number(),
  velocity: z.number(),
  confidence: z.number(),
});

export const cleanMelodySchema = z.object({
  notes: z.array(melodyNoteSchema).max(2048),
  key: z.string().min(1).max(20),
  scale: z.enum(["major", "minor", "pentatonic", "dorian", "phrygian"]),
  bpm: z.number(),
  duration: z.number(),
  contour: z.enum(["rising", "falling", "wave", "flat"]),
});

// Creation provenance persisted on save (#297): flow, recording op, generation
// batch/clip, draft. All optional; bounded strings.
export const songProvenanceSchema = z.object({
  flow: z.string().max(256).optional(),
  draftId: z.string().max(256).optional(),
  recordingOperationId: z.string().max(256).optional(),
  generationBatchId: z.string().max(256).optional(),
  generationClipId: z.string().max(256).optional(),
  generationAudioSha256: z.string().regex(/^[0-9a-f]{64}$/i).transform((value) => value.toLowerCase()).optional(),
  generationBatchIndex: z.number().int().optional(),
  sourceType: z.enum(["hum", "demo", "library"]).optional(),
  captureQuality: z.literal("reduced").optional(),
});

const strictTrackStateSchema = trackStateSchema.strict();

export const strictArrangementStateSchema = z.object({
  melody: strictTrackStateSchema,
  chords: strictTrackStateSchema,
  strings: strictTrackStateSchema,
  drums: strictTrackStateSchema,
  bass: strictTrackStateSchema,
  texture: strictTrackStateSchema,
}).strict();

export const strictVisualConfigSchema = visualConfigSchema.strict();
