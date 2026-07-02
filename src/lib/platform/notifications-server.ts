import webpush from "web-push";
import { randomUUID } from "crypto";

import {
  disablePushSubscriptionByEndpoint,
  disablePushSubscriptionForUser,
  getActivePushSubscriptions,
  getActivePushSubscriptionsForUser,
  upsertPushSubscription,
  type WebPushSubscriptionJSON,
} from "@/lib/db/queries/push-subscriptions";
import type { PushSubscriptionRecord } from "@/lib/db/schema/push-subscriptions";
import { log } from "@/lib/observability/log";

export class NotificationPublishError extends Error {
  constructor(
    message: string,
    public readonly code: number,
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

export interface NotificationSubscribeDeviceInput {
  userId: string;
  sessionId?: string | null;
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

const DEFAULT_PUSH_LIMIT = 1000;
const PUSH_SEND_CONCURRENCY = 25;

export const notifications = {
  subscribeDevice(input: NotificationSubscribeDeviceInput) {
    return upsertPushSubscription(input);
  },

  unsubscribeDevice(input: { endpoint: string; userId: string }) {
    return disablePushSubscriptionForUser(input.endpoint, input.userId);
  },

  publish(input: NotificationUserPublishInput): Promise<NotificationPublishResult> {
    return publishToSubscriptions(input, () =>
      getActivePushSubscriptionsForUser(input.userId),
    );
  },

  publishBroadcast(input: NotificationPublishInput): Promise<NotificationPublishResult> {
    return publishToSubscriptions(input, () =>
      getActivePushSubscriptions(DEFAULT_PUSH_LIMIT),
    );
  },
};

async function publishToSubscriptions(
  input: NotificationPublishInput,
  loadSubscriptions: () => Promise<PushSubscriptionRecord[]>,
): Promise<NotificationPublishResult> {
  const publishId = createPublishId();
  const config = getWebPushConfig();
  if (!config.ok) {
    return {
      delivered: 0,
      failed: 0,
      removed: 0,
      publishId,
      title: input.title,
      skipped: true,
      reason: config.reason,
    };
  }

  webpush.setVapidDetails(
    config.subject,
    config.publicKey,
    config.privateKey,
  );

  const subscriptions = await loadSubscriptions();

  if (subscriptions.length === 0) {
    return {
      delivered: 0,
      failed: 0,
      removed: 0,
      publishId,
      title: input.title,
      skipped: true,
      reason: "No active browser push subscriptions are registered.",
    };
  }

  const payload = JSON.stringify({
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

  let delivered = 0;
  let failed = 0;
  let removed = 0;

  await mapWithConcurrency(
    subscriptions,
    PUSH_SEND_CONCURRENCY,
    async (subscription) => {
      try {
        await webpush.sendNotification(toWebPushSubscription(subscription), payload, {
          TTL: 60 * 60 * 24,
          timeout: 5000,
          urgency: "normal",
        });
        delivered += 1;
      } catch (error) {
        failed += 1;
        if (isGonePushEndpoint(error)) {
          await disablePushSubscriptionByEndpoint(subscription.endpoint);
          removed += 1;
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

  return {
    delivered,
    failed,
    removed,
    publishId,
    title: input.title,
  };
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
