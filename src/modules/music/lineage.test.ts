import { describe, expect, it } from "bun:test";

import {
  buildLineageTrail,
  buildRemixLineage,
  getLineageLabel,
  normalizeLineageDepth,
  resolveParentSongId,
  resolveRootSongId,
} from "./lineage";

describe("lineage helpers", () => {
  it("normalizes lineage depth", () => {
    expect(normalizeLineageDepth(undefined)).toBe(0);
    expect(normalizeLineageDepth(-2)).toBe(0);
    expect(normalizeLineageDepth(1.7)).toBe(2);
  });

  it("resolves root and parent ids", () => {
    expect(resolveRootSongId({ id: "song_a" })).toBe("song_a");
    expect(resolveRootSongId({ id: "song_b", rootSongId: "song_root" })).toBe("song_root");
    expect(resolveParentSongId({ id: "song_a" })).toBeNull();
    expect(resolveParentSongId({ id: "song_b", parentSongId: "song_parent" })).toBe("song_parent");
  });

  it("builds remix lineage from a saved song", () => {
    expect(buildRemixLineage({ id: "song_child", lineageDepth: 0 })).toEqual({
      parentSongId: "song_child",
      rootSongId: "song_child",
      lineageDepth: 1,
    });

    expect(buildRemixLineage({ id: "song_branch", rootSongId: "song_root", lineageDepth: 2 })).toEqual({
      parentSongId: "song_branch",
      rootSongId: "song_root",
      lineageDepth: 3,
    });
  });

  it("formats lineage labels", () => {
    const t = (key: string) => key === "lineage.branch_n" ? "Branch {n}" : key;
    expect(getLineageLabel({ lineageDepth: 0 }, t)).toBe("lineage.original");
    expect(getLineageLabel({ lineageDepth: 2 }, t)).toBe("Branch 2");
  });

  it("builds a deduped root-parent-current trail", () => {
    const root = { id: "root", title: "Root", vibe: "黄昏", duration: 10, arrangementState: {} as never, visualConfig: {} as never, createdAt: "" };
    const parent = { id: "parent", title: "Parent", vibe: "电影", duration: 10, arrangementState: {} as never, visualConfig: {} as never, createdAt: "" };
    const current = { id: "current", title: "Current", vibe: "雨天", duration: 10, arrangementState: {} as never, visualConfig: {} as never, createdAt: "" };

    expect(buildLineageTrail(current, { parentSong: parent, rootSong: root })).toEqual([
      { kind: "root", song: root },
      { kind: "parent", song: parent },
      { kind: "current", song: current },
    ]);
  });

  it("dedupes overlapping root and parent songs", () => {
    const root = { id: "root", title: "Root", vibe: "黄昏", duration: 10, arrangementState: {} as never, visualConfig: {} as never, createdAt: "" };
    const current = { id: "current", title: "Current", vibe: "雨天", duration: 10, arrangementState: {} as never, visualConfig: {} as never, createdAt: "" };

    expect(buildLineageTrail(current, { parentSong: root, rootSong: root })).toEqual([
      { kind: "root", song: root },
      { kind: "current", song: current },
    ]);
  });
});
