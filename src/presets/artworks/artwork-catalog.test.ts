import { describe, expect, it } from "bun:test";
import { ARTWORK_CATALOG } from "./catalog";
import { pickArtworkSelection } from "./artwork-matcher";

describe("artwork catalog", () => {
  it("loads the archived v0.5 seed pack", () => {
    expect(ARTWORK_CATALOG).toHaveLength(61);
    expect(new Set(ARTWORK_CATALOG.map((entry) => entry.id)).size).toBe(61);
    expect(ARTWORK_CATALOG.every((entry) => entry.backgroundImagePath?.startsWith("/background_ready/"))).toBe(true);
    expect(ARTWORK_CATALOG.some((entry) => entry.id === "sublime_terrain-commons-church-cotopaxi")).toBe(false);
    expect(ARTWORK_CATALOG.some((entry) => entry.id === "nocturne_metro-commons-caillebotte-paris-street-rainy-day")).toBe(false);
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
