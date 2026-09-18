import {
  detectAudioFilePrefix,
  detectAudioFileType,
} from "@/lib/audio/file-signature";
import { createHash } from "node:crypto";
import { APP_BUILD, APP_VERSION } from "../src/lib/release-metadata";
import {
  buildCanaryMelody,
  loadCanaryDatasetInputs,
} from "./release-music-provider-canary";

let origin: string;
let expectedSha: string;
let expectedResourceFingerprint: string | undefined;
const WORKFLOW_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const WORKFLOW_RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,9}$/;
const probes = [
  { path: "/", contentType: "text/html" },
  { path: "/gallery", contentType: "text/html" },
] as const;

async function probe(path: string, expectedContentType: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(`${origin}${path}`, {
        headers: smokeHeaders(),
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes(expectedContentType)) {
        throw new Error(`${path} returned ${response.status} ${contentType}`);
      }
      await response.arrayBuffer();
      console.log(`ok ${path} (${response.status})`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await Bun.sleep(Math.min(1_000 * 2 ** (attempt - 1), 10_000));
    }
  }
  throw lastError;
}

async function verifyReleaseIdentity() {
  let lastError: unknown;
  let consecutiveMatches = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const releaseUrl = new URL("/api/release", origin);
      releaseUrl.searchParams.set("smoke", `${Date.now()}-${attempt}`);
      const response = await fetch(releaseUrl, {
        cache: "no-store",
        headers: {
          ...smokeHeaders(),
          "Cache-Control": "no-cache",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      const identity = await parseReleaseIdentity(response);
      assertReleaseIdentity(identity, {
        version: APP_VERSION,
        build: APP_BUILD,
        sha: expectedSha,
        resourceFingerprint: expectedResourceFingerprint,
      });
      consecutiveMatches += 1;
      if (consecutiveMatches >= 3) {
        console.log(
          `ok /api/release x3 (${APP_VERSION} build ${APP_BUILD} ${expectedSha})`,
        );
        return;
      }
      await Bun.sleep(500);
    } catch (error) {
      lastError = error;
      consecutiveMatches = 0;
      if (attempt < 12)
        await Bun.sleep(
          Math.min(1_000 * 2 ** Math.min(attempt - 1, 3), 10_000),
        );
    }
  }
  throw lastError;
}

export async function parseReleaseIdentity(response: Response) {
  if (!response.ok) {
    throw new Error(`/api/release returned ${response.status}`);
  }
  return (await response.json()) as {
    version?: unknown;
    build?: unknown;
    sha?: unknown;
    resourceFingerprint?: unknown;
  };
}

export function assertReleaseIdentity(
  actual: Awaited<ReturnType<typeof parseReleaseIdentity>>,
  expected: {
    version: string;
    build: string;
    sha: string;
    resourceFingerprint?: string;
  },
) {
  if (
    actual.sha !== expected.sha
    || actual.version !== expected.version
    || actual.build !== expected.build
    || (expected.resourceFingerprint
      && actual.resourceFingerprint !== expected.resourceFingerprint)
  ) {
    throw new Error(
      `release identity mismatch: expected ${expected.version}/${expected.build}/${expected.sha}/${expected.resourceFingerprint ?? "unverified-resource-fingerprint"}, got ${String(actual.version)}/${String(actual.build)}/${String(actual.sha)}/${String(actual.resourceFingerprint)}`,
    );
  }
}

function smokeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "murmur-production-smoke",
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

async function main() {
  const input = process.argv[2]?.trim();
  expectedSha = process.argv[3]?.trim();
  expectedResourceFingerprint = process.env.EXPECTED_RELEASE_RESOURCE_FINGERPRINT?.trim();
  const requireAudio = process.argv.includes("--require-audio");
  const requireWorkerCanary = process.argv.includes("--require-worker-canary");
  if (!input || !expectedSha) {
    throw new Error(
      "Usage: bun scripts/release-production-smoke.ts <deployment-url> <expected-full-sha> [--require-audio] [--require-worker-canary]",
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    throw new Error(
      "Expected release SHA must contain exactly 40 hexadecimal characters",
    );
  }
  if (expectedResourceFingerprint && !/^[0-9a-f]{64}$/i.test(expectedResourceFingerprint)) {
    throw new Error(
      "EXPECTED_RELEASE_RESOURCE_FINGERPRINT must contain exactly 64 hexadecimal characters",
    );
  }
  origin = new URL(input).origin;

  await verifyReleaseIdentity();
  for (const probeDefinition of probes) {
    await probe(probeDefinition.path, probeDefinition.contentType);
  }
  await probeMusicHealth();

  const shareCode = process.env.MURMUR_SMOKE_SHARE_CODE?.trim();
  if (requireAudio && !shareCode) {
    throw new Error("MURMUR_SMOKE_SHARE_CODE is required for release audio smoke");
  }
  if (shareCode) {
    await probeAudio(
      `/api/public/songs/${encodeURIComponent(shareCode)}/audio`,
      {},
      "public share",
    );
  }

  const ownerSongId = process.env.MURMUR_SMOKE_SONG_ID?.trim();
  const ownerToken = process.env.MURMUR_SMOKE_SESSION_TOKEN?.trim();
  if (requireAudio && (!ownerSongId || !ownerToken)) {
    throw new Error(
      "MURMUR_SMOKE_SONG_ID and MURMUR_SMOKE_SESSION_TOKEN are required for release audio smoke",
    );
  }
  if (Boolean(ownerSongId) !== Boolean(ownerToken)) {
    throw new Error(
      "MURMUR_SMOKE_SONG_ID and MURMUR_SMOKE_SESSION_TOKEN must be set together",
    );
  }
  if (ownerSongId && ownerToken) {
    await probeAudio(
      `/api/songs/${encodeURIComponent(ownerSongId)}/audio`,
      { Authorization: `Bearer ${ownerToken}` },
      "owner song",
    );
  }

  if (requireWorkerCanary && !ownerToken) {
    throw new Error("MURMUR_SMOKE_SESSION_TOKEN is required for app Worker canary");
  }
  if (requireWorkerCanary && ownerToken) {
    const operationIds = buildWorkerCanaryOperationIds({
      releaseSha: expectedSha,
      workflowRunId: process.env.MURMUR_RELEASE_SMOKE_RUN_ID,
      workflowRunAttempt: process.env.MURMUR_RELEASE_SMOKE_RUN_ATTEMPT,
    });
    await probeDeployedWorkerPaths(ownerToken, operationIds);
  }

  console.log(`Release smoke passed for ${origin} at ${expectedSha}`);
}

export function buildWorkerCanaryOperationIds(input: {
  releaseSha: string;
  workflowRunId: string | undefined;
  workflowRunAttempt: string | undefined;
}): {
  batchId: string;
  transcriptionOperationId: string;
  musicClipOperationId: string;
} {
  const releaseSha = input.releaseSha.trim().toLowerCase();
  const workflowRunId = input.workflowRunId?.trim() ?? "";
  const workflowRunAttempt = input.workflowRunAttempt?.trim() ?? "";
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error("Worker canary release SHA must be an exact 40-character Git SHA");
  }
  if (!WORKFLOW_RUN_ID_PATTERN.test(workflowRunId)) {
    throw new Error("MURMUR_RELEASE_SMOKE_RUN_ID must be a positive GitHub workflow run id");
  }
  if (!WORKFLOW_RUN_ATTEMPT_PATTERN.test(workflowRunAttempt)) {
    throw new Error(
      "MURMUR_RELEASE_SMOKE_RUN_ATTEMPT must be a positive GitHub workflow run attempt",
    );
  }

  // Stable within one workflow attempt for HTTP retries and durable receipt
  // replay, but different for every workflow rerun of the same release SHA.
  const batchId = `rel_${releaseSha.slice(0, 12)}_r${workflowRunId}_a${workflowRunAttempt}`;
  return {
    batchId,
    transcriptionOperationId: `${batchId}_transcribe`,
    musicClipOperationId: `${batchId}_music`,
  };
}

export function assertMusicHealth(body: unknown): void {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("music health returned an invalid body");
  }
  const health = body as Record<string, unknown>;
  if (health.available !== true || health.configured !== true) {
    throw new Error(
      `music health unavailable: configured=${String(health.configured)} available=${String(health.available)} reason=${String(health.reason)}`,
    );
  }
}

