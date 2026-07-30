import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import {
  isMusicDeliveryBase64WithinLimit,
  type VerifiedMusicOutput,
  verifyMusicWorkerOutput,
} from "../src/lib/platform/music-worker-output";
import { runJob } from "../src/lib/platform/runpod-serverless";

const duration = 10;
const styleMix = 0.35;
const prompt = "warm piano and soft strings, clear pulse, melodic development, consonant ending";
const MAX_CANARY_HUM_BYTES = 2 * 1024 * 1024;

interface CanaryDatasetInput {
  caseName: string;
  datasetRevision: string;
  expectedPitchCount: number;
  hum: Uint8Array;
  melody: string;
}

if (import.meta.main) {
  const expectedRevision = process.env.MURMUR_MUSIC_RELEASE_SHA?.trim();
  const expectedModel = process.env.MAGENTA_MODEL?.trim() || "mrt2_base";
  const endpointId = process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const manifestPath = process.env.MURMUR_CANARY_DATASET_MANIFEST?.trim();
  const datasetRoot = process.env.MURMUR_CANARY_DATASET_ROOT?.trim();
  const datasetRevision = process.env.MURMUR_CANARY_DATASET_REVISION?.trim();
  if (
    !endpointId
    || !apiKey
    || !expectedRevision
    || !/^[0-9a-f]{40}$/i.test(expectedRevision)
    || !manifestPath
    || !datasetRoot
    || !datasetRevision
    || !/^[0-9a-f]{40}$/i.test(datasetRevision)
  ) {
    throw new Error(
      "Provider credentials, immutable Worker SHA, and pinned canary dataset paths/revision are required",
    );
  }

  const conditioning = await loadCanaryDatasetInput({
    manifestPath,
    datasetRoot,
    datasetRevision,
  });
  const requestId = `release_canary_${Date.now()}`;
  const startedAt = performance.now();
  const output = await runJob(
    { endpointId, apiKey },
    {
      prompt,
      duration,
      style_mix: styleMix,
      melody: conditioning.melody,
      hum_b64: Buffer.from(conditioning.hum).toString("base64"),
      request_id: requestId,
    },
    { budgetMs: 295_000 },
  );
  const audioB64 = output.audio_b64;
  if (
    typeof audioB64 !== "string"
    || !audioB64
    || !isMusicDeliveryBase64WithinLimit(audioB64, duration)
  ) {
    throw new Error("Provider canary returned missing or oversized audio");
  }
  const bytes = new Uint8Array(Buffer.from(audioB64, "base64"));
  const verified = verifyMusicWorkerOutput({
    output,
    bytes,
    expected: {
      requestId,
      prompt,
      duration,
      styleMix,
      melody: conditioning.melody,
      humSha256: createHash("sha256").update(conditioning.hum).digest("hex"),
    },
    requireEvidence: true,
    requireV2Evidence: true,
  });
  const canaryIssues = collectProviderCanaryIssues({
    output,
    verified,
    expectedRevision,
    expectedModel,
  });
  if (canaryIssues.length > 0) {
    throw new Error(`Provider canary failed: ${canaryIssues.join("; ")}`);
  }

  const report = canaryReport({
    requestId,
    output,
    verified,
    bytes,
    clientWallMs: performance.now() - startedAt,
    conditioning,
  });
  const artifactDirectory = process.env.MURMUR_RELEASE_EVIDENCE_DIR?.trim();
  if (artifactDirectory) {
    await Bun.write(`${artifactDirectory}/music-provider-canary.wav`, bytes);
    await Bun.write(
      `${artifactDirectory}/music-provider-canary.json`,
      JSON.stringify(report, null, 2),
    );
  }
  console.log(JSON.stringify(report));
}

export function collectProviderCanaryIssues(input: {
  output: Record<string, unknown>;
  verified: VerifiedMusicOutput;
  expectedRevision: string;
  expectedModel: string;
}): string[] {
  const issues: string[] = [];
  const runtime = input.verified.diagnostics.runtime;
  if (input.output.model !== input.expectedModel || runtime.model !== input.expectedModel) {
    issues.push("unexpected music model");
  }
  if (runtime.backend_loaded !== "jax") issues.push("music backend is not jax");
  if (runtime.engine_revision !== input.expectedRevision) issues.push("music Worker revision mismatch");
  if (input.verified.diagnostics.inputReceipt?.humAccepted !== true) {
    issues.push("release canary hum was not accepted");
  }
  if (
    input.verified.diagnostics.inputReceipt?.melodyAccepted !== true
    || (input.verified.diagnostics.inputReceipt?.melodyValidNoteCount ?? 0) < 3
  ) {
    issues.push("release canary melody was not accepted");
  }
  if ((input.verified.quality.metrics.interiorDropoutCount ?? -1) !== 0) {
    issues.push("release canary contains interior dropouts");
  }
  return issues;
}

