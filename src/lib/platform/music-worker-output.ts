import { createHash } from "node:crypto";

import {
  analyzePcm16Wav,
  MUSIC_QUALITY_GATE_VERSION,
  type MusicQualityGateResult,
} from "@/lib/music/music-output-quality";

export const MUSIC_QUALITY_EVIDENCE_REQUIRED_ENV =
  "MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED";
export const MUSIC_V2_EVIDENCE_REQUIRED_ENV =
  "MURMUR_MUSIC_V2_EVIDENCE_REQUIRED";
const MAX_PCM_BYTES_PER_SECOND = 96_000 * 2 * 2;
const MAX_WAV_CONTAINER_OVERHEAD_BYTES = 64 * 1024;
const SUPPORTED_WORKER_GATE_VERSIONS = new Set([
  "music-technical-v1",
  MUSIC_QUALITY_GATE_VERSION,
]);

export interface MusicWorkerCandidateDiagnostics {
  candidateId: string | null;
  attempt: number;
  audioSha256: string | null;
  duplicateOfAttempt: number | null;
  generationMs: number | null;
  sampling: {
    temperature: number | null;
    topK: number | null;
    seedControl: string;
  };
  conditioning: {
    styleMix: number | null;
    melodyConditioned: boolean | null;
    melodySegments: number | null;
    melodyOnsets: number | null;
    melodyCoverage: number | null;
    cfgNotes: number | null;
    preNormalizationPeak: number | null;
    preNormalizationRms: number | null;
    normalizationGainDb: number | null;
  };
  quality: MusicQualityGateResult | null;
}

export interface MusicInputReceiptEvidence {
  version: number;
  requestId: string;
  promptSha256: string;
  duration: number;
  styleMix: number;
  melodySha256: string | null;
  melodyAccepted: boolean;
  melodyValidNoteCount: number | null;
  humSha256: string | null;
  humAccepted: boolean | null;
}

export interface MusicWorkerDiagnostics {
  version: number;
  gateVersion: string;
  evidence: "verified" | "legacy_missing";
  candidateCount: number;
  totalGenerationMs: number | null;
  workerWallMs: number | null;
  estimatedCostUsd: number | null;
  runtime: Record<string, string>;
  inputReceipt: MusicInputReceiptEvidence | null;
  candidates: MusicWorkerCandidateDiagnostics[];
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
  requireV2Evidence?: boolean;
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

  const receiptV2 = optionalObject(input.output, "input_receipt_v2");
  const qualityV2 = optionalObject(input.output, "quality_v2");
  const receiptCompat = optionalObject(input.output, "input_receipt");
  const qualityCompat = optionalObject(input.output, "quality");
  const receipt = receiptV2 ?? receiptCompat;
  const workerQualityRaw = qualityV2 ?? qualityCompat;
  const evidencePresent = Boolean(receipt && workerQualityRaw);
  const partialEvidence = Boolean(receipt) !== Boolean(workerQualityRaw);
  const requireEvidence = input.requireEvidence ?? isMusicQualityEvidenceRequired();
  const requireV2Evidence = input.requireV2Evidence ?? isMusicV2EvidenceRequired();
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
        inputReceipt: null,
        candidates: [],
      },
    };
  }
  if (requireV2Evidence && (!receiptV2 || !qualityV2)) {
    throw new Error("music_worker_v2_evidence_missing");
  }

  const inputReceipt = verifyInputReceipt(receipt!, input.expected);
  verifyAppliedConditioning(input.output, input.expected, inputReceipt.version);
  const workerQuality = parseWorkerQuality(workerQualityRaw);
  if (receiptV2 || qualityV2) {
    verifyV2CompatibilityEnvelopes({
      receiptV2,
      qualityV2,
      receiptCompat,
      qualityCompat,
      workerQuality,
    });
  }
  if (!workerQuality.passed || !SUPPORTED_WORKER_GATE_VERSIONS.has(workerQuality.version)) {
    throw new Error("music_worker_quality_gate_failed");
  }

  const diagnosticsRaw = objectValue(input.output.diagnostics);
  const runtimeRaw = objectValue(diagnosticsRaw?.runtime);
  const workerWallMs = finiteNumber(diagnosticsRaw?.worker_wall_ms);
  const diagnosticsVersion = finiteNumber(diagnosticsRaw?.version) ?? 1;
  const candidateCount = finiteNumber(diagnosticsRaw?.candidate_count) ?? 1;
  const candidates = Array.isArray(diagnosticsRaw?.candidates)
    ? diagnosticsRaw.candidates.slice(0, 3).map(parseCandidateDiagnostics)
    : [];
  if (workerQuality.version === MUSIC_QUALITY_GATE_VERSION) {
    verifyV2CandidateEvidence({
      candidates,
      candidateCount,
      diagnosticsVersion,
      diagnosticsGateVersion: stringValue(diagnosticsRaw?.gate_version),
      workerQualityVersion: workerQuality.version,
      bytes: input.bytes,
      expected: input.expected,
    });
  }
  return {
    quality,
    diagnostics: {
      version: diagnosticsVersion,
      gateVersion: stringValue(diagnosticsRaw?.gate_version) || workerQuality.version,
      evidence: "verified",
      candidateCount,
      totalGenerationMs: finiteNumber(diagnosticsRaw?.total_generation_ms),
      workerWallMs,
      estimatedCostUsd: estimateWorkerCostUsd(workerWallMs),
      runtime: Object.fromEntries(
        Object.entries(runtimeRaw ?? {}).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value.slice(0, 128)]] : [],
        ),
      ),
      inputReceipt,
      candidates,
    },
  };
}

