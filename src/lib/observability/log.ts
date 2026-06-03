import { recordRecentEvent } from "./recent-events";

type LogLevel = "info" | "warn" | "error";

/**
 * Canonical structured log events for the v2 cutover.
 *
 * Keep names aligned with docs/observability.md §2. Additive changes are OK;
 * renames are not, because dashboards and incident queries will depend on
 * these strings.
 */
export type LogEvent =
  | "auth.me_failed"
  | "auth.logout_failed"
  | "auth.session_revoked"
  | "capture.failed"
  | "capture.prepared"
  | "transcribe.requested"
  | "transcribe.completed"
  | "transcribe.failed"
  | "notes.spent"
  | "notes.granted"
  | "user.balance_failed"
  | "arrangement.generated"
  | "song.list_failed"
  | "song.created"
  | "song.create_failed"
  | "storage.local_serve_failed";

export interface LogContext {
  requestId?: string;
  userId?: string | null;
  sessionId?: string | null;
  shell?: "web" | "ios" | "android" | "wechat_mp" | "server";
  route?: string;
  region?: "intl" | "cn";
  durationMs?: number;
}

/**
 * Emit a single OpenTelemetry-shaped JSON line.
 *
 * This helper intentionally does not take raw audio, full melody note arrays,
 * email addresses, or arbitrary Error objects. Callers pass small diagnostic
 * summaries in `ext` so logs stay useful without leaking sensitive payloads.
 */
export function log(
  event: LogEvent,
  ext: Record<string, unknown> = {},
  context: LogContext & { level?: LogLevel } = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level: context.level ?? "info",
    msg: event,
    service: "web",
    region: context.region ?? "intl",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local",
    requestId: context.requestId ?? null,
    userId: context.userId ?? null,
    sessionId: context.sessionId ?? null,
    shell: context.shell ?? "web",
    route: context.route ?? null,
    durationMs: context.durationMs ?? null,
    ext,
  };

  recordRecentEvent({
    event,
    level: payload.level,
    ts: payload.ts,
    route: payload.route,
    requestId: payload.requestId,
    userId: payload.userId,
    shell: payload.shell,
    durationMs: payload.durationMs,
    ext,
  });

  const line = JSON.stringify(payload);
  if (payload.level === "error") {
    console.error(line);
    return;
  }
  if (payload.level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}
