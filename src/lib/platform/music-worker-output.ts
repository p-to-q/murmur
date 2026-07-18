import { createHash } from "node:crypto";

import {
  analyzePcm16Wav,
  MUSIC_QUALITY_GATE_VERSION,
  type MusicQualityGateResult,
} from "@/lib/music/music-output-quality";

export const MUSIC_QUALITY_EVIDENCE_REQUIRED_ENV =
  "MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED";
const MAX_PCM_BYTES_PER_SECOND = 96_000 * 2 * 2;
const MAX_WAV_CONTAINER_OVERHEAD_BYTES = 64 * 1024;

export interface MusicWorkerDiagnostics {
  version: number;
  gateVersion: string;
  evidence: "verified" | "legacy_missing";
  candidateCount: number;
  totalGenerationMs: number | null;
  workerWallMs: number | null;
  estimatedCostUsd: number | null;
  runtime: Record<string, string>;
  candidates: unknown[];
}

export interface VerifiedMusicOutput {
  quality: MusicQualityGateResult;
  diagnostics: MusicWorkerDiagnostics;
}

/**
 * Verify the RunPod protocol receipt plus the delivered PCM bytes.
 *
 * During the rolling Worker upgrade, old workers may omit protocol evidence.
 * The Web-side WAV Gate remains fail-closed; receipt evidence becomes strict
 * only after the endpoint is verified and the rollout env is enabled.
 */
export function verifyMusicWorkerOutput(input: {
  output: Record<string, unknown>;
  bytes: Uint8Array;
  expected: {
    requestId: string;
    prompt: string;
    duration: number;
    styleMix: number;
    melody: string;
    humSha256: string | null;
  };
  requireEvidence?: boolean;
}): VerifiedMusicOutput {
  const maxBytes = Math.ceil(input.expected.duration * MAX_PCM_BYTES_PER_SECOND)
    + MAX_WAV_CONTAINER_OVERHEAD_BYTES;
  if (input.bytes.byteLength > maxBytes) {
    throw new Error("music_delivery_quality_gate_failed:payload_too_large");
  }
  const quality = analyzePcm16Wav(input.bytes, input.expected.duration);
  if (!quality.passed) {
    throw new Error(`music_delivery_quality_gate_failed:${quality.failures.join(",")}`);
  }

  const receipt = objectValue(input.output.input_receipt);
  const workerQualityRaw = objectValue(input.output.quality);
  const evidencePresent = Boolean(receipt && workerQualityRaw);
  const partialEvidence = Boolean(receipt) !== Boolean(workerQualityRaw);
  const requireEvidence = input.requireEvidence ?? isMusicQualityEvidenceRequired();
  if (partialEvidence) throw new Error("music_worker_quality_evidence_invalid");
  if (!evidencePresent) {
    if (requireEvidence) throw new Error("music_worker_quality_evidence_missing");
    return {
      quality,
      diagnostics: {
        version: 1,
        gateVersion: quality.version,
        evidence: "legacy_missing",
        candidateCount: 1,
        totalGenerationMs: null,
        workerWallMs: null,
        estimatedCostUsd: null,
        runtime: {},
        candidates: [],
      },
    };
  }

  verifyInputReceipt(receipt!, input.expected);
  const workerQuality = parseWorkerQuality(workerQualityRaw);
  if (!workerQuality.passed || workerQuality.version !== MUSIC_QUALITY_GATE_VERSION) {
    throw new Error("music_worker_quality_gate_failed");
  }

  const diagnosticsRaw = objectValue(input.output.diagnostics);
  const runtimeRaw = objectValue(diagnosticsRaw?.runtime);
  const workerWallMs = finiteNumber(diagnosticsRaw?.worker_wall_ms);
  return {
    quality,
    diagnostics: {
      version: finiteNumber(diagnosticsRaw?.version) ?? 1,
      gateVersion: stringValue(diagnosticsRaw?.gate_version) || workerQuality.version,
      evidence: "verified",
      candidateCount: finiteNumber(diagnosticsRaw?.candidate_count) ?? 1,
      totalGenerationMs: finiteNumber(diagnosticsRaw?.total_generation_ms),
      workerWallMs,
      estimatedCostUsd: estimateWorkerCostUsd(workerWallMs),
      runtime: Object.fromEntries(
        Object.entries(runtimeRaw ?? {}).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value.slice(0, 128)]] : [],
        ),
      ),
      candidates: Array.isArray(diagnosticsRaw?.candidates)
        ? diagnosticsRaw.candidates.slice(0, 3)
        : [],
    },
  };
}

export function isMusicQualityEvidenceRequired(): boolean {
  const value = process.env[MUSIC_QUALITY_EVIDENCE_REQUIRED_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function estimateWorkerCostUsd(workerWallMs: number | null): number | null {
  const rate = Number(process.env.RUNPOD_GPU_USD_PER_SECOND);
  if (workerWallMs === null || workerWallMs < 0 || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return Math.round((workerWallMs / 1000) * rate * 1_000_000) / 1_000_000;
}

function verifyInputReceipt(
  receipt: Record<string, unknown>,
  expected: {
    requestId: string;
    prompt: string;
    duration: number;
    styleMix: number;
    melody: string;
    humSha256: string | null;
  },
): void {
  if (receipt.version !== 1) {
    throw new Error("music_input_receipt_version_unsupported");
  }
  if (receipt.request_id !== expected.requestId) {
    throw new Error("music_input_receipt_request_mismatch");
  }
  if (receipt.prompt_sha256 !== sha256(expected.prompt)) {
    throw new Error("music_input_receipt_prompt_mismatch");
  }
  if (!nearNumber(receipt.duration, expected.duration)) {
    throw new Error("music_input_receipt_duration_mismatch");
  }
  if (!nearNumber(receipt.style_mix, expected.styleMix)) {
    throw new Error("music_input_receipt_style_mismatch");
  }
  const melodyHash = expected.melody ? sha256(expected.melody) : null;
  if ((receipt.melody_sha256 ?? null) !== melodyHash) {
    throw new Error("music_input_receipt_melody_mismatch");
  }
  if (melodyHash && receipt.melody_accepted !== true) {
    throw new Error("music_input_receipt_melody_rejected");
  }
  if ((receipt.hum_sha256 ?? null) !== expected.humSha256) {
    throw new Error("music_input_receipt_hum_mismatch");
  }
}

function parseWorkerQuality(value: unknown): MusicQualityGateResult {
  const quality = objectValue(value);
  if (!quality || typeof quality.passed !== "boolean" || typeof quality.version !== "string") {
    throw new Error("music_worker_quality_evidence_invalid");
  }
  return {
    version: quality.version,
    passed: quality.passed,
    failures: Array.isArray(quality.failures)
      ? quality.failures.filter((item): item is string => typeof item === "string").slice(0, 16)
      : [],
    metrics: Object.fromEntries(
      Object.entries(objectValue(quality.metrics) ?? {}).flatMap(([key, item]) =>
        typeof item === "number" && Number.isFinite(item) ? [[key, item]] : [],
      ),
    ),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nearNumber(value: unknown, expected: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected) < 0.0001;
}
