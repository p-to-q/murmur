import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ARTWORK_CATALOG } from "./catalog";
import { pickArtworkSelection } from "./artwork-matcher";

const EXCLUDED_ARTWORK_IDS = [
  "sublime_terrain-commons-church-cotopaxi",
  "nocturne_metro-commons-caillebotte-paris-street-rainy-day",
] as const;

const RESTORED_ARTWORK_IDS = [
  "hypermodern_void-aic-65916",
  "interior_reverie-aic-28560",
  "nocturne_metro-aic-56905",
  "printed_signal-aic-33398",
  "printed_signal-met-37193",
  "stage_heat-aic-27992",
  "tidal_mineral-aic-24645",
] as const;

function publicAssetExists(path: string): boolean {
  return existsSync(join(process.cwd(), "public", path.replace(/^\//, "")));
}

describe("artwork catalog", () => {
  it("loads the archived v0.5 seed pack", () => {
    const ids = new Set<string>(ARTWORK_CATALOG.map((entry) => entry.id));

    expect(ARTWORK_CATALOG).toHaveLength(68);
    expect(ids.size).toBe(68);
    expect(ARTWORK_CATALOG.every((entry) => entry.backgroundImagePath?.startsWith("/background_ready/"))).toBe(true);

    for (const id of EXCLUDED_ARTWORK_IDS) {
      expect(ids.has(id)).toBe(false);
    }

    for (const id of RESTORED_ARTWORK_IDS) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("keeps active artwork image files wired to public assets", () => {
    const missingAssets = ARTWORK_CATALOG.flatMap((entry) => {
      const paths: Array<string | undefined> = [entry.imagePath, entry.backgroundImagePath];
      return paths.filter(
        (path): path is string => Boolean(path),
      ).filter((path) => !publicAssetExists(path));
    });

    expect(missingAssets).toEqual([]);
  });

  it("returns a persistable artwork selection with background render hints", () => {
    const selection = pickArtworkSelection(
      { genre: "ambient", mood: "serene", energy: 0.25 },
      "catalog-smoke",
    );

    expect(selection).toBeDefined();
    expect(selection?.imagePath.startsWith("/artworks/")).toBe(true);
    expect(selection?.backgroundImagePath?.startsWith("/background_ready/")).toBe(true);
    expect(selection?.renderTreatment?.recommendedOverlay).toBeGreaterThan(0);
  });

  it("honors hard artwork exclusions", () => {
    const first = pickArtworkSelection(
      { genre: "ambient", mood: "serene", energy: 0.25 },
      "catalog-smoke",
    );

    const second = pickArtworkSelection(
      { genre: "ambient", mood: "serene", energy: 0.25 },
      "catalog-smoke",
      [],
      first ? [first.id] : [],
    );

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.id).not.toBe(first?.id);
  });

  it("keeps gallery demo artwork anchors available", () => {
    const ids = new Set(ARTWORK_CATALOG.map((entry) => entry.id));

    expect(ids.has("nocturne_metro-commons-whistler-nocturne-southampton-water")).toBe(true);
    expect(ids.has("nocturne_metro-commons-hassam-rainy-day-fifth-avenue")).toBe(true);
    expect(ids.has("sublime_terrain-manual-saam-1967.136.7")).toBe(true);
  });

  it("still picks a replacement sublime terrain cover", () => {
    const selection = pickArtworkSelection(
      { genre: "cinematic", mood: "triumphant", energy: 0.72, bucket: "sublime_terrain" },
      "replacement-smoke",
    );

    expect(selection).toBeDefined();
    expect(selection?.bucket).toBe("sublime_terrain");
    expect(selection?.id).not.toBe("sublime_terrain-commons-church-cotopaxi");
  });
});
