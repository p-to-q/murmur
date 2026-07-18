import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import {
  estimateWorkerCostUsd,
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
      request_id: expected.requestId,
      prompt_sha256: createHash("sha256").update(expected.prompt).digest("hex"),
      duration: expected.duration,
      style_mix: expected.styleMix,
      melody_sha256: null,
      melody_accepted: false,
      hum_sha256: null,
    },
    quality: { version: "music-technical-v1", passed: true, failures: [], metrics: {} },
    diagnostics: {
      version: 1,
      gate_version: "music-technical-v1",
      candidate_count: 1,
      worker_wall_ms: 2_500,
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

  it("rejects a mismatched receipt", () => {
    expect(() => verifyMusicWorkerOutput({
      output: evidencedOutput(),
      bytes: toneWav(),
      expected: { ...expected, requestId: "wrong" },
      requireEvidence: true,
    })).toThrow("music_input_receipt_request_mismatch");
  });
});
