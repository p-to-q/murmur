/**
 * Resolution for the Magenta RealTime music worker base URL.
 *
 * In development it defaults to the local worker (`bun run dev:music`) so the
 * Magenta path is always configured; use `bun run dev:stack` to boot it with
 * Next.js. In production set MUSIC_WORKER_URL explicitly — when absent, only
 * then does the app stay on the legacy Tone.js synth engine.
 */
export function getMusicWorkerUrl(): string | null {
  const configured = process.env.MUSIC_WORKER_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8002";
  return null;
}

/** True when this deployment is wired for Magenta (dev default or explicit URL). */
export function isMusicWorkerConfigured(): boolean {
  return getMusicWorkerUrl() !== null;
}