async function probeMusicHealth(): Promise<void> {
  const response = await fetchWithRetry(`${origin}/api/music/health`, {
    headers: smokeHeaders(),
  });
  if (!response.ok) throw new Error(`music health returned ${response.status}`);
  assertMusicHealth(await response.json());
  console.log("ok /api/music/health (available)");
}

async function probeDeployedWorkerPaths(
  ownerToken: string,
  operationIds: ReturnType<typeof buildWorkerCanaryOperationIds>,
): Promise<void> {
  const manifestPath = process.env.MURMUR_CANARY_DATASET_MANIFEST?.trim();
  const datasetRoot = process.env.MURMUR_CANARY_DATASET_ROOT?.trim();
  const datasetRevision = process.env.MURMUR_CANARY_DATASET_REVISION?.trim();
  if (!manifestPath || !datasetRoot || !datasetRevision) {
    throw new Error("Pinned canary dataset paths and revision are required for app Worker smoke");
  }
  const [input] = await loadCanaryDatasetInputs({
    manifestPath,
    datasetRoot,
    datasetRevision,
  }, 1);
  if (!input) throw new Error("Pinned app Worker canary input is missing");

  const baseHeaders = {
    ...smokeHeaders(),
    Authorization: `Bearer ${ownerToken}`,
  };
  const transcribe = new FormData();
  transcribe.append("audio", new File([input.hum], "release-canary.wav", {
    type: "audio/wav",
  }));
  transcribe.append("targetInstrument", "piano");
  const transcribeAttempt = await fetchCanaryWithRetry("/api/transcribe", {
    method: "POST",
    headers: {
      ...baseHeaders,
      "x-operation-id": operationIds.transcriptionOperationId,
    },
    body: transcribe,
  }, 90_000);
  await assertCanaryResponseEvidence(transcribeAttempt, "transcription");
  const transcribeResponse = transcribeAttempt.response;
  const transcription = await parseJsonResponse(transcribeResponse, "transcription canary");
  const cleanMelody = objectValue(transcription.cleanMelody);
  if (!Array.isArray(cleanMelody?.notes) || cleanMelody.notes.length < 1) {
    throw new Error("transcription canary returned no clean melody notes");
  }
  console.log("ok deployed Audio Worker transcription");

  const duration = 8;
  const melody = buildCanaryMelody(input.expectedPitches, duration);
  const music = new FormData();
  music.append(
    "prompt",
    "warm piano and soft strings, clear instrumental melody, stable dynamics, clean ending",
  );
  music.append("duration", String(duration));
  music.append("styleMix", "0.35");
  music.append("melody", melody);
  music.append("hum", new File([input.hum], "release-canary.wav", {
    type: "audio/wav",
  }));
  const musicAttempt = await fetchCanaryWithRetry("/api/music/generate", {
    method: "POST",
    headers: {
      ...baseHeaders,
      "x-generation-batch-id": operationIds.batchId,
      "x-generation-clip-id": operationIds.musicClipOperationId,
    },
    body: music,
  }, 310_000);
  await assertCanaryResponseEvidence(musicAttempt, "music");
  const musicResponse = musicAttempt.response;
  const bytes = new Uint8Array(await musicResponse.arrayBuffer());
  const declaredDigest = musicResponse.headers.get("x-audio-sha256")?.toLowerCase();
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (
    musicResponse.headers.get("content-type")?.startsWith("audio/") !== true
    || !detectAudioFileType(bytes)
    || declaredDigest !== actualDigest
  ) {
    throw new Error("music canary audio identity or digest mismatch");
  }
  console.log("ok deployed music generation, evidence, revision, and audio integrity");
}

