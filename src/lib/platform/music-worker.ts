/**
 * Resolution for the Magenta RealTime music worker base URL.
 *
 * In development it defaults to the local worker (`bun run dev:music`) so the
 * Magenta path lights up with zero config; in production it must be set
 * explicitly — when absent, the app quietly stays on the legacy synth engine.
 */
export function getMusicWorkerUrl(): string | null {
  const configured = process.env.MUSIC_WORKER_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8002";
  return null;
}
