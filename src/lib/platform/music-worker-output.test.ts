import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  estimateWorkerCostUsd,
  isMusicDeliveryBase64WithinLimit,
  maxMusicDeliveryBytes,
  MUSIC_QUALITY_GATE_COMPAT_VERSION,
  verifyMusicWorkerOutput,
} from "./music-worker-output";

function toneWav(): Uint8Array {
  const sampleRate = 16_000;
  const bytes = new Uint8Array(44 + sampleRate * 2);
  const view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  }
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, sampleRate * 2, true);
  for (let index = 0; index < sampleRate; index += 1) {
    view.setInt16(44 + index * 2, Math.round(Math.sin(index / 8) * 8_000), true);
  }
  return bytes;
}

const expected = {
  requestId: "mjob_test",
  prompt: "warm piano",
  duration: 1,
  styleMix: 0,
  melody: "",
  humSha256: null,
};

function evidencedOutput() {
  return {
    input_receipt: {
      version: 1,
      request_id: expected.requestId,
      prompt_sha256: createHash("sha256").update(expected.prompt).digest("hex"),
      duration: expected.duration,
      style_mix: expected.styleMix,
      melody_sha256: null,
      melody_accepted: false,
      hum_sha256: null,
    },
    quality: { version: MUSIC_QUALITY_GATE_COMPAT_VERSION, passed: true, failures: [], metrics: {} },
    diagnostics: {
      version: 1,
      gate_version: MUSIC_QUALITY_GATE_COMPAT_VERSION,
      candidate_count: 1,
      worker_wall_ms: 2_500,
    } as Record<string, unknown>,
  } satisfies Record<string, unknown>;
}

function v2EvidencedOutput(bytes: Uint8Array) {
  const output = evidencedOutput();
  return {
    ...output,
    input_receipt_v2: {
      ...output.input_receipt,
      version: 2,
      melody_valid_note_count: 0,
      hum_accepted: false,
    },
    quality_v2: { version: "music-technical-v2", passed: true, failures: [], metrics: {} },
    diagnostics: {
      ...output.diagnostics,
      version: 2,
      gate_version: "music-technical-v2",
      candidate_count: 1,
      candidates: [{
        candidate_id: createHash("sha256")
          .update(`${expected.requestId}:1:${createHash("sha256").update(bytes).digest("hex")}`)
          .digest("hex")
          .slice(0, 24),
        attempt: 1,
        audio_sha256: createHash("sha256").update(bytes).digest("hex"),
        duplicate_of_attempt: null,
        generation_ms: 100,
        sampling: { temperature: 1.3, top_k: 40, seed_control: "library_managed" },
        conditioning: {
          style_mix: 0,
          melody_conditioned: false,
          melody_segments: 0,
          melody_onsets: 0,
          melody_coverage: 0,
          cfg_notes: 0,
          pre_normalization_peak: 0.3,
          pre_normalization_rms: 0.1,
          normalization_gain_db: 10,
        },
        quality: {
          version: "music-technical-v2",
          passed: true,
          failures: [] as string[],
          metrics: {} as Record<string, number>,
        },
      }],
    },
  };
}

