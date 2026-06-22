import { hashString, mulberry32 } from "@/lib/music/seeded-random";
import { ARTWORK_CATALOG } from "./catalog";
import { ARTWORK_BUCKETS, toArtworkSelection } from "./types";
import type { ArtworkBucket, ArtworkCatalogEntry, ArtworkSelection } from "./types";

type ArtworkMatchFacets = {
  genre?: string;
  mood?: string;
  instrument?: string;
  scene?: string;
  energy?: number;
  bucket?: string;
};

const LEGACY_BUCKETS: Record<string, ArtworkBucket[]> = {
  sunset: ["pastoral_memory", "luminist_air", "sublime_terrain"],
  bedroom: ["interior_reverie", "pastoral_memory", "luminist_air"],
  cinematic: ["sublime_terrain", "luminist_air", "nocturne_metro"],
  party: ["stage_heat", "nocturne_metro", "hypermodern_void"],
  rain: ["nocturne_metro", "luminist_air", "tidal_mineral"],
  synth: ["hypermodern_void", "nocturne_metro", "printed_signal"],
};

const GENRE_BUCKETS: Record<string, ArtworkBucket[]> = {
  "lo-fi hip hop": ["interior_reverie", "pastoral_memory", "luminist_air"],
  synthwave: ["hypermodern_void", "nocturne_metro"],
  "city pop": ["nocturne_metro", "stage_heat", "interior_reverie"],
  "bossa nova": ["tidal_mineral", "pastoral_memory"],
  "ambient electronic": ["hypermodern_void", "luminist_air"],
  "jazz fusion": ["stage_heat", "nocturne_metro"],
  "dream pop instrumental": ["pastoral_memory", "luminist_air", "interior_reverie"],
  "funk groove": ["stage_heat", "nocturne_metro"],
  disco: ["stage_heat", "hypermodern_void"],
  "deep house": ["nocturne_metro", "hypermodern_void"],
  "drum and bass": ["hypermodern_void", "nocturne_metro", "tidal_mineral"],
  "trip hop": ["nocturne_metro", "interior_reverie", "luminist_air"],
  "post-rock": ["sublime_terrain", "tidal_mineral"],
  "neo-soul": ["interior_reverie", "stage_heat", "pastoral_memory"],
  afrobeat: ["tidal_mineral", "stage_heat"],
  "reggae dub": ["tidal_mineral", "nocturne_metro"],
  "flamenco guitar": ["stage_heat", "pastoral_memory"],
  "celtic folk": ["pastoral_memory", "sublime_terrain"],
  bluegrass: ["pastoral_memory", "sublime_terrain"],
  "solo piano": ["luminist_air", "interior_reverie"],
  "baroque chamber strings": ["printed_signal", "interior_reverie"],
  "cinematic film score": ["sublime_terrain", "luminist_air"],
  "epic orchestral": ["sublime_terrain", "hypermodern_void"],
  vaporwave: ["hypermodern_void", "nocturne_metro", "printed_signal"],
  chillwave: ["hypermodern_void", "luminist_air", "pastoral_memory"],
  "UK garage": ["nocturne_metro", "stage_heat"],
  breakbeat: ["hypermodern_void", "stage_heat", "nocturne_metro"],
  "surf rock": ["tidal_mineral", "stage_heat"],
  "psychedelic rock": ["hypermodern_void", "sublime_terrain", "printed_signal"],
  tango: ["stage_heat", "nocturne_metro", "interior_reverie"],
  "gamelan ensemble": ["printed_signal", "luminist_air"],
  "koto and shakuhachi": ["printed_signal", "luminist_air"],
  "guzheng meditation": ["printed_signal", "luminist_air"],
  "minimal techno": ["hypermodern_void", "printed_signal", "nocturne_metro"],
  "swing jazz": ["stage_heat", "interior_reverie"],
  "music box lullaby": ["interior_reverie", "luminist_air"],
};

const MOOD_BUCKETS: Record<string, ArtworkBucket[]> = {
  dreamy: ["luminist_air", "pastoral_memory", "interior_reverie"],
  melancholic: ["luminist_air", "nocturne_metro", "interior_reverie"],
  euphoric: ["stage_heat", "tidal_mineral", "hypermodern_void"],
  mysterious: ["printed_signal", "nocturne_metro", "sublime_terrain"],
  cozy: ["interior_reverie", "pastoral_memory"],
  nostalgic: ["pastoral_memory", "interior_reverie", "luminist_air"],
  triumphant: ["sublime_terrain", "stage_heat"],
  playful: ["stage_heat", "printed_signal", "tidal_mineral"],
  brooding: ["nocturne_metro", "sublime_terrain", "printed_signal"],
  serene: ["luminist_air", "tidal_mineral", "printed_signal"],
  hypnotic: ["hypermodern_void", "printed_signal", "tidal_mineral"],
  bittersweet: ["pastoral_memory", "interior_reverie", "luminist_air"],
  glowing: ["tidal_mineral", "luminist_air", "hypermodern_void"],
  weightless: ["hypermodern_void", "luminist_air"],
  smoky: ["nocturne_metro", "interior_reverie"],
  starlit: ["hypermodern_void", "sublime_terrain", "nocturne_metro"],
};

