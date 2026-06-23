import { describe, expect, it } from "bun:test";
import { compactMeloLabDiagnostics } from "@/lib/test/melo-lab-contract";
import { meloLabGate, resolveLocalWorkerUrl } from "@/lib/test/melo-lab";

describe("MeLo Lab helpers", () => {
  it("keeps production test APIs disabled even when the flag is set", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFlag = process.env.MURMUR_ENABLE_MELO_LAB;

    try {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "production",
        configurable: true,
        writable: true,
      });
      delete process.env.MURMUR_ENABLE_MELO_LAB;
      expect(meloLabGate()).toEqual({ ok: false, reason: "disabled" });

      process.env.MURMUR_ENABLE_MELO_LAB = "1";
      expect(meloLabGate()).toEqual({ ok: false, reason: "disabled" });
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: originalNodeEnv,
        configurable: true,
        writable: true,
      });
      if (originalFlag === undefined) {
        delete process.env.MURMUR_ENABLE_MELO_LAB;
      } else {
        process.env.MURMUR_ENABLE_MELO_LAB = originalFlag;
      }
    }
  });

  it("allows the explicit flag outside production", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFlag = process.env.MURMUR_ENABLE_MELO_LAB;

    try {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: "test",
        configurable: true,
        writable: true,
      });
      process.env.MURMUR_ENABLE_MELO_LAB = "1";
      expect(meloLabGate()).toEqual({ ok: true, reason: "enabled" });
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: originalNodeEnv,
        configurable: true,
        writable: true,
      });
      if (originalFlag === undefined) {
        delete process.env.MURMUR_ENABLE_MELO_LAB;
      } else {
        process.env.MURMUR_ENABLE_MELO_LAB = originalFlag;
      }
    }
  });

  it("only resolves explicit loopback worker URLs", () => {
    expect(resolveLocalWorkerUrl("http://localhost:8001/", "")).toBe(
      "http://localhost:8001",
    );
    expect(resolveLocalWorkerUrl("http://127.0.0.1:8001/transcribe", "")).toBe(
      "http://127.0.0.1:8001/transcribe",
    );
    expect(resolveLocalWorkerUrl("http://[::1]:8001", "")).toBe(
      "http://[::1]:8001",
    );
    expect(resolveLocalWorkerUrl("http://worker.localhost:8001", "")).toBeNull();
    expect(resolveLocalWorkerUrl("https://audio.example.test", "")).toBeNull();
  });

  it("keeps current audio-engine diagnostics in the exported compact packet", () => {
    const compact = compactMeloLabDiagnostics({
      duration: 1.8,
      snr: 14.2,
      voicedRatio: 0.88,
      decodeMs: 9,
      trimMs: 2,
      providerPitchMs: 118,
      pitchMs: 347,
      totalMs: 381,
      rmvpeFrames: 180,
      rmvpeVoicedFrames: 144,
      rmvpeDevice: "cpu",
      rmvpeModel: "/models/rmvpe.onnx",
      noteDensity: 4.12,
      noteProposalProfile: "glide",
      noteProposalCandidates: "glide_guarded:2.100",
      proposalGlideRatio: 0.42,
      alternateReviewMode: "light_no_repair_general",
      alternateReviewHypotheses: "balanced,steady",
      detailPreservingRerank: "steady->balanced:balanced",
      ensembleScore: 2.91,
      ensembleDecision: "highest_score",
      ensembleSelected: "swiftf0/balanced",
    });

    expect(compact).toMatchObject({
      decodeMs: 9,
      trimMs: 2,
      providerPitchMs: 118,
      pitchMs: 347,
      totalMs: 381,
      rmvpeFrames: 180,
      rmvpeVoicedFrames: 144,
      rmvpeDevice: "cpu",
      rmvpeModel: "/models/rmvpe.onnx",
      noteDensity: 4.12,
      noteProposalProfile: "glide",
      noteProposalCandidates: "glide_guarded:2.100",
      proposalGlideRatio: 0.42,
      alternateReviewMode: "light_no_repair_general",
      alternateReviewHypotheses: "balanced,steady",
      detailPreservingRerank: "steady->balanced:balanced",
      ensembleScore: 2.91,
      ensembleDecision: "highest_score",
      ensembleSelected: "swiftf0/balanced",
    });
  });
});
