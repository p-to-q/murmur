"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

type Permission = NotificationPermission | "unsupported";

let listeners: Array<() => void> = [];
let currentPermission: Permission = "default";

function getPermission(): Permission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function snapshot(): Permission {
  return currentPermission;
}

function subscribe(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
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
  const permission = useSyncExternalStore(subscribe, snapshot, () => "default" as Permission);

  const requestPermission = useCallback(async (): Promise<NotificationPermission | "unsupported"> => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    const result = await Notification.requestPermission();
    syncPermission();
    return result;
  }, []);

  return { permission, requestPermission };
}

export function sendBrowserNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  try {
    new Notification(title, {
      icon: "/icon.png",
      ...options,
    });
  } catch {
    // Silently ignore — some browsers restrict Notification in certain contexts
  }
}
