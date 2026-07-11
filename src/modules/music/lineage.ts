import type { SongCard, VibeVersion } from "@/modules/shared/types";

type LineageLike = {
  id: string;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth?: number | null;
};

export type LineageTrailNode<T extends { id: string }> = {
  kind: "root" | "parent" | "current";
  song: T;
};

export function normalizeLineageDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function resolveRootSongId(input: LineageLike): string {
  return typeof input.rootSongId === "string" && input.rootSongId.length > 0
    ? input.rootSongId
    : input.id;
}

export function resolveParentSongId(input: LineageLike): string | null {
  return typeof input.parentSongId === "string" && input.parentSongId.length > 0
    ? input.parentSongId
    : null;
}

export type ResolvedServerLineage = {
  parentSongId: string | null;
  rootSongId: string;
  lineageDepth: number;
};

type ParentLineageRow = {
  id: string;
  userId: string;
  rootSongId: string | null;
  lineageDepth: number | null;
};

/**
 * Derive and validate parent → root → depth lineage on the server (#297).
 *
 * When the payload names a parent the caller owns, root and depth are computed
 * authoritatively from that parent (`root = parent.root ?? parent.id`,
 * `depth = parent.depth + 1`) rather than trusting client-supplied values.
 * When the parent is absent or not owned (e.g. remixing a demo), we fall back
 * to the client's normalized values so those flows keep working.
 *
 * `loadParent` is injected so this module stays free of DB imports and usable
 * from the client bundle.
 */
export async function deriveServerLineage(input: {
  id: string;
  userId: string;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth?: number | null;
  loadParent: (parentSongId: string) => Promise<ParentLineageRow | null>;
}): Promise<ResolvedServerLineage> {
  const parentSongId = resolveParentSongId(input);

  if (parentSongId) {
    const parent = await input.loadParent(parentSongId);
    if (parent && parent.userId === input.userId) {
      return {
        parentSongId,
        rootSongId:
          typeof parent.rootSongId === "string" && parent.rootSongId.length > 0
            ? parent.rootSongId
            : parent.id,
        lineageDepth: normalizeLineageDepth(parent.lineageDepth) + 1,
      };
    }
  }

  return {
    parentSongId,
    rootSongId: resolveRootSongId(input),
    lineageDepth: normalizeLineageDepth(input.lineageDepth),
  };
}

export function buildRemixLineage(song: SongCard) {
  return {
    parentSongId: song.id,
    rootSongId: resolveRootSongId(song),
    lineageDepth: normalizeLineageDepth(song.lineageDepth) + 1,
  };
}

export function getLineageLabel(
  input: Pick<SongCard, "lineageDepth"> | Pick<VibeVersion, "lineageDepth">,
  t: (key: string) => string,
): string {
  const depth = normalizeLineageDepth(input.lineageDepth);
  if (depth <= 0) return t("lineage.original") || "Original";
  return (t("lineage.branch_n") || "Branch {n}").replace("{n}", String(depth));
}

// Only `id` is read here; the loose constraint lets callers pass summary
// projections (no audio/arrangement payload) for the related songs.
export function buildLineageTrail<T extends { id: string }>(
  currentSong: T,
  related: { parentSong?: T | null; rootSong?: T | null },
): Array<LineageTrailNode<T>> {
  const trail: Array<LineageTrailNode<T>> = [];
  const seen = new Set<string>();

  const push = (kind: LineageTrailNode<T>["kind"], song: T | null | undefined) => {
    if (!song || seen.has(song.id)) return;
    seen.add(song.id);
    trail.push({ kind, song });
  };

  push("root", related.rootSong ?? null);
  push("parent", related.parentSong ?? null);
  push("current", currentSong);

  return trail;
}
