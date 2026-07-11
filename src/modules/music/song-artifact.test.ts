import { describe, expect, it } from "bun:test";
import {
  SONG_ARTIFACT_VERSION,
  computeSaveFingerprint,
  readSongArtifact,
  validateCleanMelody,
  validateSongProvenance,
} from "./song-artifact";
import type { CleanMelody } from "@/modules/shared/types";

const MELODY: CleanMelody = {
  notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
  key: "C",
  scale: "major",
  bpm: 90,
  duration: 10,
  contour: "wave",
};

describe("readSongArtifact", () => {
  it("reads a legacy row as v1 with base64 playback", () => {
    const artifact = readSongArtifact({
      artifactVersion: null,
      melody: null,
      provenance: null,
      mp3Url: null,
      mp3DataUrl: "data:audio/mpeg;base64,AAAA",
    });
    expect(artifact.artifactVersion).toBe(1);
    expect(artifact.melody).toBeNull();
    expect(artifact.playbackSource).toBe("legacy_data_url");
    expect(artifact.playbackUrl).toBe("data:audio/mpeg;base64,AAAA");
  });

  it("reads a v2 row with object playback and canonical melody", () => {
    const artifact = readSongArtifact({
      artifactVersion: 2,
      melody: MELODY,
      provenance: { flow: "flow_1", sourceType: "hum" },
      mp3Url: "https://cdn.test/songs/master/u/s.mp3",
      mp3DataUrl: null,
    });
    expect(artifact.artifactVersion).toBe(2);
    expect(artifact.melody).toEqual(MELODY);
    expect(artifact.provenance).toEqual({ flow: "flow_1", sourceType: "hum" });
    expect(artifact.playbackSource).toBe("object");
  });

  it("prefers object playback over a legacy data URL when both are present", () => {
    const artifact = readSongArtifact({
      artifactVersion: 2,
      mp3Url: "https://cdn.test/master.mp3",
      mp3DataUrl: "data:audio/mpeg;base64,AAAA",
    });
    expect(artifact.playbackSource).toBe("object");
    expect(artifact.playbackUrl).toBe("https://cdn.test/master.mp3");
  });

  it("degrades a malformed persisted melody to null without throwing", () => {
    const artifact = readSongArtifact({
      artifactVersion: 2,
      melody: { notes: "nope", key: 5, scale: "space", bpm: "fast" },
      mp3Url: "https://cdn.test/master.mp3",
    });
    expect(artifact.melody).toBeNull();
    expect(artifact.playbackSource).toBe("object");
  });

  it("reports 'none' when a row has no audio at all", () => {
    const artifact = readSongArtifact({ artifactVersion: 2, mp3Url: null, mp3DataUrl: null });
    expect(artifact.playbackSource).toBe("none");
    expect(artifact.playbackUrl).toBeNull();
  });
});

describe("validateCleanMelody", () => {
  it("drops individually malformed notes but keeps valid ones", () => {
    const melody = validateCleanMelody({
      ...MELODY,
      notes: [
        { pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 },
        { pitch: "x", start: 0, duration: 1, velocity: 1, confidence: 1 },
      ],
    });
    expect(melody?.notes).toHaveLength(1);
  });

  it("rejects an unknown scale", () => {
    expect(validateCleanMelody({ ...MELODY, scale: "lydian" })).toBeNull();
  });
});

describe("validateSongProvenance", () => {
  it("keeps known fields and drops an all-empty object", () => {
    expect(validateSongProvenance({ flow: "f", sourceType: "hum", bogus: 1 })).toEqual({
      flow: "f",
      sourceType: "hum",
    });
    expect(validateSongProvenance({})).toBeNull();
    expect(validateSongProvenance({ sourceType: "not-a-source" })).toBeNull();
  });
});

describe("computeSaveFingerprint", () => {
  it("is stable across key order and audio identity but not payload changes", () => {
    const a = computeSaveFingerprint({ title: "A", tags: ["x"], mp3StorageKey: "k1", melody: MELODY });
    const b = computeSaveFingerprint({ melody: MELODY, tags: ["x"], title: "A", mp3StorageKey: "k1" });
    expect(a).toBe(b);
    // A different title is a different fingerprint (a genuine conflict).
    expect(computeSaveFingerprint({ title: "B", tags: ["x"], mp3StorageKey: "k1" })).not.toBe(a);
  });

  it("collapses a large base64 fallback to a length marker (no megabyte hashing)", () => {
    const big = "data:audio/mpeg;base64," + "A".repeat(5_000_000);
    // Should not throw or hang; a fingerprint is produced quickly.
    expect(typeof computeSaveFingerprint({ title: "A", mp3DataUrl: big })).toBe("string");
  });

  it("exposes the current artifact version constant", () => {
    expect(SONG_ARTIFACT_VERSION).toBe(2);
  });
});
