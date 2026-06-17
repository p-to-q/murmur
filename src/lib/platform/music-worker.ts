/**
 * Resolution for the Magenta RealTime music worker transport.
 *
 * Two production transports run side by side and are switchable at runtime:
 *  - "serverless" — a RunPod Serverless endpoint (`RUNPOD_SERVERLESS_ENDPOINT_ID`
 *    + `RUNPOD_API_KEY`). Scale-to-zero; cheap when idle but a cold start can run
 *    minutes — far past the route's wait budget.
 *  - "http" — a long-lived HTTP worker (`MUSIC_WORKER_URL` + `MUSIC_WORKER_TOKEN`),
 *    e.g. a RunPod GPU *pod* running the FastAPI server (workers/music-engine/
 *    main.py), or the local `bun run dev:music` worker on :8002. A warm pod
 *    answers instantly; stop it when unused to stop paying for the GPU.
 *
 * `MUSIC_ENGINE_MODE` picks between them without unconfiguring either:
 *   "serverless" → force serverless · "http"/"pod" → force the HTTP worker ·
 *   "auto"/unset → serverless wins when configured, else the HTTP worker.
 * Flip the env var (+ redeploy) to switch the live transport. When neither
 * transport is configured the app stays on the legacy Tone.js synth engine.
 */

export type MusicEngineMode = "serverless" | "http";

export interface MusicServerlessConfig {
  endpointId: string;
  apiKey: string;
}

/** RunPod Serverless config (prod): endpoint id + API key used as the bearer. */
export function getMusicServerlessConfig(): MusicServerlessConfig | null {
  const endpointId = process.env.RUNPOD_SERVERLESS_ENDPOINT_ID?.trim();
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  if (endpointId && apiKey) return { endpointId, apiKey };
  return null;
}

/** Base URL for the legacy/dev HTTP worker, or null in prod when unset. */
export function getMusicWorkerUrl(): string | null {
  const configured = process.env.MUSIC_WORKER_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8002";
  return null;
}

/** Explicit transport preference from `MUSIC_ENGINE_MODE` (default "auto"). */
function getMusicModePreference(): MusicEngineMode | "auto" {
  const raw = process.env.MUSIC_ENGINE_MODE?.trim().toLowerCase();
  if (raw === "serverless") return "serverless";
  if (raw === "http" || raw === "pod" || raw === "worker") return "http";
  return "auto"; // "auto", unset, or unrecognized
}

/**
 * Which transport serves music generation right now?
 *  - "serverless" — RunPod Serverless.
 *  - "http"       — long-lived HTTP worker / GPU pod (or local dev on :8002).
 *  - null         — neither configured; the app stays on the legacy Tone.js engine.
 *
 * `MUSIC_ENGINE_MODE` forces a transport; when the forced one isn't configured
 * we fall back to the other rather than going dark. "auto" (the default)
 * prefers serverless when configured.
 */
export function getMusicEngineMode(): MusicEngineMode | null {
  const serverless = getMusicServerlessConfig() ? "serverless" : null;
  const http = getMusicWorkerUrl() ? "http" : null;
  const preference = getMusicModePreference();

  if (preference === "http") return http ?? serverless;
  if (preference === "serverless") return serverless ?? http;
  return serverless ?? http; // auto: serverless wins
}

/** True when this deployment is wired for Magenta (serverless, dev, or legacy URL). */
export function isMusicWorkerConfigured(): boolean {
  return getMusicEngineMode() !== null;
}