export function isMusicQualityEvidenceRequired(): boolean {
  const value = process.env[MUSIC_QUALITY_EVIDENCE_REQUIRED_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function isMusicV2EvidenceRequired(): boolean {
  const value = process.env[MUSIC_V2_EVIDENCE_REQUIRED_ENV]?.trim().toLowerCase();
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
): MusicInputReceiptEvidence {
  if (receipt.version !== 1 && receipt.version !== 2) {
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
  const validNoteCount = finiteNumber(receipt.melody_valid_note_count);
  if (receipt.version === 2 && melodyHash && (validNoteCount === null || validNoteCount < 1)) {
    throw new Error("music_input_receipt_melody_unusable");
  }
  if (receipt.version === 2 && expected.humSha256 && receipt.hum_accepted !== true) {
    throw new Error("music_input_receipt_hum_rejected");
  }
  return {
    version: receipt.version,
    requestId: expected.requestId,
    promptSha256: stringValue(receipt.prompt_sha256),
    duration: expected.duration,
    styleMix: expected.styleMix,
    melodySha256: melodyHash,
    melodyAccepted: receipt.melody_accepted === true,
    melodyValidNoteCount: validNoteCount,
    humSha256: expected.humSha256,
    humAccepted: typeof receipt.hum_accepted === "boolean" ? receipt.hum_accepted : null,
  };
}

function verifyAppliedConditioning(
  output: Record<string, unknown>,
  expected: {
    styleMix: number;
    melody: string;
    humSha256: string | null;
  },
  receiptVersion: number,
): void {
  if (expected.humSha256 && expected.styleMix > 0) {
    const appliedStyleMix = finiteNumberish(output.style_mix);
    // The Worker reports applied mix with two decimal places in its public
    // protocol; the receipt above still verifies the exact requested value.
    if (appliedStyleMix === null || Math.abs(appliedStyleMix - expected.styleMix) > 0.0051) {
      throw new Error("music_conditioning_hum_not_applied");
    }
  }
  if (expected.melody.trim()) {
    const applied = output.melody_conditioned === true || output.melody_conditioned === "1";
    if (!applied) throw new Error("music_conditioning_melody_not_applied");
    if (receiptVersion >= 2) {
      const segments = finiteNumberish(output.melody_segments);
      const coverage = finiteNumberish(output.melody_coverage);
      if (segments === null || segments < 1 || coverage === null || coverage <= 0) {
        throw new Error("music_conditioning_melody_evidence_invalid");
      }
    }
  }
}

function parseCandidateDiagnostics(value: unknown): MusicWorkerCandidateDiagnostics {
  const candidate = objectValue(value) ?? {};
  const sampling = objectValue(candidate.sampling) ?? {};
  const conditioning = objectValue(candidate.conditioning) ?? {};
  const qualityRaw = objectValue(candidate.quality);
  let quality: MusicQualityGateResult | null = null;
  if (qualityRaw) {
    try {
      quality = parseWorkerQuality(qualityRaw);
    } catch {
      quality = null;
    }
  }
  return {
    candidateId: boundedToken(candidate.candidate_id, 64),
    attempt: Math.max(0, Math.trunc(finiteNumber(candidate.attempt) ?? 0)),
    audioSha256: sha256Token(candidate.audio_sha256),
    duplicateOfAttempt: integerOrNull(candidate.duplicate_of_attempt),
    generationMs: finiteNumber(candidate.generation_ms),
    sampling: {
      temperature: finiteNumber(sampling.temperature),
      topK: finiteNumber(sampling.top_k),
      seedControl: boundedToken(sampling.seed_control, 64) ?? "",
    },
    conditioning: {
      styleMix: finiteNumber(conditioning.style_mix),
      melodyConditioned: typeof conditioning.melody_conditioned === "boolean"
        ? conditioning.melody_conditioned
        : null,
      melodySegments: finiteNumber(conditioning.melody_segments),
      melodyOnsets: finiteNumber(conditioning.melody_onsets),
      melodyCoverage: finiteNumber(conditioning.melody_coverage),
      cfgNotes: finiteNumber(conditioning.cfg_notes),
      preNormalizationPeak: finiteNumber(conditioning.pre_normalization_peak),
      preNormalizationRms: finiteNumber(conditioning.pre_normalization_rms),
      normalizationGainDb: finiteNumber(conditioning.normalization_gain_db),
    },
    quality,
  };
}

function verifyV2CandidateEvidence(input: {
  candidates: MusicWorkerCandidateDiagnostics[];
  candidateCount: number;
  diagnosticsVersion: number;
  diagnosticsGateVersion: string;
  workerQualityVersion: string;
  bytes: Uint8Array;
  expected: {
    requestId: string;
    styleMix: number;
    melody: string;
  };
}): void {
  if (
    input.diagnosticsVersion !== 2
    || input.diagnosticsGateVersion !== input.workerQualityVersion
    || !Number.isInteger(input.candidateCount)
    || input.candidateCount < 1
    || input.candidateCount > 3
    || input.candidateCount !== input.candidates.length
  ) {
    throw new Error("music_worker_candidate_evidence_inconsistent");
  }
  const delivered = input.candidates.at(-1);
  if (!delivered || !delivered.quality?.passed || delivered.attempt < 1) {
    throw new Error("music_worker_candidate_evidence_missing");
  }
  if (
    delivered.quality.version !== input.workerQualityVersion
    || delivered.audioSha256 !== createHash("sha256").update(input.bytes).digest("hex")
    || delivered.candidateId !== sha256(
      `${input.expected.requestId}:${delivered.attempt}:${delivered.audioSha256}`,
    ).slice(0, 24)
    || delivered.duplicateOfAttempt !== null
  ) {
    throw new Error("music_worker_candidate_digest_mismatch");
  }
  const requestedMelody = Boolean(input.expected.melody.trim());
  if (
    delivered.sampling.temperature === null
    || delivered.sampling.temperature <= 0
    || delivered.sampling.topK === null
    || delivered.sampling.topK < 1
    || delivered.sampling.seedControl !== "library_managed"
    || delivered.conditioning.styleMix === null
    || Math.abs(delivered.conditioning.styleMix - input.expected.styleMix) > 0.0051
    || delivered.conditioning.melodyConditioned !== requestedMelody
    || (requestedMelody && (
      (delivered.conditioning.melodySegments ?? 0) < 1
      || (delivered.conditioning.melodyCoverage ?? 0) <= 0
      || (delivered.conditioning.cfgNotes ?? 0) <= 0
    ))
  ) {
    throw new Error("music_worker_candidate_conditioning_mismatch");
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

function verifyV2CompatibilityEnvelopes(input: {
  receiptV2: Record<string, unknown> | null;
  qualityV2: Record<string, unknown> | null;
  receiptCompat: Record<string, unknown> | null;
  qualityCompat: Record<string, unknown> | null;
  workerQuality: MusicQualityGateResult;
}): void {
  if (!input.receiptV2 || !input.qualityV2 || !input.receiptCompat || !input.qualityCompat) {
    throw new Error("music_worker_v2_compatibility_evidence_missing");
  }
  const compatibleQuality = parseWorkerQuality(input.qualityCompat);
  if (
    input.receiptV2.version !== 2
    || input.receiptCompat.version !== 1
    || input.receiptV2.request_id !== input.receiptCompat.request_id
    || input.qualityV2.version !== MUSIC_QUALITY_GATE_VERSION
    || compatibleQuality.version !== "music-technical-v1"
    || compatibleQuality.passed !== input.workerQuality.passed
  ) {
    throw new Error("music_worker_v2_compatibility_evidence_invalid");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalObject(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  if (!(key in parent)) return null;
  const value = objectValue(parent[key]);
  if (!value) throw new Error("music_worker_quality_evidence_invalid");
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteNumberish(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : Math.trunc(number);
}

function boundedToken(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}

function sha256Token(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function nearNumber(value: unknown, expected: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value - expected) < 0.0001;
}
