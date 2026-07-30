import webpush from "web-push";
import { randomUUID } from "crypto";

import {
  ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE,
  disablePushSubscriptionByEndpoint,
  disablePushSubscriptionForUser,
  getActivePushSubscriptionsForUser,
  getActivePushSubscriptionsPage,
  upsertPushSubscription,
  type WebPushSubscriptionJSON,
} from "@/lib/db/queries/push-subscriptions";
import type { PushSubscriptionRecord } from "@/lib/db/schema/push-subscriptions";
import type { Lang } from "@/lib/i18n/dict";
import {
  NOTIFICATION_FALLBACK_LANG,
  normalizeNotificationLocale,
} from "@/lib/notifications/notification-copy";
import { log } from "@/lib/observability/log";

export type NotificationErrorCode = "publish_failed" | "unauthorized" | "server_error";

export class NotificationPublishError extends Error {
  constructor(
    message: string,
    public readonly code: NotificationErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "NotificationPublishError";
  }
}

export interface NotificationPublishInput {
  title: string;
  body: string;
  data?: {
    href?: string;
    url?: string;
    tag?: string;
    kind?: string;
    source?: string;
    [key: string]: unknown;
  };
}

export type NotificationUserPublishInput = NotificationPublishInput & {
  userId: string;
};

export interface NotificationLocalizedBroadcastInput {
  /** Resolves the notification copy for a supported language. */
  resolveCopy: (lang: Lang) => { title: string; body: string };
  data?: NotificationPublishInput["data"];
}

export interface NotificationSubscribeDeviceInput {
  userId: string;
  sessionId: string;
  subscription: WebPushSubscriptionJSON;
  userAgent?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

export type NotificationPublishResult = {
  delivered: number;
  failed: number;
  removed: number;
  publishId: string;
  title: string;
  skipped?: true;
  reason?: string;
};

type WebPushErrorLike = Error & {
  statusCode?: number;
  body?: string;
};

const PUSH_SEND_CONCURRENCY = 25;
const NO_ACTIVE_SUBSCRIPTIONS_REASON =
  "No active browser push subscriptions are registered.";

/** Mutable delivery tally threaded through paginated broadcast delivery. */
type DeliveryCounters = { delivered: number; failed: number; removed: number };

/** Builds the per-subscription push payload. The seam #293 hooks for locale. */
type PayloadBuilder = (subscription: PushSubscriptionRecord) => string;

export const notifications = {
  subscribeDevice(input: NotificationSubscribeDeviceInput) {
    return upsertPushSubscription(input);
  },

  unsubscribeDevice(input: { endpoint: string; userId: string }) {
    return disablePushSubscriptionForUser(input.endpoint, input.userId);
  },

  publish(input: NotificationUserPublishInput): Promise<NotificationPublishResult> {
    return runPublish(input.title, async (publishId) => {
      const subscriptions = await getActivePushSubscriptionsForUser(input.userId);
      if (subscriptions.length === 0) {
        return { skipped: true, reason: NO_ACTIVE_SUBSCRIPTIONS_REASON };
      }
      const payload = serializeNotificationPayload(input, publishId);
      const counters: DeliveryCounters = { delivered: 0, failed: 0, removed: 0 };
      await deliverPage(subscriptions, () => payload, counters);
      return counters;
    });
  },

  publishBroadcast(input: NotificationPublishInput): Promise<NotificationPublishResult> {
    return runPublish(input.title, (publishId) => {
      const payload = serializeNotificationPayload(input, publishId);
      return deliverActiveSubscriptionPages(() => payload);
    });
  },

  /**
   * Broadcast to every active subscription in the recipient's own persisted
   * locale. Owns locale selection (#293); delivery completeness + scale stay in
   * {@link deliverActiveSubscriptionPages} (#312). Subscriptions are grouped by
   * normalized supported locale and one payload is built per locale group
   * (lazily, then reused), so the population is never materialized in memory.
   * Missing/unknown locales fall back to {@link NOTIFICATION_FALLBACK_LANG}.
   */
  publishLocalizedBroadcast(
    input: NotificationLocalizedBroadcastInput,
  ): Promise<NotificationPublishResult> {
    // The result summary title is representative only; use the fallback locale.
    const summaryTitle = input.resolveCopy(NOTIFICATION_FALLBACK_LANG).title;
    return runPublish(summaryTitle, (publishId) => {
      const payloadByLang = new Map<Lang, string>();
      const buildPayload: PayloadBuilder = (subscription) => {
        const lang = normalizeNotificationLocale(subscription.metadata?.locale);
        const cached = payloadByLang.get(lang);
        if (cached) return cached;
        const copy = input.resolveCopy(lang);
        const payload = serializeNotificationPayload(
          { title: copy.title, body: copy.body, data: input.data },
          publishId,
        );
        payloadByLang.set(lang, payload);
        return payload;
      };
      return deliverActiveSubscriptionPages(buildPayload);
    });
  },
};

/**
 * Shared publish envelope: mints a publish id, short-circuits with a skipped
 * result when Web Push is unconfigured (keeps local demos + saves working),
 * primes VAPID, then runs `deliver` and normalizes its outcome. `deliver`
 * returns either delivery counters or a `{ skipped }` marker (e.g. no
 * recipients).
 */
async function runPublish(
  title: string,
  deliver: (
    publishId: string,
  ) => Promise<DeliveryCounters | { skipped: true; reason: string }>,
): Promise<NotificationPublishResult> {
  const publishId = createPublishId();
  const config = getWebPushConfig();
  if (!config.ok) {
    return {
      delivered: 0,
      failed: 0,
      removed: 0,
      publishId,
      title,
      skipped: true,
      reason: config.reason,
    };
  }

  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);

