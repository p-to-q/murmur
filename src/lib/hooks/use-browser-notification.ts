"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { request } from "@/lib/api/request";
import {
  getBrowserPushSubscription,
  unsubscribeBrowserPushLocally,
} from "@/lib/platform/browser-push";
import {
  addMurmurNotification,
  isBrowserAlertPreferenceEnabled,
  useNotificationStore,
  type MurmurNotificationKind,
} from "@/lib/store/notification-store";

type Permission = NotificationPermission | "unsupported";

let listeners: Array<() => void> = [];
let currentPermission: Permission = "default";
let activeSubscriptionSync: Promise<boolean> | null = null;

function getPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

function snapshot(): Permission {
  return currentPermission;
}

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((listener) => listener !== cb);
  };
}

function syncPermission(): void {
  const next = getPermission();
  if (next !== currentPermission) {
    currentPermission = next;
    for (const cb of listeners) cb();
  }
}

if (typeof window !== "undefined") {
  currentPermission = getPermission();
}

export function useBrowserNotification() {
  const permission = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "default" as Permission,
  );
  const browserAlertsEnabled = useNotificationStore(
    (state) => state.browserAlertsEnabled,
  );
  const setBrowserAlertsEnabled = useNotificationStore(
    (state) => state.setBrowserAlertsEnabled,
  );

  useEffect(() => {
    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  useEffect(() => {
    if (permission !== "granted" || !browserAlertsEnabled) return;
    void ensurePushSubscription();
  }, [browserAlertsEnabled, permission]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const notification = notificationFromServiceWorkerMessage(event.data);
      if (!notification) return;
      addMurmurNotification(notification);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<Permission> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserAlertsEnabled(false);
      return "unsupported";
    }
    const result = await Notification.requestPermission();
    syncPermission();
    setBrowserAlertsEnabled(result === "granted");
    return result;
  }, [setBrowserAlertsEnabled]);

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<Permission> => {
      const current = getPermission();
      if (!enabled) {
        void disablePushSubscription();
        setBrowserAlertsEnabled(false);
        return current;
      }
      if (current === "granted") {
        setBrowserAlertsEnabled(true);
        void ensurePushSubscription();
        syncPermission();
        return current;
      }
      if (current === "denied" || current === "unsupported") {
        setBrowserAlertsEnabled(false);
        syncPermission();
        return current;
      }
      const permissionResult = await requestPermission();
      setBrowserAlertsEnabled(permissionResult === "granted");
      if (permissionResult === "granted") {
        void ensurePushSubscription();
      }
      return permissionResult;
    },
    [requestPermission, setBrowserAlertsEnabled],
  );

  return {
    permission,
    browserAlertsEnabled,
    requestPermission,
    setBrowserAlertsEnabled: setEnabled,
  };
}

export function sendBrowserNotification(
  title: string,
  options?: NotificationOptions & { showWhileVisible?: boolean },
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!isBrowserAlertPreferenceEnabled()) return;
  if (Notification.permission !== "granted") return;
  const { showWhileVisible = false, ...notificationOptions } = options ?? {};
  if (!showWhileVisible && document.visibilityState === "visible") return;

  try {
    new Notification(title, {
      icon: "/icon.png",
      ...notificationOptions,
    });
  } catch {
    // Some browsers restrict Notification in embedded or local contexts.
  }
}

async function ensurePushSubscription(): Promise<boolean> {
  if (activeSubscriptionSync) return activeSubscriptionSync;
  activeSubscriptionSync = subscribeForPush()
    .catch(() => false)
    .finally(() => {
      activeSubscriptionSync = null;
    });
  return activeSubscriptionSync;
}

async function subscribeForPush(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  const keyResponse = await request("/api/notifications/push/public-key", {
    headers: { accept: "application/json" },
  });
  if (!keyResponse.ok) return false;
  const keyPayload = (await keyResponse.json().catch(() => null)) as
    | { enabled?: boolean; publicKey?: string | null }
    | null;
  if (!keyPayload?.enabled || !keyPayload.publicKey) return false;

  const registration = await navigator.serviceWorker.register(
    "/murmur-service-worker.js",
    { scope: "/" },
  );
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(keyPayload.publicKey),
  });

  const response = await request("/api/notifications/push/subscribe", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      locale: navigator.language || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    }),
  });

  return response.ok;
}

async function disablePushSubscription(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  try {
    const subscription = await getBrowserPushSubscription();
    if (!subscription) return;

    await request("/api/notifications/push/subscribe", {
      method: "DELETE",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});
    await unsubscribeBrowserPushLocally();
  } catch {
    // Browser push cleanup is best-effort when a user turns alerts off.
  }
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return buffer;
}

function notificationFromServiceWorkerMessage(data: unknown) {
  if (!isRecord(data) || data.type !== "murmur:notification") return null;
  const payload = data.payload;
  if (!isRecord(payload)) return null;

  const title = typeof payload.title === "string" ? payload.title : null;
  const body = typeof payload.body === "string" ? payload.body : null;
  if (!title || !body) return null;

  const rawKind = typeof payload.kind === "string" ? payload.kind : "system";
  const kind: MurmurNotificationKind =
    rawKind === "song_generated" || rawKind === "song_saved" || rawKind === "system"
      ? rawKind
      : "system";
  const href = typeof payload.href === "string" && payload.href.startsWith("/")
    ? payload.href
    : undefined;
  const sourceId =
    typeof payload.sourceId === "string"
      ? payload.sourceId
      : typeof payload.publishId === "string"
        ? payload.publishId
        : undefined;

  return {
    kind,
    title,
    body,
    href,
    sourceId,
    id: typeof payload.id === "string" ? payload.id : undefined,
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