describe("music worker output protocol", () => {
  it("allows rolling legacy workers while keeping the Web WAV gate", () => {
    const verified = verifyMusicWorkerOutput({
      output: {},
      bytes: toneWav(),
      expected,
      requireEvidence: false,
    });
    expect(verified.diagnostics.evidence).toBe("legacy_missing");
    expect(verified.quality.passed).toBe(true);
  });

  it("fails closed on missing evidence after cutover", () => {
    expect(() => verifyMusicWorkerOutput({
      output: {},
      bytes: toneWav(),
      expected,
      requireEvidence: true,
    })).toThrow("music_worker_quality_evidence_missing");
  });

  it("treats the v2 cutover as evidence-required when all evidence is missing", () => {
    expect(() => verifyMusicWorkerOutput({
      output: {},
      bytes: toneWav(),
      expected,
      requireEvidence: false,
      requireV2Evidence: true,
    })).toThrow("music_worker_v2_evidence_missing");
  });

  it("bounds payload size before scanning samples", () => {
    expect(() => verifyMusicWorkerOutput({
      output: {},
      bytes: new Uint8Array(maxMusicDeliveryBytes(expected.duration) + 1),
      expected,
      requireEvidence: false,
    })).toThrow("payload_too_large");
  });

  it("derives the JSON base64 boundary from the shared delivery limit", () => {
    const maxBytes = maxMusicDeliveryBytes(expected.duration);
    expect(isMusicDeliveryBase64WithinLimit(
      Buffer.alloc(maxBytes).toString("base64"),
      expected.duration,
    )).toBe(true);
    expect(isMusicDeliveryBase64WithinLimit(
      Buffer.alloc(maxBytes + 1).toString("base64"),
      expected.duration,
    )).toBe(false);
  });

  it("rejects partial evidence even during rolling deployment", () => {
    expect(() => verifyMusicWorkerOutput({
      output: { quality: evidencedOutput().quality },
      bytes: toneWav(),
      expected,
      requireEvidence: false,
    })).toThrow("music_worker_quality_evidence_invalid");
  });

  it("verifies receipts and records cost only as telemetry", () => {
    process.env.RUNPOD_GPU_USD_PER_SECOND = "0.0004";
    const verified = verifyMusicWorkerOutput({
      output: evidencedOutput(),
      bytes: toneWav(),
      expected,
      requireEvidence: true,
    });
    delete process.env.RUNPOD_GPU_USD_PER_SECOND;
    expect(verified.diagnostics.evidence).toBe("verified");
    expect(verified.diagnostics.estimatedCostUsd).toBe(0.001);
    expect(estimateWorkerCostUsd(2_500)).toBeNull();
  });

  it("persists bounded v2 receipt and candidate evidence", () => {
    const bytes = toneWav();
    const verified = verifyMusicWorkerOutput({
      output: v2EvidencedOutput(bytes),
      bytes,
      expected,
      requireEvidence: true,
    });
    expect(verified.quality.version).toBe("music-technical-v2");
    expect(verified.diagnostics.inputReceipt?.version).toBe(2);
    expect(verified.diagnostics.candidates[0].audioSha256).toHaveLength(64);
    expect(verified.diagnostics.candidates[0].sampling.topK).toBe(40);
  });

  it("fails closed when the runtime Worker revision drifts", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    (output.diagnostics as Record<string, unknown>).runtime = {
      engine_revision: "b".repeat(40),
    };
    process.env.MURMUR_MUSIC_RELEASE_SHA = "a".repeat(40);
    try {
      expect(() => verifyMusicWorkerOutput({
        output,
        bytes,
        expected,
        requireEvidence: true,
      })).toThrow("music_worker_revision_mismatch");
    } finally {
      delete process.env.MURMUR_MUSIC_RELEASE_SHA;
    }
  });

  it("bounds provider failure strings before persisting diagnostics", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    output.diagnostics.candidates[0].quality.failures = ["f".repeat(512)];
    output.diagnostics.candidates[0].quality.metrics = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`metric-${index}-${"k".repeat(80)}`, index]),
    );
    const verified = verifyMusicWorkerOutput({
      output,
      bytes,
      expected,
      requireEvidence: true,
    });
    expect(verified.diagnostics.candidates[0].quality?.failures)
      .toEqual(["f".repeat(128)]);
    const metrics = verified.diagnostics.candidates[0].quality?.metrics ?? {};
    expect(Object.keys(metrics)).toHaveLength(32);
    expect(Object.keys(metrics).every((key) => key.length <= 64)).toBe(true);
  });

  it("bounds provider runtime labels before durable persistence", () => {
    const output = evidencedOutput();
    output.diagnostics.runtime = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `runtime-${index}-${"k".repeat(80)}`,
        "v".repeat(256),
      ]),
    );
    const verified = verifyMusicWorkerOutput({
      output,
      bytes: toneWav(),
      expected,
      requireEvidence: true,
    });
    expect(Object.keys(verified.diagnostics.runtime)).toHaveLength(32);
    expect(Object.keys(verified.diagnostics.runtime).every((key) => key.length <= 64)).toBe(true);
    expect(Object.values(verified.diagnostics.runtime).every((value) => value.length <= 128)).toBe(true);
  });

  it("rejects v2 evidence when the delivered candidate digest drifts", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    output.diagnostics.candidates[0].audio_sha256 = "0".repeat(64);
    expect(() => verifyMusicWorkerOutput({
      output,
      bytes,
      expected,
      requireEvidence: true,
    })).toThrow("music_worker_candidate_digest_mismatch");
  });

  it("rejects inconsistent v2 candidate counts and gate versions", () => {
    const bytes = toneWav();
    const countDrift = v2EvidencedOutput(bytes);
    countDrift.diagnostics.candidate_count = 2;
    expect(() => verifyMusicWorkerOutput({
      output: countDrift,
      bytes,
      expected,
      requireEvidence: true,
    })).toThrow("music_worker_candidate_evidence_inconsistent");

    const gateDrift = v2EvidencedOutput(bytes);
    gateDrift.diagnostics.gate_version = MUSIC_QUALITY_GATE_COMPAT_VERSION;
    expect(() => verifyMusicWorkerOutput({
      output: gateDrift,
      bytes,
      expected,
      requireEvidence: true,
    })).toThrow("music_worker_candidate_evidence_inconsistent");
  });

  it("rejects requested conditioning that silently fell back", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    Object.assign(output.input_receipt_v2, {
      style_mix: 0.35,
      hum_sha256: "a".repeat(64),
      hum_accepted: true,
    });
    expect(() => verifyMusicWorkerOutput({
      output,
      bytes,
      expected: { ...expected, styleMix: 0.35, humSha256: "a".repeat(64) },
      requireEvidence: true,
    })).toThrow("music_conditioning_hum_not_applied");
  });

  it("rejects incomplete v2 pre-normalization evidence", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    output.diagnostics.candidates[0].conditioning.pre_normalization_rms = 0;
    expect(() => verifyMusicWorkerOutput({
      output,
      bytes,
      expected,
      requireEvidence: true,
      requireV2Evidence: true,
    })).toThrow("music_worker_candidate_conditioning_mismatch");
  });

  it("rejects a mismatched receipt", () => {
    expect(() => verifyMusicWorkerOutput({
      output: evidencedOutput(),
      bytes: toneWav(),
      expected: { ...expected, requestId: "wrong" },
      requireEvidence: true,
    })).toThrow("music_input_receipt_request_mismatch");
  });

  it("rejects unsupported receipt versions", () => {
    const output = evidencedOutput();
    output.input_receipt.version = 3;
    expect(() => verifyMusicWorkerOutput({
      output,
      bytes: toneWav(),
      expected,
      requireEvidence: true,
    })).toThrow("music_input_receipt_version_unsupported");
  });

  it("rejects an incomplete v2 rolling-compatibility envelope", () => {
    const bytes = toneWav();
    const output = v2EvidencedOutput(bytes);
    delete (output as Partial<typeof output>).quality;
    expect(() => verifyMusicWorkerOutput({
      output,
      bytes,
      expected,
      requireEvidence: true,
    })).toThrow("music_worker_v2_compatibility_evidence_missing");
  });

  it("requires explicit v2 evidence only after the v2 cutover", () => {
    expect(() => verifyMusicWorkerOutput({
      output: evidencedOutput(),
      bytes: toneWav(),
      expected,
      requireEvidence: true,
      requireV2Evidence: true,
    })).toThrow("music_worker_v2_evidence_missing");
  });

  it("rejects negative cost telemetry", () => {
    process.env.RUNPOD_GPU_USD_PER_SECOND = "0.0004";
    expect(estimateWorkerCostUsd(-1)).toBeNull();
    delete process.env.RUNPOD_GPU_USD_PER_SECOND;
  });
});
