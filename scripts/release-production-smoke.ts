const input = process.argv[2]?.trim();
if (!input) throw new Error("Usage: bun scripts/release-production-smoke.ts <production-url>");

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

console.log(`Production smoke passed for ${origin}`);