  const outcome = await deliver(publishId);
  if ("skipped" in outcome) {
    return {
      delivered: 0,
      failed: 0,
      removed: 0,
      publishId,
      title,
      skipped: true,
      reason: outcome.reason,
    };
  }

  return {
    delivered: outcome.delivered,
    failed: outcome.failed,
    removed: outcome.removed,
    publishId,
    title,
  };
}

/**
 * Walk every active subscription in stable keyset pages and deliver to each
 * exactly once. Owns delivery completeness + scale (#312): payload selection is
 * delegated to `buildPayload` so locale grouping (#293) stays a separate
 * concern. Returns a skipped marker when there are no active recipients.
 */
async function deliverActiveSubscriptionPages(
  buildPayload: PayloadBuilder,
): Promise<DeliveryCounters | { skipped: true; reason: string }> {
  const counters: DeliveryCounters = { delivered: 0, failed: 0, removed: 0 };
  let cursor: string | null = null;
  let total = 0;

  for (;;) {
    const page = await getActivePushSubscriptionsPage({
      after: cursor,
      limit: ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE,
    });
    if (page.length === 0) break;
    total += page.length;
    await deliverPage(page, buildPayload, counters);
    if (page.length < ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }

  if (total === 0) {
    return { skipped: true, reason: NO_ACTIVE_SUBSCRIPTIONS_REASON };
  }
  return counters;
}

/**
 * Deliver a single page of subscriptions with bounded concurrency. Idempotent
 * on failure: `410/404` endpoints are disabled and counted as removed; other
 * errors are logged and counted as failed. `counters` is accumulated in place
 * across pages.
 */
async function deliverPage(
  subscriptions: PushSubscriptionRecord[],
  buildPayload: PayloadBuilder,
  counters: DeliveryCounters,
): Promise<void> {
  await mapWithConcurrency(
    subscriptions,
    PUSH_SEND_CONCURRENCY,
    async (subscription) => {
      try {
        await webpush.sendNotification(
          toWebPushSubscription(subscription),
          buildPayload(subscription),
          {
            TTL: 60 * 60 * 24,
            timeout: 5000,
            urgency: "normal",
          },
        );
        counters.delivered += 1;
      } catch (error) {
        counters.failed += 1;
        if (isGonePushEndpoint(error)) {
          await disablePushSubscriptionByEndpoint(subscription.endpoint);
          counters.removed += 1;
          return;
        }

        log("notifications.publish_failed", {
          endpointHost: safeEndpointHost(subscription.endpoint),
          statusCode: statusCodeFromPushError(error),
          error: error instanceof Error ? error.message : String(error),
        }, {
          userId: subscription.userId,
          sessionId: subscription.sessionId,
          level: "warn",
        });
      }
    },
  );
}

function serializeNotificationPayload(
  input: NotificationPublishInput,
  publishId: string,
): string {
  return JSON.stringify({
    title: input.title,
    body: input.body,
    icon: "/icon.png",
    badge: "/brand/murmur-app-icon-120-rounded.png",
    tag: input.data?.tag ?? input.data?.kind ?? "murmur-notification",
    data: {
      ...input.data,
      publishId,
    },
  });
}

export function getPublicWebPushKey() {
  const config = getWebPushConfig();
  if (!config.ok) {
    return { enabled: false as const, publicKey: null, reason: config.reason };
  }
  return { enabled: true as const, publicKey: config.publicKey, reason: null };
}

function getWebPushConfig():
  | { ok: true; publicKey: string; privateKey: string; subject: string }
  | { ok: false; reason: string } {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject =
    process.env.WEB_PUSH_SUBJECT?.trim()
    || process.env.MURMUR_APP_URL?.trim()
    || "mailto:notifications@murmur.local";

  if (!publicKey || !privateKey) {
    return {
      ok: false,
      reason:
        "WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY are not configured.",
    };
  }

  return { ok: true, publicKey, privateKey, subject };
}

function toWebPushSubscription(subscription: PushSubscriptionRecord) {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime?.getTime() ?? null,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
}

function createPublishId(): string {
  return `push-${randomUUID()}`;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), items.length) },
    async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += concurrency) {
        await task(items[index]);
      }
    },
  );
  await Promise.all(workers);
}

function isGonePushEndpoint(error: unknown): boolean {
  const statusCode = statusCodeFromPushError(error);
  return statusCode === 404 || statusCode === 410;
}

function statusCodeFromPushError(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const statusCode = (error as WebPushErrorLike).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

export function safeEndpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}