function normalized(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

const ARTWORK_BUCKET_SET = new Set<ArtworkBucket>(ARTWORK_BUCKETS);

function isArtworkBucket(value: string | undefined): value is ArtworkBucket {
  return !!value && ARTWORK_BUCKET_SET.has(value as ArtworkBucket);
}

function bucketAffinity(bucket: ArtworkBucket, facets: ArtworkMatchFacets): number {
  let score = 0;
  const explicitBuckets = isArtworkBucket(facets.bucket) ? [facets.bucket] : [];
  const genreBuckets = GENRE_BUCKETS[normalized(facets.genre)] ?? [];
  const moodBuckets = MOOD_BUCKETS[normalized(facets.mood)] ?? [];
  const legacyBuckets = LEGACY_BUCKETS[normalized(facets.genre)] ?? [];
  if (explicitBuckets.includes(bucket)) score += 5;
  score += Math.max(0, 3 - genreBuckets.indexOf(bucket)) * (genreBuckets.includes(bucket) ? 1 : 0);
  score += Math.max(0, 3 - moodBuckets.indexOf(bucket)) * (moodBuckets.includes(bucket) ? 0.95 : 0);
  score += Math.max(0, 3 - legacyBuckets.indexOf(bucket)) * (legacyBuckets.includes(bucket) ? 0.8 : 0);

  const scene = normalized(facets.scene);
  if (scene.includes("rain") || scene.includes("midnight drive") || scene.includes("neon")) {
    if (bucket === "nocturne_metro" || bucket === "hypermodern_void") score += 1.2;
  }
  if (scene.includes("winter") || scene.includes("fog")) {
    if (bucket === "luminist_air" || bucket === "sublime_terrain") score += 1;
  }
  if (scene.includes("underwater")) {
    if (bucket === "tidal_mineral" || bucket === "hypermodern_void") score += 1;
  }

  return score;
}

function recordAffinity(entry: ArtworkCatalogEntry, facets: ArtworkMatchFacets): number {
  const genre = normalized(facets.genre);
  const mood = normalized(facets.mood);
  let score = bucketAffinity(entry.bucket, facets);
  score += entry.genreWeights[genre] ?? 0;
  score += entry.moodWeights[mood] ?? 0;

  const energy = facets.energy ?? 0.5;
  const [min, max] = entry.energyRange;
  if (energy >= min && energy <= max) {
    score += 1.2;
  } else {
    const distance = Math.min(Math.abs(energy - min), Math.abs(energy - max));
    score -= Math.min(1.4, distance * 2.2);
  }

  if (entry.tags.includes(genre)) score += 0.8;
  if (entry.tags.includes(mood)) score += 0.8;
  if (facets.instrument && entry.tags.includes(normalized(facets.instrument))) score += 0.5;
  return score;
}

export function pickArtwork(
  catalog: readonly ArtworkCatalogEntry[],
  facets: ArtworkMatchFacets | undefined,
  seed: string,
  recentArtworkIds: string[] = [],
  excludedArtworkIds: string[] = [],
): ArtworkCatalogEntry | null {
  if (catalog.length === 0) return null;
  const resolvedFacets = facets ?? {};
  const rng = mulberry32(hashString(seed));
  const recent = new Set(recentArtworkIds);
  const excluded = new Set(excludedArtworkIds);
  const availableCatalog = catalog.filter((entry) => !excluded.has(entry.id));
  if (availableCatalog.length === 0) return null;

  const scored = availableCatalog
    .map((entry) => {
      const noise = (rng() - 0.5) * 1.15;
      const repeatPenalty = recent.has(entry.id) ? 2.5 : 0;
      return {
        entry,
        score: recordAffinity(entry, resolvedFacets) + noise - repeatPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const shortlist = scored.slice(0, Math.min(7, scored.length));
  const total = shortlist.reduce((sum, item) => sum + Math.max(0.15, item.score), 0);
  let ticket = rng() * total;
  for (const item of shortlist) {
    ticket -= Math.max(0.15, item.score);
    if (ticket <= 0) return item.entry;
  }
  return shortlist[0]?.entry ?? null;
}

export function pickArtworkSelection(
  facets: ArtworkMatchFacets | undefined,
  seed: string,
  recentArtworkIds: string[] = [],
  excludedArtworkIds: string[] = [],
): ArtworkSelection | undefined {
  const entry = pickArtwork(ARTWORK_CATALOG, facets, seed, recentArtworkIds, excludedArtworkIds);
  return entry ? toArtworkSelection(entry) : undefined;
}

export function gradientFromPalette(palette: string[], seed: string): string {
  const rng = mulberry32(hashString(seed));
  const indices = [0, 1, 2, 3, 4];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  const picked = indices.slice(0, 3).map((i) => palette[i]!);
  return `linear-gradient(148deg, ${picked[0]} 0%, ${picked[1]} 48%, ${picked[2]} 100%)`;
}