function canaryReport(input: {
  requestId: string;
  output: Record<string, unknown>;
  verified: VerifiedMusicOutput;
  bytes: Uint8Array;
  clientWallMs: number;
  conditioning: CanaryDatasetInput;
}) {
  const delivered = input.verified.diagnostics.candidates.at(-1);
  return {
    ok: true,
    requestId: input.requestId,
    inputReceipt: input.verified.diagnostics.inputReceipt,
    dataset: {
      name: "HumTrans",
      revision: input.conditioning.datasetRevision,
      case: input.conditioning.caseName,
      expectedPitchCount: input.conditioning.expectedPitchCount,
      humSha256: createHash("sha256").update(input.conditioning.hum).digest("hex"),
    },
    audioSha256: createHash("sha256").update(input.bytes).digest("hex"),
    outputBytes: input.bytes.byteLength,
    gateVersion: input.verified.quality.version,
    qualityMetrics: input.verified.quality.metrics,
    evidence: input.verified.diagnostics.evidence,
    candidateCount: input.verified.diagnostics.candidateCount,
    deliveredCandidate: delivered
      ? {
          attempt: delivered.attempt,
          audioSha256: delivered.audioSha256,
          generationMs: delivered.generationMs,
          sampling: delivered.sampling,
          conditioning: delivered.conditioning,
          quality: delivered.quality,
        }
      : null,
    runtime: input.verified.diagnostics.runtime,
    workerWallMs: input.verified.diagnostics.workerWallMs,
    totalGenerationMs: input.verified.diagnostics.totalGenerationMs,
    clientWallMs: Math.round(input.clientWallMs),
    estimatedCostUsd: input.verified.diagnostics.estimatedCostUsd,
  };
}

export async function loadCanaryDatasetInput(input: {
  manifestPath: string;
  datasetRoot: string;
  datasetRevision: string;
}): Promise<CanaryDatasetInput> {
  const parsed = await Bun.file(input.manifestPath).json() as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Canary manifest must contain exactly one frozen case");
  }
  const item = parsed[0];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error("Canary manifest case is invalid");
  }
  const record = item as Record<string, unknown>;
  const caseName = typeof record.name === "string" ? record.name.trim() : "";
  const relativePath = typeof record.path === "string" ? record.path.trim() : "";
  const pitches = Array.isArray(record.expected_pitches)
    ? record.expected_pitches.filter(
        (pitch): pitch is number => Number.isInteger(pitch) && pitch >= 0 && pitch <= 127,
      )
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  if (
    !caseName
    || !relativePath
    || pitches.length < 3
    || pitches.length !== (record.expected_pitches as unknown[])?.length
    || !tags.includes("midi_ref")
  ) {
    throw new Error("Canary manifest must contain one MIDI-annotated HumTrans case");
  }
  const root = resolve(input.datasetRoot);
  const audioPath = resolve(root, relativePath);
  const traversal = relative(root, audioPath);
  if (traversal.startsWith("..") || traversal === "" || resolve(root, traversal) !== audioPath) {
    throw new Error("Canary audio path escapes its dataset root");
  }
  const hum = new Uint8Array(await Bun.file(audioPath).arrayBuffer());
  if (
    hum.byteLength < 44
    || hum.byteLength > MAX_CANARY_HUM_BYTES
    || ascii(hum, 0, 4) !== "RIFF"
    || ascii(hum, 8, 12) !== "WAVE"
  ) {
    throw new Error("Canary hum must be one bounded PCM WAV input");
  }
  return {
    caseName,
    datasetRevision: input.datasetRevision,
    expectedPitchCount: pitches.length,
    hum,
    melody: buildCanaryMelody(pitches),
  };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function buildCanaryMelody(expectedPitches: number[]): string {
  const pitches = expectedPitches.slice(0, 16);
  if (pitches.length < 3) throw new Error("Canary melody needs at least three pitches");
  const step = (duration - 0.5) / pitches.length;
  return JSON.stringify({
    notes: pitches.map((pitch, index) => ({
      pitch,
      start: Math.round(index * step * 1_000) / 1_000,
      duration: Math.round(Math.max(0.15, step * 0.82) * 1_000) / 1_000,
    })),
  });
}
