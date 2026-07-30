import { detectAudioFileType } from "@/lib/audio/file-signature";

const input = process.argv[2]?.trim();
const requireAudio = process.argv.includes("--require-audio");
if (!input) {
  throw new Error(
    "Usage: bun scripts/release-production-smoke.ts <production-url> [--require-audio]",
  );
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
        headers: { "User-Agent": "murmur-production-smoke" },
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

console.log(`Production smoke passed for ${origin}`);

async function probeAudio(
  path: string,
  authHeaders: Record<string, string>,
  label: string,
) {
  const baseHeaders = {
    "User-Agent": "murmur-production-smoke",
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
