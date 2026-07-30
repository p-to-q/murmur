import { APP_BUILD, APP_VERSION } from "../src/lib/release-metadata";

const input = process.argv[2]?.trim();
const expectedSha = process.argv[3]?.trim();
if (!input || !expectedSha) {
  throw new Error(
    "Usage: bun scripts/release-production-smoke.ts <deployment-url> <expected-full-sha>",
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
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/release`, {
        headers: smokeHeaders(),
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
      });
      const identity = await response.json() as {
        version?: unknown;
        build?: unknown;
        sha?: unknown;
      };
      if (!response.ok) throw new Error(`/api/release returned ${response.status}`);
      if (
        identity.sha !== expectedSha
        || identity.version !== APP_VERSION
        || identity.build !== APP_BUILD
      ) {
        throw new Error(
          `release identity mismatch: expected ${APP_VERSION}/${APP_BUILD}/${expectedSha}, got ${String(identity.version)}/${String(identity.build)}/${String(identity.sha)}`,
        );
      }
      console.log(`ok /api/release (${APP_VERSION} build ${APP_BUILD} ${expectedSha})`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await Bun.sleep(Math.min(1_000 * 2 ** (attempt - 1), 10_000));
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

console.log(`Release smoke passed for ${origin} at ${expectedSha}`);
