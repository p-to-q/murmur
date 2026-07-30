const audioWorkerUrl = process.env.AUDIO_WORKER_URL?.trim();
if (!audioWorkerUrl) throw new Error("AUDIO_WORKER_URL is required");

const healthUrl = new URL("health", `${audioWorkerUrl.replace(/\/+$/, "")}/`);
const response = await fetch(healthUrl, {
  headers: { "User-Agent": "murmur-release-preflight" },
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
});
const contentType = response.headers.get("content-type") ?? "";
if (!response.ok || !contentType.includes("application/json")) {
  throw new Error(`Audio Worker health returned ${response.status} ${contentType}`);
}
const body = await response.json() as {
  status?: unknown;
  service?: unknown;
  detectorsReady?: unknown;
};
if (
  body.service !== "murmur-audio-engine"
  || body.status !== "ok"
  || body.detectorsReady !== true
) {
  throw new Error("Audio Worker health identity or detector readiness mismatch");
}
console.log("Audio Worker health preflight passed.");
