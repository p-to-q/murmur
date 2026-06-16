import {
  VISUAL_ARTWORK_BUCKETS,
  VISUAL_ARTWORK_SOURCES,
  type VisualArtworkBucket,
  type VisualArtworkSource,
} from "@/modules/shared/types";

export const ARTWORK_BUCKETS = VISUAL_ARTWORK_BUCKETS;
export type ArtworkBucket = VisualArtworkBucket;

export const ARTWORK_SOURCES = VISUAL_ARTWORK_SOURCES;
export type ArtworkSource = VisualArtworkSource;

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
  backgroundImagePath?: string;
  license: "CC0" | "Public Domain";
  tags: string[];
  genreWeights: Record<string, number>;
  moodWeights: Record<string, number>;
  energyRange: [number, number];
  crop: ArtworkCrop;
  palette?: string[];
  composition?: string;
  figurePresence?: string;
  backgroundFit?: number;
  renderTreatment?: {
    intent?: string;
    cropFormat?: string;
    recommendedOverlay?: number;
    contrast?: string;
    grain?: string;
  };
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
  | "backgroundImagePath"
  | "license"
  | "crop"
  | "renderTreatment"
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
    backgroundImagePath: entry.backgroundImagePath,
    license: entry.license,
    crop: { ...entry.crop },
    renderTreatment: entry.renderTreatment ? { ...entry.renderTreatment } : undefined,
  };
}