export async function fetchCanaryWithRetry(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  dependencies: {
    baseOrigin?: string;
    fetchImpl?: (
      input: string | URL | Request,
      init?: RequestInit,
    ) => Promise<Response>;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<{
  response: Response;
  retriedAfterAmbiguousFailure: boolean;
}> {
  const baseOrigin = dependencies.baseOrigin ?? origin;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? Bun.sleep;
  let lastError: unknown;
  let retriedAfterAmbiguousFailure = false;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseOrigin}${path}`, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status >= 500 && attempt < 2) {
        await response.arrayBuffer();
        retriedAfterAmbiguousFailure = true;
        await sleep(2_000);
        continue;
      }
      return { response, retriedAfterAmbiguousFailure };
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        retriedAfterAmbiguousFailure = true;
        await sleep(2_000);
      }
    }
  }
  throw lastError;
}

export function assertCanaryOperationEvidence(
  attempt: Awaited<ReturnType<typeof fetchCanaryWithRetry>>,
  kind: "transcription" | "music",
): void {
  const label = `${kind} canary`;
  const replayed = attempt.response.headers.get("x-murmur-operation-replayed");
  if (replayed === null) {
    if (kind === "transcription") return;
    throw new Error(`${label} omitted X-Murmur-Operation-Replayed`);
  }
  if (replayed === "false") return;
  if (replayed === "true") {
    if (attempt.retriedAfterAmbiguousFailure) return;
    throw new Error(
      `${label} replayed a receipt before any in-script retry; this does not prove a new provider call`,
    );
  }
  throw new Error(`${label} returned invalid X-Murmur-Operation-Replayed: ${replayed}`);
}

export async function assertCanaryResponseEvidence(
  attempt: Awaited<ReturnType<typeof fetchCanaryWithRetry>>,
  kind: "transcription" | "music",
): Promise<void> {
  if (!attempt.response.ok) {
    throw new Error(
      `${kind} canary returned ${attempt.response.status}: ${await boundedBody(attempt.response)}`,
    );
  }
  assertCanaryOperationEvidence(attempt, kind);
}

async function parseJsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}: ${await boundedBody(response)}`);
  }
  const body = await response.json() as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} returned invalid JSON`);
  }
  return body as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function boundedBody(response: Response): Promise<string> {
  return (await response.text()).slice(0, 512);
}

async function probeAudio(
  path: string,
  authHeaders: Record<string, string>,
  label: string,
) {
  const baseHeaders = {
    ...smokeHeaders(),
    ...authHeaders,
  };
  const head = await fetchWithRetry(`${origin}${path}`, {
    method: "HEAD",
    headers: baseHeaders,
  });
  assertAudioResponse(head, 200, label);
  if (head.headers.get("accept-ranges") !== "bytes") {
    throw new Error(`${label} HEAD omitted Accept-Ranges: bytes`);
  }

  const ranged = await fetchWithRetry(`${origin}${path}`, {
    headers: { ...baseHeaders, Range: "bytes=0-4095" },
  });
  assertAudioResponse(ranged, 206, label);
  if (!ranged.headers.get("content-range")?.startsWith("bytes 0-")) {
    throw new Error(`${label} range response omitted Content-Range`);
  }
  const bytes = new Uint8Array(await ranged.arrayBuffer());
  if (!detectAudioFilePrefix(bytes)) {
    throw new Error(`${label} did not return recognizable MP3/WAV bytes`);
  }

  const download = await fetchWithRetry(`${origin}${path}?download=1`, {
    method: "HEAD",
    headers: baseHeaders,
  });
  assertAudioResponse(download, 200, `${label} download`);
  if (!download.headers.get("content-disposition")?.startsWith("attachment;")) {
    throw new Error(`${label} download omitted attachment disposition`);
  }
  console.log(`ok ${label} audio (HEAD, Range, download)`);
}

function assertAudioResponse(response: Response, status: number, label: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status !== status || !contentType.startsWith("audio/")) {
    throw new Error(`${label} returned ${response.status} ${contentType}`);
  }
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status >= 500) {
        throw new Error(`${new URL(url).pathname} returned ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await Bun.sleep(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
    }
  }
  throw lastError;
}

if (import.meta.main) {
  await main();
}
