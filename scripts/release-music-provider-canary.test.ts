import { describe, expect, test } from "bun:test";

import {
  buildCanaryMelody,
  collectProviderCanaryIssues,
  loadCanaryDatasetInputs,
  parseCanaryProfileCount,
} from "./release-music-provider-canary";
import type { VerifiedMusicOutput } from "../src/lib/platform/music-worker-output";

const revision = "a".repeat(40);
const verified: VerifiedMusicOutput = {
  quality: { version: "music-technical-v2", passed: true, failures: [], metrics: { interiorDropoutCount: 0 } },
  diagnostics: {
    version: 2,
    gateVersion: "music-technical-v2",
    evidence: "verified" as const,
    candidateCount: 1,
    totalGenerationMs: 10,
    workerWallMs: 12,
    estimatedCostUsd: null,
    runtime: { model: "mrt2_base", backend_loaded: "jax", engine_revision: revision },
    inputReceipt: {
      version: 2,
      requestId: "canary",
      promptSha256: "a".repeat(64),
      duration: 10,
      styleMix: 0.35,
      melodySha256: "b".repeat(64),
      melodyAccepted: true,
      melodyValidNoteCount: 8,
      humSha256: "c".repeat(64),
      humAccepted: true,
    },
    candidates: [],
  },
};

describe("release music provider canary", () => {
  test("loads exactly three MIDI-annotated dataset cases", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-${Date.now()}`;
    const audioPaths = [0, 1, 2].map((index) => `${root}/case-${index}.wav`);
    const manifestPath = `${root}/manifest.json`;
    const wav = new Uint8Array(64);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVE"), 8);
    await Promise.all(audioPaths.map(async (audioPath, index) => {
      const distinct = wav.slice();
      distinct[63] = index;
      await Bun.write(audioPath, distinct);
    }));
    await Bun.write(manifestPath, JSON.stringify([0, 1, 2].map((index) => ({
      name: `case-${index}`,
      path: `case-${index}.wav`,
      expected_pitches: [60, 62, 64, 67],
      tags: ["real", "humming", "midi_ref"],
    }))));
    const inputs = await loadCanaryDatasetInputs({
      manifestPath,
      datasetRoot: root,
      datasetRevision: revision,
    });
    expect(inputs).toHaveLength(3);
    expect(inputs[0]?.caseName).toBe("case-0");
    expect(inputs[0]?.expectedPitchCount).toBe(4);
    expect(JSON.parse(buildCanaryMelody(inputs[0]!.expectedPitches)).notes).toHaveLength(4);
  });

  test("supports a one-profile production re-attestation without weakening the default", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-single-${Date.now()}`;
    const manifestPath = `${root}/manifest.json`;
    const wav = new Uint8Array(64);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVE"), 8);
    await Bun.write(`${root}/case.wav`, wav);
    await Bun.write(manifestPath, JSON.stringify([{
      name: "case",
      path: "case.wav",
      expected_pitches: [60, 62, 64],
      tags: ["midi_ref"],
    }]));

    expect(parseCanaryProfileCount(undefined)).toBe(3);
    expect(parseCanaryProfileCount("1")).toBe(1);
    expect(() => parseCanaryProfileCount("0")).toThrow("between 1 and 3");
    expect(await loadCanaryDatasetInputs({
      manifestPath,
      datasetRoot: root,
      datasetRevision: revision,
    }, 1)).toHaveLength(1);
  });

  test("rejects repeated audio disguised as three canary cases", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-duplicate-${Date.now()}`;
    const audioPath = `${root}/same.wav`;
    const manifestPath = `${root}/manifest.json`;
    const wav = new Uint8Array(64);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVE"), 8);
    await Bun.write(audioPath, wav);
    await Bun.write(manifestPath, JSON.stringify([0, 1, 2].map((index) => ({
      name: `case-${index}`,
      path: "same.wav",
      expected_pitches: [60, 62, 64],
      tags: ["midi_ref"],
    }))));

    await expect(loadCanaryDatasetInputs({
      manifestPath,
      datasetRoot: root,
      datasetRevision: revision,
    })).rejects.toThrow("distinct names, paths, and audio inputs");
  });

  test("rejects an unfrozen multi-case manifest and short melody", async () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-invalid-${Date.now()}.json`;
    await Bun.write(path, "[]");
    await expect(loadCanaryDatasetInputs({
      manifestPath: path,
      datasetRoot: "/tmp",
      datasetRevision: revision,
    })).rejects.toThrow("exactly 3");
    expect(() => buildCanaryMelody([60, 62])).toThrow("at least three");
  });

  test("accepts the expected immutable production runtime", () => {
    expect(collectProviderCanaryIssues({
      output: { model: "mrt2_base" },
      verified,
      expectedRevision: revision,
      expectedModel: "mrt2_base",
    })).toEqual([]);
  });

  test("rejects mock, stale, wrong-model, or fragmented output", () => {
    expect(collectProviderCanaryIssues({
      output: { model: "mock" },
      verified: {
        ...verified,
        quality: { ...verified.quality, metrics: { interiorDropoutCount: 2 } },
        diagnostics: {
          ...verified.diagnostics,
          runtime: { model: "mock", backend_loaded: "mock", engine_revision: "unknown" },
        },
      },
      expectedRevision: revision,
      expectedModel: "mrt2_base",
    })).toEqual([
      "unexpected music model",
      "music backend is not jax",
      "music Worker revision mismatch",
      "release canary contains interior dropouts",
    ]);
  });
});
