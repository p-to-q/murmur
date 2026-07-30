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
};

const defaultCleanup: AccountExitCleanup = {
  clearCreationData: () => useMurmurStore.getState().resetFlow(),
  clearLastRecording: clearRecordingBlob,
  clearNotificationItems: () => useNotificationStore.getState().clearAll(),
  clearMemoryEvents: () => memory.clearLocalEvents(),
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
