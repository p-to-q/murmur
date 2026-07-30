import { describe, expect, test } from "bun:test";

import {
  buildCanaryMelody,
  collectProviderCanaryIssues,
  loadCanaryDatasetInput,
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
  test("loads exactly one MIDI-annotated dataset case", async () => {
    const root = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-${Date.now()}`;
    const audioPath = `${root}/case.wav`;
    const manifestPath = `${root}/manifest.json`;
    const wav = new Uint8Array(44);
    wav.set(Buffer.from("RIFF"), 0);
    wav.set(Buffer.from("WAVE"), 8);
    await Bun.write(audioPath, wav);
    await Bun.write(manifestPath, JSON.stringify([{
      name: "case",
      path: "case.wav",
      expected_pitches: [60, 62, 64, 67],
      tags: ["real", "humming", "midi_ref"],
    }]));
    const input = await loadCanaryDatasetInput({
      manifestPath,
      datasetRoot: root,
      datasetRevision: revision,
    });
    expect(input.caseName).toBe("case");
    expect(input.expectedPitchCount).toBe(4);
    expect(JSON.parse(input.melody).notes).toHaveLength(4);
  });

  test("rejects an unfrozen multi-case manifest and short melody", async () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/murmur-canary-invalid-${Date.now()}.json`;
    await Bun.write(path, "[]");
    await expect(loadCanaryDatasetInput({
      manifestPath: path,
      datasetRoot: "/tmp",
      datasetRevision: revision,
    })).rejects.toThrow("exactly one");
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
