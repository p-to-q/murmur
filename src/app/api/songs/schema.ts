import { z } from "zod";

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
  bucket: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1),
  year: z.string().min(1),
  source: z.string().min(1),
  sourceUrl: z.string().min(1),
  imagePath: z.string().min(1),
  license: z.enum(["CC0", "Public Domain"]),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    scale: z.number(),
  }),
});

export const visualFacetsSchema = z.object({
  genre: z.string().optional(),
  mood: z.string().optional(),
  instrument: z.string().optional(),
  scene: z.string().optional(),
  energy: z.number().optional(),
  bucket: z.string().optional(),
});

export const visualConfigSchema = z.object({
  preset: z.string().min(1),
  gradient: z.string().min(1),
  particleDensity: z.number(),
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
