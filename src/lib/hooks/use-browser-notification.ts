"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  isBrowserAlertPreferenceEnabled,
  useNotificationStore,
} from "@/lib/store/notification-store";

type Permission = NotificationPermission | "unsupported";

let listeners: Array<() => void> = [];
let currentPermission: Permission = "default";

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
      if (!enabled) {
        setBrowserAlertsEnabled(false);
        return getPermission();
      }
      const permissionResult = await requestPermission();
      setBrowserAlertsEnabled(permissionResult === "granted");
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
  options?: NotificationOptions,
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (!isBrowserAlertPreferenceEnabled()) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  try {
    new Notification(title, {
      icon: "/icon.png",
      ...options,
    });
  } catch {
    // Some browsers restrict Notification in embedded or local contexts.
  }
}
