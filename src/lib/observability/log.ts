import { formatReleaseIdentifier } from "@/lib/app-version";
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
  | "auth.local_creator_created"
  | "auth.local_creator_failed"
  | "auth.session_revoked"
  | "auth.signin_failed"
  | "auth.user_provisioned"
  | "auth.email_code_sent"
  | "auth.email_send_code_failed"
  | "auth.email_verify_failed"
  | "auth.oauth_adopt_existing_session_failed"
  | "auth.oauth_adopt_failed"
  | "account.delete_requested"
  | "account.delete_failed"
  | "capture.failed"
  | "capture.prepared"
  | "capture.stopped"
  | "transcribe.requested"
  | "transcribe.completed"
  | "transcribe.failed"
  | "notes.spent"
  | "notes.granted"
  | "notes.refund_failed"
  | "rate_limit.tripped"
  | "security.cross_origin_unsafe_request_blocked"
  | "user.balance_failed"
  | "arrangement.generated"
  | "magenta.batch_started"
  | "magenta.clip_ready"
  | "magenta.clip_failed"
  | "music.generate_requested"
  | "music.generate_completed"
  | "music.generate_failed"
  | "song.list_failed"
  | "song.created"
  | "song.create_failed"
  | "song.get_failed"
  | "song.share_failed"
  | "public_song.get_failed"
  | "song.update_failed"
  | "song.delete_failed"
  | "song.payload_invalid"
  | "purchases.restore_failed"
  | "user.profile_failed"
  | "notifications.publish_failed"
  | "notifications.subscribe_failed"
  | "notifications.unsubscribe_failed"
  | "billing.checkout_failed"
  | "billing.zpay_checkout_failed"
  | "billing.zpay_notify_failed"
  | "billing.reconcile_failed"
  | "billing.reconcile_mismatch"
  | "billing.reconcile_ok"
  | "billing.webhook_received"
  | "billing.webhook_failed"
  | "share.referral_failed"
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
    release: formatReleaseIdentifier(),
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
