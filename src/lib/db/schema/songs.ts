import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

// ─── These types MUST stay in sync with src/modules/shared/types.ts ───────────

export interface TrackState {
  enabled: boolean;
  intensity: number;        // 0.0–1.0
  originalPattern: string;  // NEVER deleted — required for undo
  /**
   * @deprecated since v2; use melodyPitchSequence / chordsTag / bassPattern /
   * drumsPattern / texturePreset. Removed v3.
   */
  currentPattern: string;
  instrument: string;
  versionHistory: string[];
  melodyPitchSequence?: number[];
  chordsTag?: string;
  bassPattern?: string;
  drumsPattern?: string;
  texturePreset?: string;
}

// ArrangementState: 6 tracks — melody, chords, strings, drums, bass, texture
// "strings" is mandatory — do NOT remove; it is part of the default arrangement.
export interface ArrangementState {
  melody: TrackState;
  chords: TrackState;
  strings: TrackState;
  drums: TrackState;
  bass: TrackState;
  texture: TrackState;
}

// VisualConfig: matches src/modules/shared/types.ts VisualConfig exactly
export interface VisualArtworkCrop {
  x: number;
  y: number;
  scale: number;
}

export interface VisualArtwork {
  id: string;
  bucket: string;
  title: string;
  artist: string;
  year: string;
  source: string;
  sourceUrl: string;
  imagePath: string;
  backgroundImagePath?: string;
  license: "CC0" | "Public Domain";
  crop: VisualArtworkCrop;
  renderTreatment?: {
    intent?: string;
    cropFormat?: string;
    recommendedOverlay?: number;
    contrast?: string;
    grain?: string;
  };
}

export interface VisualFacets {
  genre?: string;
  mood?: string;
  instrument?: string;
  scene?: string;
  energy?: number;
  bucket?: string;
}

export interface VisualConfig {
  preset: string;              // e.g. "warm_particles"
  gradient: string;            // CSS gradient string (source of truth for colors)
  particleDensity: number;     // 0.0–1.0
  pulseSource: "drums" | "melody" | "energy";
  // posterBg is derived from gradient at render time — stored for convenience
  posterBg?: string;
  artwork?: VisualArtwork;
  visualFacets?: VisualFacets;
}

export type MelodySelectionKind = "intent" | "corrected" | "musical";
export type EditDepth = "fresh" | "shaped" | "reworked";
export type SongVisibility = "private" | "unlisted" | "public";

// ─── Drizzle table ─────────────────────────────────────────────────────────────

export const songs = pgTable(
  "songs",
  {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  vibe: text("vibe").notNull(),
  vibeEn: text("vibe_en").notNull().default(""),
  bpm: integer("bpm").notNull().default(80),
  keySignature: text("key_signature").notNull().default("C"),
  scaleType: text("scale_type").notNull().default("minor"),
  duration: integer("duration").notNull().default(0),
  parentSongId: text("parent_song_id"),
  rootSongId: text("root_song_id"),
  lineageDepth: integer("lineage_depth").notNull().default(0),
  sourceMelodyKind: text("source_melody_kind").notNull().default("corrected").$type<MelodySelectionKind>(),
  editCount: integer("edit_count").notNull().default(0),
  editDepth: text("edit_depth").notNull().default("fresh").$type<EditDepth>(),
  visibility: text("visibility").notNull().default("private").$type<SongVisibility>(),
  shareCode: text("share_code"),
  // Audio playback artifact.
  // DEPRECATED — legacy base64 data URL; read-only fallback for pre-#292 rows.
  // New saves upload through the object-storage adapter and leave this null.
  mp3DataUrl: text("mp3_data_url"),
  // Object-storage URL for newly rendered audio (R2 / S3 / 腾讯云 COS). Preferred
  // playback source; null until an object master exists.
  mp3Url: text("mp3_url"),
  // Storage key backing mp3Url — the durable reference used for re-derivation
  // and object-lifecycle deletion. Null for legacy/demo rows.
  mp3StorageKey: text("mp3_storage_key"),
  // JSON blobs
  visualConfig: jsonb("visual_config").$type<VisualConfig>().notNull(),
  arrangementState: jsonb("arrangement_state").$type<ArrangementState>().notNull(),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Every owner-scoped song query (gallery list, detail, update, delete,
    // share publish/revoke) filters by user_id; the list additionally orders
    // by created_at DESC. Without this index each of those is a sequential
    // scan over a table whose rows carry multi-MB audio/arrangement blobs.
    byUserCreated: index("songs_user_created_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export type Song = InferSelectModel<typeof songs>;
