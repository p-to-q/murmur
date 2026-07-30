"use client";

import { clearRecordingBlob } from "@/lib/audio/recording-cache";
import {
  getBrowserPushSubscription,
  unsubscribeBrowserPushLocally,
} from "@/lib/platform/browser-push";
import { memory } from "@/lib/platform/memory";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { useNotificationStore } from "@/lib/store/notification-store";

export type AccountExitCleanupStep =
  | "creation-data"
  | "last-recording"
  | "notification-items"
  | "memory-events"
  | "account-storage"
  | "browser-push"
  | "device-cleanup";

type CleanupOutcome = boolean | void;

type AccountExitCleanup = {
  clearCreationData: () => CleanupOutcome | Promise<CleanupOutcome>;
  clearLastRecording: () => CleanupOutcome | Promise<CleanupOutcome>;
  clearNotificationItems: () => CleanupOutcome | Promise<CleanupOutcome>;
  clearMemoryEvents: () => CleanupOutcome | Promise<CleanupOutcome>;
  clearAccountStorage: () => CleanupOutcome | Promise<CleanupOutcome>;
  unsubscribeBrowserPush: () => CleanupOutcome | Promise<CleanupOutcome>;
};

export interface AccountExitCleanupFailure {
  step: AccountExitCleanupStep;
  reason: unknown;
}

export interface AccountExitCleanupResult {
  succeeded: AccountExitCleanupStep[];
  failed: AccountExitCleanupFailure[];
}

export interface AccountExitResult {
  serverExitSucceeded: true;
  deviceCleanup: AccountExitCleanupResult;
}

const ACCOUNT_LOCAL_STORAGE_KEYS = ["murmur.local-user"] as const;
const MEMORY_EVENTS_STORAGE_KEY = "murmur.memory-events";
const ACCOUNT_SESSION_STORAGE_KEYS = [
  "murmur.checkout.baseline.v1",
  "murmur.local-creator.bootstrapped",
] as const;

function clearAccountStorage(): boolean {
  if (typeof window === "undefined") return false;
  let succeeded = true;
  try {
    for (const key of ACCOUNT_LOCAL_STORAGE_KEYS)
      window.localStorage.removeItem(key);
  } catch {
    succeeded = false;
  }
  try {
    for (const key of ACCOUNT_SESSION_STORAGE_KEYS)
      window.sessionStorage.removeItem(key);
  } catch {
    succeeded = false;
  }
  return succeeded;
}

const defaultCleanup: AccountExitCleanup = {
  clearCreationData: () => useMurmurStore.getState().resetFlow(),
  clearLastRecording: clearRecordingBlob,
  clearNotificationItems: () => {
    useNotificationStore.getState().clearAll();
    return useNotificationStore.getState().items.length === 0;
  },
  clearMemoryEvents: () => {
    memory.clearLocalEvents();
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(MEMORY_EVENTS_STORAGE_KEY) === null;
    } catch {
      return false;
    }
  },
  clearAccountStorage,
  unsubscribeBrowserPush: async () => {
    const current = await getBrowserPushSubscription();
    if (!current) return true;
    await unsubscribeBrowserPushLocally();
    return (await getBrowserPushSubscription()) === null;
  },
};

/**
 * Clear sensitive, account-scoped browser data after an account exit succeeds.
 * Each store is best-effort so one unavailable browser API cannot block the
 * remaining cleanup. The result preserves every failure for logging or user
 * feedback instead of converting a partially completed cleanup into success.
 */
export async function clearAccountScopedDeviceData(
  cleanup: AccountExitCleanup = defaultCleanup,
): Promise<AccountExitCleanupResult> {
  const tasks: Array<
    readonly [
      AccountExitCleanupStep,
      () => CleanupOutcome | Promise<CleanupOutcome>,
    ]
  > = [
    ["creation-data", cleanup.clearCreationData],
    ["last-recording", cleanup.clearLastRecording],
    ["notification-items", cleanup.clearNotificationItems],
    ["memory-events", cleanup.clearMemoryEvents],
    ["account-storage", cleanup.clearAccountStorage],
    ["browser-push", cleanup.unsubscribeBrowserPush],
  ];

  const settled = await Promise.allSettled(
    tasks.map(([, task]) => Promise.resolve().then(task)),
  );
  const result: AccountExitCleanupResult = { succeeded: [], failed: [] };
  settled.forEach((entry, index) => {
    const step = tasks[index]?.[0];
    if (!step) return;
    if (entry.status === "fulfilled" && entry.value !== false) {
      result.succeeded.push(step);
      return;
    }
    result.failed.push({
      step,
      reason:
        entry.status === "rejected"
          ? entry.reason
          : new Error(`${step} cleanup did not complete`),
    });
  });
  return result;
}

/**
 * Run device cleanup only after the server-side account exit succeeds. A local
 * cleanup failure is returned as evidence and never reclassified as a failed
 * server logout/deletion.
 */
export async function completeAccountExit(
  exitAccount: () => Promise<void>,
  clearDeviceData: () => Promise<AccountExitCleanupResult> = clearAccountScopedDeviceData,
): Promise<AccountExitResult> {
  await exitAccount();
  let deviceCleanup: AccountExitCleanupResult;
  try {
    deviceCleanup = await clearDeviceData();
  } catch (reason) {
    deviceCleanup = {
      succeeded: [],
      failed: [{ step: "device-cleanup", reason }],
    };
  }
  return { serverExitSucceeded: true, deviceCleanup };
}
