/**
 * Resolution for the Magenta RealTime music worker transport.
 *
 * Production runs on a RunPod Serverless endpoint (`RUNPOD_SERVERLESS_ENDPOINT_ID`
 * + `RUNPOD_API_KEY`). Local dev talks to the FastAPI worker over HTTP
 * (`bun run dev:music`, default `http://127.0.0.1:8002`); `MUSIC_WORKER_URL`
 * can also point at a legacy HTTP worker. When neither is configured the app
 * stays on the legacy Tone.js synth engine.
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

/**
 * Which transport serves music generation right now?
 *  - "serverless" — RunPod Serverless (prod); wins whenever configured.
 *  - "http"       — direct HTTP worker (local dev default, or legacy URL).
 *  - null         — neither; the app stays on the legacy Tone.js engine.
 */
export function getMusicEngineMode(): MusicEngineMode | null {
  if (getMusicServerlessConfig()) return "serverless";
  if (getMusicWorkerUrl()) return "http";
  return null;
}

/** True when this deployment is wired for Magenta (serverless, dev, or legacy URL). */
export function isMusicWorkerConfigured(): boolean {
  return getMusicEngineMode() !== null;
}
