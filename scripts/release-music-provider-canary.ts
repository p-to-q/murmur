import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

import {
  isMusicDeliveryBase64WithinLimit,
  type VerifiedMusicOutput,
  verifyMusicWorkerOutput,
} from "../src/lib/platform/music-worker-output";
import { runJob } from "../src/lib/platform/runpod-serverless";

const MAX_CANARY_HUM_BYTES = 2 * 1024 * 1024;
const CANARY_PROFILES = [
  {
    id: "melodic",
    duration: 10,
    styleMix: 0.35,
    prompt: "warm piano and soft strings, clear pulse, melodic development, consonant ending",
  },
  {
    id: "rhythmic",
    duration: 12,
    styleMix: 0.55,
    prompt: "organic percussion and bass, coherent groove, distinct melodic phrases, clean ending",
  },
  {
    id: "sparse",
    duration: 8,
    styleMix: 0.2,
    prompt: "intimate strings and piano, spacious arrangement, audible melody, stable dynamics",
  },
] as const;

interface CanaryDatasetInput {
  caseName: string;
  audioPath: string;
  audioSha256: string;
  datasetRevision: string;
  expectedPitchCount: number;
  expectedPitches: number[];
  hum: Uint8Array;
}

if (import.meta.main) {
  const expectedRevision = process.env.MURMUR_MUSIC_RELEASE_SHA?.trim();
  const expectedModel = process.env.MAGENTA_MODEL?.trim() || "mrt2_base";
  const endpointId = process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const manifestPath = process.env.MURMUR_CANARY_DATASET_MANIFEST?.trim();
  const datasetRoot = process.env.MURMUR_CANARY_DATASET_ROOT?.trim();
  const datasetRevision = process.env.MURMUR_CANARY_DATASET_REVISION?.trim();
  const profileCount = parseCanaryProfileCount(
    process.env.MURMUR_CANARY_PROFILE_LIMIT,
  );
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

  const conditioningInputs = await loadCanaryDatasetInputs({
    manifestPath,
    datasetRoot,
    datasetRevision,
  }, profileCount);
  const artifactDirectory = process.env.MURMUR_RELEASE_EVIDENCE_DIR?.trim();
  const reports = [];
  for (const [index, profile] of CANARY_PROFILES.slice(0, profileCount).entries()) {
    const conditioning = conditioningInputs[index]!;
    const requestId = `release_canary_${profile.id}_${Date.now()}`;
    const startedAt = performance.now();
    const output = await runJob(
      { endpointId, apiKey },
      {
        prompt: profile.prompt,
        duration: profile.duration,
        style_mix: profile.styleMix,
        melody: buildCanaryMelody(conditioning.expectedPitches, profile.duration),
        hum_b64: Buffer.from(conditioning.hum).toString("base64"),
        request_id: requestId,
      },
      { budgetMs: 295_000 },
    );
    const audioB64 = output.audio_b64;
    if (
      typeof audioB64 !== "string"
      || !audioB64
      || !isMusicDeliveryBase64WithinLimit(audioB64, profile.duration)
    ) {
      throw new Error(`Provider canary ${profile.id} returned missing or oversized audio`);
    }
    const bytes = new Uint8Array(Buffer.from(audioB64, "base64"));
    const melody = buildCanaryMelody(conditioning.expectedPitches, profile.duration);
    const verified = verifyMusicWorkerOutput({
      output,
      bytes,
      expected: {
        requestId,
        prompt: profile.prompt,
        duration: profile.duration,
        styleMix: profile.styleMix,
        melody,
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
      throw new Error(`Provider canary ${profile.id} failed: ${canaryIssues.join("; ")}`);
    }

    const report = canaryReport({
      requestId,
      output,
      verified,
      bytes,
      clientWallMs: performance.now() - startedAt,
      conditioning,
      profile,
    });
    reports.push(report);
    if (artifactDirectory) {
      await Bun.write(
        `${artifactDirectory}/music-provider-canary-${String(index + 1).padStart(2, "0")}-${profile.id}.wav`,
        bytes,
      );
    }
  }
  const aggregate = { ok: true, caseCount: reports.length, cases: reports };
  if (artifactDirectory) {
    await Bun.write(
      `${artifactDirectory}/music-provider-canary.json`,
      JSON.stringify(aggregate, null, 2),
    );
  }
  console.log(JSON.stringify(aggregate));
}

export function parseCanaryProfileCount(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return CANARY_PROFILES.length;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > CANARY_PROFILES.length) {
    throw new Error(`MURMUR_CANARY_PROFILE_LIMIT must be between 1 and ${CANARY_PROFILES.length}`);
  }
  return parsed;
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
  profile: (typeof CANARY_PROFILES)[number];
}) {
  const delivered = input.verified.diagnostics.candidates.at(-1);
  return {
    ok: true,
    requestId: input.requestId,
    profile: input.profile,
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

export async function loadCanaryDatasetInputs(input: {
  manifestPath: string;
  datasetRoot: string;
  datasetRevision: string;
}, caseCount = CANARY_PROFILES.length): Promise<CanaryDatasetInput[]> {
  if (!Number.isInteger(caseCount) || caseCount < 1 || caseCount > CANARY_PROFILES.length) {
    throw new Error(`Canary case count must be between 1 and ${CANARY_PROFILES.length}`);
  }
  const parsed = await Bun.file(input.manifestPath).json() as unknown;
  if (!Array.isArray(parsed) || parsed.length !== caseCount) {
    throw new Error(`Canary manifest must contain exactly ${caseCount} frozen cases`);
  }
  const cases = await Promise.all(parsed.map((item) => loadCanaryDatasetCase(item, input)));
  const names = new Set(cases.map((item) => item.caseName));
  const paths = new Set(cases.map((item) => item.audioPath));
  const digests = new Set(cases.map((item) => item.audioSha256));
  if (
    names.size !== cases.length
    || paths.size !== cases.length
    || digests.size !== cases.length
  ) {
    throw new Error("Canary manifest must contain distinct names, paths, and audio inputs");
  }
  return cases;
}

async function loadCanaryDatasetCase(
  item: unknown,
  input: { datasetRoot: string; datasetRevision: string },
): Promise<CanaryDatasetInput> {
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
    throw new Error("Every canary manifest case must be MIDI-annotated HumTrans audio");
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
    audioPath,
    audioSha256: createHash("sha256").update(hum).digest("hex"),
    datasetRevision: input.datasetRevision,
    expectedPitchCount: pitches.length,
    expectedPitches: pitches,
    hum,
  };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

export function buildCanaryMelody(expectedPitches: number[], duration = 10): string {
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
