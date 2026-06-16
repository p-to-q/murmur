import { z } from "zod";
import { VISUAL_ARTWORK_BUCKETS, VISUAL_ARTWORK_SOURCES } from "@/modules/shared/types";

export const trackStateSchema = z.object({
  enabled: z.boolean(),
  intensity: z.number(),
  originalPattern: z.string(),
  currentPattern: z.string(),
  instrument: z.string(),
  versionHistory: z.array(z.string()),
  melodyPitchSequence: z.array(z.number()).optional(),
  chordsTag: z.string().optional(),
  bassPattern: z.string().optional(),
  drumsPattern: z.string().optional(),
  texturePreset: z.string().optional(),
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
  id: z.string().min(1),
  bucket: z.enum(VISUAL_ARTWORK_BUCKETS),
  title: z.string().min(1),
  artist: z.string().min(1),
  year: z.string().min(1),
  source: z.enum(VISUAL_ARTWORK_SOURCES),
  sourceUrl: z.string().min(1),
  imagePath: z.string().min(1),
  backgroundImagePath: z.string().min(1).optional(),
  license: z.enum(["CC0", "Public Domain"]),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number().min(0.1),
  }),
  renderTreatment: z.object({
    intent: z.string().optional(),
    cropFormat: z.string().optional(),
    recommendedOverlay: z.number().min(0).max(1).optional(),
    contrast: z.string().optional(),
    grain: z.string().optional(),
  }).optional(),
});

export const visualFacetsSchema = z.object({
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrument: z.string().optional(),
  scene: z.string().optional(),
  energy: z.number().min(0).max(1).optional(),
  bucket: z.enum(VISUAL_ARTWORK_BUCKETS).optional(),
});

export const visualConfigSchema = z.object({
  preset: z.string().min(1),
  gradient: z.string().min(1),
  particleDensity: z.number().min(0).max(1),
  pulseSource: z.enum(["drums", "melody", "energy"]),
  posterBg: z.string().optional(),
  artwork: visualArtworkSchema.optional(),
  visualFacets: visualFacetsSchema.optional(),
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
