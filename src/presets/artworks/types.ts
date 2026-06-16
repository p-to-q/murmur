export type ArtworkBucket =
  | "luminist_air"
  | "sublime_terrain"
  | "tidal_mineral"
  | "pastoral_memory"
  | "nocturne_metro"
  | "printed_signal"
  | "stage_heat"
  | "interior_reverie"
  | "hypermodern_void";

export type ArtworkSource = "aic" | "met" | "cma";

export type ArtworkCrop = {
  x: number;
  y: number;
  scale: number;
};

export type ArtworkCatalogEntry = {
  id: string;
  bucket: ArtworkBucket;
  title: string;
  artist: string;
  year: string;
  source: ArtworkSource;
  sourceId: string;
  sourceUrl: string;
  imagePath: string;
  license: "CC0" | "Public Domain";
  tags: string[];
  genreWeights: Record<string, number>;
  moodWeights: Record<string, number>;
  energyRange: [number, number];
  crop: ArtworkCrop;
  curatorNote: string;
};

export type ArtworkSelection = Pick<
  ArtworkCatalogEntry,
  | "id"
  | "bucket"
  | "title"
  | "artist"
  | "year"
  | "source"
  | "sourceUrl"
  | "imagePath"
  | "license"
  | "crop"
>;

export type VisualFacets = {
  genre?: string;
  mood?: string;
  instrument?: string;
  scene?: string;
  energy?: number;
  bucket?: ArtworkBucket;
};

export function toArtworkSelection(entry: ArtworkCatalogEntry): ArtworkSelection {
  return {
    id: entry.id,
    bucket: entry.bucket,
    title: entry.title,
    artist: entry.artist,
    year: entry.year,
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    imagePath: entry.imagePath,
    license: entry.license,
    crop: entry.crop,
  };
}
