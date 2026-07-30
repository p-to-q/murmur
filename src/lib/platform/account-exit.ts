"use client";

import { clearRecordingBlob } from "@/lib/audio/recording-cache";
import { memory } from "@/lib/platform/memory";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { useNotificationStore } from "@/lib/store/notification-store";

type AccountExitCleanup = {
  clearCreationData: () => void | Promise<void>;
  clearLastRecording: () => void | Promise<void>;
  clearNotificationItems: () => void | Promise<void>;
  clearMemoryEvents: () => void | Promise<void>;
  clearAccountStorage: () => void | Promise<void>;
};

const ACCOUNT_LOCAL_STORAGE_KEYS = ["murmur.local-user"] as const;
const ACCOUNT_SESSION_STORAGE_KEYS = [
  "murmur.checkout.baseline.v1",
  "murmur.local-creator.bootstrapped",
] as const;

function clearAccountStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of ACCOUNT_LOCAL_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Continue with session storage when local storage is unavailable.
  }
  try {
    for (const key of ACCOUNT_SESSION_STORAGE_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    // Private browsing can deny session storage; the remaining cleanup still ran.
  }
}

const defaultCleanup: AccountExitCleanup = {
  clearCreationData: () => useMurmurStore.getState().resetFlow(),
  clearLastRecording: clearRecordingBlob,
  clearNotificationItems: () => useNotificationStore.getState().clearAll(),
  clearMemoryEvents: () => memory.clearLocalEvents(),
  clearAccountStorage,
};

/**
 * Clear sensitive, account-scoped browser data after an account exit succeeds.
 * Each store is best-effort so one unavailable browser API cannot block the
 * remaining cleanup or leave the client attached to the previous identity.
 */
export async function clearAccountScopedDeviceData(
  cleanup: AccountExitCleanup = defaultCleanup,
): Promise<void> {
  const tasks = [
    cleanup.clearCreationData,
    cleanup.clearLastRecording,
    cleanup.clearNotificationItems,
    cleanup.clearMemoryEvents,
    cleanup.clearAccountStorage,
  ];

  await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
}

/** Run device cleanup only after the server-side account exit has succeeded. */
export async function completeAccountExit(
  exitAccount: () => Promise<void>,
  clearDeviceData: () => Promise<void> = clearAccountScopedDeviceData,
): Promise<void> {
  await exitAccount();
  await clearDeviceData();
}
