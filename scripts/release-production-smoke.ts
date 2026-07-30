import { detectAudioFileType } from "@/lib/audio/file-signature";
import { APP_BUILD, APP_VERSION } from "../src/lib/release-metadata";

const input = process.argv[2]?.trim();
const expectedSha = process.argv[3]?.trim();
const requireAudio = process.argv.includes("--require-audio");
if (!input || !expectedSha) {
  throw new Error(
    "Usage: bun scripts/release-production-smoke.ts <deployment-url> <expected-full-sha> [--require-audio]",
  );
}
if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
  throw new Error("Expected release SHA must contain exactly 40 hexadecimal characters");
}

const origin = new URL(input).origin;
const probes = [
  { path: "/", contentType: "text/html" },
  { path: "/gallery", contentType: "text/html" },
  { path: "/api/music/health", contentType: "application/json" },
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
      const identity = (await response.json()) as {
        version?: unknown;
        build?: unknown;
        sha?: unknown;
      };
      if (!response.ok)
        throw new Error(`/api/release returned ${response.status}`);
      if (
        identity.sha !== expectedSha ||
        identity.version !== APP_VERSION ||
        identity.build !== APP_BUILD
      ) {
        throw new Error(
          `release identity mismatch: expected ${APP_VERSION}/${APP_BUILD}/${expectedSha}, got ${String(identity.version)}/${String(identity.build)}/${String(identity.sha)}`,
        );
      }
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

function smokeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "murmur-production-smoke",
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return headers;
}

await verifyReleaseIdentity();
for (const probeDefinition of probes) {
  await probe(probeDefinition.path, probeDefinition.contentType);
}

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

console.log(`Release smoke passed for ${origin} at ${expectedSha}`);

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
  if (!detectAudioFileType(bytes)) {
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
