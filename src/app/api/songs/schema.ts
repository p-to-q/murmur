import { z } from "zod";
import { VISUAL_ARTWORK_BUCKETS, VISUAL_ARTWORK_SOURCES } from "@/modules/shared/types";

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
  palette: z.array(z.string()).optional(),
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
