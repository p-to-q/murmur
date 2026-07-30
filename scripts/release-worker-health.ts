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
const body = await response.json() as { status?: unknown; ready?: unknown };
if (body.status !== "ok" && body.ready !== true) {
  throw new Error("Audio Worker health did not report ready");
}
console.log("Audio Worker health preflight passed.");
