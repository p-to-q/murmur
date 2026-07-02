/**
 * Tiny in-memory ring buffer for the audio pipeline's most recent
 * observability events. This is the floor of the diagnostic surface
 * described in `docs/observability.md` §8 — single-process,
 * dev / single-instance focus, no persistence. When we ship a real
 * vendor backend (Phase 5+) this stops being the source of truth and
 * downgrades to a "last five seconds locally" overlay.
 *
 * Privacy: we deliberately drop any field whose key starts with `raw`
 * or whose stringified value exceeds 2048 chars, so the buffer never
 * captures audio bytes or full melody arrays even when a caller forgets.
 */

const TRACKED_EVENTS = new Set([
  "transcribe.requested",
  "transcribe.completed",
  "transcribe.failed",
  "capture.failed",
  "capture.prepared",
  "capture.stopped",
  "arrangement.generated",
]);

const BUFFER_LIMIT = 32;
const MAX_FIELD_LENGTH = 2048;
const PII_KEY_PREFIXES = ["raw", "audio"];

export interface RecentEvent {
  ts: string;
  level: "info" | "warn" | "error";
  event: string;
  route: string | null;
  requestId: string | null;
  userId: string | null;
  durationMs: number | null;
  shell: string | null;
  ext: Record<string, unknown>;
}

// In Next.js dev mode each compiled module instance gets its own copy
// of file-scoped state. Pinning the buffer to `globalThis` keeps the
// route handlers and the API reader looking at the same array. Safe in
// production too — Node only has one global per process.
const GLOBAL_KEY = "__murmur_recent_events__";
type GlobalShape = { [GLOBAL_KEY]?: RecentEvent[] };
function sharedBuffer(): RecentEvent[] {
  const root = globalThis as unknown as GlobalShape;
  if (!root[GLOBAL_KEY]) root[GLOBAL_KEY] = [];
  return root[GLOBAL_KEY];
}

export function recordRecentEvent(input: {
  event: string;
  level: "info" | "warn" | "error";
  ts: string;
  route: string | null;
  requestId: string | null;
  userId: string | null;
  shell: string | null;
  durationMs: number | null;
  ext: Record<string, unknown>;
}): void {
  if (!TRACKED_EVENTS.has(input.event)) return;
  const buffer = sharedBuffer();

  buffer.push({
    ts: input.ts,
    level: input.level,
    event: input.event,
    route: input.route,
    requestId: input.requestId,
    userId: input.userId,
    durationMs: input.durationMs,
    shell: input.shell,
    ext: redact(input.ext),
  });

  if (buffer.length > BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - BUFFER_LIMIT);
  }
}

export function getRecentEvents(): RecentEvent[] {
  return sharedBuffer().slice().reverse();
}

export function clearRecentEvents(): void {
  sharedBuffer().length = 0;
}

function redact(ext: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ext)) {
    if (PII_KEY_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) {
      cleaned[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
      cleaned[key] = `${value.slice(0, MAX_FIELD_LENGTH)}…`;
      continue;
    }
    if (Array.isArray(value) && value.length > 32) {
      cleaned[key] = `array(${value.length})`;
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}
