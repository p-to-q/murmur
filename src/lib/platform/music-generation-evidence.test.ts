import { describe, expect, it } from "bun:test";

import { buildMusicGenerationEvidencePayload } from "./music-generation-evidence";
import type { VerifiedMusicOutput } from "./music-worker-output";

describe("music generation evidence", () => {
  it("keeps the event bounded and excludes raw creative inputs", () => {
    const payload = buildMusicGenerationEvidencePayload({
      userId: "usr_evidence",
      requestId: "req_evidence",
      batchId: "batch_evidence",
      clipId: "clip_evidence",
      mode: "serverless",
      model: "m".repeat(200),
      outputSha256: "o".repeat(64),
      outputBytes: 1024,
      duration: 10,
      styleMix: 0.35,
      quality: qualityEvidence(),
    });

    expect(payload.model).toBe("m".repeat(128));
    expect(payload.runtime).toEqual({ revision: "r".repeat(128) });
    expect(payload.qualityMetrics).toEqual({ rms: 0.1 });
    expect(payload.outputSha256).toBe("o".repeat(64));
    expect((payload.candidates as unknown[])).toHaveLength(3);
    expect(payload).not.toHaveProperty("prompt");
    expect(JSON.stringify(payload)).not.toContain("hum_b64");
  });
});

function qualityEvidence(): VerifiedMusicOutput {
  const candidate = {
    candidateId: "candidate",
    attempt: 1,
    audioSha256: "a".repeat(64),
    duplicateOfAttempt: null,
    generationMs: 100,
    sampling: { temperature: 1, topK: 40, seedControl: "provider" },
    conditioning: {
      styleMix: 0.35,
      melodyConditioned: true,
      melodySegments: 4,
      melodyOnsets: 4,
      melodyCoverage: 0.8,
      cfgNotes: 4,
      preNormalizationPeak: 0.5,
      preNormalizationRms: 0.1,
      normalizationGainDb: 2,
    },
    quality: {
      passed: true,
      version: "music-technical-v2",
      failures: [],
      metrics: { rms: 0.1 },
    },
  };
  return {
    quality: candidate.quality,
    diagnostics: {
      version: 2,
      gateVersion: "music-technical-v2",
      evidence: "verified",
      candidateCount: 4,
      totalGenerationMs: 400,
      workerWallMs: 420,
      estimatedCostUsd: 0.01,
      runtime: { revision: "r".repeat(200) },
      inputReceipt: {
        version: 2,
        requestId: "req_evidence",
        promptSha256: "p".repeat(64),
        duration: 10,
        styleMix: 0.35,
        melodySha256: "m".repeat(64),
        melodyAccepted: true,
        melodyValidNoteCount: 4,
        humSha256: "h".repeat(64),
        humAccepted: true,
      },
      candidates: [candidate, candidate, candidate, candidate],
    },
  };
}
